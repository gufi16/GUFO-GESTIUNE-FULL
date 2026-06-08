// @ts-nocheck
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
import { drawSimpleTable, ensurePdfPage, pdfDate, pdfFmt, pdfText, registerPdfFonts } from "../lib/professionalPdf"
import { requireRequestCompanyId, resolveRequestCompany } from "../lib/companyScope"
import { generateTransferETransportXml, validateTransferForETransport } from "../lib/etransport"
import { resolveWarehouseForLocation } from "../lib/warehouse"
import {
  buildTransferDocListWhere,
  buildETransportSummary,
  buildTransferPdfCompanyLines,
  buildTransferPdfFileName,
  buildTransferPdfRightLines,
  buildTransferPdfSignatureRows,
  buildTransferPdfSummaryRows,
  cleanTransferPdfValue,
  classifyEtransportStatus,
  explainEtransportAnafError,
  extractUit,
  getTransferRouteErrorMessage,
  getTransferRouteErrorStack,
  resolveEtransportDownloadId,
  safeTransferFilePart,
  serializeTransferDoc,
  transferRouteNumber,
} from "../lib/transferRouteSupport"
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

async function recalcTransfer(transferId: string) {
  const items = await prisma.transferDocItem.findMany({
    where: { transferId }
  })

  const totalQty = items.reduce((sum, item) => sum + transferRouteNumber(item.qty), 0)
  const totalValue = items.reduce((sum, item) => sum + transferRouteNumber(item.lineValue), 0)

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

  const where = buildTransferDocListWhere({ tenantId, companyId, month, dateFrom, dateTo })

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

  const eTransportVehicleMaxMassKg = Math.max(0, transferRouteNumber(header?.eTransportVehicleMaxMassKg || 0))
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

  const filename = safeTransferFilePart(`ro-e-transport-${doc.docNo || doc.id}.xml`) || `ro-e-transport-${doc.id}.xml`
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
  } catch (error: unknown) {
    const message = getTransferRouteErrorMessage(error, "Eroare la trimiterea RO e-Transport catre ANAF.")
    logAnafRouteError("TRANSFER ETRANSPORT SEND ERROR", {
      tenantId,
      transferId: id,
      message,
      stack: getTransferRouteErrorStack(error),
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
  } catch (error: unknown) {
    const message = getTransferRouteErrorMessage(error, "Eroare la verificarea starii in ANAF.")
    logAnafRouteError("TRANSFER ETRANSPORT STATUS ERROR", {
      tenantId,
      transferId: id,
      uploadIndex: doc.eTransportUploadIndex || null,
      message,
      stack: getTransferRouteErrorStack(error),
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
    downloadId = await resolveEtransportDownloadId(company, doc, {
      normalizeCompanyCui,
      anafListEtransportMessages,
      extractDownloadId,
    })
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

    const fileNameBase = safeTransferFilePart(`Raspuns_RO_eTransport_${doc.docNo}`) || `Raspuns_RO_eTransport_${doc.id}`
    const contentType = readAnafHeader(receiptResult.response.headers, "content-type") || "application/octet-stream"
    const extension =
      contentType.includes("zip") ? "zip" :
      contentType.includes("pdf") ? "pdf" :
      contentType.includes("xml") ? "xml" :
      "bin"

    res.setHeader("Content-Type", contentType)
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameBase}.${extension}"`)
    return res.send(receiptResult.response.buffer)
  } catch (error: unknown) {
    const message = getTransferRouteErrorMessage(error, "Eroare la descarcarea raspunsului ANAF.")
    logAnafRouteError("TRANSFER ETRANSPORT RECEIPT ERROR", {
      tenantId,
      transferId: id,
      downloadId: downloadId || null,
      message,
      stack: getTransferRouteErrorStack(error),
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
  const eTransportVehicleMaxMassKg = Math.max(0, transferRouteNumber(header?.eTransportVehicleMaxMassKg || 0))
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
    prisma.location.findFirst({ where: { id: fromLocationId, tenantId, companyId } }),
    prisma.location.findFirst({ where: { id: toLocationId, tenantId, companyId } })
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
      const qty = transferRouteNumber(raw.qty)
      const unitPrice = transferRouteNumber(raw.unitPrice || 0)

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
  } catch (e: unknown) {
    return res.status(400).json({
      ok: false,
      error: getTransferRouteErrorMessage(e, "Eroare la salvarea transferului.")
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
      fromWarehouse: true,
      toLocation: true,
      toWarehouse: true,
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

  const actorUser = req.auth?.userId
    ? await prisma.user.findFirst({
        where: { id: req.auth.userId, tenantId },
        select: { name: true, email: true },
      })
    : null

  const company = await resolveRequestCompany(req)
  const filename = buildTransferPdfFileName(docData.docNo, docData.fromLocation.name, docData.toLocation.name)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 34

  const pageWidth = doc.page.width
  const pageHeight = doc.page.height
  const contentWidth = pageWidth - margin * 2
  const headerBlockHeight = 110
  const actorLabel =
    cleanTransferPdfValue(actorUser?.name) ||
    cleanTransferPdfValue(actorUser?.email) ||
    cleanTransferPdfValue(docData.delegateName) ||
    "-"
  const fromStorageLabel =
    [cleanTransferPdfValue(docData.fromLocation.name), cleanTransferPdfValue(docData.fromWarehouse?.name)].filter(Boolean).join(" / ") || "-"
  const toStorageLabel =
    [cleanTransferPdfValue(docData.toLocation.name), cleanTransferPdfValue(docData.toWarehouse?.name)].filter(Boolean).join(" / ") || "-"
  const summaryRows = buildTransferPdfSummaryRows({
    actorLabel,
    fromStorageLabel,
    toStorageLabel,
    delegateCi: docData.delegateCi,
    vehicleNo: docData.vehicleNo,
    note: docData.note,
    eTransportUit: docData.eTransportUit,
  })
  const signatures = buildTransferPdfSignatureRows(actorLabel, fromStorageLabel, toStorageLabel)
  const drawHeader = () => {
    const y = margin
    doc.font(fonts.bold).fontSize(12).fillColor('#111827').text(pdfText(company?.name), margin, y + 8, {
      width: 220,
      align: 'left',
    })
    const companyLines = buildTransferPdfCompanyLines(company || {})
    let companyY = y + 28
    doc.font(fonts.regular).fontSize(8.8).fillColor('#334155')
    companyLines.forEach((lineText) => {
      doc.text(lineText, margin, companyY, { width: 240, align: 'left' })
      companyY += 11
    })

    doc.font(fonts.bold).fontSize(21).fillColor('#111827').text('TRANSFER INTRE GESTIUNI', margin + 200, y + 18, {
      width: contentWidth - 400,
      align: 'center',
    })
    doc.font(fonts.regular).fontSize(9).fillColor('#475569').text('Document intern de predare / primire stoc', margin + 200, y + 46, {
      width: contentWidth - 400,
      align: 'center',
    })

    const rightX = pageWidth - margin - 210
    const rightLines = buildTransferPdfRightLines(docData.docNo, docData.docDate, docData.createdAt)
    let rightY = y + 14
    doc.font(fonts.regular).fontSize(9.4).fillColor('#111827')
    rightLines.forEach((lineText) => {
      doc.text(lineText, rightX, rightY, { width: 210, align: 'left' })
      rightY += 14
    })

    return Math.max(companyY + 8, rightY + 4, y + headerBlockHeight)
  }

  const drawPageFooter = (pageNo: number) => {
    doc
      .font(fonts.regular)
      .fontSize(8.3)
      .fillColor("#64748B")
      .text(`Pagina ${pageNo}`, margin, pageHeight - margin - 10, {
        width: contentWidth,
        align: "right",
      })
  }

  const drawSummaryPair = (x: number, startY: number, label: string, value: string, width: number) => {
    doc.font(fonts.bold).fontSize(8.6).fillColor('#64748B').text(label, x, startY, {
      width,
      align: 'left',
    })
    const valueY = startY + 11
    doc.font(fonts.regular).fontSize(9.4).fillColor('#111827').text(value || "-", x, valueY, {
      width,
      align: 'left',
    })
    return Math.max(26, doc.heightOfString(value || "-", { width, align: 'left' }) + 16)
  }

  let y = drawHeader()
  const leftX = margin
  const rightX = margin + contentWidth / 2 + 14
  const pairWidth = contentWidth / 2 - 20

  summaryRows.forEach((row) => {
    const leftHeight = drawSummaryPair(leftX, y, row[0].label, row[0].value, pairWidth)
    const rightHeight = drawSummaryPair(rightX, y, row[1].label, row[1].value, pairWidth)
    y += Math.max(leftHeight, rightHeight) + 8
  })
  y += 14

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Produse transferate', margin, y)
  y += 16

  y = drawSimpleTable(doc, fonts, {
    margin,
    y,
    columns: [
      { label: '#', width: 34, align: 'center' },
      { label: 'Cod produs', width: 120, align: 'left' },
      { label: 'Produs', width: 458, align: 'left' },
      { label: 'UM', width: 72, align: 'center' },
      { label: 'Cant.', width: 110, align: 'right' },
    ],
    rows: docData.items.map((item, index) => ([
      String(index + 1),
      pdfText(item.product?.sku),
      pdfText(item.product?.name),
      pdfText(item.uom?.code || item.product?.uom?.code),
      pdfFmt(item.qty),
    ])),
    rowHeight: 24,
    drawHeader,
  }) + 18

  y += 8
  doc.font(fonts.regular).fontSize(9.2).fillColor('#111827').text('Nr. pozitii', margin, y)
  doc.font(fonts.bold).fontSize(9.6).text(String(docData.items.length), pageWidth - margin - 120, y, {
    width: 120,
    align: 'right',
  })
  y += 16
  doc.font(fonts.regular).fontSize(9.2).fillColor('#111827').text('Cantitate totala transfer', margin, y)
  doc.font(fonts.bold).fontSize(10.2).text(pdfFmt(docData.totalQty), pageWidth - margin - 120, y, {
    width: 120,
    align: 'right',
  })

  y += 40
  y = ensurePdfPage(doc, y, 80, margin, drawHeader)
  const signatureWidth = 190
  const signatureGap = (contentWidth - signatureWidth * 3) / 2
  const signatureY = y
  signatures.forEach((signature, index) => {
    const x = margin + index * (signatureWidth + signatureGap)
    doc.font(fonts.bold).fontSize(10).fillColor('#111827').text(signature.label, x, signatureY, {
      width: signatureWidth,
      align: 'center',
    })
    doc.moveTo(x + 12, signatureY + 42).lineTo(x + signatureWidth - 12, signatureY + 42).strokeColor('#94A3B8').lineWidth(1).stroke()
    doc.font(fonts.regular).fontSize(8.8).fillColor('#475569').text(signature.value, x, signatureY + 50, {
      width: signatureWidth,
      align: 'center',
    })
  })

  drawPageFooter(1)

  doc.end()
})

export default router
