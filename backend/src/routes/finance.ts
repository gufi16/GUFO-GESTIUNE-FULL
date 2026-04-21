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

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isSyntheticSgrLine(line: any) {
  if (!line?.product?.isSgr) return false
  const unitPrice = numberValue(line?.unitPrice)
  const sgrValue = numberValue(line?.product?.sgrValue || 0.5)
  return line?.vatRate === 0 && Math.abs(unitPrice - sgrValue) < 0.0001
}

function dateToken(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "")
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
        const sgrLine = isSyntheticSgrLine(line)
        return {
          id: line.id,
          productId: line.productId,
          sku: sgrLine ? "SGR" : line.product?.sku || "",
          name: sgrLine ? "SGR" : line.product?.name || "Produs",
          uom: line.product?.uom?.code || line.product?.uom?.name || "",
          qty,
          unitPrice,
          vatRate: line.vatRate,
          total: qty * unitPrice,
          isSgr: sgrLine,
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

router.post("/api/v1/finance/daily-closures/generate-from-sales", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth?.tenantId
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant" })

    const company = await requireRequestCompany(req)
    const now = new Date()
    const dateFrom = asDate(req.body?.dateFrom, dayStart(now))
    const dateTo = asDate(req.body?.dateTo, dayEnd(now))
    const locationId = normalizeText(req.body?.locationId)
    const terminalId = normalizeText(req.body?.terminalId)

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
      },
      orderBy: [{ soldAt: "asc" }, { createdAt: "asc" }],
      take: 1000,
    })

    if (!sales.length) {
      return res.status(400).json({ ok: false, error: "Nu exista vanzari POS in intervalul selectat." })
    }

    const totals = sales.reduce(
      (acc, sale) => {
        const total = numberValue(sale.total)
        const cash = numberValue(sale.cashAmount)
        const card = numberValue(sale.cardAmount)
        acc.total += total

        if (sale.paymentType === "CASH") {
          acc.cash += cash > 0 ? cash : total
        } else if (sale.paymentType === "CARD") {
          acc.card += card > 0 ? card : total
        } else {
          acc.cash += cash
          acc.card += card
          const other = total - cash - card
          if (other > 0) acc.other += other
        }

        return acc
      },
      { total: 0, cash: 0, card: 0, other: 0 }
    )

    const firstSale = sales[0]
    const sameLocation = sales.every((sale) => sale.locationId === firstSale.locationId)
    const sameTerminal = sales.every((sale) => (sale.terminalId || "") === (firstSale.terminalId || ""))
    const locationName = sameLocation
      ? firstSale.location?.name || firstSale.location?.code || null
      : "Toate locatiile"
    const terminalLabel = sameTerminal
      ? firstSale.terminal?.label || firstSale.terminal?.deviceId || null
      : "Toate terminalele"
    const deviceId = sameTerminal ? firstSale.terminal?.deviceId || null : null
    const reportNo = `ERP-${dateToken(dateFrom)}${dateToken(dateFrom) === dateToken(dateTo) ? "" : `-${dateToken(dateTo)}`}${locationId ? `-${locationId.slice(-6)}` : ""}${terminalId ? `-${terminalId.slice(-6)}` : ""}`

    const reportLines = [
      "Raport Z generat automat din vanzarile POS sincronizate in ERP",
      `Interval: ${dateFrom.toISOString()} -> ${dateTo.toISOString()}`,
      `Firma: ${company.name}`,
      `Locatie: ${locationName || "-"}`,
      `Terminal: ${terminalLabel || "-"}`,
      `Bonuri: ${sales.length}`,
      `Total: ${totals.total.toFixed(2)} RON`,
      `Cash: ${totals.cash.toFixed(2)} RON`,
      `Card: ${totals.card.toFixed(2)} RON`,
      `Alte metode: ${totals.other.toFixed(2)} RON`,
      "",
      "Bonuri incluse:",
      ...sales.map((sale) => {
        const receiptNo = sale.receiptNo || sale.clientSaleId || sale.id
        const locationLabel = sale.location?.name || sale.location?.code || "-"
        const terminal = sale.terminal?.label || sale.terminal?.deviceId || "-"
        return `${sale.soldAt.toISOString()} | ${receiptNo} | ${numberValue(sale.total).toFixed(2)} RON | ${sale.paymentType} | ${locationLabel} | ${terminal}`
      }),
    ]

    const existing = await prisma.posDailyClosure.findFirst({
      where: {
        tenantId,
        companyId: company.id,
        locationId: locationId || null,
        terminalId: terminalId || null,
        reportType: "Z",
        reportNo,
      },
      orderBy: { createdAt: "desc" },
    })

    const payloadJson = {
      source: "erp-sales-rebuild",
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      salesCount: sales.length,
      receiptIds: sales.map((sale) => sale.id),
    }

    const data = {
      tenantId,
      companyId: company.id,
      locationId: locationId || (sameLocation ? firstSale.locationId : null),
      terminalId: terminalId || (sameTerminal ? firstSale.terminalId || null : null),
      deviceId,
      locationName,
      terminalLabel,
      reportType: "Z",
      reportNo,
      closedAt: dateTo,
      total: totals.total,
      cashTotal: totals.cash,
      cardTotal: totals.card,
      otherTotal: totals.other,
      reportText: reportLines.join("\n"),
      payloadJson,
    }

    const item = existing
      ? await prisma.posDailyClosure.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.posDailyClosure.create({
          data,
        })

    res.json({
      ok: true,
      created: !existing,
      item: {
        id: item.id,
        reportNo: item.reportNo,
        total: numberValue(item.total),
        cashTotal: numberValue(item.cashTotal),
        cardTotal: numberValue(item.cardTotal),
        otherTotal: numberValue(item.otherTotal),
        closedAt: item.closedAt,
      },
    })
  } catch (error) {
    console.error("FINANCE DAILY CLOSURE GENERATE ERROR", error)
    res.status(500).json({ ok: false, error: "Nu am putut genera inchiderea zilnica din vanzarile POS." })
  }
})

export default router
