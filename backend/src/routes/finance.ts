import { Router } from "express"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { prisma } from "../lib/prisma"
import { requireRequestCompany } from "../lib/companyScope"

const router = Router()

function asDate(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date
}

function dayStart(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function dayEnd(date: Date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function numberValue(value: any) {
  return Number(value || 0)
}

router.get("/api/v1/finance/pos-receipts", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth?.tenantId
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant" })

    const company = await requireRequestCompany(req)
    const now = new Date()
    const dateFrom = asDate(req.query.dateFrom, dayStart(now))
    const dateTo = asDate(req.query.dateTo, dayEnd(now))
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : ""
    const terminalId = typeof req.query.terminalId === "string" ? req.query.terminalId.trim() : ""

    const sales = await prisma.sale.findMany({
      where: {
        tenantId,
        companyId: company.id,
        soldAt: { gte: dateFrom, lte: dateTo },
        ...(locationId ? { locationId } : {}),
        ...(terminalId ? { terminalId } : {}),
      },
      include: {
        location: { select: { id: true, name: true, code: true } },
        terminal: { select: { id: true, label: true, deviceId: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                isSgr: true,
                sgrValue: true,
                uom: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    })

    const items = sales.map((sale) => ({
      id: sale.id,
      receiptNo: sale.receiptNo || sale.clientSaleId || sale.id,
      clientSaleId: sale.clientSaleId,
      soldAt: sale.soldAt,
      total: numberValue(sale.total),
      paymentType: sale.paymentType,
      cashAmount: numberValue(sale.cashAmount),
      cardAmount: numberValue(sale.cardAmount),
      operatorName: sale.operatorName,
      location: sale.location,
      terminal: sale.terminal,
      lines: sale.items.map((line) => {
        const qty = numberValue(line.qty)
        const unitPrice = numberValue(line.unitPrice)
        return {
          id: line.id,
          productId: line.productId,
          sku: line.product?.sku || "",
          name: line.product?.name || "Produs",
          uom: line.product?.uom?.code || line.product?.uom?.name || "",
          qty,
          unitPrice,
          vatRate: line.vatRate,
          total: qty * unitPrice,
          isSgr: Boolean(line.product?.isSgr),
        }
      }),
    }))

    const totals = items.reduce(
      (acc, sale) => {
        acc.total += sale.total
        acc.cash += sale.cashAmount
        acc.card += sale.cardAmount
        acc.count += 1
        return acc
      },
      { total: 0, cash: 0, card: 0, count: 0 }
    )

    res.json({ ok: true, items, totals })
  } catch (error) {
    console.error("FINANCE POS RECEIPTS ERROR", error)
    res.status(500).json({ ok: false, error: "Nu am putut incarca bonurile POS." })
  }
})

router.get("/api/v1/finance/daily-closures", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth?.tenantId
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant" })

    const company = await requireRequestCompany(req)
    const now = new Date()
    const dateFrom = asDate(req.query.dateFrom, dayStart(now))
    const dateTo = asDate(req.query.dateTo, dayEnd(now))
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : ""
    const terminalId = typeof req.query.terminalId === "string" ? req.query.terminalId.trim() : ""
    const companyLocations = await prisma.location.findMany({
      where: {
        tenantId,
        companyId: company.id,
      },
      select: { id: true },
    })
    const companyLocationIds = companyLocations.map((item) => item.id)

    const items = await prisma.posDailyClosure.findMany({
      where: {
        tenantId,
        closedAt: { gte: dateFrom, lte: dateTo },
        OR: [
          { companyId: company.id },
          ...(companyLocationIds.length
            ? [{ companyId: null, locationId: { in: companyLocationIds } }]
            : []),
        ],
        ...(locationId ? { locationId } : {}),
        ...(terminalId ? { terminalId } : {}),
      },
      orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    })

    const mapped = items.map((item) => ({
      id: item.id,
      reportType: item.reportType,
      reportNo: item.reportNo,
      closedAt: item.closedAt,
      total: numberValue(item.total),
      cashTotal: numberValue(item.cashTotal),
      cardTotal: numberValue(item.cardTotal),
      otherTotal: numberValue(item.otherTotal),
      locationId: item.locationId,
      locationName: item.locationName,
      terminalId: item.terminalId,
      terminalLabel: item.terminalLabel,
      deviceId: item.deviceId,
      reportText: item.reportText,
    }))

    const totals = mapped.reduce(
      (acc, item) => {
        acc.total += item.total
        acc.cash += item.cashTotal
        acc.card += item.cardTotal
        acc.other += item.otherTotal
        acc.count += 1
        return acc
      },
      { total: 0, cash: 0, card: 0, other: 0, count: 0 }
    )

    res.json({ ok: true, items: mapped, totals })
  } catch (error) {
    console.error("FINANCE DAILY CLOSURES ERROR", error)
    res.status(500).json({ ok: false, error: "Nu am putut incarca inchiderile zilnice." })
  }
})

export default router
