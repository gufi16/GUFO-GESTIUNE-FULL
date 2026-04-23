// @ts-nocheck
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { decrementStockBalanceStrict } from "../lib/stock";
import { getPrimaryTenantCompany } from "../lib/companyResolver";
import { reserveNextNumber } from "../lib/numbering";

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

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function extractAnafCompanyPayload(entry: any) {
  const general = entry?.date_generale || {};
  const headquarters = entry?.adresa_sediu_social || {};
  const registration = entry?.inregistrare_RTVAI || entry?.inregistrare_scop_Tva || {};

  const county =
    headquarters?.sdenumire_Judet ||
    general?.judet ||
    general?.denumire_Judet ||
    "";
  const city =
    headquarters?.sdenumire_Localitate ||
    general?.localitate ||
    general?.denumire_Localitate ||
    "";
  const postalCode =
    headquarters?.scod_Postal ||
    general?.codPostal ||
    general?.cod_postal ||
    "";
  const address =
    headquarters?.sdenumire_Strada && headquarters?.snumar_Strada
      ? `${headquarters.sdenumire_Strada} ${headquarters.snumar_Strada}`.trim()
      : headquarters?.sdenumire_Strada ||
        general?.adresa_domiciliu_fiscal ||
        general?.adresa ||
        general?.adresa_completa ||
        "";

  return {
    name: String(general?.denumire || "").trim(),
    cui: String(general?.cui || "").trim(),
    regNo: String(general?.nrRegCom || general?.nr_reg_com || "").trim(),
    address: String(address || "").trim(),
    city: String(city || "").trim(),
    county: String(county || "").trim(),
    postalCode: String(postalCode || "").trim(),
    country: "RO",
    isVatPayer:
      registration?.scpTVA !== undefined
        ? Boolean(registration.scpTVA)
        : general?.scpTVA !== undefined
          ? Boolean(general.scpTVA)
          : true,
  };
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function asDate(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function buildPublicBaseUrl(req: Request) {
  const configured = normalizeText(process.env.PUBLIC_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, "").replace(/^http:\/\//i, "https://");
  }

  const host = req.get("host") || "";
  const forwardedProto = normalizeText(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || req.protocol || "http";

  return `${protocol}://${host}`.replace(/\/+$/, "").replace(/^http:\/\//i, "https://");
}

function resolveImageUrl(req: Request, rawUrl: unknown) {
  const value = normalizeText(rawUrl);
  if (!value) return null;

  const baseUrl = buildPublicBaseUrl(req);
  const apiBaseUrl = baseUrl.replace("://test.gufo.ink", "://api.gufo.ink");

  const internalHostPattern =
    /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|api\.gufo\.ink)(:\d+)?/i;
  if (internalHostPattern.test(value)) {
    return value.replace(internalHostPattern, apiBaseUrl).replace(/^http:\/\//i, "https://");
  }

  if (/^https?:\/\//i.test(value)) {
    return value.replace(/^http:\/\//i, "https://");
  }

  if (value.startsWith("/")) {
    return `${apiBaseUrl}${value}`.replace(/^http:\/\//i, "https://");
  }

  return `${apiBaseUrl}/${value}`.replace(/^http:\/\//i, "https://");
}

function buildSgrLine(product: any, qty: number) {
  const isSgr = Boolean(product?.isSgr);
  const unitPrice = isSgr ? toNumber(product?.sgrValue || 0.5) : 0;
  const total = qty * unitPrice;

  return {
    type: "SGR",
    productId: product?.id || null,
    productName: product?.name || "",
    label: "SGR",
    qty,
    unitPrice,
    vatRate: 0,
    total,
    isSgr,
  };
}

function isSyntheticSgrSaleLine(line: any) {
  if (!line?.product?.isSgr) return false;
  const unitPrice = toNumber(line?.unitPrice);
  const sgrValue = toNumber(line?.product?.sgrValue || 0.5);
  return toNumber(line?.vatRate) === 0 && Math.abs(unitPrice - sgrValue) < 0.0001;
}

function buildInvoiceFromSaleNote(sale: any, userNote?: string) {
  const parts = [
    normalizeText(userNote),
    `Factura emisa dupa bon fiscal ${normalizeText(sale?.receiptNo) || sale?.id || "-"}`,
    sale?.soldAt ? `Data bon: ${new Date(sale.soldAt).toISOString()}` : "",
    `[POS-SALE:${sale?.id || ""}]`,
    sale?.clientSaleId ? `[POS-CLIENT-SALE:${sale.clientSaleId}]` : "",
  ].filter(Boolean);
  return parts.join("\n");
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
          name: product.vatRate?.name ?? "Fara TVA",
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
    sgrLabel: product.isSgr ? "SGR" : null,
    barcodes: Array.isArray(product.barcodes)
      ? product.barcodes.map((barcode: any) => barcode.barcode)
      : [],
  };
}

export async function buildCatalogPayload(req: Request, tenantId: string) {
  const requestedCursor = normalizeText(req.query.cursor ?? req.query.since);
  const company = await getPrimaryTenantCompany(tenantId, {
    select: {
      id: true,
      isVatPayer: true,
    },
  });

  const isVatPayer = company?.isVatPayer ?? true;

  const departments = await prisma.department.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [{ companyId: company?.id || null }, { companyId: null }],
    },
    orderBy: { name: "asc" },
  });

  const categories = await prisma.category.findMany({
    where: {
      tenantId,
      OR: [{ companyId: company?.id || null }, { companyId: null }],
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
        companyId: company?.id || null,
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

const PosLicenseValidateSchema = z.object({
  licenseKey: z.string().min(3).optional(),
  license_key: z.string().min(3).optional(),
});

const PosDailyClosureSchema = z.object({
  reportType: z.string().optional().default("Z"),
  reportNo: z.string().optional().nullable(),
  closedAt: z.string().optional().nullable(),
  total: z.number().optional().default(0),
  cashTotal: z.number().optional().default(0),
  cardTotal: z.number().optional().default(0),
  otherTotal: z.number().optional().default(0),
  reportText: z.string().optional().nullable(),
  licenseKey: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  payload: z.any().optional(),
});

const PosBackofficeReceiptSchema = z.object({
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  postNow: z.boolean().optional().default(true),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      qty: z.number().positive(),
      unitCostNetFc: z.number().min(0),
      vatRateValue: z.number().min(0).max(100).optional(),
    })
  ).min(1),
});

async function resolveDailyClosureAuth(req: PosAuthRequest, body: z.infer<typeof PosDailyClosureSchema>) {
  const auth = await resolvePosAuthContext(req);
  if (auth?.tenantId && auth.terminalId) {
    return auth;
  }

  const licenseKey = normalizeText(body.licenseKey);
  const deviceId = normalizeText(body.deviceId);
  if (!licenseKey && !deviceId) {
    return null;
  }

  const terminal = await prisma.terminal.findFirst({
    where: {
      OR: [
        ...(licenseKey ? [{ deviceId: licenseKey }] : []),
        ...(deviceId ? [{ deviceId }] : []),
      ],
    },
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

  const license = terminal?.tenant.licenses[0];
  if (
    !terminal ||
    !license ||
    license.isSuspended ||
    license.expiresAt <= new Date() ||
    !license.modPos
  ) {
    return null;
  }

  return {
    tenantId: terminal.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId,
  };
}

router.post("/api/v1/pos/validate", async (req: Request, res: Response) => {
  try {
    console.log("POS VALIDATE PUBLIC HIT", req.body);
    const parsed = PosLicenseValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        allowed: false,
        error: parsed.error.flatten(),
      });
    }

    const licenseKey = normalizeText(parsed.data.licenseKey ?? parsed.data.license_key);
    if (!licenseKey || licenseKey.length < 3) {
      return res.status(400).json({
        ok: false,
        allowed: false,
        error: "Licenta POS este invalida",
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
        allowed: false,
        error: "Licenta invalida",
      });
    }

    const license = terminal.tenant.licenses[0];

    if (!license) {
      return res.status(404).json({
        ok: false,
        allowed: false,
        error: "Licenta ERP inexistenta",
      });
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "Licenta este suspendata",
      });
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "Licenta este expirata",
      });
    }

    if (!license.modPos) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "POS nu este activ",
      });
    }

    const terminalsCount = await prisma.terminal.count({
      where: { tenantId: terminal.tenantId },
    });

    const withinLimit = terminalsCount <= license.limitTerminals;

    return res.json({
      ok: true,
      allowed: withinLimit,
      tenantId: terminal.tenantId,
      terminal: {
        id: terminal.id,
        deviceId: terminal.deviceId,
        label: terminal.label,
        locationId: terminal.locationId,
        locationName: terminal.location?.name || null,
      },
      license: {
        expiresAt: license.expiresAt,
        posEnabled: license.modPos,
        licenseKey,
      },
    });
  } catch (error) {
    console.error("POS VALIDATE ERROR:", error);
    return res.status(500).json({
      ok: false,
      allowed: false,
      error: "Eroare interna la validarea POS",
    });
  }
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
        error: "License key lipsa sau invalid",
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
        error: "Licenta invalida",
      });
    }

    const license = terminal.tenant.licenses[0];

    if (!license) {
      return res.status(404).json({
        ok: false,
        error: "Licenta ERP inexistenta",
      });
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        error: "Licenta este suspendata",
      });
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        error: "Licenta este expirata",
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
        OR: [{ companyId: terminal.companyId || terminal.location?.companyId || null }, { companyId: null }],
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
      error: "Eroare interna la conectarea POS",
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
    const currentTerminal = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { companyId: true },
    });

    const loc = await prisma.location.findFirst({
      where: {
        id: parsed.data.locationId,
        tenantId,
        OR: [{ companyId: currentTerminal?.companyId || null }, { companyId: null }],
        isActive: true,
      },
    });

    if (!loc) {
      return res.status(404).json({ ok: false, error: "Locatia nu exista" });
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

export async function handlePosDailyClosure(req: PosAuthRequest, res: Response) {
    try {
      const parsed = PosDailyClosureSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      }

      const auth = await resolveDailyClosureAuth(req, parsed.data);
      if (!auth?.tenantId || !auth.terminalId) {
        console.warn("POS DAILY CLOSURE AUTH FAILED", {
          hasAuthorization: Boolean(normalizeText(req.headers.authorization)),
          hasXPosToken: Boolean(normalizeText(req.headers["x-pos-token"])),
          hasToken: Boolean(normalizeText(req.headers["token"])),
          licenseKey: normalizeText(parsed.data.licenseKey),
          deviceId: normalizeText(parsed.data.deviceId),
        });
        return res.status(401).json({ ok: false, error: "POS neautentificat" });
      }

      const terminal = await prisma.terminal.findFirst({
        where: { id: auth.terminalId, tenantId: auth.tenantId },
        include: { location: true },
      });

      if (!terminal) {
        return res.status(404).json({ ok: false, error: "Terminal POS inexistent" });
      }

      const data = parsed.data;
      const resolvedCompanyId = terminal.companyId || terminal.location?.companyId || null;
      const resolvedLocationId = terminal.locationId || normalizeText(data.locationId) || null;
      const parsedClosedAt = data.closedAt ? new Date(data.closedAt) : new Date();
      const closedAt = Number.isNaN(parsedClosedAt.getTime()) ? new Date() : parsedClosedAt;
      let total = toNumber(data.total);
      let cashTotal = toNumber(data.cashTotal);
      let cardTotal = toNumber(data.cardTotal);
      let otherTotal = toNumber(data.otherTotal);
      const clientProvidedTotals = Boolean((data.payload as any)?.clientTotals);

      if (!clientProvidedTotals && total === 0 && cashTotal === 0 && cardTotal === 0 && otherTotal === 0) {
        const previousClosure = await prisma.posDailyClosure.findFirst({
          where: {
            tenantId: auth.tenantId,
            companyId: resolvedCompanyId,
            terminalId: terminal.id,
            reportType: "Z",
            closedAt: { lt: closedAt },
          },
          orderBy: { closedAt: "desc" },
        });

        const sales = await prisma.sale.findMany({
          where: {
            tenantId: auth.tenantId,
            companyId: resolvedCompanyId,
            terminalId: terminal.id,
            soldAt: {
              gt: previousClosure?.closedAt || startOfDay(closedAt),
              lte: closedAt,
            },
          },
          select: {
            total: true,
            cashAmount: true,
            cardAmount: true,
          },
        });

        total = sales.reduce((sum, sale) => sum + toNumber(sale.total), 0);
        cashTotal = sales.reduce((sum, sale) => sum + toNumber(sale.cashAmount), 0);
        cardTotal = sales.reduce((sum, sale) => sum + toNumber(sale.cardAmount), 0);
        otherTotal = Math.max(0, total - cashTotal - cardTotal);
      }

      const item = await prisma.posDailyClosure.create({
        data: {
          tenantId: auth.tenantId,
          companyId: resolvedCompanyId,
          locationId: resolvedLocationId,
          terminalId: terminal.id,
          deviceId: terminal.deviceId,
          locationName: terminal.location?.name || null,
          terminalLabel: terminal.label || null,
          reportType: normalizeText(data.reportType || "Z").toUpperCase() || "Z",
          reportNo: data.reportNo ? normalizeText(data.reportNo) : null,
          closedAt,
          total: new Prisma.Decimal(total),
          cashTotal: new Prisma.Decimal(cashTotal),
          cardTotal: new Prisma.Decimal(cardTotal),
          otherTotal: new Prisma.Decimal(otherTotal),
          reportText: data.reportText ? String(data.reportText).slice(0, 12000) : null,
          payloadJson: data.payload ?? req.body,
        },
      });

      console.log("POS DAILY CLOSURE SAVED", {
        id: item.id,
        tenantId: auth.tenantId,
        terminalId: terminal.id,
        locationId: resolvedLocationId,
        reportType: item.reportType,
      });
      return res.json({ ok: true, item });
    } catch (error) {
      console.error("POS DAILY CLOSURE ERROR", error);
      return res.status(500).json({ ok: false, error: "Nu am putut salva inchiderea zilnica." });
    }
}

router.post("/api/v1/pos/daily-closures", handlePosDailyClosure);

/* ======================================================
   3) POS CONFIG
====================================================== */

router.get("/api/v1/pos/config", async (req: PosAuthRequest, res: Response) => {
  try {
    const auth = await resolvePosAuthContext(req);
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fa pair din nou.",
      });
    }

    const tenantId = auth.tenantId;

    const company = await getPrimaryTenantCompany(tenantId, {
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
      error: "Eroare la incarcarea configurarii POS",
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
      error: "POS neautentificat. Fa pair din nou.",
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
      error: "POS neautentificat. Fa pair din nou.",
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
      error: "POS neautentificat. Fa pair din nou.",
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

const PosInvoiceFromSaleSchema = z.object({
  customerId: z.string().trim().optional(),
  customerName: z.string().trim().min(1, "Numele clientului este obligatoriu."),
  customerCif: z.string().trim().optional(),
  customerRegNo: z.string().trim().optional(),
  customerAddress: z.string().trim().optional(),
  customerEmail: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  note: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
});

export async function handlePosCustomersSearch(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });
  const q = normalizeText(req.query.q);

  const customers = await prisma.customer.findMany({
    where: {
      tenantId,
      companyId: company?.id || null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { cif: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: q ? 20 : 30,
    select: {
      id: true,
      name: true,
      code: true,
      cif: true,
      regNo: true,
      address: true,
      phone: true,
      email: true,
    },
  });

  return res.json({
    ok: true,
    customers,
  });
}

export async function handlePosCompanyLookupByCui(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;

  const cuiRaw = normalizeText(req.query.cui).replace(/^RO/i, "");
  if (!/^\d{2,12}$/.test(cuiRaw)) {
    return res.status(400).json({ ok: false, error: "Introdu un CUI valid." });
  }

  try {
    const response = await fetch("https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        {
          cui: Number(cuiRaw),
          data: new Date().toISOString().slice(0, 10),
        },
      ]),
    });

    const payload = await response.json().catch(() => ({}));
    const found = Array.isArray(payload?.found) ? payload.found : [];
    const item = found[0];

    if (!response.ok || !item) {
      return res.status(404).json({
        ok: false,
        error: payload?.message || "Nu am gasit firma dupa CUI.",
      });
    }

    return res.json({
      ok: true,
      company: extractAnafCompanyPayload(item),
      raw: item,
    });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: error?.message || "Nu am putut interoga serviciul ANAF pentru CUI.",
    });
  }
}

export async function handlePosReceiptInvoice(req: PosAuthRequest, res: Response) {
  const parsed = PosInvoiceFromSaleSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;

  const tenantId = auth.tenantId;
  const saleId = normalizeText(req.params.saleId);
  if (!saleId) {
    return res.status(400).json({ ok: false, error: "Bonul selectat este invalid." });
  }

  const company = await getPrimaryTenantCompany(tenantId, {
    select: {
      id: true,
    },
  });

  const sale = await prisma.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(company?.id
        ? {
            OR: [{ companyId: company.id }, { companyId: null }],
          }
        : {}),
    },
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
        orderBy: { id: "asc" },
      },
      location: true,
    },
  });

  if (!sale) {
    return res.status(404).json({ ok: false, error: "Bonul nu a fost gasit in ERP." });
  }

  const duplicateMarker = `[POS-SALE:${sale.id}]`;
  const existingInvoice = await prisma.salesInvoice.findFirst({
    where: {
      tenantId,
      companyId: sale.companyId || company?.id || null,
      note: {
        contains: duplicateMarker,
      },
    },
    select: {
      id: true,
      docNo: true,
      status: true,
    },
  });

  if (existingInvoice) {
    return res.json({
      ok: true,
      duplicated: true,
      invoiceId: existingInvoice.id,
      docNo: existingInvoice.docNo,
      status: existingInvoice.status,
    });
  }

  const realLines = sale.items.filter((line) => !isSyntheticSgrSaleLine(line));
  const sgrLines = sale.items.filter((line) => isSyntheticSgrSaleLine(line));
  if (!realLines.length) {
    return res.status(400).json({ ok: false, error: "Bonul nu are linii valide pentru facturare." });
  }

  const payload = parsed.data;
  const normalizedCompanyId = sale.companyId || company?.id || null;
  const normalizedCustomerId = normalizeText(payload.customerId);
  const normalizedCustomerCif = normalizeText(payload.customerCif);

  let customer: any = null;
  if (normalizedCustomerId) {
    customer = await prisma.customer.findFirst({
      where: {
        id: normalizedCustomerId,
        tenantId,
        companyId: normalizedCompanyId,
      },
    });
  } else if (normalizedCustomerCif) {
    customer = await prisma.customer.findFirst({
      where: {
        tenantId,
        companyId: normalizedCompanyId,
        cif: normalizedCustomerCif,
      },
    });
  }

  const customerName = normalizeText(customer?.name || payload.customerName);
  if (!customerName) {
    return res.status(400).json({ ok: false, error: "Numele clientului este obligatoriu." });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const docNo = await reserveNextNumber(tx, tenantId, "invoice");
      const note = buildInvoiceFromSaleNote(sale, payload.note);

      const invoice = await tx.salesInvoice.create({
        data: {
          tenantId,
          companyId: normalizedCompanyId,
          locationId: sale.locationId,
          customerId: customer?.id || null,
          docNo,
          docDate: sale.soldAt,
          dueDate: payload.dueDate ? new Date(payload.dueDate) : sale.soldAt,
          customerName,
          customerCode: customer?.code || null,
          customerCif: normalizeText(customer?.cif || payload.customerCif) || null,
          customerRegNo: normalizeText(customer?.regNo || payload.customerRegNo) || null,
          customerAddress: normalizeText(customer?.address || payload.customerAddress) || null,
          customerEmail: normalizeText(customer?.email || payload.customerEmail) || null,
          customerPhone: normalizeText(customer?.phone || payload.customerPhone) || null,
          currency: "RON",
          fxRate: 1,
          note,
          status: "ISSUED",
        },
      });

      let totalNetFc = 0;
      let totalVatFc = 0;
      let totalGrossFc = 0;

      for (const line of realLines) {
        const qty = toNumber(line.qty);
        const unitPriceGross = toNumber(line.unitPrice);
        const vatRate = toNumber(line.vatRate);
        const unitPriceNet = vatRate > 0 ? unitPriceGross / (1 + vatRate / 100) : unitPriceGross;
        const lineNetFc = qty * unitPriceNet;
        const lineVatFc = lineNetFc * vatRate / 100;
        const lineGrossFc = lineNetFc + lineVatFc;
        const vatCategoryCode = vatRate > 0 ? "S" : "Z";

        totalNetFc += lineNetFc;
        totalVatFc += lineVatFc;
        totalGrossFc += lineGrossFc;

        await tx.salesInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: line.productId,
            productName: line.product?.name || "Produs",
            productCode: normalizeText(line.product?.sku) || null,
            uomCode: normalizeText(line.product?.uom?.code || line.product?.uom?.name) || null,
            vatCategoryCode,
            qty,
            unitPriceFc: unitPriceNet,
            vatRateValue: vatRate,
            discountPercent: 0,
            discountAmountFc: 0,
            lineNetFc,
            lineVatFc,
            lineGrossFc,
            sgrUnitFc: 0,
            sgrTotalFc: 0,
            discountAmountRon: 0,
            lineNetRon: lineNetFc,
            lineVatRon: lineVatFc,
            lineGrossRon: lineGrossFc,
            sgrTotalRon: 0,
          },
        });
      }

      for (const line of sgrLines) {
        const qty = toNumber(line.qty);
        const unitPriceFc = toNumber(line.unitPrice);
        const lineNetFc = qty * unitPriceFc;

        if (qty <= 0 || unitPriceFc <= 0 || lineNetFc <= 0) continue;

        totalNetFc += lineNetFc;
        totalGrossFc += lineNetFc;

        await tx.salesInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: line.productId,
            productName: "SGR",
            productCode: "SGR",
            uomCode: normalizeText(line.product?.uom?.code || line.product?.uom?.name) || "BUC",
            vatCategoryCode: "Z",
            qty,
            unitPriceFc,
            vatRateValue: 0,
            discountPercent: 0,
            discountAmountFc: 0,
            lineNetFc,
            lineVatFc: 0,
            lineGrossFc: lineNetFc,
            sgrUnitFc: 0,
            sgrTotalFc: 0,
            discountAmountRon: 0,
            lineNetRon: lineNetFc,
            lineVatRon: 0,
            lineGrossRon: lineNetFc,
            sgrTotalRon: 0,
          },
        });
      }

      const updated = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          totalNetFc,
          totalDiscountFc: 0,
          totalVatFc,
          totalGrossFc,
          totalSgrFc: 0,
          totalWithSgrFc: totalGrossFc,
          totalNetRon: totalNetFc,
          totalDiscountRon: 0,
          totalVatRon: totalVatFc,
          totalGrossRon: totalGrossFc,
          totalSgrRon: 0,
          totalWithSgrRon: totalGrossFc,
        },
      });

      return updated;
    });

    return res.status(201).json({
      ok: true,
      invoiceId: created.id,
      docNo: created.docNo,
      total: Number(created.totalWithSgrRon || 0),
      duplicated: false,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut emite factura din bon.",
    });
  }
}

router.post("/api/v1/pos/receipts/:saleId/invoice", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosReceiptInvoice(req, res);
});

export async function handlePosReceiptsList(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  try {
    const now = new Date();
    const dateFrom = asDate(req.query.dateFrom, startOfDay(now));
    const dateTo = asDate(req.query.dateTo, endOfDay(now));

    const sales = await prisma.sale.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
        soldAt: { gte: dateFrom, lte: dateTo },
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
      take: 100,
    });

    const items = sales.map((sale) => ({
      id: sale.id,
      receiptNo: sale.receiptNo,
      clientSaleId: sale.clientSaleId,
      soldAt: sale.soldAt,
      total: toNumber(sale.total),
      paymentType: sale.paymentType,
      cashAmount: toNumber(sale.cashAmount),
      cardAmount: toNumber(sale.cardAmount),
      operatorName: sale.operatorName,
      location: sale.location,
      terminal: sale.terminal,
      lines: sale.items
        .filter((line) => !isSyntheticSgrSaleLine(line))
        .map((line) => {
          const qty = toNumber(line.qty);
          const unitPrice = toNumber(line.unitPrice);
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
            isSgr: false,
          };
        }),
    }));

    const totals = items.reduce(
      (acc, sale) => {
        acc.total += sale.total;
        acc.cash += sale.cashAmount;
        acc.card += sale.cardAmount;
        acc.count += 1;
        return acc;
      },
      { total: 0, cash: 0, card: 0, count: 0 }
    );

    return res.json({ ok: true, items, totals });
  } catch (error) {
    console.error("POS RECEIPTS LIST ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut incarca bonurile POS." });
  }
}

export async function handlePosBackofficeSalesSummary(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const terminalId = auth.terminalId || null;

  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  try {
    const now = new Date();
    const dateFrom = asDate(req.query.dateFrom, startOfDay(now));
    const dateTo = asDate(req.query.dateTo, endOfDay(now));

    const saleWhere: any = {
      tenantId,
      companyId: company?.id || null,
      soldAt: { gte: dateFrom, lte: dateTo },
    };

    if (terminalId) {
      saleWhere.terminalId = terminalId;
    }

    const [salesAgg, cashAgg, cardAgg, topProductsRows, recentSales] = await Promise.all([
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { cashAmount: true },
      }),
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { cardAmount: true },
      }),
      prisma.$queryRaw<Array<{ name: string; qty: number; total: number }>>(Prisma.sql`
        SELECT
          p.name,
          SUM(si.qty) as qty,
          SUM(si.qty * si."unitPrice") as total
        FROM "SaleItem" si
        JOIN "Product" p ON p.id = si."productId"
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."tenantId" = ${tenantId}
          AND s."companyId" = ${company?.id || null}
          ${terminalId ? Prisma.sql`AND s."terminalId" = ${terminalId}` : Prisma.empty}
          AND s."soldAt" BETWEEN ${dateFrom} AND ${dateTo}
          AND NOT (
            COALESCE(p."isSgr", false) = true
            AND COALESCE(si."vatRate", 0) = 0
            AND COALESCE(si."unitPrice", 0) = COALESCE(p."sgrValue", 0)
          )
        GROUP BY p.name
        ORDER BY total DESC, qty DESC
        LIMIT 5
      `),
      prisma.sale.findMany({
        where: saleWhere,
        select: {
          id: true,
          receiptNo: true,
          total: true,
          soldAt: true,
          paymentType: true,
          location: { select: { name: true } },
        },
        orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
    ]);

    const totalSales = Number(salesAgg._sum.total || 0);
    const receipts = Number(salesAgg._count.id || 0);
    const cash = Number(cashAgg._sum.cashAmount || 0);
    const card = Number(cardAgg._sum.cardAmount || 0);
    const avgReceipt = receipts > 0 ? totalSales / receipts : 0;

    return res.json({
      ok: true,
      totals: {
        sales: totalSales,
        receipts,
        cash,
        card,
        avgReceipt,
      },
      topProducts: Array.isArray(topProductsRows)
        ? topProductsRows.map((item) => ({
            name: item.name || "Produs",
            qty: Number(item.qty || 0),
            total: Number(item.total || 0),
          }))
        : [],
      recentSales: recentSales.map((item) => ({
        id: item.id,
        receiptNo: item.receiptNo,
        soldAt: item.soldAt,
        total: Number(item.total || 0),
        paymentType: item.paymentType || "",
        locationName: item.location?.name || null,
      })),
      interval: {
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
      },
    });
  } catch (error) {
    console.error("POS BACKOFFICE SUMMARY ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut incarca sumarul de vanzari POS." });
  }
}

export async function handlePosBackofficeSuppliersSearch(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  try {
    const q = normalizeText(req.query.q).slice(0, 60);
    const suppliers = await prisma.supplier.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
                { cif: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      take: 15,
    });

    return res.json({
      ok: true,
      suppliers: suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code || null,
        cif: supplier.cif || null,
        address: supplier.address || null,
        phone: supplier.phone || null,
        email: supplier.email || null,
      })),
    });
  } catch (error) {
    console.error("POS BACKOFFICE SUPPLIERS ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut cauta furnizorii." });
  }
}

export async function handlePosBackofficeProductsSearch(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  try {
    const q = normalizeText(req.query.q).slice(0, 60);
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcodes: { some: { barcode: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: {
        vatRate: true,
        uom: true,
        purchaseUom: true,
      },
      orderBy: [{ name: "asc" }],
      take: 20,
    });

    return res.json({
      ok: true,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku || null,
        vatRateValue: toNumber(product.vatRate?.rate),
        defaultCost: toNumber(product.costPrice),
        uomCode: product.purchaseUom?.code || product.uom?.code || "",
      })),
    });
  } catch (error) {
    console.error("POS BACKOFFICE PRODUCTS ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut cauta produsele." });
  }
}

export async function handlePosBackofficeReceiptCreate(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId || !auth?.terminalId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const parsed = PosBackofficeReceiptSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const tenantId = auth.tenantId;
  const terminalId = auth.terminalId;
  const payload = parsed.data;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  try {
    const terminal = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, locationId: true },
    });

    if (!terminal?.locationId) {
      return res.status(400).json({ ok: false, error: "Terminal fara locatie selectata." });
    }

    let supplier: any = null;
    if (normalizeText(payload.supplierId)) {
      supplier = await prisma.supplier.findFirst({
        where: {
          id: normalizeText(payload.supplierId),
          tenantId,
          companyId: company?.id || null,
        },
      });
      if (!supplier) {
        return res.status(404).json({ ok: false, error: "Furnizorul nu a fost gasit." });
      }
    }

    const productIds = payload.items.map((item) => normalizeText(item.productId));
    const dbProducts = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
        companyId: company?.id || null,
      },
      include: {
        vatRate: true,
        uom: true,
        purchaseUom: true,
      },
    });

    const productMap = new Map(dbProducts.map((product) => [product.id, product]));

    for (const item of payload.items) {
      if (!productMap.get(normalizeText(item.productId))) {
        return res.status(404).json({ ok: false, error: "Un produs din receptie nu a fost gasit." });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const docNo = await reserveNextNumber(tx, tenantId, "purchaseReceipt");
      const receipt = await tx.purchaseReceipt.create({
        data: {
          tenantId,
          companyId: company?.id || null,
          locationId: terminal.locationId!,
          supplierId: supplier?.id || null,
          supplierName: supplier?.name || normalizeText(payload.supplierName) || null,
          supplierCode: supplier?.code || normalizeText(payload.supplierCode) || null,
          docNo,
          docDate: new Date(),
          currency: "RON",
          fxRate: 1,
          note: normalizeText(payload.note) || null,
          status: payload.postNow ? "POSTED" : "DRAFT",
        },
      });

      let totalNetFc = 0;
      let totalVatFc = 0;
      let totalGrossFc = 0;

      for (const rawItem of payload.items) {
        const product = productMap.get(normalizeText(rawItem.productId))!;
        const qty = toNumber(rawItem.qty);
        const unitCostNetFc = toNumber(rawItem.unitCostNetFc);
        const vatRateValue =
          rawItem.vatRateValue !== undefined ? toNumber(rawItem.vatRateValue) : toNumber(product.vatRate?.rate);
        const conversionFactor = product.purchaseUomId && product.purchaseUomId !== product.uomId
          ? Math.max(0.000001, toNumber(product.purchaseFactor || 1))
          : 1;
        const stockQty = qty * conversionFactor;
        const lineNetFc = qty * unitCostNetFc;
        const lineVatFc = (lineNetFc * vatRateValue) / 100;
        const lineGrossFc = lineNetFc + lineVatFc;

        totalNetFc += lineNetFc;
        totalVatFc += lineVatFc;
        totalGrossFc += lineGrossFc;

        await tx.purchaseReceiptItem.create({
          data: {
            receiptId: receipt.id,
            productId: product.id,
            uomId: product.purchaseUomId || product.uomId,
            qty,
            conversionFactor,
            stockQty,
            unitCostNetFc,
            unitCostNetRon: unitCostNetFc,
            lineNetFc,
            lineVatFc,
            lineGrossFc,
            lineNetRon: lineNetFc,
            lineVatRon: lineVatFc,
            lineGrossRon: lineGrossFc,
            vatRateId: product.vatRateId,
            vatRateValue,
          },
        });

        if (payload.postNow) {
          await tx.stockBalance.upsert({
            where: {
              tenantId_companyId_locationId_productId: {
                tenantId,
                companyId: company?.id || null,
                locationId: terminal.locationId!,
                productId: product.id,
              },
            },
            update: {
              qty: { increment: stockQty },
            },
            create: {
              tenantId,
              companyId: company?.id || null,
              locationId: terminal.locationId!,
              productId: product.id,
              qty: stockQty,
            },
          });

          await tx.stockMove.create({
            data: {
              tenantId,
              companyId: company?.id || null,
              locationId: terminal.locationId!,
              productId: product.id,
              type: "IN",
              qty: stockQty,
              refType: "PURCHASE",
              refId: receipt.id,
              note: `NIR ${docNo}`,
            },
          });

          await tx.product.update({
            where: { id: product.id },
            data: { costPrice: unitCostNetFc },
          });
        }
      }

      return tx.purchaseReceipt.update({
        where: { id: receipt.id },
        data: {
          totalNetFc,
          totalVatFc,
          totalGrossFc,
          totalNetRon: totalNetFc,
          totalVatRon: totalVatFc,
          totalGrossRon: totalGrossFc,
        },
      });
    });

    return res.status(201).json({
      ok: true,
      receiptId: created.id,
      docNo: created.docNo,
      status: created.status,
      total: Number(created.totalGrossRon || 0),
    });
  } catch (error) {
    console.error("POS BACKOFFICE RECEIPT CREATE ERROR", error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut salva receptia din POS.",
    });
  }
}

router.get("/api/v1/pos/customers", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosCustomersSearch(req, res);
});

router.get("/api/v1/pos/cui-lookup", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosCompanyLookupByCui(req, res);
});

router.get("/api/v1/pos/backoffice/sales-summary", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeSalesSummary(req, res);
});

router.get("/api/v1/pos/backoffice/suppliers", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeSuppliersSearch(req, res);
});

router.get("/api/v1/pos/backoffice/products", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeProductsSearch(req, res);
});

router.post("/api/v1/pos/backoffice/receipts", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeReceiptCreate(req, res);
});

router.get("/api/v1/pos/receipts", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosReceiptsList(req, res);
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
      error: "POS neautentificat. Fa pair din nou.",
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
      error: "Terminal fara locatie selectata",
    });
  }

  const company = await getPrimaryTenantCompany(tenantId, {
      select: {
        id: true,
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
        companyId: company?.id || null,
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
      return res.status(404).json({ ok: false, error: "Produs inexistent in vanzare." });
    }
  }

  const recipes = await prisma.recipe.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
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

  const totalProductLines = receiptLines
    .filter((line) => line.type === "PRODUCT")
    .reduce((sum, line) => sum + toNumber(line.total), 0);
  const payloadTotal = toNumber(payload.total);
  const expectedTotalWithSgr = totalProductLines + totalSgr;
  const payloadLooksWithoutSgr = Math.abs(payloadTotal - totalProductLines) < 0.01;
  const totalWithSgr = payloadLooksWithoutSgr ? expectedTotalWithSgr : payloadTotal;
  const totalWithoutSgr = Math.max(0, totalWithSgr - totalSgr);

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
          companyId: company?.id || null,
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
                companyId: company?.id || null,
                locationId,
              saleId: sale.id,
              docNo: createConsumptionDocNo(),
              docDate: payload.soldAt ? new Date(payload.soldAt) : new Date(),
              note: `Generat automat din vanzare POS ${payload.receiptNo || sale.id}`,
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
              companyId: company?.id || null,
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
                companyId: company?.id || null,
                locationId,
              productId: recipeItem.ingredientId,
              type: "OUT",
              qty: ingredientQty,
              refType: "CONSUMPTION",
              refId: consumptionDocId,
              note: `Consum automat retetar pentru ${product.name}`,
            },
          });

        }
      } else {
        await decrementStockBalanceStrict(tx, {
            tenantId,
            companyId: company?.id || null,
            locationId,
          productId: line.productId,
          qty: qtyDecimal,
          productName: product.name,
          uomCode: product.uom?.code || null,
        });

        await tx.stockMove.create({
            data: {
              tenantId,
              companyId: company?.id || null,
              locationId,
            productId: line.productId,
            type: "OUT",
            qty: qtyDecimal,
            refType: "SALE",
            refId: sale.id,
            note: product.productionMode === "MANUAL"
              ? `Vanzare POS produs cu productie manuala: ${product.name}`
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

