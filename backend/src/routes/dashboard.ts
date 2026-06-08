import { Router, Response } from "express"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

type ActivityType =
  | "sale"
  | "purchase"
  | "transfer"
  | "consumption"
  | "production"
  | "inventory"
  | "minutes"

type RecentActivityItem = {
  type: ActivityType
  title: string
  meta: string
  at: string
}

type DashboardSaleLike = {
  total?: unknown
  paymentType?: unknown
  cashAmount?: unknown
  cardAmount?: unknown
}

function parseBoundaryDate(value: unknown, fallback: Date, endOfDay = false) {
  const text = String(value || "").trim()
  if (!text) return fallback

  const hasExplicitTime = text.includes("T")
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return fallback

  if (!hasExplicitTime) {
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  }

  return date
}

function buildLocationWhere(locationId: string | null) {
  return locationId ? { locationId } : {}
}

function buildTerminalWhere(terminalId: string | null) {
  return terminalId ? { terminalId } : {}
}

function deriveSalePaymentBuckets(sale: DashboardSaleLike) {
  const total = Number(sale?.total || 0)
  const cash = Number(sale?.cashAmount || 0)
  const card = Number(sale?.cardAmount || 0)
  const paymentType = String(sale?.paymentType || "").trim().toUpperCase()

  if (paymentType === "CASH") {
    return { cash: cash > 0 ? cash : total, card: 0 }
  }

  if (paymentType === "CARD") {
    return { cash: 0, card: card > 0 ? card : total }
  }

  return { cash, card }
}

router.get("/api/v1/dashboard", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const locationId = req.query.locationId ? String(req.query.locationId) : null
    const terminalId = req.query.terminalId ? String(req.query.terminalId) : null

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId lipsa" })
    }

    const now = new Date()
    const dateFrom = parseBoundaryDate(req.query.dateFrom, new Date(new Date().setHours(0, 0, 0, 0)), false)
    const dateTo = parseBoundaryDate(req.query.dateTo, new Date(now.setHours(23, 59, 59, 999)), true)

    const saleWhere = {
      tenantId,
      companyId,
      ...buildLocationWhere(locationId),
      ...buildTerminalWhere(terminalId),
      soldAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    }

    const [
      salesAgg,
      paymentSales,
      salesPerDayRows,
      topProductsRows,
      lowStock,
      recentSales,
      recentPurchases,
      recentTransfers,
      recentConsumptions,
      recentProductions,
      recentInventories,
      recentMinutes,
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.findMany({
        where: saleWhere,
        select: {
          total: true,
          paymentType: true,
          cashAmount: true,
          cardAmount: true,
        },
      }),
      prisma.$queryRaw<Array<{ day: string; total: number }>>(Prisma.sql`
        SELECT
          DATE("soldAt") as day,
          SUM(total) as total
        FROM "Sale"
        WHERE "tenantId" = ${tenantId}
          AND "companyId" = ${companyId}
          ${locationId ? Prisma.sql`AND "locationId" = ${locationId}` : Prisma.empty}
          ${terminalId ? Prisma.sql`AND "terminalId" = ${terminalId}` : Prisma.empty}
          AND "soldAt" BETWEEN ${dateFrom} AND ${dateTo}
        GROUP BY day
        ORDER BY day
      `),
      prisma.$queryRaw<Array<{ name: string; qty: number; profit: number }>>(Prisma.sql`
        SELECT
          p.name,
          SUM(si.qty) as qty,
          SUM(
            (
              (COALESCE(si."unitPrice", 0) / NULLIF(1 + (COALESCE(si."vatRate", 0) / 100.0), 0))
              - COALESCE(rc."recipeCost", p."costPrice", 0)
            ) * COALESCE(si.qty, 0)
          ) as profit
        FROM "SaleItem" si
        JOIN "Product" p ON p.id = si."productId"
        JOIN "Sale" s ON s.id = si."saleId"
        LEFT JOIN (
          SELECT
            r."productId",
            SUM(
              (COALESCE(ri.qty, 0) / NULLIF(COALESCE(r."yieldQty", 1), 0))
              * (1 + (COALESCE(ri."lossPercent", 0) / 100.0))
              * COALESCE(ingredient."costPrice", 0)
            ) as "recipeCost"
          FROM "Recipe" r
          JOIN "RecipeItem" ri ON ri."recipeId" = r.id
          JOIN "Product" ingredient ON ingredient.id = ri."ingredientId"
          WHERE r."tenantId" = ${tenantId}
            AND r."companyId" = ${companyId}
            AND r.status = 'ACTIVE'
            AND COALESCE(r."isActive", true) = true
          GROUP BY r."productId"
        ) rc ON rc."productId" = p.id
        WHERE s."tenantId" = ${tenantId}
          AND s."companyId" = ${companyId}
          ${locationId ? Prisma.sql`AND s."locationId" = ${locationId}` : Prisma.empty}
          ${terminalId ? Prisma.sql`AND s."terminalId" = ${terminalId}` : Prisma.empty}
          AND s."soldAt" BETWEEN ${dateFrom} AND ${dateTo}
          AND NOT (
            COALESCE(p."isSgr", false) = true
            AND COALESCE(si."vatRate", 0) = 0
            AND COALESCE(si."unitPrice", 0) = COALESCE(p."sgrValue", 0)
          )
        GROUP BY p.name
        ORDER BY qty DESC
        LIMIT 5
      `),
      prisma.stockBalance.findMany({
        where: {
          tenantId,
          companyId,
          ...buildLocationWhere(locationId),
          qty: { lte: 5 },
        },
        include: {
          product: true,
          location: true,
        },
        take: 10,
      }),
      prisma.sale.findMany({
        where: saleWhere,
        select: {
          id: true,
          receiptNo: true,
          total: true,
          soldAt: true,
          location: { select: { name: true } },
        },
        orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
        take: 4,
      }),
      prisma.purchaseReceipt.findMany({
        where: {
          tenantId,
          companyId,
          ...buildLocationWhere(locationId),
        },
        select: {
          id: true,
          docNo: true,
          supplierName: true,
          createdAt: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.transferDoc.findMany({
        where: {
          tenantId,
          companyId,
          ...(locationId
            ? {
                OR: [{ fromLocationId: locationId }, { toLocationId: locationId }],
              }
            : {}),
        },
        select: {
          id: true,
          docNo: true,
          createdAt: true,
          fromLocation: { select: { name: true } },
          toLocation: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.consumptionDoc.findMany({
        where: {
          tenantId,
          companyId,
          status: "VALIDATED",
          ...buildLocationWhere(locationId),
        },
        select: {
          id: true,
          docNo: true,
          createdAt: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.productionDoc.findMany({
        where: {
          tenantId,
          companyId,
          ...buildLocationWhere(locationId),
        },
        select: {
          id: true,
          docNo: true,
          createdAt: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.inventoryDoc.findMany({
        where: {
          tenantId,
          companyId,
          ...buildLocationWhere(locationId),
        },
        select: {
          id: true,
          docNo: true,
          createdAt: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.minutesDoc.findMany({
        where: {
          tenantId,
          companyId,
          ...buildLocationWhere(locationId),
        },
        select: {
          id: true,
          docNo: true,
          type: true,
          createdAt: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
    ])

    const sales = Number(salesAgg._sum.total || 0)
    const receipts = Number(salesAgg._count.id || 0)
    const avgReceipt = receipts > 0 ? sales / receipts : 0
    const paymentTotals = paymentSales.reduce(
      (acc, sale) => {
        const buckets = deriveSalePaymentBuckets(sale)
        acc.cash += buckets.cash
        acc.card += buckets.card
        return acc
      },
      { cash: 0, card: 0 }
    )
    const cash = paymentTotals.cash
    const card = paymentTotals.card

    const recentActivity: RecentActivityItem[] = [
      ...recentSales.map((item) => ({
        type: "sale" as const,
        title: `Bon fiscal ${item.receiptNo ? `#${item.receiptNo}` : "nou"}`,
        meta: `${item.location?.name || "locatie necunoscuta"} | ${Number(item.total || 0).toFixed(2)} RON`,
        at: item.soldAt.toISOString(),
      })),
      ...recentPurchases.map((item) => ({
        type: "purchase" as const,
        title: `NIR ${item.docNo}`,
        meta: `${item.supplierName || "furnizor"} | ${item.location?.name || "locatie"}`,
        at: item.createdAt.toISOString(),
      })),
      ...recentTransfers.map((item) => ({
        type: "transfer" as const,
        title: `Transfer ${item.docNo}`,
        meta: `${item.fromLocation?.name || "-"} -> ${item.toLocation?.name || "-"}`,
        at: item.createdAt.toISOString(),
      })),
      ...recentConsumptions.map((item) => ({
        type: "consumption" as const,
        title: `Bon consum ${item.docNo}`,
        meta: item.location?.name || "locatie",
        at: item.createdAt.toISOString(),
      })),
      ...recentProductions.map((item) => ({
        type: "production" as const,
        title: `Productie ${item.docNo}`,
        meta: item.location?.name || "locatie",
        at: item.createdAt.toISOString(),
      })),
      ...recentInventories.map((item) => ({
        type: "inventory" as const,
        title: `Inventar ${item.docNo}`,
        meta: item.location?.name || "locatie",
        at: item.createdAt.toISOString(),
      })),
      ...recentMinutes.map((item) => ({
        type: "minutes" as const,
        title: `${item.type === "PRICE_CHANGE" ? "Proces verbal pret" : "Proces verbal"} ${item.docNo}`,
        meta: item.location?.name || "locatie",
        at: item.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6)

    return res.json({
      ok: true,
      sales,
      receipts,
      avgReceipt,
      cash,
      card,
      salesPerDay: Array.isArray(salesPerDayRows)
        ? salesPerDayRows.map((item) => ({
            day: item.day,
            total: Number(item.total || 0),
          }))
        : [],
      topProducts: Array.isArray(topProductsRows)
        ? topProductsRows.map((item) => ({
            name: item.name,
            qty: Number(item.qty || 0),
            profit: Number(item.profit || 0),
          }))
        : [],
      lowStock: lowStock.map((item) => ({
        product: item.product.name,
        location: item.location.name,
        qty: Number(item.qty),
      })),
      recentActivity,
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("DASHBOARD ERROR", err)

    return res.status(500).json({
      ok: false,
      error: "dashboard_failed",
    })
  }
})

export default router
