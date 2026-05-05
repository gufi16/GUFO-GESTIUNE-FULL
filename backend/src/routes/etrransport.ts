// @ts-nocheck
import { Router } from "express"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompany, requireRequestCompanyId } from "../lib/companyScope"
import { generateETransportNoticeXml, validateNoticeForETransport } from "../lib/etransport"
import { readAnafHeader } from "../lib/anafHttp"
import {
  anafCheckEtransportStatus,
  anafDownloadEtransportById,
  anafListEtransportMessages,
  anafUploadEtransportXml,
  loadAnafCompanyContext,
  logAnafRouteError,
} from "../lib/anafClient"
import { extractDownloadId, normalizeCompanyCui } from "../lib/incomingEfactura"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function text(value: any) {
  return String(value || "").trim()
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function makeNoticeNo() {
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "")
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, "")
  const rand = Math.floor(Math.random() * 900 + 100)
  return `ETR-${datePart}-${timePart}-${rand}`
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
    return "ANAF a refuzat cererea RO e-Transport. Verifica aplicatia OAuth si drepturile E-Transport active in ANAF."
  }
  return message || "ANAF a respins operatiunea RO e-Transport."
}

function extractUit(raw: string) {
  const match = String(raw || "").match(/\bUIT\b[^A-Z0-9]*([A-Z0-9\-]{6,})/i)
  return match?.[1] || ""
}

function hasExplicitDownloadId(raw: string) {
  return /id_descarcare|downloadId/i.test(String(raw || ""))
}

async function resolveNoticeDownloadId(company: any, notice: any) {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif || !company?.efacturaOauthAccessToken || !notice?.uploadIndex) return ""

  const listResult = await anafListEtransportMessages(company, { days: 60, cif })
  const matched = listResult.items.find((item: any) => {
    const blob = JSON.stringify(item || {}).toLowerCase()
    return blob.includes(String(notice.uploadIndex).toLowerCase()) || blob.includes(String(notice.noticeNo || "").toLowerCase())
  })

  return matched
    ? (
        text(matched?.id_descarcare) ||
        text(matched?.downloadId) ||
        text(matched?.id)
      )
    : ""
}

async function resolveNoticeUit(company: any, notice: any) {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif || !company?.efacturaOauthAccessToken || !notice?.uploadIndex) return ""

  const listResult = await anafListEtransportMessages(company, { days: 60, cif })
  const matched = listResult.items.find((item: any) => {
    const blob = JSON.stringify(item || {}).toLowerCase()
    return blob.includes(String(notice.uploadIndex).toLowerCase()) || blob.includes(String(notice.noticeNo || "").toLowerCase())
  })

  return text(matched?.uit)
}

function serializeNotice(notice: any) {
  if (!notice) return notice
  return {
    ...notice,
    vehicleMaxMassKg: toNumber(notice.vehicleMaxMassKg || 0),
    totalGrossWeightKg: toNumber(notice.totalGrossWeightKg || 0),
    totalValueRon: toNumber(notice.totalValueRon || 0),
    items: Array.isArray(notice.items)
      ? notice.items.map((item: any) => ({
        ...item,
        qty: toNumber(item.qty),
        unitPrice: toNumber(item.unitPrice),
        lineValue: toNumber(item.lineValue),
        netWeightPerUnitKg: toNumber(item.netWeightPerUnitKg),
        netWeightTotalKg: toNumber(item.netWeightTotalKg),
        grossWeightPerUnitKg: toNumber(item.grossWeightPerUnitKg),
        grossWeightTotalKg: toNumber(item.grossWeightTotalKg),
          product: item.product
            ? {
                ...item.product,
                price: toNumber(item.product.price),
                costPrice: toNumber(item.product.costPrice),
                grossWeightKg: toNumber(item.product.grossWeightKg || 0),
              }
            : item.product,
        }))
      : [],
  }
}

function recalcNotice(items: any[]) {
  const normalized = Array.isArray(items) ? items : []
  const totalGrossWeightKg = normalized.reduce((sum, item) => sum + toNumber(item.grossWeightTotalKg || toNumber(item.qty) * toNumber(item.grossWeightPerUnitKg)), 0)
  const totalValueRon = normalized.reduce((sum, item) => sum + toNumber(item.lineValue), 0)
  const hasFiscalRisk = normalized.some((item) => item.fiscalRisk === true)
  const thresholdsReached = totalGrossWeightKg > 500 || totalValueRon > 10000
  return {
    totalGrossWeightKg,
    totalValueRon,
    candidate: hasFiscalRisk && thresholdsReached,
  }
}

router.get("/api/v1/etransport/notices", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const notices = await prisma.eTransportNotice.findMany({
    where: { tenantId, companyId },
    include: {
      items: true,
    },
    orderBy: [{ createdAt: "desc" }],
  })
  return res.json({ ok: true, items: notices.map(serializeNotice) })
})

router.get("/api/v1/etransport/notices/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  })
  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }
  return res.json({ ok: true, item: serializeNotice(notice) })
})

router.post("/api/v1/etransport/notices", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const company = await requireRequestCompany(req)
  const created = await prisma.eTransportNotice.create({
    data: {
      tenantId,
      companyId: company.id,
      noticeNo: makeNoticeNo(),
      sourceType: "MANUAL",
      status: "DRAFT",
      transportDocType: "ALTELE",
      operationType: "TTN",
      partnerCountry: "RO",
      partnerAddress: null,
      startScope: "ADR",
      endScope: "ADR",
      organizerCountry: "RO",
      organizerCode: text(company.cui),
      organizerName: text(company.name),
      organizerAddress: null,
    },
    include: { items: true },
  })
  return res.json({ ok: true, item: serializeNotice(created) })
})

router.post("/api/v1/etransport/notices/from-transfer/:transferId", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const company = await requireRequestCompany(req)
  const transferId = String(req.params.transferId)
  const transfer = await prisma.transferDoc.findFirst({
    where: { id: transferId, tenantId, companyId: company.id },
    include: {
      items: {
        include: {
          product: {
            include: {
              uom: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!transfer) {
    return res.status(404).json({ ok: false, error: "Transferul nu a fost gasit." })
  }

  const items = transfer.items.map((item: any, index: number) => ({
    lineNo: index + 1,
    productId: item.productId,
    sourceItemId: item.id,
    sku: text(item.product?.sku),
    name: text(item.product?.name),
    ncCode: text(item.product?.ncCode),
    fiscalRisk: item.product?.isFiscalRiskProduct === true,
    uomCode: text(item.product?.uom?.standardCode || item.product?.uom?.code),
    qty: new Prisma.Decimal(toNumber(item.qty)),
    unitPrice: new Prisma.Decimal(toNumber(item.unitPrice)),
    lineValue: new Prisma.Decimal(toNumber(item.lineValue)),
    netWeightPerUnitKg: new Prisma.Decimal(toNumber(item.product?.netWeightKg || item.product?.grossWeightKg || 0)),
    netWeightTotalKg: new Prisma.Decimal(toNumber(item.qty) * toNumber(item.product?.netWeightKg || item.product?.grossWeightKg || 0)),
    grossWeightPerUnitKg: new Prisma.Decimal(toNumber(item.product?.grossWeightKg || 0)),
    grossWeightTotalKg: new Prisma.Decimal(toNumber(item.qty) * toNumber(item.product?.grossWeightKg || 0)),
    internalReference: text(transfer.docNo),
  }))

  const summary = recalcNotice(items)
  const created = await prisma.eTransportNotice.create({
    data: {
      tenantId,
      companyId: company.id,
      noticeNo: makeNoticeNo(),
      sourceType: "TRANSFER",
      sourceId: transfer.id,
      sourceDocNo: transfer.docNo,
      transportDocType: "TRANSFER",
      transportDocNo: transfer.docNo,
      transportDocDate: transfer.docDate,
      transportDocNotes: text(transfer.eTransportTransportDocNotes),
      extraInfo: text(transfer.eTransportExtraInfo),
      operationType: text(transfer.eTransportOperationType) || "TTN",
      partnerCountry: text(transfer.eTransportPartnerCountry) || "RO",
      partnerCui: text(transfer.eTransportPartnerCui),
      partnerName: text(transfer.eTransportPartnerName),
      partnerAddress: null,
      internalRef: text(transfer.eTransportInternalRef || transfer.docNo),
      startScope: text(transfer.eTransportStartScope) || "ADR",
      endScope: text(transfer.eTransportEndScope) || "ADR",
      startAddress: text(transfer.eTransportStartAddress),
      endAddress: text(transfer.eTransportEndAddress),
      startBorderPoint: text(transfer.eTransportStartBorderPoint),
      endBorderPoint: text(transfer.eTransportEndBorderPoint),
      candidate: summary.candidate,
      required: transfer.eTransportRequired === true || summary.candidate,
      declaredStart: transfer.eTransportDeclaredStart,
      vehicleNo: text(transfer.vehicleNo),
      trailerNo: text(transfer.trailerNo),
      vehicleMaxMassKg: new Prisma.Decimal(toNumber(transfer.eTransportVehicleMaxMassKg || 0)),
      organizerCountry: "RO",
      organizerCode: text(company.cui),
      organizerName: text(transfer.eTransportOrganizer || company.name),
      organizerAddress: null,
      operatorName: text(transfer.eTransportOperator),
      status: "DRAFT",
      totalGrossWeightKg: new Prisma.Decimal(summary.totalGrossWeightKg),
      totalValueRon: new Prisma.Decimal(summary.totalValueRon),
      items: {
        create: items,
      },
    },
    include: {
      items: true,
    },
  })
  return res.json({ ok: true, item: serializeNotice(created) })
})

router.put("/api/v1/etransport/notices/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const current = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    include: { items: true },
  })
  if (!current) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }

  const header = req.body?.header || {}
  const incomingItems = Array.isArray(req.body?.items) ? req.body.items : []
  const items = incomingItems.map((item: any, index: number) => ({
    lineNo: index + 1,
    productId: text(item.productId) || null,
    sourceItemId: text(item.sourceItemId) || null,
    sku: text(item.sku) || null,
    name: text(item.name),
    ncCode: text(item.ncCode) || null,
    fiscalRisk: Boolean(item.fiscalRisk),
    uomCode: text(item.uomCode) || null,
    qty: new Prisma.Decimal(toNumber(item.qty)),
    unitPrice: new Prisma.Decimal(toNumber(item.unitPrice)),
    lineValue: new Prisma.Decimal(toNumber(item.lineValue)),
    netWeightPerUnitKg: new Prisma.Decimal(toNumber(item.netWeightPerUnitKg)),
    netWeightTotalKg: new Prisma.Decimal(toNumber(item.netWeightTotalKg || toNumber(item.qty) * toNumber(item.netWeightPerUnitKg))),
    grossWeightPerUnitKg: new Prisma.Decimal(toNumber(item.grossWeightPerUnitKg)),
    grossWeightTotalKg: new Prisma.Decimal(toNumber(item.grossWeightTotalKg || toNumber(item.qty) * toNumber(item.grossWeightPerUnitKg))),
    internalReference: text(item.internalReference) || null,
  }))

  const summary = recalcNotice(items)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.eTransportNoticeItem.deleteMany({ where: { noticeId: current.id } })
    return tx.eTransportNotice.update({
      where: { id: current.id },
      data: {
        sourceType: text(header.sourceType) || current.sourceType || "MANUAL",
        sourceDocNo: text(header.sourceDocNo) || null,
        transportDocType: text(header.transportDocType) || null,
        transportDocNo: text(header.transportDocNo) || null,
        transportDocDate: header.transportDocDate ? new Date(String(header.transportDocDate)) : null,
        transportDocNotes: text(header.transportDocNotes) || null,
        extraInfo: text(header.extraInfo) || null,
        operationType: text(header.operationType) || null,
        partnerCountry: text(header.partnerCountry || "RO") || "RO",
        partnerCui: text(header.partnerCui) || null,
        partnerName: text(header.partnerName) || null,
        partnerAddress: text(header.partnerAddress) || null,
        internalRef: text(header.internalRef) || null,
        startScope: text(header.startScope) || "ADR",
        endScope: text(header.endScope) || "ADR",
        startAddress: text(header.startAddress) || null,
        endAddress: text(header.endAddress) || null,
        startBorderPoint: text(header.startBorderPoint) || null,
        endBorderPoint: text(header.endBorderPoint) || null,
        declaredStart: header.declaredStart ? new Date(String(header.declaredStart)) : null,
        vehicleNo: text(header.vehicleNo) || null,
        trailerNo: text(header.trailerNo) || null,
        vehicleMaxMassKg: new Prisma.Decimal(toNumber(header.vehicleMaxMassKg)),
        organizerCountry: text(header.organizerCountry || "RO") || "RO",
        organizerCode: text(header.organizerCode) || null,
        organizerName: text(header.organizerName) || null,
        organizerAddress: text(header.organizerAddress) || null,
        operatorName: text(header.operatorName) || null,
        candidate: summary.candidate,
        required: Boolean(header.required) || summary.candidate,
        totalGrossWeightKg: new Prisma.Decimal(summary.totalGrossWeightKg),
        totalValueRon: new Prisma.Decimal(summary.totalValueRon),
        status: current.status === "PREPARED" ? "DRAFT" : current.status,
        preparedXml: null,
        uploadIndex: null,
        downloadId: null,
        uit: null,
        errorText: null,
        items: {
          create: items,
        },
      },
      include: {
        items: {
          include: {
            product: {
              include: { uom: true, vatRate: true },
            },
          },
          orderBy: { lineNo: "asc" },
        },
      },
    })
  })
  return res.json({ ok: true, item: serializeNotice(updated), message: "Notificarea a fost salvata." })
})

router.post("/api/v1/etransport/notices/:id/prepare", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId },
    select: { id: true, name: true, cui: true },
  })
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    include: { items: { orderBy: { lineNo: "asc" } } },
  })
  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }

  const issues = validateNoticeForETransport(notice)
  const blockingIssues = issues.filter((issue) => issue.severity === "error")
  if (blockingIssues.length) {
    return res.status(400).json({
      ok: false,
      error: blockingIssues[0]?.message || "Notificarea nu poate genera XML-ul RO e-Transport.",
      issues,
    })
  }

  const xmlText = generateETransportNoticeXml({
    ...notice,
    company,
  })
  const updated = await prisma.eTransportNotice.update({
    where: { id: notice.id },
    data: {
      preparedXml: xmlText,
      status: "PREPARED",
      errorText: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message).join("\n") || null,
    },
    include: { items: true },
  })

  return res.json({ ok: true, item: serializeNotice(updated), issues, message: "XML RO e-Transport generat." })
})

router.get("/api/v1/etransport/notices/:id/xml", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    select: { id: true, noticeNo: true, preparedXml: true },
  })
  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }
  if (!notice.preparedXml) {
    return res.status(400).json({ ok: false, error: "Genereaza mai intai XML-ul RO e-Transport." })
  }
  const filename = safeFilePart(`ro-e-transport-${notice.noticeNo || notice.id}.xml`) || `ro-e-transport-${notice.id}.xml`
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(notice.preparedXml)
})

router.post("/api/v1/etransport/notices/:id/send", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    include: { items: { orderBy: { lineNo: "asc" } } },
  })

  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    return res.status(400).json({ ok: false, error: "Firma nu are CUI valid pentru transmiterea la ANAF." })
  }
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  const issues = validateNoticeForETransport(notice)
  const blockingIssues = issues.filter((issue) => issue.severity === "error")
  if (blockingIssues.length) {
    return res.status(400).json({
      ok: false,
      error: blockingIssues[0]?.message || "Notificarea nu poate fi trimisa la ANAF.",
      issues,
    })
  }

  const xmlText =
    notice.preparedXml ||
    generateETransportNoticeXml({
      ...notice,
      company,
    })

  try {
    const uploadResult = await anafUploadEtransportXml(company, xmlText)
    const uploadIndex = uploadResult.uploadIndex
    const summary = explainEtransportAnafError(uploadResult.response.status, uploadResult.summary)

    if (!uploadResult.response.ok || !uploadIndex) {
      await prisma.eTransportNotice.update({
        where: { id: notice.id },
        data: {
          preparedXml: xmlText,
          status: "ERROR",
          errorText: summary || "ANAF a respins upload-ul RO e-Transport.",
        },
      })
      return res.status(400).json({ ok: false, error: summary || "ANAF a respins upload-ul RO e-Transport." })
    }

    const updated = await prisma.eTransportNotice.update({
      where: { id: notice.id },
      data: {
        preparedXml: xmlText,
        status: "SENT",
        uploadIndex,
        errorText: summary || null,
      },
      include: {
        items: {
          include: {
            product: {
              include: { uom: true, vatRate: true },
            },
          },
          orderBy: { lineNo: "asc" },
        },
      },
    })

    return res.json({
      ok: true,
      message: summary || "RO e-Transport a fost trimis la ANAF.",
      uploadIndex,
      item: serializeNotice(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la trimiterea RO e-Transport catre ANAF."
    logAnafRouteError("NOTICE ETRANSPORT SEND ERROR", {
      tenantId,
      noticeId: id,
      message,
      stack: error?.stack || null,
    })
    await prisma.eTransportNotice.update({
      where: { id: notice.id },
      data: {
        preparedXml: xmlText,
        status: "ERROR",
        errorText: message,
      },
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/etransport/notices/:id/status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      items: {
        include: {
          product: { include: { uom: true, vatRate: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  })

  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }

  if (!notice.uploadIndex) {
    return res.status(400).json({ ok: false, error: "Notificarea nu a fost trimisa inca la ANAF." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  try {
    const statusResult = await anafCheckEtransportStatus(company, notice.uploadIndex)
    const summary = statusResult.summary
    const nextStatus = classifyEtransportStatus(statusResult.payload, statusResult.rawText)
    let downloadId = hasExplicitDownloadId(statusResult.rawText)
      ? (statusResult.downloadId || notice.downloadId || null)
      : (notice.downloadId || null)
    let uit = extractUit(statusResult.rawText) || notice.uit || null

    if (!uit || !downloadId) {
      try {
        const [resolvedUit, resolvedDownloadId] = await Promise.all([
          !uit ? resolveNoticeUit(company, notice) : Promise.resolve(""),
          !downloadId ? resolveNoticeDownloadId(company, notice) : Promise.resolve(""),
        ])
        if (!uit && resolvedUit) uit = resolvedUit
        if (!downloadId && resolvedDownloadId) downloadId = resolvedDownloadId
      } catch (lookupError: any) {
        logAnafRouteError("NOTICE ETRANSPORT STATUS LIST LOOKUP ERROR", {
          tenantId,
          noticeId: id,
          uploadIndex: notice.uploadIndex || null,
          message: lookupError?.message || String(lookupError),
        })
      }
    }

    if (!statusResult.response.ok) {
      return res.status(400).json({ ok: false, error: summary || "Nu am putut verifica starea la ANAF." })
    }

    const updated = await prisma.eTransportNotice.update({
      where: { id: notice.id },
      data: {
        status: nextStatus,
        downloadId,
        uit,
        errorText: summary || null,
      },
      include: {
        items: {
          include: {
            product: { include: { uom: true, vatRate: true } },
          },
          orderBy: { lineNo: "asc" },
        },
      },
    })

    return res.json({
      ok: true,
      status: nextStatus,
      uit,
      downloadId,
      message: summary || "Starea RO e-Transport a fost verificata la ANAF.",
      item: serializeNotice(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la verificarea starii in ANAF."
    logAnafRouteError("NOTICE ETRANSPORT STATUS ERROR", {
      tenantId,
      noticeId: id,
      uploadIndex: notice.uploadIndex || null,
      message,
      stack: error?.stack || null,
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/etransport/notices/:id/receipt", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const notice = await prisma.eTransportNotice.findFirst({
    where: { id, tenantId, companyId },
    select: {
      id: true,
      noticeNo: true,
      uploadIndex: true,
      downloadId: true,
      uit: true,
    },
  })

  if (!notice) {
    return res.status(404).json({ ok: false, error: "Notificarea nu a fost gasita." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  let downloadId = await resolveNoticeDownloadId(company, notice)
  if (!downloadId) {
    downloadId = notice.downloadId || ""
  }

  if (!downloadId) {
    const uitFromList = (await resolveNoticeUit(company, notice)) || notice.uit || ""
    if (uitFromList && !notice.uit) {
      await prisma.eTransportNotice.update({
        where: { id: notice.id },
        data: { uit: uitFromList, status: "ACCEPTED", errorText: null },
      })
    }
    return res.status(400).json({
      ok: false,
      error: uitFromList
        ? `e-Transportul este acceptat, iar UIT-ul este ${uitFromList}, dar ANAF nu ofera inca un fisier de raspuns descarcabil pentru acest mesaj in mediul curent.`
        : "Raspunsul ANAF nu este inca disponibil pentru acest e-Transport.",
    })
  }

  try {
    const receiptResult = await anafDownloadEtransportById(company, downloadId)
    const summary = receiptResult.response.ok ? "Raspunsul ANAF a fost descarcat." : receiptResult.summary
    const uit = extractUit(receiptResult.rawText) || notice.uit || null

    if (!receiptResult.response.ok) {
      return res.status(400).json({ ok: false, error: summary || "Nu am putut descarca raspunsul ANAF." })
    }

    await prisma.eTransportNotice.update({
      where: { id: notice.id },
      data: {
        downloadId,
        uit,
        status: "ACCEPTED",
        errorText: null,
      },
    })

    const fileNameBase = safeFilePart(`Raspuns_RO_eTransport_${notice.noticeNo}`) || `Raspuns_RO_eTransport_${notice.id}`
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
    logAnafRouteError("NOTICE ETRANSPORT RECEIPT ERROR", {
      tenantId,
      noticeId: id,
      downloadId: notice.downloadId || null,
      message,
      stack: error?.stack || null,
    })
    return res.status(500).json({ ok: false, error: message })
  }
})

export default router
