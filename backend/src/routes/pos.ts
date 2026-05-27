// @ts-nocheck
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { decrementStockBalanceAllowNegative } from "../lib/stock";
import { getPrimaryTenantCompany } from "../lib/companyResolver";
import { reserveNextNumber } from "../lib/numbering";
import { getJwtSecret, verifySecret } from "../lib/auth";
import { createConsumptionDraft, validateConsumptionDoc } from "../lib/consumptionDocs";

console.log("POS ROUTES FILE LOADED");

const router = Router();
const JWT_SECRET = getJwtSecret();
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

async function resolvePosHeaderTerminalContext(req: Request) {
  const headerTerminalId =
    normalizeText(req.headers["x-pos-terminal-id"]) ||
    normalizeText(req.headers["terminal-id"]) ||
    normalizeText(req.query.terminalId);
  const headerLicenseKey =
    normalizeText(req.headers["x-pos-license-key"]) ||
    normalizeText(req.headers["license-key"]) ||
    normalizeText(req.query.licenseKey);
  const headerTerminalDeviceId =
    normalizeText(req.headers["x-pos-terminal-device-id"]) ||
    normalizeText(req.headers["terminal-device-id"]) ||
    normalizeText(req.query.terminalDeviceId);
  const headerAndroidDeviceId =
    normalizeText(req.headers["x-pos-device-id"]) ||
    normalizeText(req.headers["device-id"]) ||
    normalizeText(req.query.deviceId);

  if (!headerTerminalId && !headerLicenseKey && !headerTerminalDeviceId && !headerAndroidDeviceId) {
    return null;
  }

  console.warn("POS AUTH HEADER LOOKUP", {
    path: req.path,
    method: req.method,
    headerTerminalId,
    headerLicenseKey,
    headerTerminalDeviceId,
    headerAndroidDeviceId,
  });

  const terminal = await prisma.terminal.findFirst({
    where: {
      OR: [
        ...(headerTerminalId ? [{ id: headerTerminalId }] : []),
        ...(headerLicenseKey ? [{ deviceId: headerLicenseKey }] : []),
        ...(headerTerminalDeviceId ? [{ deviceId: headerTerminalDeviceId }] : []),
        ...(headerAndroidDeviceId ? [{ deviceId: headerAndroidDeviceId }] : []),
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

  if (!terminal) {
    console.warn("POS AUTH HEADER LOOKUP MISS", {
      path: req.path,
      method: req.method,
      headerTerminalId,
      headerLicenseKey,
      headerTerminalDeviceId,
      headerAndroidDeviceId,
    });
    return null;
  }

  const license = terminal?.tenant.licenses?.[0];
  if (!license || license.isSuspended || license.expiresAt <= new Date() || !license.modPos) {
    console.warn("POS AUTH HEADER LOOKUP LICENSE BYPASS", {
      path: req.path,
      method: req.method,
      resolvedTerminalId: terminal.id,
      resolvedTerminalDeviceId: terminal.deviceId,
      licensePresent: Boolean(license),
      licenseSuspended: license?.isSuspended ?? null,
      licenseExpired: license ? license.expiresAt <= new Date() : null,
      modPos: license?.modPos ?? null,
    });
    return {
      tenantId: terminal.tenantId,
      terminalId: terminal.id,
      deviceId: terminal.deviceId,
    };
  }

  console.warn("POS AUTH HEADER FALLBACK", {
    path: req.path,
    method: req.method,
    headerTerminalId,
    headerLicenseKey,
    headerTerminalDeviceId,
    headerAndroidDeviceId,
    resolvedTerminalId: terminal.id,
    resolvedTerminalDeviceId: terminal.deviceId,
  });

  return {
    tenantId: terminal.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId,
  };
}

export async function resolvePosAuthContext(req: PosAuthRequest) {
  if (req.auth?.tenantId) {
    return req.auth;
  }

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

  if (token) {
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
      return req.auth;
    } catch (error) {
      console.warn("POS AUTH INVALID TOKEN IN CONTEXT", {
        path: req.path,
        method: req.method,
        tokenPreview: token.slice(0, 24),
        tokenLength: token.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  const headerResolved = await resolvePosHeaderTerminalContext(req);
  if (headerResolved) {
    return headerResolved;
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
async function requirePosAuth(req: PosAuthRequest, res: Response, next: NextFunction) {
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
    const headerResolved = await resolvePosHeaderTerminalContext(req);
    if (headerResolved) {
      req.auth = headerResolved;
      return next();
    }

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
    const headerResolved = await resolvePosHeaderTerminalContext(req);
    if (headerResolved) {
      req.auth = headerResolved;
      return next();
    }

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

function parseLooseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return {};
  }
}

function pickFirstNonBlank(...values: unknown[]) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
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
  const recipeItems = Array.isArray(product.recipe?.items) ? product.recipe.items : [];
  const menuComponents =
    product.isMenu === true
      ? recipeItems
          .map((item: any) => {
            const ingredient = item?.ingredient;
            const componentId = String(ingredient?.id || item?.ingredientId || "").trim();
            if (!componentId) return null;
            return {
              id: componentId,
              code: componentId,
              sku: String(ingredient?.sku || "").trim() || null,
              name: String(ingredient?.name || "").trim() || null,
              qty: toNumber(item?.qty || 0),
            };
          })
          .filter(Boolean)
      : [];

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
    isMenu: Boolean(product.isMenu),
    menuComponents,
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
      recipe: {
        include: {
          items: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                },
              },
            },
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      },
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

/* ======================================================
   1) POS PAIR
====================================================== */

const PairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  deviceType: z.string().optional(),
  device_type: z.string().optional(),
  source: z.string().optional(),
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
  androidDeviceId: z.string().optional().nullable(),
  terminalId: z.string().optional().nullable(),
  terminalDeviceId: z.string().optional().nullable(),
  terminalLabel: z.string().optional().nullable(),
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
  const hintedTerminalIds = dedupeNonEmpty([body.terminalId]);
  const hintedDeviceIds = dedupeNonEmpty([
    body.terminalDeviceId,
    body.deviceId,
    body.licenseKey,
  ]);

  if (hintedTerminalIds.length > 0 || hintedDeviceIds.length > 0) {
    const hintedTerminal = await prisma.terminal.findFirst({
      where: {
        OR: [
          ...(hintedTerminalIds.length ? [{ id: { in: hintedTerminalIds } }] : []),
          ...(hintedDeviceIds.length ? [{ deviceId: { in: hintedDeviceIds } }] : []),
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

    const hintedLicense = hintedTerminal?.tenant.licenses[0];
    if (
      hintedTerminal &&
      hintedLicense &&
      !hintedLicense.isSuspended &&
      hintedLicense.expiresAt > new Date() &&
      hintedLicense.modPos
    ) {
      return {
        tenantId: hintedTerminal.tenantId,
        terminalId: hintedTerminal.id,
        deviceId: hintedTerminal.deviceId,
      };
    }
  }

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

    const terminalModuleEnabled = terminal.deviceType === "KDS" ? license.modKds : license.modPos;
    if (!terminalModuleEnabled) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: terminal.deviceType === "KDS" ? "KDS nu este activ" : "POS nu este activ",
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
        deviceType: terminal.deviceType,
        label: terminal.label,
        locationId: terminal.locationId,
        locationName: terminal.location?.name || null,
      },
      license: {
        expiresAt: license.expiresAt,
        posEnabled: license.modPos,
        kdsEnabled: license.modKds,
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
    const requestedDeviceType =
      normalizeText(body.deviceType ?? body.device_type)?.toUpperCase() === "KDS" || normalizeText(body.source)?.toLowerCase() === "gufo-kds"
        ? "KDS"
        : "POS";
    const licenseKey = normalizeText(body.licenseKey ?? body.license_key);
    const incomingDeviceId = normalizeText(body.deviceId ?? body.device_id);
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) || (requestedDeviceType === "KDS" ? "GuFo KDS" : "Android POS");

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

    if (terminal.deviceType !== requestedDeviceType) {
      return res.status(409).json({
        ok: false,
        error: requestedDeviceType === "KDS" ? "Licenta KDS invalida" : "Licenta POS invalida",
      });
    }

    const terminalModuleEnabled = terminal.deviceType === "KDS" ? license.modKds : license.modPos;
    if (!terminalModuleEnabled) {
      return res.status(403).json({
        ok: false,
        error: terminal.deviceType === "KDS" ? "KDS nu este activ" : "POS nu este activ",
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
        deviceType: terminal.deviceType,
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

router.post("/api/v1/pos/daily-closures", requirePosAuth, handlePosDailyClosure);

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

const ACTIVE_MARKETPLACE_ORDER_STATUSES = [
  "RECEIVED",
  "ACKNOWLEDGED",
  "IN_KITCHEN",
  "READY",
  "READY_FOR_FISCAL",
] as const;

const GLOVO_PARTNER_API_BASE = process.env.GLOVO_PARTNER_API_BASE || "https://glovo.partner.deliveryhero.io";

const PosMarketplaceKdsStatusSchema = z.object({
  status: z.string().trim().min(1),
  message: z.string().trim().optional(),
});

function getIntegrationSettingsObject(integration: any) {
  return integration?.settingsJson && typeof integration.settingsJson === "object" ? integration.settingsJson : {};
}

function normalizeGlovoTransportType(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LOGISTICS" || normalized === "LOGISTICS_DELIVERY") return "LOGISTICS_DELIVERY";
  if (normalized === "VENDOR" || normalized === "VENDOR_DELIVERY") return "VENDOR_DELIVERY";
  return normalized || null;
}

function getGlovoChainIdForOrder(order: any) {
  const raw = order?.rawPayloadJson && typeof order.rawPayloadJson === "object" ? order.rawPayloadJson : {};
  const settings = getIntegrationSettingsObject(order?.integration);
  return String(raw?.client?.chain_id || raw?.chain_id || settings?.glovoChainId || "").trim() || null;
}

function getGlovoOrderUuid(order: any) {
  const raw = order?.rawPayloadJson && typeof order.rawPayloadJson === "object" ? order.rawPayloadJson : {};
  return String(raw?.order_id || raw?.id || order?.externalOrderId || "").trim() || null;
}

function getGlovoAcceptedFor(order: any) {
  const raw = order?.rawPayloadJson && typeof order.rawPayloadJson === "object" ? order.rawPayloadJson : {};
  const acceptedRaw = String(raw?.accepted_for || raw?.promised_for || "").trim();
  if (acceptedRaw) {
    const parsed = new Date(acceptedRaw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const settings = getIntegrationSettingsObject(order?.integration);
  const prepMinutes = Number(settings?.glovoDefaultPrepMinutes || 0);
  if (prepMinutes > 0) {
    const base = order?.placedAt ? new Date(order.placedAt) : new Date();
    if (!Number.isNaN(base.getTime())) {
      base.setMinutes(base.getMinutes() + prepMinutes);
      return base.toISOString();
    }
  }

  return null;
}

function buildGlovoUpdateItems(order: any) {
  const raw = order?.rawPayloadJson && typeof order.rawPayloadJson === "object" ? order.rawPayloadJson : {};
  const rawItems = Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(raw?.products)
      ? raw.products
      : [];
  const fallbackItems = Array.isArray(order?.items) ? order.items : [];

  const normalized = rawItems.length ? rawItems : fallbackItems;
  return normalized
    .map((item: any, index: number) => {
      const fallbackOrderItem = fallbackItems[index];
      const quantity = Number(item?.pricing?.quantity ?? item?.quantity ?? item?.qty ?? fallbackOrderItem?.qty ?? 1) || 1;
      const unitPrice = Number(
        item?.pricing?.unit_price ??
        item?.original_pricing?.unit_price ??
        item?.unit_price ??
        item?.price ??
        fallbackOrderItem?.unitPrice ??
        0
      ) || 0;
      const payloadItem: any = {
        pricing: {
          pricing_type: "UNIT",
          quantity,
          unit_price: unitPrice,
          weight: Number(item?.pricing?.weight ?? item?.original_pricing?.weight ?? 0) || 0,
        },
        status: "IN_CART",
      };
      const rawId = String(item?._id || item?.id || "").trim();
      const rawSku = String(item?.sku || fallbackOrderItem?.sku || item?.product_id || item?.externalProductId || "").trim();
      if (rawId) payloadItem._id = rawId;
      if (rawSku) payloadItem.sku = rawSku;
      if (!payloadItem._id && !payloadItem.sku) return null;
      return payloadItem;
    })
    .filter(Boolean);
}

async function requestGlovoPartnerAccessToken(integration: any) {
  const settings = getIntegrationSettingsObject(integration);
  const clientId = String(settings?.glovoClientId || "").trim();
  const clientSecret = String(settings?.glovoClientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Glovo Partner API necesita clientId si clientSecret.");
  }

  const response = await fetch(`${GLOVO_PARTNER_API_BASE}/v2/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || `Glovo OAuth failed with ${response.status}`);
  }

  const token = String(payload?.access_token || "").trim();
  if (!token) {
    throw new Error("Glovo OAuth nu a returnat access_token.");
  }

  return token;
}

function decideGlovoOutboundStatus(order: any, nextInternalStatus: string) {
  const transportType = normalizeGlovoTransportType(order?.rawPayloadJson?.transport_type);
  if (nextInternalStatus === "ACKNOWLEDGED" && transportType === "VENDOR_DELIVERY") {
    return "ACCEPTED";
  }
  if (nextInternalStatus === "READY_FOR_FISCAL" && transportType === "VENDOR_DELIVERY") {
    return "DISPATCHED";
  }
  if (nextInternalStatus === "READY_FOR_FISCAL" && transportType === "LOGISTICS_DELIVERY") {
    return "READY_FOR_PICKUP";
  }
  return null;
}

export async function syncGlovoPartnerStatusForOrder(
  auth: NonNullable<PosAuthRequest["auth"]>,
  order: any,
  nextInternalStatus: string,
  source: "POS" | "KDS"
) {
  if (order?.platform !== "GLOVO" || !order?.integration) {
    return { skipped: true, reason: "not-glovo" };
  }

  const glovoStatus = decideGlovoOutboundStatus(order, nextInternalStatus);
  if (!glovoStatus) {
    return { skipped: true, reason: "no-outbound-status-for-transition" };
  }

  const chainId = getGlovoChainIdForOrder(order);
  const glovoOrderId = getGlovoOrderUuid(order);
  const items = buildGlovoUpdateItems(order);
  const confirmedAmount = Number(order?.total || 0) || 0;

  if (!chainId) {
    return { skipped: true, reason: "missing-chain-id" };
  }
  if (!glovoOrderId) {
    return { skipped: true, reason: "missing-order-id" };
  }
  if (!items.length) {
    return { skipped: true, reason: "missing-order-items" };
  }

  const body: any = {
    order_id: glovoOrderId,
    status: glovoStatus,
    confirmed_amount: confirmedAmount,
    items,
  };

  if (glovoStatus === "ACCEPTED") {
    const acceptedFor = getGlovoAcceptedFor(order);
    if (!acceptedFor) {
      return { skipped: true, reason: "missing-accepted-for" };
    }
    body.accepted_for = acceptedFor;
  }

  const accessToken = await requestGlovoPartnerAccessToken(order.integration);
  const response = await fetch(`${GLOVO_PARTNER_API_BASE}/v2/chains/${encodeURIComponent(chainId)}/orders/${encodeURIComponent(glovoOrderId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message ||
      payload?.error ||
      payload?.detail ||
      `Glovo Update Order failed with ${response.status}`
    );
  }

  await createPosMarketplaceHistory(
    auth,
    order.id,
    nextInternalStatus,
    "GLOVO",
    `Glovo sync trimis cu status ${glovoStatus} din ${source}.`,
    {
      glovoStatus,
      chainId,
      glovoOrderId,
      response: payload,
    }
  );

  return { skipped: false, glovoStatus, response: payload };
}

export async function syncGlovoPartnerCancellationForOrder(
  auth: NonNullable<PosAuthRequest["auth"]>,
  order: any,
  source: "POS" | "KDS",
  reason = "OTHER"
) {
  if (order?.platform !== "GLOVO" || !order?.integration) {
    return { skipped: true, reason: "not-glovo" };
  }

  const chainId = getGlovoChainIdForOrder(order);
  const glovoOrderId = getGlovoOrderUuid(order);
  const items = buildGlovoUpdateItems(order);
  const confirmedAmount = Number(order?.total || 0) || 0;

  if (!chainId) {
    return { skipped: true, reason: "missing-chain-id" };
  }
  if (!glovoOrderId) {
    return { skipped: true, reason: "missing-order-id" };
  }
  if (!items.length) {
    return { skipped: true, reason: "missing-order-items" };
  }

  const accessToken = await requestGlovoPartnerAccessToken(order.integration);
  const response = await fetch(`${GLOVO_PARTNER_API_BASE}/v2/chains/${encodeURIComponent(chainId)}/orders/${encodeURIComponent(glovoOrderId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      order_id: glovoOrderId,
      status: "CANCELLED",
      confirmed_amount: confirmedAmount,
      items,
      cancellation: {
        reason: String(reason || "OTHER").trim() || "OTHER",
      },
    }),
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message ||
      payload?.error ||
      payload?.detail ||
      `Glovo Cancel Order failed with ${response.status}`
    );
  }

  await createPosMarketplaceHistory(
    auth,
    order.id,
    "CANCELLED",
    "GLOVO",
    `Glovo sync trimis cu status CANCELLED din ${source}.`,
    {
      glovoStatus: "CANCELLED",
      chainId,
      glovoOrderId,
      response: payload,
    }
  );

  return { skipped: false, glovoStatus: "CANCELLED", response: payload };
}

async function resolvePosMarketplaceTerminalLocation(auth: NonNullable<PosAuthRequest["auth"]>) {
  if (!auth.terminalId) return null;
  return prisma.terminal.findUnique({
    where: { id: auth.terminalId },
    select: { id: true, locationId: true, label: true, deviceId: true },
  });
}

function getMarketplaceTargetTerminalId(integration: any) {
  const value = integration?.settingsJson?.targetTerminalId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getMarketplaceTargetTerminalDeviceId(integration: any) {
  const value = integration?.settingsJson?.targetTerminalDeviceId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveMarketplaceTargetTerminal(integration: any) {
  const targetTerminalId = getMarketplaceTargetTerminalId(integration);
  const targetTerminalDeviceId = getMarketplaceTargetTerminalDeviceId(integration);

  if (!targetTerminalId && !targetTerminalDeviceId) {
    return null;
  }

  if (targetTerminalId && targetTerminalDeviceId) {
    return {
      id: targetTerminalId,
      deviceId: targetTerminalDeviceId,
    };
  }

  if (targetTerminalId) {
    const terminal = await prisma.terminal.findUnique({
      where: { id: targetTerminalId },
      select: { id: true, deviceId: true },
    });

    return {
      id: targetTerminalId,
      deviceId: terminal?.deviceId?.trim() || null,
    };
  }

  return {
    id: null,
    deviceId: targetTerminalDeviceId,
  };
}

async function isMarketplaceOrderVisibleToTerminal(order: any, auth: NonNullable<PosAuthRequest["auth"]>) {
  const targetTerminal = await resolveMarketplaceTargetTerminal(order?.integration);
  if (targetTerminal) {
    if (auth.terminalId && targetTerminal.id === auth.terminalId) {
      return true;
    }

    const authDeviceId = String(auth.deviceId || "").trim().toUpperCase();
    const targetDeviceId = String(targetTerminal.deviceId || "").trim().toUpperCase();
    if (authDeviceId && targetDeviceId && targetDeviceId === authDeviceId) {
      return true;
    }

    return false;
  }

  if (!auth.terminalId) return true;
  const terminal = await resolvePosMarketplaceTerminalLocation(auth);
  if (!terminal?.locationId) return true;
  return terminal.locationId === order?.locationId;
}

async function getMarketplaceVisibilityDebug(order: any, auth: NonNullable<PosAuthRequest["auth"]>) {
  const targetTerminal = await resolveMarketplaceTargetTerminal(order?.integration);
  const authTerminalId = auth.terminalId || null;
  const authDeviceId = auth.deviceId || null;
  const targetTerminalId = targetTerminal?.id || null;
  const targetTerminalDeviceId = targetTerminal?.deviceId || null;

  const matchesTerminalId = Boolean(authTerminalId && targetTerminalId && authTerminalId === targetTerminalId);
  const matchesDeviceId = Boolean(authDeviceId && targetTerminalDeviceId && authDeviceId === targetTerminalDeviceId);
  const visible = !targetTerminal || matchesTerminalId || matchesDeviceId;

  return {
    visible,
    authTerminalId,
    authDeviceId,
    targetTerminalId,
    targetTerminalDeviceId,
    matchesTerminalId,
    matchesDeviceId,
    reason: !targetTerminal
      ? "no-target-terminal"
      : matchesTerminalId
        ? "matched-terminal-id"
        : matchesDeviceId
          ? "matched-device-id"
          : "target-mismatch",
  };
}

export async function resolvePosMarketplaceOrder(auth: NonNullable<PosAuthRequest["auth"]>, inputOrderId: string, include: Record<string, unknown> = {}) {
  const order = await prisma.externalOrder.findFirst({
    where: {
      tenantId: auth.tenantId,
      OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
    },
    include: {
      integration: {
        select: {
          id: true,
          settingsJson: true,
          locationId: true,
        },
      },
      ...include,
    },
  });
  if (!order) return null;
  return (await isMarketplaceOrderVisibleToTerminal(order, auth)) ? order : null;
}

export async function createPosMarketplaceHistory(
  auth: NonNullable<PosAuthRequest["auth"]>,
  externalOrderId: string,
  status: string,
  source: string,
  message: string,
  payloadJson?: unknown
) {
  const normalizedSource = (() => {
    const value = String(source || "").trim().toUpperCase();
    if (["POS", "KDS", "ERP", "BACKEND", "PLATFORM"].includes(value)) {
      return value;
    }
    if (["GLOVO", "WOLT", "BOLT", "BOLT_FOOD"].includes(value)) {
      return "PLATFORM";
    }
    return "BACKEND";
  })();

  const normalizedPayload =
    payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)
      ? {
          ...(payloadJson as Record<string, unknown>),
          historyPlatformSource:
            normalizedSource === "PLATFORM" && !["PLATFORM", "POS", "KDS", "ERP", "BACKEND"].includes(String(source || "").trim().toUpperCase())
              ? String(source || "").trim().toUpperCase()
              : undefined,
        }
      : payloadJson;

  return prisma.externalOrderStatusHistory.create({
    data: {
      tenantId: auth.tenantId,
      externalOrderId,
      status,
      source: normalizedSource as any,
      message,
      payloadJson: normalizedPayload ?? undefined,
    },
  });
}

export function normalizePosMarketplaceKdsStatus(rawStatus: string) {
  const value = String(rawStatus || "").trim().toUpperCase();
  if (["CANCEL", "CANCELED", "CANCELLED", "REJECTED"].includes(value)) {
    return "CANCELLED" as const;
  }
  if (["READY", "FINAL", "FINALIZED", "DONE", "COMPLETED", "COMPLETE", "READY_FOR_FISCAL"].includes(value)) {
    return "READY_FOR_FISCAL" as const;
  }
  if (["IN_PROGRESS", "PREPARING", "START", "STARTED", "COOKING"].includes(value)) {
    return "IN_KITCHEN" as const;
  }
  if (["SENT", "SENT_TO_KDS", "QUEUED", "WAITING"].includes(value)) {
    return "IN_KITCHEN" as const;
  }
  if (["ACCEPT", "ACCEPTED"].includes(value)) {
    return "ACKNOWLEDGED" as const;
  }
  if (["RECEIVED", "NEW", "PENDING"].includes(value)) {
    return "RECEIVED" as const;
  }
  return null;
}

router.get("/api/v1/pos/marketplace/orders", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fa pair din nou.",
    });
  }

  const items = await prisma.externalOrder.findMany({
    where: {
      tenantId: auth.tenantId,
      status: { in: [...ACTIVE_MARKETPLACE_ORDER_STATUSES] },
    },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
      saleDraft: {
        select: { id: true, status: true, total: true, subtotal: true, updatedAt: true },
      },
      kitchenTicket: {
        select: { id: true, status: true, displayNumber: true, readyAt: true, updatedAt: true },
      },
      integration: {
        select: {
          id: true,
          settingsJson: true,
          locationId: true,
        },
      },
      items: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const visibleItems = (
    await Promise.all(
      items.map(async (item) => ((await isMarketplaceOrderVisibleToTerminal(item, auth)) ? item : null))
    )
  ).filter(Boolean);

  return res.json({ ok: true, items: visibleItems });
});

router.get("/api/v1/pos/marketplace/debug", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fa pair din nou.",
    });
  }

  const items = await prisma.externalOrder.findMany({
    where: {
      tenantId: auth.tenantId,
      status: { in: [...ACTIVE_MARKETPLACE_ORDER_STATUSES] },
    },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
      integration: {
        select: {
          id: true,
          locationId: true,
          settingsJson: true,
        },
      },
      kitchenTicket: {
        select: { id: true, status: true, displayNumber: true },
      },
      items: {
        select: { id: true, name: true, qty: true, externalProductId: true, mappingStatus: true },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  const debugItems = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      externalOrderId: item.externalOrderId,
      externalOrderNumber: item.externalOrderNumber,
      platform: item.platform,
      status: item.status,
      location: item.location,
      kitchenTicket: item.kitchenTicket,
      itemsCount: item.items.length,
      visibility: await getMarketplaceVisibilityDebug(item, auth),
    }))
  );

  return res.json({
    ok: true,
    auth,
    terminal,
    counts: {
      totalActiveInLocation: items.length,
      visibleToCurrentPos: debugItems.filter((item) => item.visibility.visible).length,
    },
    items: debugItems,
  });
});

router.post("/api/v1/pos/marketplace/:externalOrderId/accept", async (req: PosAuthRequest, res: Response) => {
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

  const order = await resolvePosMarketplaceOrder(auth, inputOrderId, {
    saleDraft: true,
    kitchenTicket: true,
  });

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" });
  }

  const nextStatus = order.status === "RECEIVED" ? "ACKNOWLEDGED" : order.status;
  await prisma.$transaction(async (tx: any) => {
    if (nextStatus !== order.status || order.cancelledAt) {
      await tx.externalOrder.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          acknowledgedAt: nextStatus === "ACKNOWLEDGED" ? new Date() : order.acknowledgedAt,
          cancelledAt: null,
        },
      });
    }

    if (order.saleDraft?.id && order.saleDraft.status === "CANCELLED") {
      await tx.saleDraft.update({
        where: { id: order.saleDraft.id },
        data: { status: "OPEN" },
      });
    }

    if (order.kitchenTicket?.id && order.kitchenTicket.status === "CANCELLED") {
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data: { status: "NEW", completedAt: null, readyAt: null },
      });
    }
  });

  await createPosMarketplaceHistory(
    auth,
    order.id,
    nextStatus,
    "POS",
    "Marketplace order accepted in POS.",
    { terminalId: auth.terminalId || null }
  );

  let glovoSync: any = { skipped: true, reason: "not-run" };
  try {
    glovoSync = await syncGlovoPartnerStatusForOrder(
      auth,
      {
        ...order,
        status: nextStatus,
      },
      nextStatus,
      "POS"
    );
    if (glovoSync?.skipped && glovoSync?.reason && glovoSync.reason !== "not-glovo") {
      await createPosMarketplaceHistory(
        auth,
        order.id,
        nextStatus,
        "GLOVO",
        `Glovo sync nu a fost trimis la acceptare: ${glovoSync.reason}.`,
        glovoSync
      );
    }
  } catch (error: any) {
    glovoSync = { skipped: false, error: error?.message || "Glovo accept sync failed." };
    await createPosMarketplaceHistory(
      auth,
      order.id,
      nextStatus,
      "GLOVO",
      `Glovo sync a esuat la acceptare: ${glovoSync.error}`,
      glovoSync
    );
  }

  return res.json({ ok: true, externalOrderId: order.id, status: nextStatus, glovoSync });
});

router.post("/api/v1/pos/marketplace/:externalOrderId/send-to-kds", async (req: PosAuthRequest, res: Response) => {
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

  const order = await resolvePosMarketplaceOrder(auth, inputOrderId, {
    kitchenTicket: true,
    saleDraft: true,
  });

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" });
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.externalOrder.update({
      where: { id: order.id },
        data: { status: "IN_KITCHEN" },
    });

    if (order.kitchenTicket) {
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data: { status: "NEW" },
      });
    }

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId: auth.tenantId,
        externalOrderId: order.id,
        status: "IN_KITCHEN",
        source: "POS",
        message: "Marketplace order sent to KDS from POS.",
        payloadJson: { terminalId: auth.terminalId || null },
      },
    });
  });

  return res.json({ ok: true, externalOrderId: order.id, status: "IN_KITCHEN" });
});

router.post("/api/v1/pos/marketplace/:externalOrderId/kds-status", async (req: PosAuthRequest, res: Response) => {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "POS neautentificat. Fa pair din nou.",
    });
  }

  const parsed = PosMarketplaceKdsStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const normalizedStatus = normalizePosMarketplaceKdsStatus(parsed.data.status);
  if (!normalizedStatus) {
    return res.status(400).json({ ok: false, error: "Unsupported marketplace KDS status" });
  }

  const inputOrderId = String(req.params.externalOrderId || "").trim();
  if (!inputOrderId) {
    return res.status(400).json({ ok: false, error: "Missing externalOrderId" });
  }

  const order = await resolvePosMarketplaceOrder(auth, inputOrderId, {
    kitchenTicket: true,
    saleDraft: true,
  });

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" });
  }

  const now = new Date();

  await prisma.$transaction(async (tx: any) => {
    await tx.externalOrder.update({
      where: { id: order.id },
      data: {
        status: normalizedStatus,
        ...(normalizedStatus === "READY_FOR_FISCAL" ? { readyAt: now } : {}),
      },
    });

    if (order.kitchenTicket) {
      const kitchenPayload =
        normalizedStatus === "READY_FOR_FISCAL"
          ? { status: "READY", readyAt: now }
          : normalizedStatus === "IN_KITCHEN"
            ? { status: "IN_PROGRESS" }
            : normalizedStatus === "ACKNOWLEDGED"
                ? { status: "NEW" }
                : { status: "NEW" };
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data: kitchenPayload,
      });
    }

    if (order.saleDraft && normalizedStatus === "READY_FOR_FISCAL") {
      await tx.saleDraft.update({
        where: { id: order.saleDraft.id },
        data: { status: "READY_FOR_FISCAL" },
      });
    }

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId: auth.tenantId,
        externalOrderId: order.id,
        status: normalizedStatus,
        source: "KDS",
        message: parsed.data.message || `Marketplace order marked ${normalizedStatus} from POS KDS callback.`,
        payloadJson: { terminalId: auth.terminalId || null },
      },
    });
  });

  let glovoSync: any = { skipped: true, reason: "not-run" };
  try {
    glovoSync = await syncGlovoPartnerStatusForOrder(
      auth,
      {
        ...order,
        status: normalizedStatus,
        readyAt: normalizedStatus === "READY_FOR_FISCAL" ? now : order.readyAt,
      },
      normalizedStatus,
      "KDS"
    );
    if (glovoSync?.skipped && glovoSync?.reason && glovoSync.reason !== "not-glovo") {
      await createPosMarketplaceHistory(
        auth,
        order.id,
        normalizedStatus,
        "GLOVO",
        `Glovo sync nu a fost trimis din KDS: ${glovoSync.reason}.`,
        glovoSync
      );
    }
  } catch (error: any) {
    glovoSync = { skipped: false, error: error?.message || "Glovo KDS sync failed." };
    await createPosMarketplaceHistory(
      auth,
      order.id,
      normalizedStatus,
      "GLOVO",
      `Glovo sync a esuat din KDS: ${glovoSync.error}`,
      glovoSync
    );
  }

  return res.json({ ok: true, externalOrderId: order.id, status: normalizedStatus, glovoSync });
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

  const order = await prisma.externalOrder.findFirst({
    where: {
      tenantId: auth.tenantId,
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
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerNote: order.customerNote,
        paymentLabel: order.paymentLabel,
        restaurantName: pickFirstNonBlank(
          parseMarketplaceSettings(order.integration?.settingsJson)?.merchantName,
          parseMarketplaceSettings(order.integration?.settingsJson)?.partnerName,
          order.location?.name
        ) || null,
        deliveryAddress: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.delivery?.address?.label,
          parseLooseJsonObject(order.rawPayloadJson)?.customer?.address?.label,
          parseLooseJsonObject(order.rawPayloadJson)?.address?.label,
          parseLooseJsonObject(order.rawPayloadJson)?.delivery_address?.label,
          parseLooseJsonObject(order.rawPayloadJson)?.deliveryAddress?.label,
          parseLooseJsonObject(order.rawPayloadJson)?.deliveryAddress
        ) || null,
        orderType: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.order_type,
          parseLooseJsonObject(order.rawPayloadJson)?.orderType,
          parseLooseJsonObject(order.rawPayloadJson)?.transport_type,
          parseLooseJsonObject(order.rawPayloadJson)?.transportType
        ) || null,
        isPickedUpByCustomer: Boolean(
          parseLooseJsonObject(order.rawPayloadJson)?.is_picked_up_by_customer ??
            parseLooseJsonObject(order.rawPayloadJson)?.isPickedUpByCustomer ??
            false
        ),
        pickUpCode: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.pick_up_code,
          parseLooseJsonObject(order.rawPayloadJson)?.pickup_code,
          parseLooseJsonObject(order.rawPayloadJson)?.pickupCode
        ) || null,
        estimatedPickupTime: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.estimated_pickup_time,
          parseLooseJsonObject(order.rawPayloadJson)?.estimatedPickupTime,
          parseLooseJsonObject(order.rawPayloadJson)?.pickup_eta
        ) || null,
        courierName: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.courier?.name,
          parseLooseJsonObject(order.rawPayloadJson)?.courier_name,
          parseLooseJsonObject(order.rawPayloadJson)?.courierName
        ) || null,
        courierPhone: pickFirstNonBlank(
          parseLooseJsonObject(order.rawPayloadJson)?.courier?.phone,
          parseLooseJsonObject(order.rawPayloadJson)?.courier_phone,
          parseLooseJsonObject(order.rawPayloadJson)?.courierPhone
        ) || null,
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
  subtotal: z.number().optional(),
  merchandiseSubtotal: z.number().optional(),
  sgrTotal: z.number().optional(),
  discountTotal: z.number().optional(),
  lineDiscountTotal: z.number().optional(),
  cartDiscountTotal: z.number().optional(),
  cartDiscountPercent: z.number().optional(),
  licenseKey: z.string().optional().nullable(),
  license_key: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  device_id: z.string().optional().nullable(),
  androidDeviceId: z.string().optional().nullable(),
  terminalId: z.string().optional().nullable(),
  terminal_id: z.string().optional().nullable(),
  terminalDeviceId: z.string().optional().nullable(),
  terminal_device_id: z.string().optional().nullable(),
  terminal: z
    .object({
      id: z.string().optional().nullable(),
      deviceId: z.string().optional().nullable(),
      device_id: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      locationId: z.string().optional().nullable(),
      location_id: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),

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
      lineTotalBeforeDiscount: z.number().optional(),
      discountPercent: z.number().optional(),
      lineDiscountTotal: z.number().optional(),
      lineTotalAfterDiscount: z.number().optional(),
      isSgr: z.boolean().optional(),
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

const PosOperatorLoginSchema = z.object({
  name: z.string().trim().min(1, "Operatorul este obligatoriu."),
  pin: z.string().trim().min(4, "PIN-ul trebuie sa aiba cel putin 4 caractere.").max(8, "PIN-ul poate avea maximum 8 caractere."),
});

const POS_OPERATOR_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.CHEF,
  UserRole.KITCHEN_HELPER,
  UserRole.KITCHEN_OPERATOR,
];

type ResolvedPosTerminalAuth = {
  tenantId: string;
  terminalId: string;
  deviceId: string;
};

function dedupeNonEmpty(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
}

async function lookupTerminalAuthByHints(
  hints: z.infer<typeof PosSaleSchema>,
  tenantId?: string | null
): Promise<ResolvedPosTerminalAuth | null> {
  const terminalIds = dedupeNonEmpty([
    hints.terminalId,
    hints.terminal_id,
    hints.terminal?.id,
  ]);
  const deviceIds = dedupeNonEmpty([
    hints.terminalDeviceId,
    hints.terminal_device_id,
    hints.deviceId,
    hints.device_id,
    hints.androidDeviceId,
    hints.licenseKey,
    hints.license_key,
    hints.terminal?.deviceId,
    hints.terminal?.device_id,
  ]);

  if (!terminalIds.length && !deviceIds.length) {
    return null;
  }

  const terminal = await prisma.terminal.findFirst({
    where: {
      ...(tenantId ? { tenantId } : {}),
      OR: [
        ...(terminalIds.length ? [{ id: { in: terminalIds } }] : []),
        ...(deviceIds.length ? [{ deviceId: { in: deviceIds } }] : []),
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

async function resolveSaleAuthContext(
  req: PosAuthRequest,
  hints: z.infer<typeof PosSaleSchema>
): Promise<ResolvedPosTerminalAuth | null> {
  const explicitAuth =
    (await lookupTerminalAuthByHints(hints, req.auth?.tenantId || null)) ||
    (await lookupTerminalAuthByHints(hints));

  if (req.auth?.tenantId && req.auth.terminalId && req.auth.deviceId) {
    if (
      explicitAuth &&
      (explicitAuth.terminalId !== req.auth.terminalId || explicitAuth.deviceId !== req.auth.deviceId)
    ) {
      console.warn("POS SALE TERMINAL OVERRIDE FROM PAYLOAD", {
        authTerminalId: req.auth.terminalId,
        authDeviceId: req.auth.deviceId,
        payloadTerminalId: explicitAuth.terminalId,
        payloadDeviceId: explicitAuth.deviceId,
      });
      return explicitAuth;
    }

    return {
      tenantId: req.auth.tenantId,
      terminalId: req.auth.terminalId,
      deviceId: req.auth.deviceId,
    };
  }

  const scopedSession = resolvePairedPosSession(req);
  if (scopedSession) {
    if (
      explicitAuth &&
      (explicitAuth.terminalId !== scopedSession.terminalId || explicitAuth.deviceId !== scopedSession.deviceId)
    ) {
      console.warn("POS SALE SCOPED SESSION OVERRIDE FROM PAYLOAD", {
        scopedTerminalId: scopedSession.terminalId,
        scopedDeviceId: scopedSession.deviceId,
        payloadTerminalId: explicitAuth.terminalId,
        payloadDeviceId: explicitAuth.deviceId,
      });
      return explicitAuth;
    }

    return {
      tenantId: scopedSession.tenantId,
      terminalId: scopedSession.terminalId,
      deviceId: scopedSession.deviceId,
    };
  }

  if (explicitAuth) {
    return explicitAuth;
  }

  // Do not fall back to the latest paired session for POS sales.
  // If a sale reaches this point without explicit terminal hints or a scoped/auth session,
  // attributing it globally can leak sales across devices and break device-specific dashboards.
  return null;
}

export async function handlePosOperatorsList(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  const operators = await prisma.user.findMany({
    where: {
      tenantId: auth.tenantId,
      isActive: true,
      role: { in: POS_OPERATOR_ROLES },
      NOT: { posPinHash: null },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
    },
  });

  return res.json({
    ok: true,
    items: operators.map((operator) => ({
      id: operator.id,
      name: operator.name,
      role: operator.role,
    })),
  });
}

export async function handlePosOperatorLogin(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  const parsed = PosOperatorLoginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const normalizedName = parsed.data.name.trim();

  const operators = await prisma.user.findMany({
    where: {
      tenantId: auth.tenantId,
      isActive: true,
      role: { in: POS_OPERATOR_ROLES },
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
      role: true,
      posPinHash: true,
    },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
  });

  const operator = operators.find((item) => Boolean(item.posPinHash)) || null;

  if (!operator || !operator.posPinHash) {
    return res.status(404).json({ ok: false, error: "Operatorul nu este disponibil pentru POS." });
  }

  const isValidPin = await verifySecret(parsed.data.pin, operator.posPinHash);
  if (!isValidPin) {
    return res.status(401).json({ ok: false, error: "PIN invalid." });
  }

  return res.json({
    ok: true,
    operator: {
      id: operator.id,
      name: operator.name,
      role: operator.role,
    },
  });
}

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
      let totalDiscountFc = 0;
      let totalVatFc = 0;
      let totalGrossFc = 0;
      let totalSgrFc = 0;

      for (const line of realLines) {
        const qty = toNumber(line.qty);
        const unitPriceGross = toNumber(line.unitPrice);
        const vatRate = toNumber(line.vatRate);
        const lineGrossBeforeDiscount = toNumber((line as any).lineTotalBeforeDiscount) || qty * unitPriceGross;
        const discountAmountFc = Math.max(0, toNumber((line as any).lineDiscountTotal));
        const lineGrossFc = Math.max(0, toNumber((line as any).lineTotalAfterDiscount) || (lineGrossBeforeDiscount - discountAmountFc));
        const discountPercent =
          lineGrossBeforeDiscount > 0
            ? Math.min(100, Math.max(0, toNumber((line as any).discountPercent) || (discountAmountFc * 100) / lineGrossBeforeDiscount))
            : 0;
        const unitPriceGrossAfterDiscount = qty > 0 ? lineGrossFc / qty : unitPriceGross;
        const lineNetFc = vatRate > 0 ? lineGrossFc / (1 + vatRate / 100) : lineGrossFc;
        const unitPriceNet = qty > 0 ? lineNetFc / qty : (vatRate > 0 ? unitPriceGrossAfterDiscount / (1 + vatRate / 100) : unitPriceGrossAfterDiscount);
        const lineVatFc = lineGrossFc - lineNetFc;
        const vatCategoryCode = vatRate > 0 ? "S" : "Z";

        totalNetFc += lineNetFc;
        totalDiscountFc += discountAmountFc;
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
            discountPercent,
            discountAmountFc,
            lineNetFc,
            lineVatFc,
            lineGrossFc,
            sgrUnitFc: 0,
            sgrTotalFc: 0,
            discountAmountRon: discountAmountFc,
            lineNetRon: lineNetFc,
            lineVatRon: lineVatFc,
            lineGrossRon: lineGrossFc,
            sgrTotalRon: 0,
          },
        });
      }

      const aggregatedSgrQty = sgrLines.reduce((sum, line) => sum + toNumber(line.qty), 0);
      const aggregatedSgrTotalFc = sgrLines.reduce((sum, line) => {
        const qty = toNumber(line.qty);
        const unitPriceFc = toNumber(line.unitPrice);
        return sum + qty * unitPriceFc;
      }, 0);

      if (aggregatedSgrQty > 0 && aggregatedSgrTotalFc > 0) {
        const aggregatedSgrUnitFc = aggregatedSgrTotalFc / aggregatedSgrQty;
        totalNetFc += aggregatedSgrTotalFc;
        totalGrossFc += aggregatedSgrTotalFc;
        totalSgrFc += aggregatedSgrTotalFc;

        await tx.salesInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: sgrLines[0]?.productId || null,
            productName: "SGR",
            productCode: "SGR",
            uomCode: "BUC",
            vatCategoryCode: "Z",
            qty: aggregatedSgrQty,
            unitPriceFc: aggregatedSgrUnitFc,
            vatRateValue: 0,
            discountPercent: 0,
            discountAmountFc: 0,
            lineNetFc: aggregatedSgrTotalFc,
            lineVatFc: 0,
            lineGrossFc: aggregatedSgrTotalFc,
            sgrUnitFc: 0,
            sgrTotalFc: 0,
            discountAmountRon: 0,
            lineNetRon: aggregatedSgrTotalFc,
            lineVatRon: 0,
            lineGrossRon: aggregatedSgrTotalFc,
            sgrTotalRon: 0,
          },
        });
      }

      const updated = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          totalNetFc,
          totalDiscountFc,
          totalVatFc,
          totalGrossFc,
          totalSgrFc,
          totalWithSgrFc: totalGrossFc,
          totalNetRon: totalNetFc,
          totalDiscountRon: totalDiscountFc,
          totalVatRon: totalVatFc,
          totalGrossRon: totalGrossFc,
          totalSgrRon: totalSgrFc,
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

    const saleIds = sales.map((sale) => sale.id);
    const invoices = saleIds.length
      ? await prisma.salesInvoice.findMany({
          where: {
            tenantId,
            companyId: company?.id || null,
            OR: saleIds.map((saleId) => ({
              note: {
                contains: `[POS-SALE:${saleId}]`,
              },
            })),
          },
          select: {
            id: true,
            docNo: true,
            status: true,
            note: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }],
        })
      : [];

    const invoiceBySaleId = new Map<string, { id: string; docNo: string; status: string }>();
    for (const invoice of invoices) {
      const match = String(invoice.note || "").match(/\[POS-SALE:([^\]]+)\]/);
      const saleId = match?.[1]?.trim();
      if (!saleId || invoiceBySaleId.has(saleId)) continue;
      invoiceBySaleId.set(saleId, {
        id: invoice.id,
        docNo: invoice.docNo,
        status: invoice.status,
      });
    }

    const items = sales.map((sale) => {
      const linkedInvoice = invoiceBySaleId.get(sale.id);
      return {
        id: sale.id,
        receiptNo: sale.receiptNo,
        clientSaleId: sale.clientSaleId,
        soldAt: sale.soldAt,
        total: toNumber(sale.total),
        subtotal: toNumber((sale as any).subtotal),
        merchandiseSubtotal: toNumber((sale as any).merchandiseSubtotal),
        sgrTotal: toNumber((sale as any).sgrTotal),
        discountTotal: toNumber((sale as any).discountTotal),
        lineDiscountTotal: toNumber((sale as any).lineDiscountTotal),
        cartDiscountTotal: toNumber((sale as any).cartDiscountTotal),
        cartDiscountPercent: toNumber((sale as any).cartDiscountPercent),
        paymentType: sale.paymentType,
        cashAmount: toNumber(sale.cashAmount),
        cardAmount: toNumber(sale.cardAmount),
        operatorName: sale.operatorName,
        invoiceId: linkedInvoice?.id || null,
        invoiceDocNo: linkedInvoice?.docNo || null,
        invoiceStatus: linkedInvoice?.status || null,
        invoiced: Boolean(linkedInvoice?.id),
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
              total: toNumber((line as any).lineTotalAfterDiscount) || qty * unitPrice,
              lineTotalBeforeDiscount: toNumber((line as any).lineTotalBeforeDiscount) || qty * unitPrice,
              discountPercent: toNumber((line as any).discountPercent),
              lineDiscountTotal: toNumber((line as any).lineDiscountTotal),
              isSgr: false,
            };
          }),
      };
    });

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
              tenantId_companyId_locationId_productId_warehouseScope: {
                tenantId,
                companyId: company?.id || null,
                locationId: terminal.locationId!,
                productId: product.id,
                warehouseScope: "__NO_WAREHOUSE__",
              },
            },
            update: {
              qty: { increment: stockQty },
              warehouseScope: "__NO_WAREHOUSE__",
            },
            create: {
              tenantId,
              companyId: company?.id || null,
              locationId: terminal.locationId!,
              warehouseScope: "__NO_WAREHOUSE__",
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

router.get("/api/v1/pos/cui-lookup", async (req: PosAuthRequest, res: Response) => {
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

router.get("/api/v1/pos/operators", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosOperatorsList(req, res);
});

router.post("/api/v1/pos/operators/login", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosOperatorLogin(req, res);
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

  const auth = await resolveSaleAuthContext(req, parsed.data);
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
    const lineTotalBeforeDiscount = toNumber(line.lineTotalBeforeDiscount) || qty * toNumber(line.unitPrice);
    const lineDiscountTotal = Math.max(0, toNumber(line.lineDiscountTotal));
    const lineTotalAfterDiscount = Math.max(0, toNumber(line.lineTotalAfterDiscount) || (lineTotalBeforeDiscount - lineDiscountTotal));
    const discountPercent =
      lineTotalBeforeDiscount > 0
        ? Math.min(100, Math.max(0, toNumber(line.discountPercent) || (lineDiscountTotal * 100) / lineTotalBeforeDiscount))
        : 0;

    const productLine = {
      type: "PRODUCT",
      productId: product.id,
      productName: product.name,
      label: product.name,
      qty,
      unitPrice: toNumber(line.unitPrice),
      vatRate: effectiveVatRate,
      total: lineTotalAfterDiscount,
      lineTotalBeforeDiscount,
      discountPercent,
      lineDiscountTotal,
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
  const normalizedSubtotal = toNumber(payload.subtotal) || totalProductLines + totalSgr;
  const normalizedMerchandiseSubtotal = toNumber(payload.merchandiseSubtotal) || totalProductLines;
  const normalizedSgrTotal = toNumber(payload.sgrTotal) || totalSgr;
  const normalizedLineDiscountTotal = Math.max(
    0,
    toNumber(payload.lineDiscountTotal) ||
      receiptLines
        .filter((line) => line.type === "PRODUCT")
        .reduce((sum, line) => sum + toNumber((line as any).lineDiscountTotal), 0)
  );
  const normalizedCartDiscountTotal = Math.max(0, toNumber(payload.cartDiscountTotal));
  const normalizedDiscountTotal = Math.max(
    0,
    toNumber(payload.discountTotal) || normalizedLineDiscountTotal + normalizedCartDiscountTotal
  );
  const normalizedCartDiscountPercent = Math.max(0, toNumber(payload.cartDiscountPercent));
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
        subtotal: new Prisma.Decimal(normalizedSubtotal),
        merchandiseSubtotal: new Prisma.Decimal(normalizedMerchandiseSubtotal),
        sgrTotal: new Prisma.Decimal(normalizedSgrTotal),
        discountTotal: new Prisma.Decimal(normalizedDiscountTotal),
        lineDiscountTotal: new Prisma.Decimal(normalizedLineDiscountTotal),
        cartDiscountTotal: new Prisma.Decimal(normalizedCartDiscountTotal),
        cartDiscountPercent: new Prisma.Decimal(normalizedCartDiscountPercent),
        paymentType: normalizedPaymentType,
        cashAmount: new Prisma.Decimal(normalizedCashAmount),
        cardAmount: new Prisma.Decimal(normalizedCardAmount),
        operatorName: payload.operatorName ? payload.operatorName.trim() : null,
      },
    });

    let consumptionDocId: string | null = null;
    const consumptionDraftLines: Array<{
      finishedProductId?: string | null;
      ingredientId: string;
      qty: Prisma.Decimal;
      note?: string | null;
    }> = [];

    for (const line of payload.lines) {
      const product = productMap.get(line.productId)!;
      const recipe = recipeMap.get(line.productId) || null;

      const qtyDecimal = new Prisma.Decimal(line.qty);
      const unitPriceDecimal = new Prisma.Decimal(line.unitPrice);
      const effectiveVatRate = isVatPayer ? toNumber(line.vatRate) : 0;
      const lineTotalBeforeDiscount = toNumber(line.lineTotalBeforeDiscount) || toNumber(line.qty) * toNumber(line.unitPrice);
      const lineDiscountTotal = Math.max(0, toNumber(line.lineDiscountTotal));
      const lineTotalAfterDiscount = Math.max(0, toNumber(line.lineTotalAfterDiscount) || (lineTotalBeforeDiscount - lineDiscountTotal));
      const lineDiscountPercent =
        lineTotalBeforeDiscount > 0
          ? Math.min(100, Math.max(0, toNumber(line.discountPercent) || (lineDiscountTotal * 100) / lineTotalBeforeDiscount))
          : 0;

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          qty: qtyDecimal,
          unitPrice: unitPriceDecimal,
          vatRate: effectiveVatRate,
          lineTotalBeforeDiscount: new Prisma.Decimal(lineTotalBeforeDiscount),
          discountPercent: new Prisma.Decimal(lineDiscountPercent),
          lineDiscountTotal: new Prisma.Decimal(lineDiscountTotal),
          lineTotalAfterDiscount: new Prisma.Decimal(lineTotalAfterDiscount),
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
            lineTotalBeforeDiscount: new Prisma.Decimal(toNumber(line.qty) * toNumber(product.sgrValue || 0.5)),
            discountPercent: new Prisma.Decimal(0),
            lineDiscountTotal: new Prisma.Decimal(0),
            lineTotalAfterDiscount: new Prisma.Decimal(toNumber(line.qty) * toNumber(product.sgrValue || 0.5)),
          },
        });
      }

      // For POS sales, if ERP has an active recipe we consume ingredients
      // directly from ERP stock, even if the product mode was left MANUAL
      // after a relink or partial product sync.
      const shouldConsumeRecipeAutomatically = recipe && recipe.items.length > 0;

      if (shouldConsumeRecipeAutomatically) {
        const lineQty = toNumber(line.qty);
        const recipeYield = Math.max(toNumber(recipe.yieldQty), 0.000001);

        for (const recipeItem of recipe.items) {
          const recipeQty = toNumber(recipeItem.qty);
          const lossPercent = toNumber(recipeItem.lossPercent);
          const ingredientQtyNumber = (lineQty * recipeQty / recipeYield) * (1 + lossPercent / 100);
          consumptionDraftLines.push({
            finishedProductId: product.id,
            ingredientId: recipeItem.ingredientId,
            qty: new Prisma.Decimal(ingredientQtyNumber),
            note: recipeItem.notes ? recipeItem.notes.trim() : null,
          });
        }
      } else {
        await decrementStockBalanceAllowNegative(tx, {
            tenantId,
            companyId: company?.id || null,
            locationId,
          productId: line.productId,
          qty: qtyDecimal,
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

    if (consumptionDraftLines.length) {
      const consumptionDoc = await createConsumptionDraft(tx, {
        tenantId,
        companyId: company?.id || null,
        locationId,
        source: "POS_RECIPE",
        saleId: sale.id,
        docDate: payload.soldAt ? new Date(payload.soldAt) : new Date(),
        note: `Generat automat din vanzare POS ${payload.receiptNo || sale.id}`,
        lines: consumptionDraftLines,
      });

      await validateConsumptionDoc(tx, {
        tenantId,
        companyId: company?.id || null,
        docId: consumptionDoc.id,
        actorId: null,
        allowNegativeStock: true,
      });

      consumptionDocId = consumptionDoc.id;
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

router.post("/api/v1/pos/sales", requirePosAuth, handlePosSale);
router.post("/api/v1/pos/receipts", requirePosAuth, handlePosSale);

export default router;





