// @ts-nocheck
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";

const router = Router();

/* ======================================================
   GET /api/v1/consumption-docs
   Listă bonuri de consum
====================================================== */

router.get("/api/v1/consumption-docs", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId;

    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    const locationId = req.query.locationId ? String(req.query.locationId) : null;
    const q = req.query.q ? String(req.query.q).trim() : "";

    const docs = await prisma.consumptionDoc.findMany({
      where: {
        tenantId,
        ...(locationId ? { locationId } : {}),
        ...(dateFrom || dateTo
          ? {
              docDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { docNo: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
                {
                  sale: {
                    is: {
                      receiptNo: { contains: q, mode: "insensitive" },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        sale: {
          select: {
            id: true,
            receiptNo: true,
            soldAt: true,
            total: true,
            paymentType: true,
            operatorName: true,
          },
        },
        items: {
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            finishedProduct: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
      },
      orderBy: [
        { docDate: "desc" },
        { createdAt: "desc" },
      ],
    });

    const result = docs.map((doc) => {
      const totalQty = doc.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);

      const finishedProductsMap = new Map<string, { id: string; name: string; sku: string }>();

      for (const item of doc.items) {
        if (item.finishedProduct) {
          finishedProductsMap.set(item.finishedProduct.id, {
            id: item.finishedProduct.id,
            name: item.finishedProduct.name,
            sku: item.finishedProduct.sku,
          });
        }
      }

      return {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,

        location: doc.location,

        sale: doc.sale
          ? {
              id: doc.sale.id,
              receiptNo: doc.sale.receiptNo,
              soldAt: doc.sale.soldAt,
              total: Number(doc.sale.total || 0),
              paymentType: doc.sale.paymentType,
              operatorName: doc.sale.operatorName,
            }
          : null,

        itemsCount: doc.items.length,
        totalQty,
        finishedProducts: Array.from(finishedProductsMap.values()),
      };
    });

    return res.json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("CONSUMPTION DOCS LIST ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: "Nu am putut încărca bonurile de consum.",
    });
  }
});

/* ======================================================
   GET /api/v1/consumption-docs/:id
   Detaliu bon de consum
====================================================== */

router.get("/api/v1/consumption-docs/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id);

    const doc = await prisma.consumptionDoc.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        sale: {
          select: {
            id: true,
            receiptNo: true,
            soldAt: true,
            total: true,
            paymentType: true,
            cashAmount: true,
            cardAmount: true,
            operatorName: true,
            createdAt: true,
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                  },
                },
              },
            },
          },
        },
        items: {
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            finishedProduct: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "Bonul de consum nu există.",
      });
    }

    const totalQty = doc.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);

    return res.json({
      ok: true,
      item: {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,

        location: doc.location,

        sale: doc.sale
          ? {
              id: doc.sale.id,
              receiptNo: doc.sale.receiptNo,
              soldAt: doc.sale.soldAt,
              total: Number(doc.sale.total || 0),
              paymentType: doc.sale.paymentType,
              cashAmount: doc.sale.cashAmount !== null ? Number(doc.sale.cashAmount) : null,
              cardAmount: doc.sale.cardAmount !== null ? Number(doc.sale.cardAmount) : null,
              operatorName: doc.sale.operatorName,
              createdAt: doc.sale.createdAt,
              items: doc.sale.items.map((saleItem) => ({
                id: saleItem.id,
                qty: Number(saleItem.qty || 0),
                unitPrice: Number(saleItem.unitPrice || 0),
                vatRate: saleItem.vatRate,
                product: saleItem.product,
              })),
            }
          : null,

        itemsCount: doc.items.length,
        totalQty,

        items: doc.items.map((item) => ({
          id: item.id,
          qty: Number(item.qty || 0),
          note: item.note,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          finishedProduct: item.finishedProduct,
          ingredient: item.ingredient,
        })),
      },
    });
  } catch (error) {
    console.error("CONSUMPTION DOC DETAIL ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: "Nu am putut încărca bonul de consum.",
    });
  }
});

export default router;
