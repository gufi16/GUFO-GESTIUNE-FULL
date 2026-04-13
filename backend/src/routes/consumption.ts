// @ts-nocheck
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { decrementStockBalanceStrict } from "../lib/stock";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { buildCompanyScopedTenantWhere, requireRequestCompanyId } from "../lib/companyScope";

const router = Router();

function createConsumptionDocNo() {
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  const hh = `${now.getHours()}`.padStart(2, "0");
  const mi = `${now.getMinutes()}`.padStart(2, "0");
  const ss = `${now.getSeconds()}`.padStart(2, "0");
  const rnd = `${Math.floor(Math.random() * 10000)}`.padStart(4, "0");
  return `BC-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rnd}`;
}

/* ======================================================
   POST /api/v1/consumption-docs
   Creează manual bon de consum și scade stocul
====================================================== */

router.post("/api/v1/consumption-docs", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const companyId = await requireRequestCompanyId(req);
    const locationId = String(req.body?.locationId || "").trim();
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const docDateRaw = req.body?.docDate ? new Date(String(req.body.docDate)) : new Date();
    const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!locationId) {
      return res.status(400).json({ ok: false, error: "Selectează locația pentru bonul de consum." });
    }

    if (!itemsRaw.length) {
      return res.status(400).json({ ok: false, error: "Adaugă cel puțin un produs în bonul de consum." });
    }

    const normalizedItems = itemsRaw
      .map((item: any) => ({
        ingredientId: String(item?.productId || item?.ingredientId || "").trim(),
        qty: Number(item?.qty || 0),
        note: typeof item?.note === "string" ? item.note.trim() : "",
      }))
      .filter((item: any) => item.ingredientId && Number.isFinite(item.qty) && item.qty > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ ok: false, error: "Cantitățile din bonul de consum sunt invalide." });
    }

    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        OR: [{ companyId }, { companyId: null }],
      },
      select: { id: true, name: true },
    });

    if (!location) {
      return res.status(404).json({ ok: false, error: "Locația selectată nu există." });
    }

    const productIds = normalizedItems.map((item: any) => item.ingredientId);
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId,
        id: { in: productIds },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        class: true,
        uom: { select: { code: true, name: true } },
      },
    });

    const productMap = new Map(products.map((product: any) => [product.id, product]));
    const missingProductId = normalizedItems.find((item: any) => !productMap.has(item.ingredientId))?.ingredientId;
    if (missingProductId) {
      return res.status(400).json({ ok: false, error: "Unul dintre produsele selectate nu mai există în nomenclator." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.consumptionDoc.create({
        data: {
          tenantId,
          companyId,
          locationId,
          docNo: createConsumptionDocNo(),
          docDate: docDateRaw,
          note: note || null,
        },
      });

      for (const line of normalizedItems) {
        const product = productMap.get(line.ingredientId);
        const qtyDecimal = new Prisma.Decimal(line.qty);

        await decrementStockBalanceStrict(tx, {
          tenantId,
          companyId,
          locationId,
          productId: line.ingredientId,
          qty: qtyDecimal,
          productName: product?.name || `produs ${line.ingredientId}`,
          uomCode: product?.uom?.code || product?.uom?.name || "",
        });

        await tx.consumptionDocItem.create({
          data: {
            consumptionDocId: doc.id,
            ingredientId: line.ingredientId,
            qty: qtyDecimal,
            note: line.note || null,
          },
        });

        await tx.stockMove.create({
          data: {
            tenantId,
            companyId,
            locationId,
            productId: line.ingredientId,
            type: "OUT",
            qty: qtyDecimal,
            refType: "CONSUMPTION",
            refId: doc.id,
            note: note || `Consum manual ${doc.docNo}`,
          },
        });
      }

      return doc;
    });

    return res.status(201).json({
      ok: true,
      item: {
        id: result.id,
        docNo: result.docNo,
        docDate: result.docDate,
        locationId,
        locationName: location.name,
      },
    });
  } catch (error: any) {
    console.error("CONSUMPTION DOC CREATE ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut salva bonul de consum.",
    });
  }
});

/* ======================================================
   GET /api/v1/consumption-docs
   Listă bonuri de consum
====================================================== */

router.get("/api/v1/consumption-docs", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const companyId = await requireRequestCompanyId(req);

    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    const locationId = req.query.locationId ? String(req.query.locationId) : null;
    const q = req.query.q ? String(req.query.q).trim() : "";

    const docs = await prisma.consumptionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
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
    const companyId = await requireRequestCompanyId(req);
    const id = String(req.params.id);

    const doc = await prisma.consumptionDoc.findFirst({
      where: {
        id,
        ...buildCompanyScopedTenantWhere(tenantId, companyId, { id }),
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
