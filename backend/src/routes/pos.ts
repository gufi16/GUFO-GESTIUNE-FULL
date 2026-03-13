import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

console.log("POS ROUTES FILE LOADED");

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

/* ======================================================
   POS TOKEN
====================================================== */

function signPosToken(payload: { tenantId: string; terminalId: string; deviceId: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

type PosAuthRequest = Request & {
  auth?: {
    tenantId: string;
    terminalId?: string;
    deviceId?: string;
  };
};

function requirePosAuth(req: PosAuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      tenantId: string;
      terminalId: string;
      deviceId: string;
    };

    req.auth = {
      tenantId: decoded.tenantId,
      terminalId: decoded.terminalId,
      deviceId: decoded.deviceId,
    };

    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid POS token" });
  }
}

function toNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildPublicBaseUrl(req: Request) {
  const configured = normalizeText(process.env.PUBLIC_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = req.get("host") || "";
  const forwardedProto = normalizeText(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || req.protocol || "http";

  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function resolveImageUrl(req: Request, rawUrl: unknown) {
  const value = normalizeText(rawUrl);
  if (!value) return null;

  const baseUrl = buildPublicBaseUrl(req);

  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i;
  if (localhostPattern.test(value)) {
    return value.replace(localhostPattern, baseUrl);
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }

  return `${baseUrl}/${value}`;
}

function buildSgrLine(product: any, qty: number) {
  const isSgr = Boolean(product?.isSgr);
  const unitPrice = isSgr ? toNumber(product?.sgrValue || 0.5) : 0;
  const total = qty * unitPrice;

  return {
    type: "SGR",
    productId: product?.id || null,
    productName: product?.name || "",
    label: `SGR ${product?.name || ""}`.trim(),
    qty,
    unitPrice,
    vatRate: 0,
    total,
    isSgr,
  };
}

function mapCatalogProduct(req: Request, product: any) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    image: resolveImageUrl(req, product.imageUrl),
    class: product.class,
    price: toNumber(product.price),
    isActive: Boolean(product.isActive),
    isVisibleInPos: Boolean(product.isVisibleInPos),
    isSgr: Boolean(product.isSgr),
    sgrValue: Boolean(product.isSgr) ? toNumber(product.sgrValue || 0.5) : 0,
    vatRate: product.vatRate
      ? {
          id: product.vatRate.id,
          name: product.vatRate.name,
          rate: toNumber(product.vatRate.rate),
        }
      : null,
    uom: product.uom
      ? {
          id: product.uom.id,
          code: product.uom.code,
          name: product.uom.name,
        }
      : null,
    department: product.department
      ? {
          id: product.department.id,
          name: product.department.name,
        }
      : null,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          image: resolveImageUrl(req, product.category.imageUrl),
          departmentId: product.category.departmentId || product.department?.id || null,
        }
      : null,
    categoryId: product.categoryId || null,
    departmentId: product.departmentId || product.category?.departmentId || null,
    sgrLabel: product.isSgr ? `SGR ${product.name}` : null,
    barcodes: Array.isArray(product.barcodes)
      ? product.barcodes.map((barcode: any) => barcode.barcode)
      : [],
  };
}

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

async function decrementStockBalance(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  productId: string,
  qty: Prisma.Decimal
) {
  const existingBalance = await tx.stockBalance.findFirst({
    where: {
      tenantId,
      locationId,
      productId,
    },
  });

  if (existingBalance) {
    await tx.stockBalance.update({
      where: { id: existingBalance.id },
      data: {
        qty: {
          decrement: qty,
        },
      },
    });
  } else {
    await tx.stockBalance.create({
      data: {
        tenantId,
        locationId,
        productId,
        qty: new Prisma.Decimal(0).minus(qty),
      },
    });
  }
}

/* ======================================================
   1) POS PAIR
====================================================== */

const PairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  terminalLabel: z.string().optional(),
  terminal_label: z.string().optional()
});

router.post("/api/v1/pos/pair", async (req: Request, res: Response) => {
  try {
    const parsed = PairSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const body = parsed.data;

    const licenseKey = normalizeText(body.licenseKey ?? body.license_key);
    const deviceId = normalizeText(body.deviceId ?? body.device_id);
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) || "Android POS";

    if (!licenseKey || licenseKey.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "License key lipsă sau invalid"
      });
    }

    if (!deviceId || deviceId.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Device ID lipsă sau invalid"
      });
    }

    const licenses = await prisma.license.findMany({
      where: {
        isSuspended: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" }
    });

    let found: (typeof licenses)[number] | null = null;

    for (const lic of licenses) {
      const match = await bcrypt.compare(licenseKey, lic.keyHash);
      if (match) {
        found = lic;
        break;
      }
    }

    if (!found) {
      return res.status(401).json({
        ok: false,
        error: "Licență invalidă sau expirată"
      });
    }

    const terminal = await prisma.terminal.upsert({
      where: {
        tenantId_deviceId: {
          tenantId: found.tenantId,
          deviceId
        }
      },
      update: {
        label: terminalLabel
      },
      create: {
        tenantId: found.tenantId,
        deviceId,
        label: terminalLabel,
        isLockedToLocation: true
      }
    });

    const locations = await prisma.location.findMany({
      where: { tenantId: found.tenantId, isActive: true },
      orderBy: { name: "asc" }
    });

    const token = signPosToken({
      tenantId: found.tenantId,
      terminalId: terminal.id,
      deviceId
    });

    return res.json({
      ok: true,
      token,
      tenantId: found.tenantId,
      terminal: {
        id: terminal.id,
        label: terminal.label,
        deviceId: terminal.deviceId,
        locationId: terminal.locationId
      },
      locations
    });
  } catch (error) {
    console.error("PAIR ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: "Eroare internă la conectarea POS"
    });
  }
});

/* ======================================================
   2) SELECT LOCATION
====================================================== */

const SelectLocationSchema = z.object({
  locationId: z.string().min(1),
});

router.post(
  "/api/v1/pos/terminal/location",
  requirePosAuth,
  async (req: PosAuthRequest, res: Response) => {
    const parsed = SelectLocationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const tenantId = req.auth!.tenantId;
    const terminalId = req.auth!.terminalId!;

    const loc = await prisma.location.findFirst({
      where: {
        id: parsed.data.locationId,
        tenantId,
        isActive: true,
      },
    });

    if (!loc) {
      return res.status(404).json({ ok: false, error: "Locația nu există" });
    }

    const terminal = await prisma.terminal.update({
      where: { id: terminalId },
      data: { locationId: loc.id },
    });

    res.json({
      ok: true,
      terminal: {
        id: terminal.id,
        locationId: terminal.locationId,
      },
    });
  }
);

/* ======================================================
   3) POS CONFIG
====================================================== */

router.get("/api/v1/pos/config", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;

    const company = await prisma.company.findUnique({
      where: { tenantId },
      select: {
        posSyncInterval: true,
      },
    });

    return res.json({
      ok: true,
      syncIntervalMinutes: company?.posSyncInterval ?? 5,
      allowedIntervals: [1, 2, 3, 4, 5, 10, 15, 20, 25, 30],
    });
  } catch (error) {
    console.error("POS CONFIG ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: "Eroare la încărcarea configurării POS",
    });
  }
});

/* ======================================================
   4) POS CATALOG
====================================================== */

router.get("/api/v1/pos/catalog", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  const tenantId = req.auth!.tenantId;

  const departments = await prisma.department.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: "asc" },
  });

  const categories = await prisma.category.findMany({
    where: {
      tenantId,
      isActive: true,
      isVisibleInPos: true,
    },
    include: {
      department: true,
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });

  const rawProducts = await prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      isVisibleInPos: true,
      OR: [
        { categoryId: null },
        {
          category: {
            is: {
              isActive: true,
              isVisibleInPos: true,
            }
          }
        }
      ]
    },
    include: {
      vatRate: true,
      uom: true,
      department: true,
      category: true,
      barcodes: true,
    },
    orderBy: { name: "asc" },
  });

  const products = rawProducts.map((product) => mapCatalogProduct(req, product));

  res.json({
    ok: true,
    departments,
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      image: resolveImageUrl(req, category.imageUrl),
      departmentId: category.departmentId,
      isVisibleInPos: Boolean(category.isVisibleInPos),
      department: category.department
        ? {
            id: category.department.id,
            name: category.department.name,
          }
        : null,
    })),
    products,
  });
});

/* ======================================================
   5) POS SALE
====================================================== */

const PosSaleSchema = z.object({
  clientSaleId: z.string(),
  receiptNo: z.string().optional(),
  soldAt: z.string().optional(),
  total: z.number(),

  paymentType: z.enum(["CASH", "CARD", "MIXED"]).optional(),
  cashAmount: z.number().optional(),
  cardAmount: z.number().optional(),
  operatorName: z.string().optional(),

  lines: z.array(
    z.object({
      productId: z.string(),
      qty: z.number(),
      unitPrice: z.number(),
      vatRate: z.number(),
    })
  ),
});

router.post("/api/v1/pos/sales", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  const parsed = PosSaleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const tenantId = req.auth!.tenantId;
  const terminalId = req.auth!.terminalId!;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
  });

  if (!terminal || !terminal.locationId) {
    return res.status(400).json({
      ok: false,
      error: "Terminal fără locație selectată",
    });
  }

  const locationId = terminal.locationId;
  const payload = parsed.data;

  const existing = await prisma.sale.findFirst({
    where: {
      tenantId,
      clientSaleId: payload.clientSaleId,
    },
  });

  if (existing) {
    return res.json({ ok: true, duplicated: true });
  }

  const productIds = payload.lines.map((line) => line.productId);

  const dbProducts = await prisma.product.findMany({
    where: {
      tenantId,
      id: { in: productIds },
    },
    include: {
      vatRate: true,
      category: true,
      uom: true,
    },
  });

  const productMap = new Map(dbProducts.map((product) => [product.id, product]));

  for (const line of payload.lines) {
    const product = productMap.get(line.productId);
    if (!product) {
      return res.status(404).json({ ok: false, error: "Produs inexistent în vânzare." });
    }
  }

  const recipes = await prisma.recipe.findMany({
    where: {
      tenantId,
      productId: { in: productIds },
      status: "ACTIVE",
      isActive: true,
    },
    include: {
      items: {
        include: {
          ingredient: true,
        },
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  const recipeMap = new Map(recipes.map((recipe) => [recipe.productId, recipe]));

  const receiptLines = payload.lines.flatMap((line) => {
    const product = productMap.get(line.productId)!;
    const qty = toNumber(line.qty);

    const productLine = {
      type: "PRODUCT",
      productId: product.id,
      productName: product.name,
      label: product.name,
      qty,
      unitPrice: toNumber(line.unitPrice),
      vatRate: toNumber(line.vatRate),
      total: qty * toNumber(line.unitPrice),
      isSgr: false,
    };

    const sgrLine = buildSgrLine(product, qty);

    return sgrLine.isSgr ? [productLine, sgrLine] : [productLine];
  });

  const totalSgr = receiptLines
    .filter((line) => line.type === "SGR")
    .reduce((sum, line) => sum + toNumber(line.total), 0);

  const totalWithoutSgr = toNumber(payload.total);
  const totalWithSgr = totalWithoutSgr + totalSgr;

  const normalizedPaymentType = payload.paymentType ?? "CASH";
  const normalizedCashAmount =
    payload.cashAmount !== undefined
      ? toNumber(payload.cashAmount)
      : normalizedPaymentType === "CASH"
      ? totalWithSgr
      : normalizedPaymentType === "MIXED"
      ? 0
      : 0;

  const normalizedCardAmount =
    payload.cardAmount !== undefined
      ? toNumber(payload.cardAmount)
      : normalizedPaymentType === "CARD"
      ? totalWithSgr
      : normalizedPaymentType === "MIXED"
      ? 0
      : 0;

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        tenantId,
        locationId,
        terminalId,
        clientSaleId: payload.clientSaleId,
        receiptNo: payload.receiptNo ? payload.receiptNo.trim() : null,
        soldAt: payload.soldAt ? new Date(payload.soldAt) : new Date(),
        total: new Prisma.Decimal(totalWithSgr),
        paymentType: normalizedPaymentType,
        cashAmount: new Prisma.Decimal(normalizedCashAmount),
        cardAmount: new Prisma.Decimal(normalizedCardAmount),
        operatorName: payload.operatorName ? payload.operatorName.trim() : null,
      },
    });

    let consumptionDocId: string | null = null;

    for (const line of payload.lines) {
      const product = productMap.get(line.productId)!;
      const recipe = recipeMap.get(line.productId) || null;

      const qtyDecimal = new Prisma.Decimal(line.qty);
      const unitPriceDecimal = new Prisma.Decimal(line.unitPrice);

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          qty: qtyDecimal,
          unitPrice: unitPriceDecimal,
          vatRate: line.vatRate,
        },
      });

      if (product.isSgr) {
        const sgrValue = new Prisma.Decimal(toNumber(product.sgrValue || 0.5));

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: line.productId,
            qty: qtyDecimal,
            unitPrice: sgrValue,
            vatRate: 0,
          },
        });
      }

      if (recipe && recipe.items.length > 0) {
        if (!consumptionDocId) {
          const consumptionDoc = await tx.consumptionDoc.create({
            data: {
              tenantId,
              locationId,
              saleId: sale.id,
              docNo: createConsumptionDocNo(),
              docDate: payload.soldAt ? new Date(payload.soldAt) : new Date(),
              note: `Generat automat din vânzare POS ${payload.receiptNo || sale.id}`,
            },
          });

          consumptionDocId = consumptionDoc.id;
        }

        const lineQty = toNumber(line.qty);
        const recipeYield = Math.max(toNumber(recipe.yieldQty), 0.000001);

        for (const recipeItem of recipe.items) {
          const recipeQty = toNumber(recipeItem.qty);
          const lossPercent = toNumber(recipeItem.lossPercent);
          const ingredientQtyNumber = (lineQty * recipeQty / recipeYield) * (1 + lossPercent / 100);

          const ingredientQty = new Prisma.Decimal(ingredientQtyNumber);

          await tx.consumptionDocItem.create({
            data: {
              consumptionDocId,
              finishedProductId: product.id,
              ingredientId: recipeItem.ingredientId,
              qty: ingredientQty,
              note: recipeItem.notes ? recipeItem.notes.trim() : null,
            },
          });

          await tx.stockMove.create({
            data: {
              tenantId,
              locationId,
              productId: recipeItem.ingredientId,
              type: "OUT",
              qty: ingredientQty,
              refType: "CONSUMPTION",
              refId: consumptionDocId,
              note: `Consum automat rețetar pentru ${product.name}`,
            },
          });

          await decrementStockBalance(
            tx,
            tenantId,
            locationId,
            recipeItem.ingredientId,
            ingredientQty
          );
        }
      } else {
        await tx.stockMove.create({
          data: {
            tenantId,
            locationId,
            productId: line.productId,
            type: "OUT",
            qty: qtyDecimal,
            refType: "SALE",
            refId: sale.id,
          },
        });

        await decrementStockBalance(
          tx,
          tenantId,
          locationId,
          line.productId,
          qtyDecimal
        );
      }
    }

    return {
      sale,
      consumptionDocId,
    };
  });

  res.status(201).json({
    ok: true,
    saleId: result.sale.id,
    consumptionDocId: result.consumptionDocId,
    total: totalWithSgr,
    totalSgr,
    totalWithoutSgr,
    totalWithSgr,
    paymentType: normalizedPaymentType,
    cashAmount: normalizedCashAmount,
    cardAmount: normalizedCardAmount,
    receiptLines,
  });
});

export default router;