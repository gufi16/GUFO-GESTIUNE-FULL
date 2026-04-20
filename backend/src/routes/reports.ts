// @ts-nocheck
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

function toNumber(val: unknown) {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

function parseDateStart(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

function parseDateEnd(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(23, 59, 59, 999)
  return d
}

function getNetUnitPrice(unitPrice: number, vatRate: number) {
  if (!vatRate || vatRate <= 0) return unitPrice
  return unitPrice / (1 + vatRate / 100)
}

function isSyntheticSgrSaleItem(item: any) {
  const product = item?.product
  if (!product?.isSgr) return false

  const unitPrice = toNumber(item?.unitPrice)
  const vatRate = toNumber(item?.vatRate)
  const sgrValue = toNumber(product?.sgrValue || 0.5)

  return vatRate === 0 && Math.abs(unitPrice - sgrValue) < 0.0001
}

function formatDayLabel(date: Date) {
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  return `${day}.${month}`
}

router.get("/api/v1/reports/advanced", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)

    const from =
      parseDateStart(req.query.dateFrom) ||
      parseDateStart(req.query.from) ||
      new Date("2000-01-01")

    const to =
      parseDateEnd(req.query.dateTo) ||
      parseDateEnd(req.query.to) ||
      new Date()

    const locationId = String(req.query.locationId || "").trim() || null
    const terminalId = String(req.query.terminalId || "").trim() || null
    const whereLocation = locationId ? { locationId } : {}
    const whereTerminal = terminalId ? { terminalId } : {}

    const [locations, products, sales, stockBalances, inventoryDocs, consumptionDocs, stockMoves] =
      await Promise.all([
        prisma.location.findMany({
          where: {
            tenantId,
            companyId,
            isActive: true,
          },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            code: true,
          },
        }),

        prisma.product.findMany({
          where: {
            tenantId,
            companyId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            class: true,
            costPrice: true,
            uom: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: { name: "asc" },
        }),

        prisma.sale.findMany({
          where: {
            tenantId,
            companyId,
            soldAt: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
            ...whereTerminal,
          },
          include: {
            items: {
              include: {
                product: {
                  include: {
                    uom: true,
                  },
                },
              },
            },
            location: true,
          },
          orderBy: { soldAt: "asc" },
        }),

        prisma.stockBalance.findMany({
          where: {
            tenantId,
            companyId,
            ...whereLocation,
          },
          include: {
            product: {
              include: {
                uom: true,
              },
            },
            location: true,
          },
          orderBy: {
            product: {
              name: "asc",
            },
          },
        }),

        prisma.inventoryDoc.findMany({
          where: {
            tenantId,
            companyId,
            status: "FINALIZED",
            docDate: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
          },
          include: {
            location: true,
            items: {
              include: {
                product: {
                  include: {
                    uom: true,
                  },
                },
              },
            },
          },
          orderBy: { docDate: "desc" },
        }),

        prisma.consumptionDoc.findMany({
          where: {
            tenantId,
            companyId,
            docDate: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
          },
          include: {
            location: true,
            items: {
              include: {
                ingredient: {
                  include: {
                    uom: true,
                  },
                },
                finishedProduct: true,
              },
            },
          },
          orderBy: { docDate: "desc" },
        }),

        prisma.stockMove.findMany({
          where: {
            tenantId,
            companyId,
            createdAt: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
          },
          include: {
            product: {
              include: {
                uom: true,
              },
            },
            location: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ])

    let totalSales = 0
    let estimatedProfit = 0

    const salesByLocationMap: Record<string, {
      locationId: string | null
      id: string | null
      name: string
      sales: number
      total: number
      profit: number
      margin: number
    }> = {}

    const salesTrendMap: Record<string, {
      sortKey: string
      name: string
      sales: number
      profit: number
    }> = {}

    const topProductsMap: Record<string, {
      productId: string
      name: string
      qty: number
      sales: number
      total: number
      profit: number
      marginPercent: number
    }> = {}

    const topProfitProductsMap: Record<string, {
      productId: string
      name: string
      profit: number
      qty: number
      total: number
    }> = {}

    const unprofitableProductsMap: Record<string, {
      productId: string
      name: string
      profit: number
      qty: number
      total: number
    }> = {}

    for (const sale of sales) {
      const saleTotal = toNumber(sale.total)
      totalSales += saleTotal

      const locKey = sale.locationId || "no-location"
      if (!salesByLocationMap[locKey]) {
        salesByLocationMap[locKey] = {
          locationId: sale.locationId || null,
          id: sale.locationId || null,
          name: sale.location?.name || "Fără locație",
          sales: 0,
          total: 0,
          profit: 0,
          margin: 0,
        }
      }

      salesByLocationMap[locKey].sales += saleTotal
      salesByLocationMap[locKey].total += saleTotal

      const trendKey = sale.soldAt.toISOString().slice(0, 10)
      if (!salesTrendMap[trendKey]) {
        salesTrendMap[trendKey] = {
          sortKey: trendKey,
          name: formatDayLabel(sale.soldAt),
          sales: 0,
          profit: 0,
        }
      }
      salesTrendMap[trendKey].sales += saleTotal

      for (const item of sale.items) {
        if (isSyntheticSgrSaleItem(item)) continue

        const key = item.productId
        const qty = toNumber(item.qty)
        const unitPriceGross = toNumber(item.unitPrice)
        const vatRate = toNumber(item.vatRate)
        const unitPriceNet = getNetUnitPrice(unitPriceGross, vatRate)
        const lineRevenueNet = qty * unitPriceNet
        const lineCost = qty * toNumber(item.product?.costPrice || 0)
        const lineProfit = lineRevenueNet - lineCost

        estimatedProfit += lineProfit
        salesByLocationMap[locKey].profit += lineProfit
        salesTrendMap[trendKey].profit += lineProfit

        if (!topProductsMap[key]) {
          topProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            qty: 0,
            sales: 0,
            total: 0,
            profit: 0,
            marginPercent: 0,
          }
        }

        topProductsMap[key].qty += qty
        topProductsMap[key].sales += lineRevenueNet
        topProductsMap[key].total += lineRevenueNet
        topProductsMap[key].profit += lineProfit

        if (!topProfitProductsMap[key]) {
          topProfitProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            profit: 0,
            qty: 0,
            total: 0,
          }
        }
        topProfitProductsMap[key].profit += lineProfit
        topProfitProductsMap[key].qty += qty
        topProfitProductsMap[key].total += lineRevenueNet

        if (!unprofitableProductsMap[key]) {
          unprofitableProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            profit: 0,
            qty: 0,
            total: 0,
          }
        }
        unprofitableProductsMap[key].profit += lineProfit
        unprofitableProductsMap[key].qty += qty
        unprofitableProductsMap[key].total += lineRevenueNet
      }
    }

    const salesByLocation = Object.values(salesByLocationMap)
      .map((row) => ({
        ...row,
        margin: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
        marginPercent: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
      }))
      .sort((a, b) => b.sales - a.sales)

    const salesTrend = Object.values(salesTrendMap)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ sortKey, ...row }) => row)

    const topProducts = Object.values(topProductsMap)
      .map((row) => ({
        ...row,
        marginPercent: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
      }))
      .sort((a, b) => {
        if (b.qty !== a.qty) return b.qty - a.qty
        return b.sales - a.sales
      })
      .slice(0, 15)

    const topProfitProducts = Object.values(topProfitProductsMap)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 15)

    const unprofitableProducts = Object.values(unprofitableProductsMap)
      .filter((row) => row.profit <= 0 && row.total > 0)
      .sort((a, b) => a.profit - b.profit)
      .slice(0, 15)

    let totalInventoryDiff = 0
    const inventoryDiffItems: Array<{
      docId: string
      docNo: string
      docDate: Date
      location: string
      product: string
      stock: number
      qty: number
      um: string
      status: string
      scriptic: number
      numarat: number
      diferenta: number
    }> = []

    for (const doc of inventoryDocs) {
      for (const item of doc.items) {
        const diff = toNumber(item.differenceQty)
        totalInventoryDiff += diff

        inventoryDiffItems.push({
          docId: doc.id,
          docNo: doc.docNo,
          docDate: doc.docDate,
          location: doc.location?.name || "Fără locație",
          product: item.product?.name || "Produs",
          stock: diff,
          qty: diff,
          um: item.product?.uom?.code || "buc",
          status: "diferență",
          scriptic: toNumber(item.systemQty),
          numarat: toNumber(item.countedQty),
          diferenta: diff,
        })
      }
    }

    const consumptionByIngredientMap: Record<
      string,
      { ingredientId: string; name: string; qty: number; um: string; uomCode: string; uomName: string }
    > = {}

    for (const doc of consumptionDocs) {
      for (const item of doc.items) {
        const key = item.ingredientId
        if (!consumptionByIngredientMap[key]) {
          consumptionByIngredientMap[key] = {
            ingredientId: key,
            name: item.ingredient?.name || "Ingredient",
            qty: 0,
            um: item.ingredient?.uom?.code || "buc",
            uomCode: item.ingredient?.uom?.code || "buc",
            uomName: item.ingredient?.uom?.name || "Bucată",
          }
        }

        consumptionByIngredientMap[key].qty += toNumber(item.qty)
      }
    }

    const rawConsumption = Object.values(consumptionByIngredientMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20)

    const lowStockAlerts = stockBalances
      .filter((row) => {
        const qty = toNumber(row.qty)
        return qty <= 5
      })
      .map((row) => ({
        productId: row.productId,
        name: row.product?.name || "Produs",
        product: row.product?.name || "Produs",
        location: row.location?.name || "Fără locație",
        stock: toNumber(row.qty),
        qty: toNumber(row.qty),
        quantity: toNumber(row.qty),
        um: row.product?.uom?.code || "buc",
        uom: row.product?.uom?.code || "buc",
        status: toNumber(row.qty) <= 0 ? "critic" : "scăzut",
        reason: toNumber(row.qty) <= 0 ? "stoc negativ sau zero" : "stoc critic",
      }))

    const noCostAlerts = stockBalances
      .filter((row) => toNumber(row.qty) > 0 && toNumber(row.product?.costPrice) <= 0)
      .map((row) => ({
        productId: row.productId,
        name: row.product?.name || "Produs",
        product: row.product?.name || "Produs",
        location: row.location?.name || "Fără locație",
        stock: toNumber(row.qty),
        qty: toNumber(row.qty),
        quantity: toNumber(row.qty),
        um: row.product?.uom?.code || "buc",
        uom: row.product?.uom?.code || "buc",
        status: "fără cost",
        reason: "produs cu stoc dar fără cost",
      }))

    const stockAlerts = [...lowStockAlerts, ...noCostAlerts, ...inventoryDiffItems]
      .sort((a, b) => Math.abs(toNumber(a.stock)) - Math.abs(toNumber(b.stock)))
      .slice(0, 25)

    const negativeStockProducts = lowStockAlerts
      .filter((item) => toNumber(item.stock) <= 0)
      .sort((a, b) => a.stock - b.stock)

    const stockIssues = negativeStockProducts.map((item) => ({
      productId: item.productId,
      product: item.product,
      location: item.location,
      qty: item.qty,
    }))

    const recentStockMoves = stockMoves.map((move) => ({
      id: move.id,
      date: move.createdAt,
      type: move.type,
      product: move.product?.name || "Produs",
      location: move.location?.name || "Fără locație",
      qty: toNumber(move.qty),
      um: move.product?.uom?.code || "buc",
      refType: move.refType || null,
      note: move.note || "",
    }))

    const productClassLabels: Record<string, string> = {
      MARFA: "Marfă",
      PRODUS_FIN: "Produse finite",
      MATERIE_PRIMA: "Materii prime",
      AMBALAJE: "Ambalaje",
      CONSUMABILE: "Consumabile",
      SEMIFABRICATE: "Semifabricate",
      REZIDUALE: "Reziduale",
      ALTE_MATERIALE: "Alte materiale",
    }

    const productMixCountMap: Record<string, number> = {}
    for (const product of products) {
      const label = productClassLabels[product.class] || product.class
      productMixCountMap[label] = (productMixCountMap[label] || 0) + 1
    }

    const productMixTotal = Object.values(productMixCountMap).reduce((acc, value) => acc + value, 0)
    const productMix = Object.entries(productMixCountMap)
      .map(([name, count]) => ({
        name,
        count,
        value: productMixTotal > 0 ? Number(((count / productMixTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    const activeLocations = salesByLocation.filter((row) => row.sales > 0).length
    const averageMargin = totalSales > 0 ? (estimatedProfit / totalSales) * 100 : 0

    res.json({
      ok: true,
      filters: {
        from,
        to,
        dateFrom: from,
        dateTo: to,
        locationId,
      },
      locations,
      totalSales,
      estimatedProfit,
      averageMargin,
      activeLocations,
      salesTrend,
      monthlyTrend: salesTrend,
      salesByLocation,
      topProducts,
      topProfitProducts,
      unprofitableProducts,
      rawConsumption,
      consumptionRawMaterials: rawConsumption,
      stockAlerts,
      negativeStockProducts,
      stockIssues,
      totalInventoryDiff,
      inventoryDiffItems,
      consumptionByIngredient: rawConsumption,
      recentStockMoves,
      pieData: productMix,
      productMix,
    })
  } catch (err) {
    console.error("REPORTS ADVANCED ERROR:", err)
    return res.status(500).json({
      ok: false,
      error: "Eroare rapoarte",
    })
  }
})

export default router
