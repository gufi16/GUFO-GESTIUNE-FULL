import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/*
GET /api/v1/dashboard

Query:
dateFrom
dateTo
*/

router.get("/api/v1/dashboard", async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const locationId = req.query.locationId ? String(req.query.locationId) : null;

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenantId lipsă",
      });
    }

    const dateFrom = req.query.dateFrom
      ? new Date(String(req.query.dateFrom))
      : new Date(new Date().setHours(0, 0, 0, 0));

    const dateTo = req.query.dateTo
      ? new Date(String(req.query.dateTo))
      : new Date();

    /* =====================================
       TOTAL SALES
    ===================================== */

    const saleWhere = {
      tenantId,
      ...(locationId ? { locationId } : {}),
      soldAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    };

    const salesAgg = await prisma.sale.aggregate({
      where: saleWhere,
      _sum: {
        total: true,
      },
      _count: {
        id: true,
      },
    });

    const sales = Number(salesAgg._sum.total || 0);
    const receipts = Number(salesAgg._count.id || 0);
    const avgReceipt = receipts > 0 ? sales / receipts : 0;

    /* =====================================
       CASH VS CARD
    ===================================== */

    const cashAgg = await prisma.sale.aggregate({
      where: saleWhere,
      _sum: {
        cashAmount: true,
      },
    });

    const cardAgg = await prisma.sale.aggregate({
      where: saleWhere,
      _sum: {
        cardAmount: true,
      },
    });

    const cash = Number(cashAgg._sum.cashAmount || 0);
    const card = Number(cardAgg._sum.cardAmount || 0);

    /* =====================================
       SALES PER DAY
    ===================================== */

    const locationFilterSql = locationId ? ` AND "locationId" = '${locationId}'` : "";

    const salesPerDay: any = await prisma.$queryRawUnsafe(`
      SELECT
        DATE("soldAt") as day,
        SUM(total) as total
      FROM "Sale"
      WHERE "tenantId" = '${tenantId}'
      ${locationFilterSql}
      AND "soldAt" BETWEEN '${dateFrom.toISOString()}' AND '${dateTo.toISOString()}'
      GROUP BY day
      ORDER BY day
    `);

    /* =====================================
       TOP PRODUCTS + REAL PROFIT
       profit = SUM((net sale price - costPrice) * qty)
       unitPrice in sale item is treated as gross sale price
       costPrice in Product is treated as net cost
    ===================================== */

    const topProducts: any = await prisma.$queryRawUnsafe(`
      SELECT
        p.name,
        SUM(si.qty) as qty,
        SUM(
          (
            (COALESCE(si."unitPrice", 0) / NULLIF(1 + (COALESCE(si."vatRate", 0) / 100.0), 0))
            - COALESCE(p."costPrice", 0)
          ) * COALESCE(si.qty, 0)
        ) as profit
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si."productId"
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."tenantId" = '${tenantId}'
      ${locationFilterSql.replace(/"locationId"/g, 's."locationId"')}
      AND s."soldAt" BETWEEN '${dateFrom.toISOString()}' AND '${dateTo.toISOString()}'
      GROUP BY p.name
      ORDER BY qty DESC
      LIMIT 5
    `);

    /* =====================================
       LOW STOCK
    ===================================== */

    const lowStock = await prisma.stockBalance.findMany({
      where: {
        tenantId,
        ...(locationId ? { locationId } : {}),
        qty: {
          lte: 5,
        },
      },
      include: {
        product: true,
        location: true,
      },
      take: 10,
    });

    return res.json({
      ok: true,

      sales,
      receipts,
      avgReceipt,

      cash,
      card,

      salesPerDay,

      topProducts: Array.isArray(topProducts)
        ? topProducts.map((item: any) => ({
            name: item.name,
            qty: Number(item.qty || 0),
            profit: Number(item.profit || 0),
          }))
        : [],

      lowStock: lowStock.map((s) => ({
        product: s.product.name,
        location: s.location.name,
        qty: Number(s.qty),
      })),
    });
  } catch (err) {
    console.error("DASHBOARD ERROR", err);

    return res.status(500).json({
      ok: false,
      error: "dashboard_failed",
    });
  }
});

export default router;
