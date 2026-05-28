// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { assertSufficientStock, decrementStockBalanceStrict, incrementStockBalance } from "../lib/stock"
import { allocateProductLots } from "../lib/stockLots"
import { reserveNextNumber } from "../lib/numbering"
import { resolveTenantCompany } from "../lib/companyResolver"
import { readAnafHeader } from "../lib/anafHttp"
import { drawDocumentHero, drawInfoCards, drawSimpleTable, drawSignatureRow, drawTotalsBox, ensurePdfPage, pdfDate, pdfFmt, pdfText, registerPdfFonts } from "../lib/professionalPdf"
import { requireRequestCompanyId, resolveRequestCompany } from "../lib/companyScope"
import { generateTransferETransportXml, validateTransferForETransport } from "../lib/etransport"
import { resolveWarehouseForLocation } from "../lib/warehouse"
import {
  anafCheckEtransportStatus,
  anafDownloadEtransportById,
  anafListEtransportMessages,
  anafUploadEtransportXml,
  loadAnafCompanyContext,
  logAnafRouteError,
} from "../lib/anafClient"
import {
  extractDownloadId,
  normalizeCompanyCui,
  summarizeAnafResponse,
} from "../lib/incomingEfactura"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function fmt(value: any, digits = 2) {
  return toNumber(value).toFixed(digits)
}

function fmtDate(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function fmtDateTime(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("ro-RO")
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function text(value: any) {
  const t = String(value || "").trim()
  return t || "-"
}

function classifyEtransportStatus(payload: any, rawText: string) {
  const textBlob = `${JSON.stringify(payload || {})} ${rawText}`.toLowerCase()
  if (/(nok|respins|rejected|eroare|error|invalid)/i.test(textBlob)) return "REJECTED"
  if (/(ok|acceptat|accepted|validat|uit|disponibil|descarcare)/i.test(textBlob)) return "ACCEPTED"
  return "SENT"
}

function explainEtransportAnafError(status: number, summary: string) {
  const message = String(summary || "").trim()
  if (status === 403 || /^forbidden$/i.test(message)) {
    return "ANAF a refuzat cererea RO e-Transport. Cel mai probabil aplicatia OAuth/tokenul curent nu are serviciul E-Transport activat in ANAF."
  }
  return message || "ANAF a respins operatiunea RO e-Transport."
}

function extractUit(raw: string) {
  const match = String(raw || "").match(/\bUIT\b[^A-Z0-9]*([A-Z0-9\-]{6,})/i)
  return match?.[1] || ""
}

async function resolveEtransportDownloadId(company: any, doc: any) {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif || !company?.efacturaOauthAccessToken || !doc?.eTransportUploadIndex) {
    return ""
  }

  const listResult = await anafListEtransportMessages(company, { days: 60, cif })
  const matched = listResult.items.find((item: any) => {
    const blob = JSON.stringify(item || {}).toLowerCase()
    return blob.includes(String(doc.eTransportUploadIndex).toLowerCase()) || blob.includes(String(doc.docNo || "").toLowerCase())
  })

  return (
    extractDownloadId(matched, JSON.stringify(matched || {})) ||
    extractDownloadId(listResult.payload, listResult.rawText)
  )
}

function serializeTransferDoc(doc: any) {
  if (!doc) return doc

  const serializeProduct = (product: any) => {
    if (!product) return product
    return {
      ...product,
      price: toNumber(product.price),
      costPrice: toNumber(product.costPrice),
      purchaseFactor: toNumber(product.purchaseFactor || 1),
      grossWeightKg: toNumber(product.grossWeightKg || 0),
      sgrValue: toNumber(product.sgrValue),
      vatRate: product.vatRate
        ? {
            ...product.vatRate,
            rate: toNumber(product.vatRate.rate)
          }
        : product.vatRate
    }
  }

  const items = Array.isArray(doc.items)
    ? doc.items.map((item: any) => ({
        ...item,
        qty: toNumber(item.qty),
        unitPrice: toNumber(item.unitPrice),
        lineValue: toNumber(item.lineValue),
        vatRateValue: toNumber(item.vatRateValue),
        lotAllocations: Array.isArray(item.lotAllocations)
          ? item.lotAllocations.map((allocation: any) => ({
              id: allocation.id,
              qty: toNumber(allocation.qty),
              unitCost: toNumber(allocation.unitCost),
              totalValue: toNumber(allocation.totalValue),
              lotNo: allocation.lotNo || "-",
              expiryDate: allocation.expiryDate || null,
              sourceStockLotId: allocation.sourceStockLotId,
              destinationStockLotId: allocation.destinationStockLotId || null,
            }))
          : [],
        product: serializeProduct(item.product),
        vatRate: item.vatRate
          ? {
              ...item.vatRate,
              rate: toNumber(item.vatRate.rate)
            }
          : item.vatRate
      }))
    : doc.items

  return {
    ...doc,
    eTransportVehicleMaxMassKg: toNumber(doc.eTransportVehicleMaxMassKg || 0),
    eTransportStartAddress: String(doc.eTransportStartAddress || ""),
    eTransportEndAddress: String(doc.eTransportEndAddress || ""),
    eTransportStartBorderPoint: String(doc.eTransportStartBorderPoint || ""),
    eTransportEndBorderPoint: String(doc.eTransportEndBorderPoint || ""),
    eTransportTransportDocType: String(doc.eTransportTransportDocType || ""),
    eTransportTransportDocNo: String(doc.eTransportTransportDocNo || ""),
    eTransportTransportDocDate: doc.eTransportTransportDocDate ? new Date(doc.eTransportTransportDocDate).toISOString() : "",
    eTransportTransportDocNotes: String(doc.eTransportTransportDocNotes || ""),
    eTransportExtraInfo: String(doc.eTransportExtraInfo || ""),
    totalQty: toNumber(doc.totalQty),
    totalValue: toNumber(doc.totalValue),
    items
  }
}

function buildETransportSummary(items: any[], vehicleMaxMassKg: number) {
  const normalizedItems = Array.isArray(items) ? items : []
  const totalGrossWeightKg = normalizedItems.reduce((sum, item) => {
    const qty = toNumber(item?.qty)
    const grossWeightKg = toNumber(item?.product?.grossWeightKg || 0)
    return sum + qty * grossWeightKg
  }, 0)
  const totalValueRon = normalizedItems.reduce((sum, item) => {
    return sum + toNumber(item?.lineValue)
  }, 0)
  const hasFiscalRiskProducts = normalizedItems.some((item) => item?.product?.isFiscalRiskProduct === true)
  const thresholdsReached = totalGrossWeightKg > 500 || totalValueRon > 10000
  const vehicleEligible = vehicleMaxMassKg >= 2500
  const candidate = hasFiscalRiskProducts && thresholdsReached
  const required = candidate && vehicleEligible

  return {
    candidate,
    required,
    hasFiscalRiskProducts,
    thresholdsReached,
    vehicleEligible,
    totalGrossWeightKg,
    totalValueRon,
  }
}

function registerFonts(doc: PDFKit.PDFDocument) {
  const regularCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf"
  ]

  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
  ]

  const regularPath = regularCandidates.find((p) => fs.existsSync(p))
  const boldPath = boldCandidates.find((p) => fs.existsSync(p))

  if (regularPath) doc.registerFont("AppRegular", regularPath)
  if (boldPath) doc.registerFont("AppBold", boldPath)

  return {
    regular: regularPath ? "AppRegular" : "Helvetica",
    bold: boldPath ? "AppBold" : "Helvetica-Bold"
  }
}

async function recalcTransfer(transferId: string) {
  const items = await prisma.transferDocItem.findMany({
    where: { transferId }
  })

  const totalQty = items.reduce((sum, item) => sum + toNumber(item.qty), 0)
  const totalValue = items.reduce((sum, item) => sum + toNumber(item.lineValue), 0)

  return prisma.transferDoc.update({
    where: { id: transferId },
    data: {
      totalQty: new Prisma.Decimal(totalQty),
      totalValue: new Prisma.Decimal(totalValue)
    }
  })
}

async function postTransferDocument(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    doc: any
    fromLocationName?: string
    toLocationName?: string
  }
) {
  for (const item of params.doc.items) {
    const qty = Number(item.qty || 0)
    const qtyDecimal = new Prisma.Decimal(qty)
    const product = await tx.product.findFirst({
      where: { id: item.productId, tenantId: params.tenantId, companyId: params.companyId },
      include: { uom: true },
    })
    const trackLots = Boolean(product?.trackLot || product?.trackExpiry)

    if (trackLots) {
      const allocations = await allocateProductLots(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        costMethod: product?.costMethod || "FIFO",
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await decrementStockBalanceStrict(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await incrementStockBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.toLocationId,
        warehouseId: params.doc.toWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
      })

      for (const allocation of allocations) {
        const destinationLot = await tx.stockLot.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.toLocationId,
            warehouseId: params.doc.toWarehouseId || null,
            productId: item.productId,
            lotNo: allocation.lotNo,
            expiryDate: allocation.expiryDate || null,
            receivedAt: new Date(),
            initialQty: allocation.qty,
            remainingQty: allocation.qty,
            unitCostNetRon: allocation.unitCost,
            totalRemainingValue: allocation.totalCost,
          },
        })

        await tx.transferDocItemLot.create({
          data: {
            transferDocItemId: item.id,
            sourceStockLotId: allocation.stockLotId,
            destinationStockLotId: destinationLot.id,
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            lotNo: allocation.lotNo,
            expiryDate: allocation.expiryDate || null,
          },
        })

        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.fromLocationId,
            warehouseId: params.doc.fromWarehouseId || null,
            productId: item.productId,
            lotId: allocation.stockLotId,
            type: "OUT",
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            refType: "TRANSFER",
            refId: params.doc.id,
            refItemId: item.id,
            note: `Nota transfer ${params.doc.docNo} catre ${params.toLocationName || "-"}`,
          },
        })

        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.toLocationId,
            warehouseId: params.doc.toWarehouseId || null,
            productId: item.productId,
            lotId: destinationLot.id,
            type: "IN",
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            refType: "TRANSFER",
            refId: params.doc.id,
            refItemId: item.id,
            note: `Nota transfer ${params.doc.docNo} din ${params.fromLocationName || "-"}`,
          },
        })
      }
    } else {
      await decrementStockBalanceStrict(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await incrementStockBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.toLocationId,
        warehouseId: params.doc.toWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
      })

      await tx.stockMove.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: params.doc.fromLocationId,
          warehouseId: params.doc.fromWarehouseId || null,
          productId: item.productId,
          type: "OUT",
          qty: qtyDecimal,
          unitCost: new Prisma.Decimal(item.unitPrice || 0),
          totalValue: new Prisma.Decimal(item.lineValue || 0),
          refType: "TRANSFER",
          refId: params.doc.id,
          refItemId: item.id,
          note: `Nota transfer ${params.doc.docNo} catre ${params.toLocationName || "-"}`,
        },
      })

      await tx.stockMove.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: params.doc.toLocationId,
          warehouseId: params.doc.toWarehouseId || null,
          productId: item.productId,
          type: "IN",
          qty: qtyDecimal,
          unitCost: new Prisma.Decimal(item.unitPrice || 0),
          totalValue: new Prisma.Decimal(item.lineValue || 0),
          refType: "TRANSFER",
          refId: params.doc.id,
          refItemId: item.id,
          note: `Nota transfer ${params.doc.docNo} din ${params.fromLocationName || "-"}`,
        },
      })
    }
  }

  await tx.transferDoc.update({
    where: { id: params.doc.id },
    data: { status: "POSTED" },
  })
}

router.get("/api/v1/transfers", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const month = String(req.query.month || "").trim()
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()

  const where: any = { tenantId, companyId }

  if (month) {
    const [y, m] = month.split("-").map(Number)
    if (y && m && m >= 1 && m <= 12) {
      where.docDate = {
        gte: new Date(y, m - 1, 1),
        lt: new Date(y, m, 1)
      }
    }
  } else {
    if (dateFrom || dateTo) {
      where.docDate = {}
      if (dateFrom) where.docDate.gte = new Date(dateFrom)
      if (dateTo) {
        const end = new Date(dateTo)
        end.setDate(end.getDate() + 1)
        where.docDate.lt = end
      }
    }
  }

  const docs = await prisma.transferDoc.findMany({
    where,
    include: {
      fromLocation: true,
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
      items: true
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }]
  })

  res.json({ ok: true, docs: docs.map(serializeTransferDoc) })
})

router.get("/api/v1/transfers/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true
            }
          },
          uom: true,
          vatRate: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
  }

  res.json({ ok: true, doc: serializeTransferDoc(doc) })
})

router.post("/api/v1/transfers/:id/etransport/prepare", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId },
    select: { id: true, name: true, cui: true },
  })

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
          uom: true,
          vatRate: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  const issues = validateTransferForETransport(doc)
  const blockingIssues = issues.filter((issue) => issue.severity === "error")

  if (blockingIssues.length) {
    return res.status(400).json({
      ok: false,
      error: blockingIssues[0]?.message || "Transferul nu poate genera XML-ul RO e-Transport.",
      issues,
    })
  }

  const xmlText = generateTransferETransportXml({
    ...doc,
    company,
    declarantCode: company?.cui || "",
  })
  const nextStatus = doc.eTransportRequired ? "PREPARED" : "READY_TO_REVIEW"

  const updated = await prisma.transferDoc.update({
    where: { id: doc.id },
    data: {
      eTransportPreparedXml: xmlText,
      eTransportStatus: nextStatus,
      eTransportErrorText: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message).join("\n") || null,
    },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
          uom: true,
          vatRate: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  return res.json({
    ok: true,
    doc: serializeTransferDoc(updated),
    issues,
    message: nextStatus === "PREPARED" ? "XML RO e-Transport generat." : "XML RO e-Transport generat pentru revizuire.",
  })
})

router.patch("/api/v1/transfers/:id/etransport-fields", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const header = req.body?.header || {}

  const existing = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  })

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  const eTransportVehicleMaxMassKg = Math.max(0, toNumber(header?.eTransportVehicleMaxMassKg || 0))
  const requestedETransportRequired = Boolean(header?.eTransportRequired)
  const eTransport = buildETransportSummary(existing.items || [], eTransportVehicleMaxMassKg)

  const updated = await prisma.transferDoc.update({
    where: { id: existing.id },
    data: {
      eTransportOperationType: String(header?.eTransportOperationType || "").trim() || null,
      eTransportPartnerCountry: String(header?.eTransportPartnerCountry || "").trim() || null,
      eTransportPartnerCui: String(header?.eTransportPartnerCui || "").trim() || null,
      eTransportPartnerName: String(header?.eTransportPartnerName || "").trim() || null,
      eTransportInternalRef: String(header?.eTransportInternalRef || "").trim() || null,
      eTransportStartScope: String(header?.eTransportStartScope || "").trim() || null,
      eTransportEndScope: String(header?.eTransportEndScope || "").trim() || null,
      eTransportStartAddress: String(header?.eTransportStartAddress || "").trim() || null,
      eTransportEndAddress: String(header?.eTransportEndAddress || "").trim() || null,
      eTransportStartBorderPoint: String(header?.eTransportStartBorderPoint || "").trim() || null,
      eTransportEndBorderPoint: String(header?.eTransportEndBorderPoint || "").trim() || null,
      eTransportTransportDocType: String(header?.eTransportTransportDocType || "").trim() || null,
      eTransportTransportDocNo: String(header?.eTransportTransportDocNo || "").trim() || null,
      eTransportTransportDocDate: String(header?.eTransportTransportDocDate || "").trim()
        ? new Date(String(header.eTransportTransportDocDate).trim())
        : null,
      eTransportTransportDocNotes: String(header?.eTransportTransportDocNotes || "").trim() || null,
      eTransportExtraInfo: String(header?.eTransportExtraInfo || "").trim() || null,
      eTransportDeclaredStart: String(header?.eTransportDeclaredStart || "").trim() ? new Date(String(header.eTransportDeclaredStart).trim()) : null,
      eTransportVehicleMaxMassKg: eTransportVehicleMaxMassKg > 0 ? new Prisma.Decimal(eTransportVehicleMaxMassKg) : null,
      eTransportOrganizer: String(header?.eTransportOrganizer || "").trim() || null,
      eTransportOperator: String(header?.eTransportOperator || "").trim() || null,
      vehicleNo: String(header?.vehicleNo || "").trim() || null,
      trailerNo: String(header?.trailerNo || "").trim() || null,
      eTransportCandidate: eTransport.candidate,
      eTransportRequired: eTransport.candidate ? requestedETransportRequired || eTransport.required : false,
      eTransportPreparedXml: null,
      eTransportUploadIndex: null,
      eTransportDownloadId: null,
      eTransportUit: null,
      eTransportErrorText: null,
      eTransportStatus: "EDITED",
    },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: { include: { uom: true, vatRate: true } },
          uom: true,
          vatRate: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  return res.json({
    ok: true,
    doc: serializeTransferDoc(updated),
    message: "Datele RO e-Transport au fost salvate.",
  })
})

router.get("/api/v1/transfers/:id/etransport/xml", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    select: {
      id: true,
      docNo: true,
      eTransportPreparedXml: true,
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  if (!doc.eTransportPreparedXml) {
    return res.status(400).json({ ok: false, error: "Genereaza mai intai XML-ul RO e-Transport." })
  }

  const filename = safeFilePart(`ro-e-transport-${doc.docNo || doc.id}.xml`) || `ro-e-transport-${doc.id}.xml`
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(doc.eTransportPreparedXml)
})

router.post("/api/v1/transfers/:id/etransport/send", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
          uom: true,
          vatRate: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  const company = await loadAnafCompanyContext(req.auth)
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    return res.status(400).json({ ok: false, error: "Firma nu are CUI valid pentru transmiterea la ANAF." })
  }
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  const issues = validateTransferForETransport(doc)
  const blockingIssues = issues.filter((issue) => issue.severity === "error")
  if (blockingIssues.length) {
    return res.status(400).json({
      ok: false,
      error: blockingIssues[0]?.message || "Transferul nu poate fi trimis la ANAF.",
      issues,
    })
  }

  const xmlText =
    doc.eTransportPreparedXml ||
    generateTransferETransportXml({
      ...doc,
      company,
      declarantCode: company?.cui || "",
    })

  try {
    const uploadResult = await anafUploadEtransportXml(company, xmlText)
    const uploadIndex = uploadResult.uploadIndex
    const summary = explainEtransportAnafError(uploadResult.response.status, uploadResult.summary)

    if (!uploadResult.response.ok || !uploadIndex) {
      await prisma.transferDoc.update({
        where: { id: doc.id },
        data: {
          eTransportPreparedXml: xmlText,
          eTransportStatus: "ERROR",
          eTransportErrorText: summary || "ANAF a respins upload-ul RO e-Transport.",
        },
      })
      return res.status(400).json({
        ok: false,
        error: summary || "ANAF a respins upload-ul RO e-Transport.",
      })
    }

    const updated = await prisma.transferDoc.update({
      where: { id: doc.id },
      data: {
        eTransportPreparedXml: xmlText,
        eTransportStatus: "SENT",
        eTransportUploadIndex: uploadIndex,
        eTransportErrorText: summary || null,
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
            uom: true,
            vatRate: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    return res.json({
      ok: true,
      message: summary || "RO e-Transport a fost trimis la ANAF.",
      uploadIndex,
      doc: serializeTransferDoc(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la trimiterea RO e-Transport catre ANAF."
    logAnafRouteError("TRANSFER ETRANSPORT SEND ERROR", {
      tenantId,
      transferId: id,
      message,
      stack: error?.stack || null,
    })
    await prisma.transferDoc.update({
      where: { id: doc.id },
      data: {
        eTransportPreparedXml: xmlText,
        eTransportStatus: "ERROR",
        eTransportErrorText: message,
      },
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/transfers/:id/etransport/status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
          uom: true,
          vatRate: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  if (!doc.eTransportUploadIndex) {
    return res.status(400).json({ ok: false, error: "Documentul nu a fost trimis inca la ANAF." })
  }

  const company = await loadAnafCompanyContext(req.auth)
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  try {
    const statusResult = await anafCheckEtransportStatus(company, doc.eTransportUploadIndex)
    const summary = statusResult.summary
    const nextStatus = classifyEtransportStatus(statusResult.payload, statusResult.rawText)
    const downloadId = statusResult.downloadId || doc.eTransportDownloadId || null
    const uit = extractUit(statusResult.rawText) || doc.eTransportUit || null

    if (!statusResult.response.ok) {
      return res.status(400).json({
        ok: false,
        error: summary || "Nu am putut verifica starea la ANAF.",
      })
    }

    const updated = await prisma.transferDoc.update({
      where: { id: doc.id },
      data: {
        eTransportStatus: nextStatus,
        eTransportDownloadId: downloadId,
        eTransportUit: uit,
        eTransportErrorText: summary || null,
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
            uom: true,
            vatRate: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    return res.json({
      ok: true,
      status: nextStatus,
      uit,
      downloadId,
      message: summary || "Starea RO e-Transport a fost verificata la ANAF.",
      doc: serializeTransferDoc(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la verificarea starii in ANAF."
    logAnafRouteError("TRANSFER ETRANSPORT STATUS ERROR", {
      tenantId,
      transferId: id,
      uploadIndex: doc.eTransportUploadIndex || null,
      message,
      stack: error?.stack || null,
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/transfers/:id/etransport/receipt", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    select: {
      id: true,
      docNo: true,
      eTransportUploadIndex: true,
      eTransportDownloadId: true,
      eTransportUit: true,
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  const company = await loadAnafCompanyContext(req.auth)
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  let downloadId = doc.eTransportDownloadId || ""
  if (!downloadId) {
    downloadId = await resolveEtransportDownloadId(company, doc)
  }

  if (!downloadId) {
    return res.status(400).json({ ok: false, error: "Raspunsul ANAF nu este inca disponibil pentru acest transport." })
  }

  try {
    const receiptResult = await anafDownloadEtransportById(company, downloadId)
    const summary = receiptResult.response.ok ? "Raspunsul ANAF a fost descarcat." : receiptResult.summary
    const uit = extractUit(receiptResult.rawText) || doc.eTransportUit || null

    if (!receiptResult.response.ok) {
      return res.status(400).json({
        ok: false,
        error: summary || "Nu am putut descarca raspunsul ANAF.",
      })
    }

    await prisma.transferDoc.update({
      where: { id: doc.id },
      data: {
        eTransportDownloadId: downloadId,
        eTransportUit: uit,
        eTransportStatus: "ACCEPTED",
        eTransportErrorText: null,
      },
    })

    const fileNameBase = safeFilePart(`Raspuns_RO_eTransport_${doc.docNo}`) || `Raspuns_RO_eTransport_${doc.id}`
    const contentType = readAnafHeader(receiptResult.response.headers, "content-type") || "application/octet-stream"
    const extension =
      contentType.includes("zip") ? "zip" :
      contentType.includes("pdf") ? "pdf" :
      contentType.includes("xml") ? "xml" :
      "bin"

    res.setHeader("Content-Type", contentType)
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameBase}.${extension}"`)
    return res.send(receiptResult.response.buffer)
  } catch (error: any) {
    const message = error?.message || "Eroare la descarcarea raspunsului ANAF."
    logAnafRouteError("TRANSFER ETRANSPORT RECEIPT ERROR", {
      tenantId,
      transferId: id,
      downloadId: downloadId || null,
      message,
      stack: error?.stack || null,
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

router.post("/api/v1/transfers/:id/post", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const existing = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
      items: true,
    },
  })

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  if (existing.status !== "DRAFT") {
    return res.status(400).json({ ok: false, error: "Doar documentele DRAFT pot fi finalizate." })
  }

  await prisma.$transaction(async (tx) => {
    await postTransferDocument(tx, {
      tenantId,
      companyId,
      doc: existing,
      fromLocationName: existing.fromLocation?.name || "-",
      toLocationName: existing.toLocation?.name || "-",
    })
  })

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
      items: {
        include: {
          product: { include: { uom: true, vatRate: true } },
          uom: true,
          vatRate: true,
          lotAllocations: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  return res.json({ ok: true, doc: serializeTransferDoc(doc), message: "Transferul a fost finalizat." })
})

router.delete("/api/v1/transfers/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    select: {
      id: true,
      docNo: true,
      status: true,
    },
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  if (doc.status !== "DRAFT") {
    return res.status(400).json({ ok: false, error: "Doar transferurile draft pot fi sterse." })
  }

  await prisma.$transaction(async (tx) => {
    await tx.transferDocItem.deleteMany({
      where: { transferId: doc.id },
    })

    await tx.transferDoc.delete({
      where: { id: doc.id },
    })
  })

  return res.json({
    ok: true,
    message: `Transferul ${doc.docNo || ""} a fost sters.`,
  })
})

router.post("/api/v1/transfers/full", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id, header, items, postNow } = req.body || {}

  const fromLocationId = String(header?.fromLocationId || "").trim()
  const requestedFromWarehouseId = String(header?.fromWarehouseId || "").trim()
  const toLocationId = String(header?.toLocationId || "").trim()
  const requestedToWarehouseId = String(header?.toWarehouseId || "").trim()
  const rawDocNo = String(header?.docNo || "").trim()
  const docDate = String(header?.docDate || "").trim()
  const trailerNo = String(header?.trailerNo || "").trim()
  const eTransportOperationType = String(header?.eTransportOperationType || "").trim()
  const eTransportPartnerCountry = String(header?.eTransportPartnerCountry || "").trim()
  const eTransportPartnerCui = String(header?.eTransportPartnerCui || "").trim()
  const eTransportPartnerName = String(header?.eTransportPartnerName || "").trim()
  const eTransportInternalRef = String(header?.eTransportInternalRef || "").trim()
  const eTransportStartScope = String(header?.eTransportStartScope || "").trim()
  const eTransportEndScope = String(header?.eTransportEndScope || "").trim()
  const eTransportStartAddress = String(header?.eTransportStartAddress || "").trim()
  const eTransportEndAddress = String(header?.eTransportEndAddress || "").trim()
  const eTransportStartBorderPoint = String(header?.eTransportStartBorderPoint || "").trim()
  const eTransportEndBorderPoint = String(header?.eTransportEndBorderPoint || "").trim()
  const eTransportTransportDocType = String(header?.eTransportTransportDocType || "").trim()
  const eTransportTransportDocNo = String(header?.eTransportTransportDocNo || "").trim()
  const eTransportTransportDocDateRaw = String(header?.eTransportTransportDocDate || "").trim()
  const eTransportTransportDocNotes = String(header?.eTransportTransportDocNotes || "").trim()
  const eTransportExtraInfo = String(header?.eTransportExtraInfo || "").trim()
  const eTransportDeclaredStartRaw = String(header?.eTransportDeclaredStart || "").trim()
  const eTransportVehicleMaxMassKg = Math.max(0, toNumber(header?.eTransportVehicleMaxMassKg || 0))
  const eTransportOrganizer = String(header?.eTransportOrganizer || "").trim()
  const eTransportOperator = String(header?.eTransportOperator || "").trim()
  const requestedETransportRequired = Boolean(header?.eTransportRequired)

  if (!fromLocationId) {
    return res.status(400).json({ ok: false, error: "Locatia predatoare este obligatorie." })
  }

  if (!toLocationId) {
    return res.status(400).json({ ok: false, error: "Locatia primitoare este obligatorie." })
  }

  if (fromLocationId === toLocationId) {
    return res.status(400).json({ ok: false, error: "Locatiile trebuie sa fie diferite." })
  }

  if (!docDate) {
    return res.status(400).json({ ok: false, error: "Data document este obligatorie." })
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "Documentul trebuie sa aiba cel putin o linie." })
  }

  const [fromLocation, toLocation] = await Promise.all([
    prisma.location.findFirst({ where: { id: fromLocationId, tenantId, OR: [{ companyId }, { companyId: null }] } }),
    prisma.location.findFirst({ where: { id: toLocationId, tenantId, OR: [{ companyId }, { companyId: null }] } })
  ])

  if (!fromLocation) {
    return res.status(404).json({ ok: false, error: "Locatia predatoare nu exista." })
  }

  if (!toLocation) {
    return res.status(404).json({ ok: false, error: "Locatia primitoare nu exista." })
  }

  try {
    const [fromWarehouse, toWarehouse] = await prisma.$transaction(async (tx) => {
      const sourceWarehouse = await resolveWarehouseForLocation(tx, {
        tenantId,
        companyId,
        locationId: fromLocationId,
        warehouseId: requestedFromWarehouseId,
      })
      const destinationWarehouse = await resolveWarehouseForLocation(tx, {
        tenantId,
        companyId,
        locationId: toLocationId,
        warehouseId: requestedToWarehouseId,
      })
      return [sourceWarehouse, destinationWarehouse]
    })

    let transferId = id ? String(id) : ""
    const docNo = !transferId
      ? await prisma.$transaction((tx) => reserveNextNumber(tx, tenantId, "transfer"))
      : rawDocNo

    if (!transferId) {
      const duplicate = await prisma.transferDoc.findFirst({
        where: { tenantId, companyId, docNo }
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja un transfer cu acest numar." })
      }

      const created = await prisma.transferDoc.create({
        data: {
          tenantId,
          companyId,
          fromLocationId,
          fromWarehouseId: fromWarehouse.id,
          toLocationId,
          toWarehouseId: toWarehouse.id,
          docNo,
          docDate: new Date(docDate),
          reason: header?.reason ? String(header.reason).trim() : null,
          note: header?.note ? String(header.note).trim() : null,
          delegateName: header?.delegateName ? String(header.delegateName).trim() : null,
          delegateCi: header?.delegateCi ? String(header.delegateCi).trim() : null,
          vehicle: header?.vehicle ? String(header.vehicle).trim() : null,
          vehicleNo: header?.vehicleNo ? String(header.vehicleNo).trim() : null,
          trailerNo: trailerNo || null,
          eTransportOperationType: eTransportOperationType || null,
          eTransportPartnerCountry: eTransportPartnerCountry || null,
          eTransportPartnerCui: eTransportPartnerCui || null,
          eTransportPartnerName: eTransportPartnerName || null,
          eTransportInternalRef: eTransportInternalRef || null,
          eTransportStartScope: eTransportStartScope || null,
          eTransportEndScope: eTransportEndScope || null,
          eTransportStartAddress: eTransportStartAddress || null,
          eTransportEndAddress: eTransportEndAddress || null,
          eTransportStartBorderPoint: eTransportStartBorderPoint || null,
          eTransportEndBorderPoint: eTransportEndBorderPoint || null,
          eTransportTransportDocType: eTransportTransportDocType || null,
          eTransportTransportDocNo: eTransportTransportDocNo || null,
          eTransportTransportDocDate: eTransportTransportDocDateRaw ? new Date(eTransportTransportDocDateRaw) : null,
          eTransportTransportDocNotes: eTransportTransportDocNotes || null,
          eTransportExtraInfo: eTransportExtraInfo || null,
          senderName: header?.senderName ? String(header.senderName).trim() : null,
          receiverName: header?.receiverName ? String(header.receiverName).trim() : null,
          approvedBy: header?.approvedBy ? String(header.approvedBy).trim() : null,
          eTransportDeclaredStart: eTransportDeclaredStartRaw ? new Date(eTransportDeclaredStartRaw) : null,
          eTransportVehicleMaxMassKg:
            eTransportVehicleMaxMassKg > 0 ? new Prisma.Decimal(eTransportVehicleMaxMassKg) : null,
          eTransportOrganizer: eTransportOrganizer || null,
          eTransportOperator: eTransportOperator || null,
          status: "DRAFT"
        }
      })

      transferId = created.id
    } else {
      const existing = await prisma.transferDoc.findFirst({
        where: { id: transferId, tenantId, companyId }
      })

      if (!existing) {
        return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
      }

      if (existing.status !== "DRAFT") {
        return res.status(400).json({ ok: false, error: "Documentul POSTED este read-only." })
      }

      const duplicate = await prisma.transferDoc.findFirst({
        where: {
          tenantId,
          companyId,
          docNo,
          NOT: { id: transferId }
        }
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja un transfer cu acest numar." })
      }

      await prisma.transferDoc.update({
        where: { id: transferId },
        data: {
          fromLocationId,
          fromWarehouseId: fromWarehouse.id,
          toLocationId,
          toWarehouseId: toWarehouse.id,
          docNo,
          docDate: new Date(docDate),
          reason: header?.reason ? String(header.reason).trim() : null,
          note: header?.note ? String(header.note).trim() : null,
          delegateName: header?.delegateName ? String(header.delegateName).trim() : null,
          delegateCi: header?.delegateCi ? String(header.delegateCi).trim() : null,
          vehicle: header?.vehicle ? String(header.vehicle).trim() : null,
          vehicleNo: header?.vehicleNo ? String(header.vehicleNo).trim() : null,
          trailerNo: trailerNo || null,
          eTransportOperationType: eTransportOperationType || null,
          eTransportPartnerCountry: eTransportPartnerCountry || null,
          eTransportPartnerCui: eTransportPartnerCui || null,
          eTransportPartnerName: eTransportPartnerName || null,
          eTransportInternalRef: eTransportInternalRef || null,
          eTransportStartScope: eTransportStartScope || null,
          eTransportEndScope: eTransportEndScope || null,
          eTransportStartAddress: eTransportStartAddress || null,
          eTransportEndAddress: eTransportEndAddress || null,
          eTransportStartBorderPoint: eTransportStartBorderPoint || null,
          eTransportEndBorderPoint: eTransportEndBorderPoint || null,
          eTransportTransportDocType: eTransportTransportDocType || null,
          eTransportTransportDocNo: eTransportTransportDocNo || null,
          eTransportTransportDocDate: eTransportTransportDocDateRaw ? new Date(eTransportTransportDocDateRaw) : null,
          eTransportTransportDocNotes: eTransportTransportDocNotes || null,
          eTransportExtraInfo: eTransportExtraInfo || null,
          senderName: header?.senderName ? String(header.senderName).trim() : null,
          receiverName: header?.receiverName ? String(header.receiverName).trim() : null,
          approvedBy: header?.approvedBy ? String(header.approvedBy).trim() : null,
          eTransportDeclaredStart: eTransportDeclaredStartRaw ? new Date(eTransportDeclaredStartRaw) : null,
          eTransportVehicleMaxMassKg:
            eTransportVehicleMaxMassKg > 0 ? new Prisma.Decimal(eTransportVehicleMaxMassKg) : null,
          eTransportOrganizer: eTransportOrganizer || null,
          eTransportOperator: eTransportOperator || null
        }
      })
    }

    await prisma.transferDocItem.deleteMany({
      where: { transferId }
    })

    for (const raw of items) {
      const productId = String(raw.productId || "").trim()
      const qty = toNumber(raw.qty)
      const unitPrice = toNumber(raw.unitPrice || 0)

      if (!productId) {
        throw new Error("Fiecare linie trebuie sa aiba produs.")
      }

      if (qty <= 0) {
        throw new Error("Cantitatea trebuie sa fie mai mare decat 0.")
      }

      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId, companyId },
        include: {
          uom: true,
          vatRate: true
        }
      })

      if (!product) {
        throw new Error("Produs inexistent in una dintre linii.")
      }

      await assertSufficientStock(prisma, {
          tenantId,
          companyId,
          locationId: fromLocationId,
          warehouseId: fromWarehouse.id,
        productId,
        requiredQty: qty,
        productName: product.name,
        uomCode: product.uom?.code || null
      })

      await prisma.transferDocItem.create({
        data: {
          transferId,
          productId,
          uomId: product.uomId,
          qty: new Prisma.Decimal(qty),
          unitPrice: new Prisma.Decimal(unitPrice),
          lineValue: new Prisma.Decimal(qty * unitPrice),
          vatRateId: product.vatRateId,
          vatRateValue: new Prisma.Decimal(product.vatRate?.rate || 0)
        }
      })
    }

    await recalcTransfer(transferId)

    const transferWithProducts = await prisma.transferDoc.findFirst({
      where: { id: transferId, tenantId, companyId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    })

    const eTransport = buildETransportSummary(
      transferWithProducts?.items || [],
      eTransportVehicleMaxMassKg
    )

    await prisma.transferDoc.update({
      where: { id: transferId },
      data: {
        eTransportCandidate: eTransport.candidate,
        eTransportRequired: eTransport.candidate ? requestedETransportRequired || eTransport.required : false,
      },
    })

    if (postNow === true) {
      await prisma.$transaction(async (tx) => {
        const doc = await tx.transferDoc.findFirst({
          where: { id: transferId, tenantId, companyId },
          include: { items: true }
        })

        if (!doc) throw new Error("Transferul nu a fost gasit.")
        if (doc.status !== "DRAFT") throw new Error("Doar documentele DRAFT pot fi postate.")

        await postTransferDocument(tx, {
          tenantId,
          companyId,
          doc,
          fromLocationName: fromLocation.name,
          toLocationName: toLocation.name,
        })
      })
    }

    const doc = await prisma.transferDoc.findFirst({
      where: { id: transferId, tenantId, companyId },
      include: {
        fromLocation: true,
        fromWarehouse: true,
        toLocation: true,
        toWarehouse: true,
        items: {
          include: {
            product: { include: { uom: true, vatRate: true } },
            uom: true,
            vatRate: true,
            lotAllocations: true,
          },
          orderBy: { createdAt: "asc" }
        }
      }
    })

    res.json({ ok: true, doc: serializeTransferDoc(doc) })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Eroare la salvarea transferului."
    })
  }
})

router.get("/api/v1/transfers/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const docData = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: { include: { uom: true } },
          uom: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!docData) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
  }

  const company = await resolveRequestCompany(req)
  const filename = `TRANSFER_${safeFilePart(docData.docNo)}_${safeFilePart(docData.fromLocation.name)}_${safeFilePart(docData.toLocation.name)}.pdf`
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: "A4", margin: 36 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 36

  const drawHeader = () => drawDocumentHero(doc, fonts, {
    title: 'Nota de transfer',
    subtitle: 'Transfer intre gestiuni',
    companyName: company?.name || '-',
    companyLines: [
      `CUI: ${pdfText(company?.cui)}`,
      `Reg. com.: ${pdfText(company?.regNo)}`,
      `Adresa: ${pdfText(company?.address)}`,
      `Email: ${pdfText(company?.email || company?.contactEmail)}`,
      `Telefon: ${pdfText(company?.phone)}`,
    ],
    rightPairs: [
      { label: 'Numar', value: pdfText(docData.docNo) },
      { label: 'Data', value: pdfDate(docData.docDate) },
      { label: 'Ora', value: new Date(docData.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) },
    ],
    margin,
  })

  let y = drawHeader()
  y = drawInfoCards(doc, fonts, {
    margin,
    y,
    cards: [
      {
        title: 'Transfer',
        pairs: [
          { label: 'Din gestiune', value: pdfText(docData.fromLocation.name) },
          { label: 'In gestiune', value: pdfText(docData.toLocation.name) },
          { label: 'Motiv', value: pdfText(docData.reason) },
          { label: 'Observatii', value: pdfText(docData.note) },
        ],
      },
      {
        title: 'Transport si predare',
        pairs: [
          { label: 'Delegat', value: pdfText(docData.delegateName) },
          { label: 'CI / BI', value: pdfText(docData.delegateCi) },
          { label: 'Mijloc transport', value: pdfText(docData.vehicle) },
          { label: 'Nr. auto', value: pdfText(docData.vehicleNo) },
        ],
      },
    ],
  }) + 18

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Produse transferate', margin, y)
  y += 14

  y = drawSimpleTable(doc, fonts, {
    margin,
    y,
    columns: [
      { label: '#', width: 28, align: 'center' },
      { label: 'Cod produs', width: 76, align: 'left' },
      { label: 'Produs', width: 210, align: 'left' },
      { label: 'UM', width: 44, align: 'center' },
      { label: 'Cant.', width: 58, align: 'right' },
      { label: 'Pret', width: 62, align: 'right' },
      { label: 'Valoare', width: 69, align: 'right' },
    ],
    rows: docData.items.map((item, index) => ([
      String(index + 1),
      pdfText(item.product?.sku),
      pdfText(item.product?.name),
      pdfText(item.uom?.code || item.product?.uom?.code),
      pdfFmt(item.qty),
      pdfFmt(item.unitPrice),
      pdfFmt(item.lineValue),
    ])),
    rowHeight: 24,
    drawHeader,
  }) + 18

  drawTotalsBox(doc, fonts, {
    x: doc.page.width - margin - 220,
    y,
    width: 220,
    lines: [
      { label: 'Total cantitati', value: pdfFmt(docData.totalQty) },
      { label: 'Total valoare', value: `${pdfFmt(docData.totalValue)} lei` },
    ],
  })

  drawSignatureRow(doc, fonts, {
    margin,
    y: y + 76,
    labels: ['Am predat', 'Am primit', 'Avizat'],
  })

  doc.end()
})

export default router
