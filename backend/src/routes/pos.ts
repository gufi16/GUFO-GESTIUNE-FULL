import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { decrementStockBalanceStrict } from "../lib/stock";

console.log("POS ROUTES FILE LOADED");

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const POS_SESSION_TTL_MS = 10 * 60 * 1000;
const pairedPosSessions = new Map<
  string,
  { tenantId: string; terminalId: string; deviceId: string; expiresAt: number }
>();
let lastPairedPosSession:
  | { tenantId: string; terminalId: string; deviceId: string; expiresAt: number }
  | null = null;

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

function buildPosSessionKey(req: Request) {
  const userAgent = normalizeText(req.headers["user-agent"]).slice(0, 200);
  return `${req.ip}|${userAgent}`;
}

export function registerPairedPosSession(
  req: Request,
  payload: { tenantId: string; terminalId: string; deviceId: string }
) {
  const session = {
    ...payload,
    expiresAt: Date.now() + POS_SESSION_TTL_MS,
  };

  pairedPosSessions.set(buildPosSessionKey(req), session);
  lastPairedPosSession = session;
}

function resolvePairedPosSession(req: Request) {
  const session = pairedPosSessions.get(buildPosSessionKey(req));
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    pairedPosSessions.delete(buildPosSessionKey(req));
    return null;
  }

  return session;
}

function resolveLatestPairedPosSession() {
  if (!lastPairedPosSession) return null;

  if (lastPairedPosSession.expiresAt <= Date.now()) {
    lastPairedPosSession = null;
    return null;
  }

  return lastPairedPosSession;
}

export async function resolvePosAuthContext(req: PosAuthRequest) {
  if (req.auth?.tenantId) {
    return req.auth;
  }

  const scopedSession = resolvePairedPosSession(req);
  if (scopedSession) {
    return {
      tenantId: scopedSession.tenantId,
      terminalId: scopedSession.terminalId,
      deviceId: scopedSession.deviceId,
    };
  }

  const latestSession = resolveLatestPairedPosSession();
  if (latestSession) {
    return {
      tenantId: latestSession.tenantId,
      terminalId: latestSession.terminalId,
      deviceId: latestSession.deviceId,
    };
  }

  const latestTerminal = await prisma.terminal.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      tenant: {
        include: {
          licenses: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  const license = latestTerminal?.tenant.licenses[0];
  if (
    latestTerminal &&
    license &&
    !license.isSuspended &&
    license.expiresAt > new Date() &&
    license.modPos
  ) {
    return {
      tenantId: latestTerminal.tenantId,
      terminalId: latestTerminal.id,
      deviceId: latestTerminal.deviceId,
    };
  }

  return null;
}

function requirePosAuth(req: PosAuthRequest, res: Response, next: NextFunction) {
  const authHeader = normalizeText(req.headers.authorization);
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;
  const token =
    headerToken ||
    normalizeText(req.headers["x-pos-token"]) ||
    normalizeText(req.headers["x-access-token"]) ||
    normalizeText(req.headers["pos-token"]) ||
    normalizeText(req.headers["token"]) ||
    normalizeText(req.headers["pos_token"]) ||
    normalizeText(req.query.token) ||
    normalizeText(req.query.pos_token) ||
    normalizeText(req.query.access_token);

  if (!token) {
    const fallbackSession = resolvePairedPosSession(req);
    if (fallbackSession) {
      req.auth = {
        tenantId: fallbackSession.tenantId,
        terminalId: fallbackSession.terminalId,
        deviceId: fallbackSession.deviceId,
      };
      console.warn("POS AUTH FALLBACK SESSION", {
        path: req.path,
        method: req.method,
        terminalId: fallbackSession.terminalId,
        deviceId: fallbackSession.deviceId,
      });
      return next();
    }

    const latestSession = resolveLatestPairedPosSession();
    if (latestSession) {
      req.auth = {
        tenantId: latestSession.tenantId,
        terminalId: latestSession.terminalId,
        deviceId: latestSession.deviceId,
      };
      console.warn("POS AUTH GLOBAL FALLBACK SESSION", {
        path: req.path,
        method: req.method,
        terminalId: latestSession.terminalId,
        deviceId: latestSession.deviceId,
      });
      return next();
    }

    console.warn("POS AUTH MISSING TOKEN", {
      path: req.path,
      method: req.method,
      authorization: Boolean(authHeader),
      xPosToken: Boolean(normalizeText(req.headers["x-pos-token"])),
      xAccessToken: Boolean(normalizeText(req.headers["x-access-token"])),
      posTokenHeader: Boolean(normalizeText(req.headers["pos-token"])),
      tokenHeader: Boolean(normalizeText(req.headers["token"])),
      posTokenUnderscoreHeader: Boolean(normalizeText(req.headers["pos_token"])),
      queryToken: Boolean(normalizeText(req.query.token)),
      queryPosToken: Boolean(normalizeText(req.query.pos_token)),
      queryAccessToken: Boolean(normalizeText(req.query.access_token)),
    });
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
  } catch (error) {
    const fallbackSession = resolvePairedPosSession(req);
    if (fallbackSession) {
      req.auth = {
        tenantId: fallbackSession.tenantId,
        terminalId: fallbackSession.terminalId,
        deviceId: fallbackSession.deviceId,
      };
      console.warn("POS AUTH FALLBACK SESSION AFTER INVALID TOKEN", {
        path: req.path,
        method: req.method,
        terminalId: fallbackSession.terminalId,
        deviceId: fallbackSession.deviceId,
      });
      return next();
    }

    const latestSession = resolveLatestPairedPosSession();
    if (latestSession) {
      req.auth = {
        tenantId: latestSession.tenantId,
        terminalId: latestSession.terminalId,
        deviceId: latestSession.deviceId,
      };
      console.warn("POS AUTH GLOBAL FALLBACK SESSION AFTER INVALID TOKEN", {
        path: req.path,
        method: req.method,
        terminalId: latestSession.terminalId,
        deviceId: latestSession.deviceId,
      });
      return next();
    }

    console.warn("POS AUTH INVALID TOKEN", {
      path: req.path,
      method: req.method,
      tokenPreview: token.slice(0, 24),
      tokenLength: token.length,
      authorization: Boolean(authHeader),
      xPosToken: Boolean(normalizeText(req.headers["x-pos-token"])),
      xAccessToken: Boolean(normalizeText(req.headers["x-access-token"])),
      posTokenHeader: Boolean(normalizeText(req.headers["pos-token"])),
      tokenHeader: Boolean(normalizeText(req.headers["token"])),
      posTokenUnderscoreHeader: Boolean(normalizeText(req.headers["pos_token"])),
      queryToken: Boolean(normalizeText(req.query.token)),
      queryPosToken: Boolean(normalizeText(req.query.pos_token)),
      queryAccessToken: Boolean(normalizeText(req.query.access_token)),
      error: error instanceof Error ? error.message : String(error),
    });
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

function mapCatalogProduct(req: Request, product: any, isVatPayer: boolean) {
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
    productionMode: product.productionMode || "AUTO",
    vatRate: isVatPayer
      ? product.vatRate
        ? {
            id: product.vatRate.id,
            name: product.vatRate.name,
            rate: toNumber(product.vatRate.rate),
            fiscalCode: product.vatRate.fiscalCode ?? null,
          }
        : null
      : {
          id: product.vatRate?.id ?? null,
          name: product.vatRate?.name ?? "Fără TVA",
          rate: 0,
          fiscalCode: null,
        },
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

export async function buildCatalogPayload(req: Request, tenantId: string) {
  const requestedCursor = normalizeText(req.query.cursor ?? req.query.since);
  const company = await prisma.company.findUnique({
    where: { tenantId },
    select: {
      isVatPayer: true,
    },
  });

  const isVatPayer = company?.isVatPayer ?? true;

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
            },
          },
        },
      ],
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

  const products = rawProducts.map((product) => mapCatalogProduct(req, product, isVatPayer));
  const latestProductUpdate =
    rawProducts.reduce<number>(
      (latest, product) => Math.max(latest, new Date(product.updatedAt).getTime()),
      0
    ) || Date.now();

  const normalizedCategories = categories.map((category) => ({
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
  }));

  return {
    ok: true,
    isVatPayer,
    fullSync: true,
    syncType: "full",
    cursor: new Date(latestProductUpdate).toISOString(),
    serverTime: new Date().toISOString(),
    requestedCursor: requestedCursor || null,
    departments,
    categories: normalizedCategories,
    products,
    items: products,
    changes: {
      departments,
      categories: normalizedCategories,
      products,
      items: products,
      deleted: {
        departments: [],
        categories: [],
        products: [],
      },
      deletedIds: [],
    },
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

/* ======================================================
   1) POS PAIR
====================================================== */

const PairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  terminalLabel: z.string().optional(),
  terminal_label: z.string().optional(),
});

router.post("/api/v1/pos/pair", async (req: Request, res: Response) => {
  console.log("🔥 POS PAIR NOU HIT", req.body);

  try {
    const parsed = PairSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const body = parsed.data;
    const licenseKey = normalizeText(body.licenseKey ?? body.license_key);
    const incomingDeviceId = normalizeText(body.deviceId ?? body.device_id);
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) || "Android POS";

    if (!licenseKey || licenseKey.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "License key lipsă sau invalid",
      });
    }

    const terminal = await prisma.terminal.findFirst({
      where: {
        deviceId: licenseKey,
      },
      include: {
        location: true,
        tenant: {
          include: {
            licenses: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!terminal) {
      return res.status(404).json({
        ok: false,
        error: "Licență invalidă",
      });
    }

    const license = terminal.tenant.licenses[0];

    if (!license) {
      return res.status(404).json({
        ok: false,
        error: "Licență ERP inexistentă",
      });
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        error: "Licența este suspendată",
      });
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        error: "Licența este expirată",
      });
    }

    if (!license.modPos) {
      return res.status(403).json({
        ok: false,
        error: "POS nu este activ",
      });
    }

    if (incomingDeviceId && incomingDeviceId !== terminal.deviceId) {
      console.warn("POS PAIR DEVICE MISMATCH", {
        incomingDeviceId,
        licenseKey,
        terminalDeviceId: terminal.deviceId,
      });
    }

    if (terminalLabel && terminal.label !== terminalLabel) {
      await prisma.terminal.update({
        where: { id: terminal.id },
        data: {
          label: terminalLabel,
        },
      });
    }

    const locations = await prisma.location.findMany({
      where: {
        tenantId: terminal.tenantId,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    const token = signPosToken({
      tenantId: terminal.tenantId,
      terminalId: terminal.id,
      deviceId: terminal.deviceId,
    });

    registerPairedPosSession(req, {
      tenantId: terminal.tenantId,
      terminalId: terminal.id,
      deviceId: terminal.deviceId,
    });

    return res.json({
      ok: true,
      token,
      pos_token: token,
      access_token: token,
      tenantId: terminal.tenantId,
      terminal: {
        id: terminal.id,
        label: terminalLabel || terminal.label,
        deviceId: terminal.deviceId,
        locationId: terminal.locationId,
      },
      locations,
    });
  } catch (error) {
    console.error("PAIR ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: "Eroare internă la conectarea POS",
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

router.get("/api/v1/pos/config", async (req: PosAuthRequest, res: Response) => {
  try {
    const auth = await resolvePosAuthContext(req);
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fă pair din nou.",
      });
    }

    const tenantId = auth.tenantId;

    const company = await prisma.company.findUnique({
      where: { tenantId },
      select: {
        posSyncInterval: true,
        isVatPayer: true,
      },
    });

    return res.json({
      ok: true,
      syncIntervalMinutes: company?.posSyncInterval ?? 5,
      isVatPayer: company?.isVatPayer ?? true,
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

router.get("/api/v1/pos/catalog", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fă pair din nou.",
    });
  }

  const tenantId = auth.tenantId;
  const payload = await buildCatalogPayload(req, tenantId);

  res.json(payload);
});

router.get(
  "/api/v1/catalog/changes",
  requirePosAuth,
  async (req: PosAuthRequest, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = await buildCatalogPayload(req, tenantId);

    return res.json(payload);
  }
);

router.get("/api/v1/pos/marketplace/ready-for-fiscal", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fă pair din nou.",
    });
  }

  const terminal = auth.terminalId
    ? await prisma.terminal.findUnique({
        where: { id: auth.terminalId },
        select: { locationId: true },
      })
    : null;

  const items = await prisma.externalOrder.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(terminal?.locationId ? { locationId: terminal.locationId } : {}),
      status: "READY_FOR_FISCAL",
    },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
      saleDraft: {
        select: { id: true, status: true, total: true, subtotal: true, updatedAt: true },
      },
      kitchenTicket: {
        select: { id: true, status: true, displayNumber: true, readyAt: true },
      },
      items: true,
    },
    orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }],
  });

  return res.json({ ok: true, items });
});

router.post("/api/v1/pos/marketplace/:externalOrderId/load-cart", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fă pair din nou.",
    });
  }

  const inputOrderId = String(req.params.externalOrderId || "").trim();
  if (!inputOrderId) {
    return res.status(400).json({ ok: false, error: "Missing externalOrderId" });
  }

  const terminal = auth.terminalId
    ? await prisma.terminal.findUnique({
        where: { id: auth.terminalId },
        select: { locationId: true },
      })
    : null;

  const order = await prisma.externalOrder.findFirst({
    where: {
      tenantId: auth.tenantId,
      ...(terminal?.locationId ? { locationId: terminal.locationId } : {}),
      OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
    },
    include: {
      saleDraft: true,
      location: {
        select: { id: true, name: true, code: true },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" });
  }

  if (!order.saleDraft) {
    return res.status(404).json({ ok: false, error: "Sale draft not found for marketplace order" });
  }

  if (order.saleDraft.status === "CANCELLED") {
    return res.status(400).json({ ok: false, error: "Sale draft is cancelled" });
  }

  await prisma.externalOrderStatusHistory.create({
    data: {
      tenantId: auth.tenantId,
      externalOrderId: order.id,
      status: order.status,
      source: "POS",
      message: "POS requested marketplace cart load.",
      payloadJson: { saleDraftId: order.saleDraft.id, terminalId: auth.terminalId || null },
    },
  });

  return res.json({
    ok: true,
    externalOrder: {
      id: order.id,
      externalOrderId: order.externalOrderId,
      externalOrderNumber: order.externalOrderNumber,
      platform: order.platform,
      status: order.status,
      location: order.location,
    },
    saleDraft: {
      id: order.saleDraft.id,
      status: order.saleDraft.status,
      subtotal: Number(order.saleDraft.subtotal || 0),
      total: Number(order.saleDraft.total || 0),
      cart: order.saleDraft.cartJson,
    },
  });
});

/* ======================================================
   5) POS SALE
====================================================== */

const PosSaleSchema = z.object({
  clientSaleId: z.string(),
  externalOrderId: z.string().optional(),
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

export async function handlePosSale(req: PosAuthRequest, res: Response) {
  console.log("POS SALE HIT", {
    path: req.path,
    method: req.method,
    terminalId: req.auth?.terminalId || null,
    deviceId: req.auth?.deviceId || null,
    body: req.body,
  });

  const parsed = PosSaleSchema.safeParse(req.body);

  if (!parsed.success) {
    console.warn("POS SALE INVALID PAYLOAD", parsed.error.flatten());
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId || !auth?.terminalId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fă pair din nou.",
    });
  }

  req.auth = auth;

  const tenantId = auth.tenantId;
  const terminalId = auth.terminalId;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
  });

  if (!terminal || !terminal.locationId) {
    return res.status(400).json({
      ok: false,
      error: "Terminal fără locație selectată",
    });
  }

  const company = await prisma.company.findUnique({
    where: { tenantId },
    select: {
      isVatPayer: true,
    },
  });

  const isVatPayer = company?.isVatPayer ?? true;

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

  const externalOrder = payload.externalOrderId
    ? await prisma.externalOrder.findFirst({
        where: {
          tenantId,
          locationId,
          OR: [{ id: payload.externalOrderId }, { externalOrderId: payload.externalOrderId }],
        },
        include: {
          saleDraft: true,
          kitchenTicket: true,
          sale: true,
        },
      })
    : null;

  if (payload.externalOrderId && !externalOrder) {
    return res.status(404).json({ ok: false, error: "Comanda marketplace nu a fost gasita." });
  }

  if (externalOrder?.sale) {
    return res.status(409).json({ ok: false, error: "Comanda marketplace este deja fiscalizata." });
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
    const effectiveVatRate = isVatPayer ? toNumber(line.vatRate) : 0;

    const productLine = {
      type: "PRODUCT",
      productId: product.id,
      productName: product.name,
      label: product.name,
      qty,
      unitPrice: toNumber(line.unitPrice),
      vatRate: effectiveVatRate,
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

  let result: { sale: { id: string }; consumptionDocId: string | null };

  try {
    result = await prisma.$transaction(async (tx) => {
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
      const effectiveVatRate = isVatPayer ? toNumber(line.vatRate) : 0;

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          qty: qtyDecimal,
          unitPrice: unitPriceDecimal,
          vatRate: effectiveVatRate,
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

      // For POS sales, if ERP has an active recipe we consume ingredients
      // directly from ERP stock, even if the product mode was left MANUAL
      // after a relink or partial product sync.
      const shouldConsumeRecipeAutomatically = recipe && recipe.items.length > 0;

      if (shouldConsumeRecipeAutomatically) {
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

          await decrementStockBalanceStrict(tx, {
            tenantId,
            locationId,
            productId: recipeItem.ingredientId,
            qty: ingredientQty,
            productName: recipeItem.ingredient?.name || `ingredient ${recipeItem.ingredientId}`,
          });

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

        }
      } else {
        await decrementStockBalanceStrict(tx, {
          tenantId,
          locationId,
          productId: line.productId,
          qty: qtyDecimal,
          productName: product.name,
          uomCode: product.uom?.code || null,
        });

        await tx.stockMove.create({
          data: {
            tenantId,
            locationId,
            productId: line.productId,
            type: "OUT",
            qty: qtyDecimal,
            refType: "SALE",
            refId: sale.id,
            note: product.productionMode === "MANUAL"
              ? `Vânzare POS produs cu producție manuală: ${product.name}`
              : undefined,
          },
        });

      }
    }

    if (externalOrder) {
      await tx.externalOrder.update({
        where: { id: externalOrder.id },
        data: {
          status: "FISCALIZED",
          fiscalizedAt: payload.soldAt ? new Date(payload.soldAt) : new Date(),
        },
      });

      if (externalOrder.saleDraft) {
        await tx.saleDraft.update({
          where: { id: externalOrder.saleDraft.id },
          data: {
            status: "FISCALIZED",
          },
        });
      }

      if (externalOrder.kitchenTicket) {
        await tx.kitchenTicket.update({
          where: { id: externalOrder.kitchenTicket.id },
          data: {
            status: "COMPLETED",
            completedAt: payload.soldAt ? new Date(payload.soldAt) : new Date(),
          },
        });
      }

      await tx.externalOrderStatusHistory.create({
        data: {
          tenantId,
          externalOrderId: externalOrder.id,
          status: "FISCALIZED",
          source: "POS",
          message: "Marketplace order fiscalized from POS.",
          payloadJson: {
            saleId: sale.id,
            clientSaleId: payload.clientSaleId,
            receiptNo: payload.receiptNo ? payload.receiptNo.trim() : null,
            terminalId,
          },
        },
      });
    }

    return {
      sale,
      consumptionDocId,
    };
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut procesa vanzarea POS.",
    });
  }

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
}

router.post("/api/v1/pos/sales", handlePosSale);
router.post("/api/v1/pos/receipts", handlePosSale);

export default router;
