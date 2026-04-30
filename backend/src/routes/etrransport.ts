// @ts-nocheck
import { Router } from "express"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompany, requireRequestCompanyId } from "../lib/companyScope"
import { generateETransportNoticeXml, validateNoticeForETransport } from "../lib/etransport"

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
      operationType: "TTN",
      partnerCountry: "RO",
      startScope: "ADR",
      endScope: "ADR",
      organizerCountry: "RO",
      organizerCode: text(company.cui),
      organizerName: text(company.name),
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
      operationType: text(transfer.eTransportOperationType) || "TTN",
      partnerCountry: text(transfer.eTransportPartnerCountry) || "RO",
      partnerCui: text(transfer.eTransportPartnerCui),
      partnerName: text(transfer.eTransportPartnerName),
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
        operationType: text(header.operationType) || null,
        partnerCountry: text(header.partnerCountry || "RO") || "RO",
        partnerCui: text(header.partnerCui) || null,
        partnerName: text(header.partnerName) || null,
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
        operatorName: text(header.operatorName) || null,
        candidate: summary.candidate,
        required: Boolean(header.required) || summary.candidate,
        totalGrossWeightKg: new Prisma.Decimal(summary.totalGrossWeightKg),
        totalValueRon: new Prisma.Decimal(summary.totalValueRon),
        status: current.status === "PREPARED" ? "DRAFT" : current.status,
        preparedXml: null,
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

  const xmlText = generateETransportNoticeXml(notice)
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

export default router
