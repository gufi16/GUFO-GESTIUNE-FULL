import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { ExternalOrderHistorySource, ExternalOrderStatus, KitchenTicketStatus, Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { decrementStockBalanceAllowNegative } from "../lib/stock";
import { getPrimaryTenantCompany } from "../lib/companyResolver";
import { getNextNumberPreview, reserveNextNumber } from "../lib/numbering";
import { getJwtSecret, verifySecret } from "../lib/auth";
import { createConsumptionDraft, validateConsumptionDoc } from "../lib/consumptionDocs";
import { hasTenantModule } from "../lib/tenantModules";

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

type JsonRecord = Record<string, unknown>;
type PosResolvedAuth = {
  tenantId: string;
  terminalId: string;
  deviceId: string;
};
type PosFallbackSource = "header" | "scopedSession" | "latestSession";
type PosFallbackResolution = {
  auth: PosResolvedAuth;
  source: PosFallbackSource;
};

type PosSaleLineLike = {
  qty?: unknown;
  unitPrice?: unknown;
  vatRate?: unknown;
  lineTotalBeforeDiscount?: unknown;
  lineDiscountTotal?: unknown;
  lineTotalAfterDiscount?: unknown;
  discountPercent?: unknown;
  productId?: string | null;
  product?: {
    id?: string | null;
    name?: string | null;
    sku?: string | null;
    isSgr?: unknown;
    sgrValue?: unknown;
    uom?: {
      code?: string | null;
      name?: string | null;
    } | null;
  } | null;
} | null;

type PosSaleLike = {
  id?: unknown;
  receiptNo?: unknown;
  soldAt?: unknown;
  clientSaleId?: unknown;
} | null;

type CatalogRecipeItemLike = {
  qty?: unknown;
  ingredientId?: unknown;
  ingredient?: {
    id?: unknown;
    sku?: unknown;
    name?: unknown;
  } | null;
};

type CatalogProductLike = {
  id: string;
  sku?: string | null;
  name?: string | null;
  imageUrl?: unknown;
  class?: string | null;
  price?: unknown;
  isActive?: unknown;
  isVisibleInPos?: unknown;
  isSgr?: unknown;
  sgrValue?: unknown;
  productionMode?: string | null;
  isMenu?: unknown;
  categoryId?: string | null;
  departmentId?: string | null;
  vatRate?: {
    id?: string | null;
    name?: string | null;
    rate?: unknown;
    fiscalCode?: string | null;
  } | null;
  uom?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
  } | null;
  department?: {
    id?: string | null;
    name?: string | null;
  } | null;
  category?: {
    id?: string | null;
    name?: string | null;
    imageUrl?: unknown;
    departmentId?: string | null;
    department?: {
      id?: string | null;
      name?: string | null;
    } | null;
  } | null;
  barcodes?: Array<{ barcode?: string | null }> | null;
  recipe?: {
    items?: CatalogRecipeItemLike[] | null;
  } | null;
};

type MarketplaceIntegrationLike = {
  settingsJson?: unknown;
};

type MarketplaceSettings = JsonRecord & {
  glovoChainId?: unknown;
  glovoDefaultPrepMinutes?: unknown;
  glovoClientId?: unknown;
  glovoClientSecret?: unknown;
  targetTerminalId?: unknown;
  targetTerminalDeviceId?: unknown;
  merchantName?: unknown;
  partnerName?: unknown;
};

type MarketplaceOrderItemLike = {
  qty?: unknown;
  unitPrice?: unknown;
  sku?: unknown;
};

type MarketplaceOrderLike = {
  id: string;
  platform?: unknown;
  total?: unknown;
  externalOrderId?: unknown;
  locationId?: unknown;
  placedAt?: unknown;
  status?: unknown;
  readyAt?: unknown;
  rawPayloadJson?: unknown;
  integration?: MarketplaceIntegrationLike | null;
  items?: MarketplaceOrderItemLike[] | null;
};

type GlovoUpdateItem = {
  pricing: {
    pricing_type: "UNIT";
    quantity: number;
    unit_price: number;
    weight: number;
  };
  status: "IN_CART";
  _id?: string;
  sku?: string;
};

type GlovoSyncResult = {
  skipped: boolean;
  reason?: string;
  error?: string;
  glovoStatus?: string;
  response?: unknown;
};

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function parseJsonText(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

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

function getPosToken(req: Request) {
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

  return {
    authHeader,
    token,
  };
}

function buildPosTokenPresence(req: Request, authHeader?: string) {
  const resolvedAuthHeader = authHeader ?? normalizeText(req.headers.authorization);
  return {
    authorization: Boolean(resolvedAuthHeader),
    xPosToken: Boolean(normalizeText(req.headers["x-pos-token"])),
    xAccessToken: Boolean(normalizeText(req.headers["x-access-token"])),
    posTokenHeader: Boolean(normalizeText(req.headers["pos-token"])),
    tokenHeader: Boolean(normalizeText(req.headers["token"])),
    posTokenUnderscoreHeader: Boolean(normalizeText(req.headers["pos_token"])),
    queryToken: Boolean(normalizeText(req.query.token)),
    queryPosToken: Boolean(normalizeText(req.query.pos_token)),
    queryAccessToken: Boolean(normalizeText(req.query.access_token)),
  };
}

function decodePosToken(token: string): PosResolvedAuth {
  return jwt.verify(token, JWT_SECRET) as PosResolvedAuth;
}

function applyPosAuth(req: PosAuthRequest, auth: PosResolvedAuth) {
  req.auth = auth;
  return auth;
}

function sessionToPosAuth(session: { tenantId: string; terminalId: string; deviceId: string }): PosResolvedAuth {
  return {
    tenantId: session.tenantId,
    terminalId: session.terminalId,
    deviceId: session.deviceId,
  };
}

function resolveScopedOrLatestSessionAuth(
  req: Request,
  options: { allowLatest: boolean }
): PosFallbackResolution | null {
  const scopedSession = resolvePairedPosSession(req);
  if (scopedSession) {
    return {
      auth: sessionToPosAuth(scopedSession),
      source: "scopedSession",
    };
  }

  if (!options.allowLatest) {
    return null;
  }

  const latestSession = resolveLatestPairedPosSession();
  if (!latestSession) {
    return null;
  }

  return {
    auth: sessionToPosAuth(latestSession),
    source: "latestSession",
  };
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

  const { token } = getPosToken(req);

  if (token) {
    try {
      return applyPosAuth(req, decodePosToken(token));
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

  const sessionResolution = resolveScopedOrLatestSessionAuth(req, { allowLatest: true });
  if (sessionResolution) {
    return sessionResolution.auth;
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
  const { authHeader, token } = getPosToken(req);

  if (!token) {
    const headerResolved = await resolvePosHeaderTerminalContext(req);
    if (headerResolved) {
      applyPosAuth(req, headerResolved);
      return next();
    }

    const sessionResolution = resolveScopedOrLatestSessionAuth(req, { allowLatest: true });
    if (sessionResolution) {
      applyPosAuth(req, sessionResolution.auth);
      console.warn(
        sessionResolution.source === "scopedSession"
          ? "POS AUTH FALLBACK SESSION"
          : "POS AUTH GLOBAL FALLBACK SESSION",
        {
        path: req.path,
        method: req.method,
          terminalId: sessionResolution.auth.terminalId,
          deviceId: sessionResolution.auth.deviceId,
        }
      );
      return next();
    }

    console.warn("POS AUTH MISSING TOKEN", {
      path: req.path,
      method: req.method,
      ...buildPosTokenPresence(req, authHeader),
    });
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  try {
    applyPosAuth(req, decodePosToken(token));
    next();
  } catch (error) {
    const headerResolved = await resolvePosHeaderTerminalContext(req);
    if (headerResolved) {
      applyPosAuth(req, headerResolved);
      return next();
    }

    const sessionResolution = resolveScopedOrLatestSessionAuth(req, { allowLatest: true });
    if (sessionResolution) {
      applyPosAuth(req, sessionResolution.auth);
      console.warn(
        sessionResolution.source === "scopedSession"
          ? "POS AUTH FALLBACK SESSION AFTER INVALID TOKEN"
          : "POS AUTH GLOBAL FALLBACK SESSION AFTER INVALID TOKEN",
        {
        path: req.path,
        method: req.method,
          terminalId: sessionResolution.auth.terminalId,
          deviceId: sessionResolution.auth.deviceId,
        }
      );
      return next();
    }

    console.warn("POS AUTH INVALID TOKEN", {
      path: req.path,
      method: req.method,
      tokenPreview: token.slice(0, 24),
      tokenLength: token.length,
      ...buildPosTokenPresence(req, authHeader),
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(401).json({ ok: false, error: "Invalid POS token" });
  }
}

function toNumber(value: unknown) {
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
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== "string") return {};
  try {
    return asObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseMarketplaceSettings(value: unknown) {
  return parseLooseJsonObject(value) as MarketplaceSettings;
}

function pickFirstNonBlank(...values: unknown[]) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function extractAnafCompanyPayload(entry: unknown) {
  const source = asObject(entry);
  const general = asObject(source.date_generale);
  const headquarters = asObject(source.adresa_sediu_social);
  const registration = asObject(source.inregistrare_RTVAI || source.inregistrare_scop_Tva);

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
    return configured
      .replace(/\/+$/, "")
      .replace(/^http:\/\//i, "https://")
      .replace("://app.gufo.ink", "://api.gufo.ink")
      .replace("://test.gufo.ink", "://api.gufo.ink");
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
  const apiBaseUrl = baseUrl
    .replace("://app.gufo.ink", "://api.gufo.ink")
    .replace("://test.gufo.ink", "://api.gufo.ink");

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

function buildSgrLine(product: CatalogProductLike | null | undefined, qty: number) {
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
    lineDiscountTotal: 0,
    lineTotalBeforeDiscount: total,
    lineTotalAfterDiscount: total,
    discountPercent: 0,
    isSgr,
  };
}

function isSyntheticSgrSaleLine(line: PosSaleLineLike) {
  if (!line?.product?.isSgr) return false;
  const unitPrice = toNumber(line?.unitPrice);
  const sgrValue = toNumber(line?.product?.sgrValue || 0.5);
  return toNumber(line?.vatRate) === 0 && Math.abs(unitPrice - sgrValue) < 0.0001;
}

function buildInvoiceFromSaleNote(sale: PosSaleLike, userNote?: string) {
  const parts = [
    normalizeText(userNote),
    `Factura emisa dupa bon fiscal ${normalizeText(sale?.receiptNo) || sale?.id || "-"}`,
    sale?.soldAt ? `Data bon: ${new Date(String(sale.soldAt)).toISOString()}` : "",
    `[POS-SALE:${sale?.id || ""}]`,
    sale?.clientSaleId ? `[POS-CLIENT-SALE:${sale.clientSaleId}]` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function mapCatalogProduct(req: Request, product: CatalogProductLike, isVatPayer: boolean) {
  const recipeItems = Array.isArray(product.recipe?.items) ? product.recipe.items : [];
  const effectiveDepartment =
    product.category?.department ||
    product.department ||
    null;
  const effectiveDepartmentId =
    product.category?.departmentId ||
    effectiveDepartment?.id ||
    product.departmentId ||
    null;
  const menuComponents =
    product.isMenu === true
      ? recipeItems
          .map((item: CatalogRecipeItemLike) => {
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
    department: effectiveDepartment
      ? {
          id: effectiveDepartment.id,
          name: effectiveDepartment.name,
        }
      : null,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          image: resolveImageUrl(req, product.category.imageUrl),
          departmentId: effectiveDepartmentId,
        }
      : null,
    categoryId: product.categoryId || null,
    departmentId: effectiveDepartmentId,
    sgrLabel: product.isSgr ? "SGR" : null,
    isMenu: Boolean(product.isMenu),
    menuComponents,
    barcodes: Array.isArray(product.barcodes)
      ? product.barcodes.map((barcode: { barcode?: string | null }) => barcode.barcode)
      : [],
  };
}

export async function buildCatalogPayload(req: Request, tenantId: string) {
  const authReq = req as PosAuthRequest;
  const terminalId = normalizeText(authReq.auth?.terminalId);
  const requestedCursor = normalizeText(req.query.cursor ?? req.query.since);
  const company = await getPrimaryTenantCompany(tenantId, {
    select: {
      id: true,
      isVatPayer: true,
    },
  });

  const isVatPayer = company?.isVatPayer ?? true;
  const scopedWhere = company?.id
    ? {
        tenantId,
        OR: [{ companyId: company.id }, { companyId: null }],
      }
    : {
        tenantId,
        companyId: null,
      };

  const departments = await prisma.department.findMany({
    where: {
      isActive: true,
      ...scopedWhere,
    },
    orderBy: { name: "asc" },
  });

  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      isVisibleInPos: true,
      ...scopedWhere,
    },
    include: {
      department: true,
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });

  const rawProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      isVisibleInPos: true,
      ...scopedWhere,
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
      category: {
        include: {
          department: true,
        },
      },
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

  const terminal = terminalId
    ? await prisma.terminal.findUnique({
        where: { id: terminalId },
        select: {
          id: true,
          departmentAccesses: { select: { departmentId: true } },
          categoryAccesses: { select: { categoryId: true } },
          productAccesses: { select: { productId: true } },
        },
      })
    : null;

  const selectedDepartmentIds = new Set(terminal?.departmentAccesses.map((item) => item.departmentId) || []);
  const selectedCategoryIds = new Set(terminal?.categoryAccesses.map((item) => item.categoryId) || []);
  const selectedProductIds = new Set(terminal?.productAccesses.map((item) => item.productId) || []);

  const filtersEnabled =
    selectedDepartmentIds.size > 0 || selectedCategoryIds.size > 0 || selectedProductIds.size > 0;

  const directProducts = filtersEnabled
    ? rawProducts.filter((product) => selectedProductIds.has(product.id))
    : [];

  const effectiveCategoryIds = new Set<string>(selectedCategoryIds);
  const effectiveDepartmentIds = new Set<string>(selectedDepartmentIds);

  for (const category of categories) {
    if (category.departmentId && selectedDepartmentIds.has(category.departmentId)) {
      effectiveCategoryIds.add(category.id);
    }
  }

  for (const product of directProducts) {
    if (product.categoryId) {
      effectiveCategoryIds.add(product.categoryId);
    }
    if (product.departmentId) {
      effectiveDepartmentIds.add(product.departmentId);
    }
    if (product.category?.departmentId) {
      effectiveDepartmentIds.add(product.category.departmentId);
    }
  }

  for (const category of categories) {
    if (effectiveCategoryIds.has(category.id) && category.departmentId) {
      effectiveDepartmentIds.add(category.departmentId);
    }
  }

  const visibleDepartments = filtersEnabled
    ? departments.filter((department) => effectiveDepartmentIds.has(department.id))
    : departments;

  const visibleCategories = filtersEnabled
    ? categories.filter((category) => {
        if (effectiveCategoryIds.has(category.id)) return true;
        return category.departmentId ? effectiveDepartmentIds.has(category.departmentId) : false;
      })
    : categories;

  const visibleProducts = filtersEnabled
    ? rawProducts.filter((product) => {
        if (selectedProductIds.has(product.id)) return true;
        if (product.categoryId && effectiveCategoryIds.has(product.categoryId)) return true;
        if (product.departmentId && effectiveDepartmentIds.has(product.departmentId)) return true;
        if (product.category?.departmentId && effectiveDepartmentIds.has(product.category.departmentId)) return true;
        return false;
      })
    : rawProducts;

  const products = visibleProducts.map((product) => mapCatalogProduct(req, product, isVatPayer));
  const latestProductUpdate =
    visibleProducts.reduce<number>(
      (latest, product) => Math.max(latest, new Date(product.updatedAt).getTime()),
      0
    ) || Date.now();

  const normalizedCategories = visibleCategories.map((category) => ({
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
    departments: visibleDepartments,
    categories: normalizedCategories,
    products,
    items: products,
    changes: {
      departments: visibleDepartments,
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

const LicenseActivateSchema = z.object({
  license_key: z.string().min(6),
  device_id: z.string().min(3),
  app_version: z.string().min(1),
  location_code: z.string().optional(),
});

async function findActiveLicenseByKey(licenseKey: string) {
  const normalized = normalizeText(licenseKey);
  if (!normalized) return null;

  const candidates = await prisma.license.findMany({
    where: {
      isSuspended: false,
      expiresAt: { gt: new Date() },
    },
    include: {
      tenant: true,
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(normalized, candidate.keyHash);
    if (matches) {
      return candidate;
    }
  }

  return null;
}

async function resolveTerminalFromPublicLicense(input: {
  licenseKey: string;
  deviceId?: string | null;
  requestedDeviceType?: "POS" | "KDS";
  terminalLabel?: string | null;
}) {
  const normalizedLicenseKey = normalizeText(input.licenseKey);
  const normalizedDeviceId = normalizeText(input.deviceId);
  const requestedDeviceType = input.requestedDeviceType || "POS";
  const terminalLabel = normalizeText(input.terminalLabel);

  let terminal = await prisma.terminal.findFirst({
    where: {
      deviceId: normalizedLicenseKey,
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

  if (terminal) {
    return {
      terminal,
      license: terminal.tenant.licenses[0] || null,
      matchedBy: "terminal-license-key" as const,
    };
  }

  const matchedLicense = await findActiveLicenseByKey(normalizedLicenseKey);
  if (!matchedLicense || !normalizedDeviceId) {
    return {
      terminal: null,
      license: matchedLicense,
      matchedBy: matchedLicense ? ("license-only" as const) : ("none" as const),
    };
  }

  terminal = await prisma.terminal.findFirst({
    where: {
      tenantId: matchedLicense.tenantId,
      deviceId: normalizedDeviceId,
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
    terminal = await prisma.terminal.create({
      data: {
        tenantId: matchedLicense.tenantId,
        companyId: null,
        locationId: null,
        deviceId: normalizedDeviceId,
        deviceType: requestedDeviceType,
        label: terminalLabel || (requestedDeviceType === "KDS" ? "GuFo KDS" : "Android POS"),
        isLockedToLocation: true,
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
  } else if (terminal.deviceType !== requestedDeviceType || (terminalLabel && terminal.label !== terminalLabel)) {
    terminal = await prisma.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceType: requestedDeviceType,
        ...(terminalLabel ? { label: terminalLabel } : {}),
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
  }

  return {
    terminal,
    license: matchedLicense,
    matchedBy: "license-hash" as const,
  };
}

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
  payload: z.unknown().optional(),
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

const PosBackofficeInvoiceSchema = z.object({
  customerId: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  customerCode: z.string().optional().nullable(),
  customerCif: z.string().optional().nullable(),
  customerAddress: z.string().optional().nullable(),
  customerEmail: z.string().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      qty: z.number().positive(),
      unitPriceFc: z.number().min(0),
      vatRateValue: z.number().min(0).max(100).optional(),
    })
  ).min(1),
});

const PosBackofficeConsumptionSchema = z.object({
  locationId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  postNow: z.boolean().optional().default(true),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      qty: z.number().positive(),
      note: z.string().optional().nullable(),
    })
  ).min(1),
});

const PosBackofficeTransferSchema = z.object({
  fromLocationId: z.string().optional().nullable(),
  toLocationId: z.string().min(1),
  note: z.string().optional().nullable(),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      qty: z.number().positive(),
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

    const terminalModuleEnabled =
      terminal.deviceType === "KDS"
        ? license.modKds
        : terminal.deviceType === "DEPOZIT"
          ? await hasTenantModule(terminal.tenantId, "warehouse_mobile")
          : license.modPos;
    if (!terminalModuleEnabled) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error:
          terminal.deviceType === "KDS"
            ? "KDS nu este activ"
            : terminal.deviceType === "DEPOZIT"
              ? "Gufo Depozit nu este activ"
              : "POS nu este activ",
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

router.post("/api/v1/license/activate", async (req: Request, res: Response) => {
  const parsed = LicenseActivateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const license_key = parsed.data.license_key.trim();
  const device_id = parsed.data.device_id.trim();
  const app_version = parsed.data.app_version.trim();
  const location_code = parsed.data.location_code?.trim();

  const candidates = await prisma.license.findMany({
    where: {
      isSuspended: false,
      expiresAt: { gt: new Date() },
    },
    include: {
      tenant: true,
    },
    take: 100,
  });

  let found: (typeof candidates)[number] | null = null;

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(license_key, candidate.keyHash);
    if (matches) {
      found = candidate;
      break;
    }
  }

  if (!found) {
    return res.status(401).json({
      ok: false,
      valid: false,
      error: "Invalid or expired license",
    });
  }

  let locationId: string | null = null;

  if (location_code) {
    const location = await prisma.location.findFirst({
      where: {
        tenantId: found.tenantId,
        code: location_code,
      },
    });
    if (location) {
      locationId = location.id;
    }
  }

  const terminalCompanyId = locationId
    ? (
        await prisma.location.findFirst({
          where: { id: locationId, tenantId: found.tenantId },
          select: { companyId: true },
        })
      )?.companyId ?? null
    : null;

  const existingTerminal = await prisma.terminal.findFirst({
    where: {
      tenantId: found.tenantId,
      companyId: terminalCompanyId,
      deviceId: device_id,
    },
  });

  const terminal = existingTerminal
    ? await prisma.terminal.update({
        where: { id: existingTerminal.id },
        data: {
          locationId: locationId ?? undefined,
          label: `Android POS (${app_version})`,
        },
      })
    : await prisma.terminal.create({
        data: {
          tenantId: found.tenantId,
          companyId: terminalCompanyId ?? undefined,
          deviceId: device_id,
          locationId: locationId ?? undefined,
          label: `Android POS (${app_version})`,
          isLockedToLocation: true,
        },
      });

  const pos_token = signPosToken({
    tenantId: found.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId,
  });

  return res.json({
    ok: true,
    valid: true,
    tenant_id: found.tenantId,
    terminal_id: terminal.id,
    pos_token,
    modules: {
      pos: found.modPos,
      inventory: found.modInventory,
      documents: found.modDocuments,
    },
  });
});

router.post("/api/v1/pos/pair", async (req: Request, res: Response) => {
  console.log("ðŸ”¥ POS PAIR NOU HIT", req.body);

  try {
    const parsed = PairSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const body = parsed.data;
    const normalizedSource = normalizeText(body.source)?.toLowerCase() || "";
    const isWarehouseMobilePair = normalizedSource === "gufo-depozit";
    const requestedDeviceType =
      normalizeText(body.deviceType ?? body.device_type)?.toUpperCase() === "DEPOZIT" || isWarehouseMobilePair
        ? "DEPOZIT"
        : normalizeText(body.deviceType ?? body.device_type)?.toUpperCase() === "KDS" || normalizedSource === "gufo-kds"
        ? "KDS"
        : "POS";
    const licenseKey = normalizeText(body.licenseKey ?? body.license_key);
    const incomingDeviceId = normalizeText(body.deviceId ?? body.device_id);
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) ||
      (requestedDeviceType === "KDS" ? "GuFo KDS" : requestedDeviceType === "DEPOZIT" ? "Gufo Depozit" : "Android POS");

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
        error:
          requestedDeviceType === "KDS"
            ? "Licenta KDS invalida"
            : requestedDeviceType === "DEPOZIT"
              ? "Licenta Gufo Depozit invalida"
              : "Licenta POS invalida",
      });
    }

    const terminalModuleEnabled =
      terminal.deviceType === "KDS"
        ? license.modKds
        : terminal.deviceType === "DEPOZIT"
          ? await hasTenantModule(terminal.tenantId, "warehouse_mobile")
          : license.modPos;
    if (!terminalModuleEnabled) {
      return res.status(403).json({
        ok: false,
        error:
          terminal.deviceType === "KDS"
            ? "KDS nu este activ"
            : terminal.deviceType === "DEPOZIT"
              ? "Gufo Depozit nu este activ"
              : "POS nu este activ",
      });
    }

    if (isWarehouseMobilePair) {
      const warehouseMobileEnabled = await hasTenantModule(terminal.tenantId, "warehouse_mobile");
      if (!warehouseMobileEnabled) {
        return res.status(403).json({
          ok: false,
          error: "Gufo Depozit nu este activ pe licenta acestui client",
        });
      }
    }

    if (incomingDeviceId && incomingDeviceId !== terminal.deviceId) {
      console.warn("POS PAIR DEVICE MISMATCH", {
        incomingDeviceId,
        licenseKey,
        terminalDeviceId: terminal.deviceId,
      });
    }

    if (terminalLabel && !normalizeText(terminal.label) && terminal.label !== terminalLabel) {
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
        companyId: terminal.companyId || terminal.location?.companyId || null,
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
        label: terminal.label || terminalLabel,
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
        companyId: currentTerminal?.companyId || null,
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
      const hintedLocationId = normalizeText(data.locationId) || null;
      const primaryCompany = await getPrimaryTenantCompany(auth.tenantId, {
        select: { id: true },
      });
      const hintedLocation =
        !terminal.locationId && hintedLocationId
          ? await prisma.location.findFirst({
              where: {
                id: hintedLocationId,
                tenantId: auth.tenantId,
                isActive: true,
              },
              select: {
                id: true,
                name: true,
                companyId: true,
              },
            })
          : null;
      const resolvedLocationId = terminal.locationId || hintedLocation?.id || hintedLocationId || null;
      const resolvedLocationName = terminal.location?.name || hintedLocation?.name || null;
      const resolvedCompanyId =
        terminal.companyId ||
        terminal.location?.companyId ||
        hintedLocation?.companyId ||
        primaryCompany?.id ||
        null;
      const parsedClosedAt = data.closedAt ? new Date(data.closedAt) : new Date();
      const closedAt = Number.isNaN(parsedClosedAt.getTime()) ? new Date() : parsedClosedAt;
      let total = toNumber(data.total);
      let cashTotal = toNumber(data.cashTotal);
      let cardTotal = toNumber(data.cardTotal);
      let otherTotal = toNumber(data.otherTotal);
      const clientProvidedTotals = Boolean(asObject(data.payload).clientTotals);

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
          locationName: resolvedLocationName,
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

function getIntegrationSettingsObject(integration: MarketplaceIntegrationLike | null | undefined): MarketplaceSettings {
  return integration?.settingsJson && typeof integration.settingsJson === "object" ? (integration.settingsJson as MarketplaceSettings) : {};
}

function normalizeGlovoTransportType(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LOGISTICS" || normalized === "LOGISTICS_DELIVERY") return "LOGISTICS_DELIVERY";
  if (normalized === "VENDOR" || normalized === "VENDOR_DELIVERY") return "VENDOR_DELIVERY";
  return normalized || null;
}

function getGlovoChainIdForOrder(order: MarketplaceOrderLike | null | undefined) {
  const raw = asObject(order?.rawPayloadJson);
  const rawClient = asObject(raw.client);
  const settings = getIntegrationSettingsObject(order?.integration);
  return String(rawClient.chain_id || raw.chain_id || settings.glovoChainId || "").trim() || null;
}

function getGlovoOrderUuid(order: MarketplaceOrderLike | null | undefined) {
  const raw = asObject(order?.rawPayloadJson);
  return String(raw?.order_id || raw?.id || order?.externalOrderId || "").trim() || null;
}

function getGlovoAcceptedFor(order: MarketplaceOrderLike | null | undefined) {
  const raw = asObject(order?.rawPayloadJson);
  const acceptedRaw = String(raw?.accepted_for || raw?.promised_for || "").trim();
  if (acceptedRaw) {
    const parsed = new Date(acceptedRaw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const settings = getIntegrationSettingsObject(order?.integration);
  const prepMinutes = Number(settings?.glovoDefaultPrepMinutes || 0);
  if (prepMinutes > 0) {
      const base = order?.placedAt ? new Date(String(order.placedAt)) : new Date();
    if (!Number.isNaN(base.getTime())) {
      base.setMinutes(base.getMinutes() + prepMinutes);
      return base.toISOString();
    }
  }

  return null;
}

function buildGlovoUpdateItems(order: MarketplaceOrderLike | null | undefined) {
  const raw = asObject(order?.rawPayloadJson);
  const rawItems = Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(raw?.products)
      ? raw.products
      : [];
  const fallbackItems = Array.isArray(order?.items) ? order.items : [];

  const normalized = rawItems.length ? rawItems : fallbackItems;
  return normalized
    .map((item: unknown, index: number) => {
      const rawItem = asObject(item);
      const fallbackOrderItem = fallbackItems[index];
      const itemPricing = asObject(rawItem.pricing);
      const itemOriginalPricing = asObject(rawItem.original_pricing);
      const quantity = Number(itemPricing.quantity ?? rawItem.quantity ?? rawItem.qty ?? fallbackOrderItem?.qty ?? 1) || 1;
      const unitPrice = Number(
        itemPricing.unit_price ??
        itemOriginalPricing.unit_price ??
        rawItem.unit_price ??
        rawItem.price ??
        fallbackOrderItem?.unitPrice ??
        0
      ) || 0;
      const payloadItem: GlovoUpdateItem = {
        pricing: {
          pricing_type: "UNIT",
          quantity,
          unit_price: unitPrice,
          weight: Number(itemPricing.weight ?? itemOriginalPricing.weight ?? 0) || 0,
        },
        status: "IN_CART",
      };
      const rawId = String(rawItem._id || rawItem.id || "").trim();
      const rawSku = String(rawItem.sku || fallbackOrderItem?.sku || rawItem.product_id || rawItem.externalProductId || "").trim();
      if (rawId) payloadItem._id = rawId;
      if (rawSku) payloadItem.sku = rawSku;
      if (!payloadItem._id && !payloadItem.sku) return null;
      return payloadItem;
    })
    .filter(Boolean);
}

async function requestGlovoPartnerAccessToken(integration: MarketplaceIntegrationLike | null | undefined) {
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
  const payload = parseJsonText(text);
  const payloadObject = asObject(payload);

  if (!response.ok) {
    throw new Error(String(payloadObject.message || payloadObject.error_description || `Glovo OAuth failed with ${response.status}`));
  }

  const token = String(payloadObject.access_token || "").trim();
  if (!token) {
    throw new Error("Glovo OAuth nu a returnat access_token.");
  }

  return token;
}

function decideGlovoOutboundStatus(order: MarketplaceOrderLike | null | undefined, nextInternalStatus: string) {
  const transportType = normalizeGlovoTransportType(asObject(order?.rawPayloadJson).transport_type);
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
  order: MarketplaceOrderLike,
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

  const body: JsonRecord = {
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
  const payload = parseJsonText(text);
  const payloadObject = asObject(payload);

  if (!response.ok) {
    throw new Error(
      String(
      payloadObject.message ||
      payloadObject.error ||
      payloadObject.detail ||
      `Glovo Update Order failed with ${response.status}`
      )
    );
  }

  await createPosMarketplaceHistory(
    auth,
    order.id,
    nextInternalStatus as ExternalOrderStatus,
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
  order: MarketplaceOrderLike,
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
  const payload = parseJsonText(text);
  const payloadObject = asObject(payload);

  if (!response.ok) {
    throw new Error(
      String(
      payloadObject.message ||
      payloadObject.error ||
      payloadObject.detail ||
      `Glovo Cancel Order failed with ${response.status}`
      )
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

function getMarketplaceTargetTerminalId(integration: MarketplaceIntegrationLike | null | undefined) {
  const value = getIntegrationSettingsObject(integration).targetTerminalId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getMarketplaceTargetTerminalDeviceId(integration: MarketplaceIntegrationLike | null | undefined) {
  const value = getIntegrationSettingsObject(integration).targetTerminalDeviceId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveMarketplaceTargetTerminal(integration: MarketplaceIntegrationLike | null | undefined) {
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

async function isMarketplaceOrderVisibleToTerminal(order: MarketplaceOrderLike | null | undefined, auth: NonNullable<PosAuthRequest["auth"]>) {
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

async function getMarketplaceVisibilityDebug(order: MarketplaceOrderLike | null | undefined, auth: NonNullable<PosAuthRequest["auth"]>) {
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

export async function resolvePosMarketplaceOrder<TInclude extends Prisma.ExternalOrderInclude>(
  auth: NonNullable<PosAuthRequest["auth"]>,
  inputOrderId: string,
  include?: TInclude
): Promise<Prisma.ExternalOrderGetPayload<{ include: TInclude & Prisma.ExternalOrderInclude }> | null> {
  const mergedInclude = {
    location: {
      select: { id: true, name: true, code: true },
    },
    integration: {
      select: {
        id: true,
        settingsJson: true,
        locationId: true,
      },
    },
    saleDraft: {
      select: { id: true, status: true, total: true, subtotal: true, updatedAt: true },
    },
    kitchenTicket: {
      select: { id: true, status: true, displayNumber: true, readyAt: true, updatedAt: true },
    },
    ...(include || {}),
  } as TInclude & Prisma.ExternalOrderInclude;

  const order = await prisma.externalOrder.findFirst({
    where: {
      tenantId: auth.tenantId,
      OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
    },
    include: mergedInclude,
  });
  if (!order) return null;
  return (await isMarketplaceOrderVisibleToTerminal(order, auth))
    ? (order as Prisma.ExternalOrderGetPayload<{ include: TInclude & Prisma.ExternalOrderInclude }>)
    : null;
}

export async function createPosMarketplaceHistory(
  auth: NonNullable<PosAuthRequest["auth"]>,
  externalOrderId: string,
  status: ExternalOrderStatus,
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
          ...asObject(payloadJson),
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
      source: normalizedSource as ExternalOrderHistorySource,
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

  const terminal = await resolvePosMarketplaceTerminalLocation(auth);

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

  const terminal = await resolvePosMarketplaceTerminalLocation(auth);

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
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

  let glovoSync: GlovoSyncResult = { skipped: true, reason: "not-run" };
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
  } catch (error: unknown) {
    glovoSync = {
      skipped: false,
      error: error instanceof Error ? error.message : "Glovo accept sync failed.",
    };
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

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
          ? ({ status: KitchenTicketStatus.READY, readyAt: now } satisfies Prisma.KitchenTicketUpdateInput)
          : normalizedStatus === "IN_KITCHEN"
            ? ({ status: KitchenTicketStatus.IN_PROGRESS } satisfies Prisma.KitchenTicketUpdateInput)
            : normalizedStatus === "ACKNOWLEDGED"
                ? ({ status: KitchenTicketStatus.NEW } satisfies Prisma.KitchenTicketUpdateInput)
                : ({ status: KitchenTicketStatus.NEW } satisfies Prisma.KitchenTicketUpdateInput);
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

  let glovoSync: GlovoSyncResult = { skipped: true, reason: "not-run" };
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
  } catch (error: unknown) {
    glovoSync = {
      skipped: false,
      error: error instanceof Error ? error.message : "Glovo KDS sync failed.",
    };
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
      integration: {
        select: {
          id: true,
          settingsJson: true,
          locationId: true,
        },
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
          parseMarketplaceSettings(order.integration?.settingsJson).merchantName,
          parseMarketplaceSettings(order.integration?.settingsJson).partnerName,
          order.location?.name
        ) || null,
        deliveryAddress: pickFirstNonBlank(
          asObject(asObject(parseLooseJsonObject(order.rawPayloadJson).delivery).address).label,
          asObject(asObject(parseLooseJsonObject(order.rawPayloadJson).customer).address).label,
          asObject(parseLooseJsonObject(order.rawPayloadJson).address).label,
          asObject(parseLooseJsonObject(order.rawPayloadJson).delivery_address).label,
          asObject(parseLooseJsonObject(order.rawPayloadJson).deliveryAddress).label,
          parseLooseJsonObject(order.rawPayloadJson).deliveryAddress
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
          asObject(parseLooseJsonObject(order.rawPayloadJson).courier).name,
          parseLooseJsonObject(order.rawPayloadJson)?.courier_name,
          parseLooseJsonObject(order.rawPayloadJson)?.courierName
        ) || null,
        courierPhone: pickFirstNonBlank(
          asObject(parseLooseJsonObject(order.rawPayloadJson).courier).phone,
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

  paymentType: z.enum(["CASH", "CARD", "MIXED", "MODERN", "PAID"]).optional(),
  cashAmount: z.number().optional(),
  cardAmount: z.number().optional(),
  otherAmount: z.number().optional(),
  otherTotal: z.number().optional(),
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

  const sessionResolution = resolveScopedOrLatestSessionAuth(req, { allowLatest: false });
  if (sessionResolution) {
    if (
      explicitAuth &&
      (explicitAuth.terminalId !== sessionResolution.auth.terminalId ||
        explicitAuth.deviceId !== sessionResolution.auth.deviceId)
    ) {
      console.warn("POS SALE SCOPED SESSION OVERRIDE FROM PAYLOAD", {
        scopedTerminalId: sessionResolution.auth.terminalId,
        scopedDeviceId: sessionResolution.auth.deviceId,
        payloadTerminalId: explicitAuth.terminalId,
        payloadDeviceId: explicitAuth.deviceId,
      });
      return explicitAuth;
    }

    return sessionResolution.auth;
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
  } catch (error: unknown) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut interoga serviciul ANAF pentru CUI.",
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
      ...(company?.id ? { companyId: company.id } : {}),
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

  let customer: Prisma.CustomerGetPayload<object> | null = null;
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
        const lineGrossBeforeDiscount = toNumber(line.lineTotalBeforeDiscount) || qty * unitPriceGross;
        const discountAmountFc = Math.max(0, toNumber(line.lineDiscountTotal));
        const lineGrossFc = Math.max(0, toNumber(line.lineTotalAfterDiscount) || (lineGrossBeforeDiscount - discountAmountFc));
        const discountPercent =
          lineGrossBeforeDiscount > 0
            ? Math.min(100, Math.max(0, toNumber(line.discountPercent) || (discountAmountFc * 100) / lineGrossBeforeDiscount))
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
        const sgrProductId = sgrLines[0]?.productId;
        if (!sgrProductId) {
          throw new Error("Lipsește produsul sursă pentru linia SGR agregată.");
        }
        const aggregatedSgrUnitFc = aggregatedSgrTotalFc / aggregatedSgrQty;
        totalNetFc += aggregatedSgrTotalFc;
        totalGrossFc += aggregatedSgrTotalFc;
        totalSgrFc += aggregatedSgrTotalFc;

        await tx.salesInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: sgrProductId,
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
        subtotal: toNumber(sale.subtotal),
        merchandiseSubtotal: toNumber(sale.merchandiseSubtotal),
        sgrTotal: toNumber(sale.sgrTotal),
        discountTotal: toNumber(sale.discountTotal),
        lineDiscountTotal: toNumber(sale.lineDiscountTotal),
        cartDiscountTotal: toNumber(sale.cartDiscountTotal),
        cartDiscountPercent: toNumber(sale.cartDiscountPercent),
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
              total: toNumber(line.lineTotalAfterDiscount) || qty * unitPrice,
              lineTotalBeforeDiscount: toNumber(line.lineTotalBeforeDiscount) || qty * unitPrice,
              discountPercent: toNumber(line.discountPercent),
              lineDiscountTotal: toNumber(line.lineDiscountTotal),
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

    const saleWhere: Prisma.SaleWhereInput = {
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
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        barcodes: {
          select: {
            barcode: true,
          },
        },
      },
      orderBy: [{ name: "asc" }],
      take: q ? 40 : 250,
    });

    return res.json({
      ok: true,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku || null,
        vatRateValue: toNumber(product.vatRate?.rate),
        defaultCost: toNumber(product.costPrice),
        salePrice: toNumber(product.price),
        uomCode: product.purchaseUom?.code || product.uom?.code || "",
        categoryId: product.category?.id || null,
        categoryName: product.category?.name || null,
        barcodes: Array.isArray(product.barcodes)
          ? product.barcodes.map((item) => normalizeText(item?.barcode)).filter(Boolean)
          : [],
      })),
    });
  } catch (error) {
    console.error("POS BACKOFFICE PRODUCTS ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut cauta produsele." });
  }
}

export async function handlePosBackofficeStockLive(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  try {
    const q = normalizeText(req.query.q).slice(0, 60);
    const terminal = auth.terminalId
      ? await prisma.terminal.findUnique({
          where: { id: auth.terminalId },
          select: { locationId: true },
        })
      : null;

    const grouped = await prisma.stockBalance.groupBy({
      by: ["productId"],
      where: {
        tenantId,
        companyId: company.id,
        ...(terminal?.locationId ? { locationId: terminal.locationId } : {}),
      },
      _sum: { qty: true },
    });

    const productIds = grouped.map((item) => item.productId).filter(Boolean);
    if (!productIds.length) {
      return res.json({ ok: true, items: [] });
    }

    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId: company.id,
        isActive: true,
        id: { in: productIds },
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
        uom: true,
        category: {
          select: {
            name: true,
          },
        },
        department: {
          select: {
            name: true,
          },
        },
        barcodes: {
          select: {
            barcode: true,
          },
        },
      },
      orderBy: [{ name: "asc" }],
      take: q ? 120 : 300,
    });

    const qtyByProductId = new Map(grouped.map((item) => [item.productId, toNumber(item._sum.qty)]));

    return res.json({
      ok: true,
      items: products.map((product) => ({
        productId: product.id,
        name: product.name,
        sku: product.sku || null,
        uomCode: product.uom?.code || "",
        categoryName: product.category?.name || null,
        departmentName: product.department?.name || null,
        totalQty: qtyByProductId.get(product.id) || 0,
        barcodes: Array.isArray(product.barcodes)
          ? product.barcodes.map((item) => normalizeText(item?.barcode)).filter(Boolean)
          : [],
      })),
    });
  } catch (error) {
    console.error("POS BACKOFFICE STOCK LIVE ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut incarca stocul live." });
  }
}

export async function handlePosBackofficeLocationsList(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const tenantId = auth.tenantId;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  try {
    const locations = await prisma.location.findMany({
      where: {
        tenantId,
        companyId: company.id,
        isActive: true,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
      },
    });

    return res.json({
      ok: true,
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        code: location.code || null,
      })),
    });
  } catch (error) {
    console.error("POS BACKOFFICE LOCATIONS ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut incarca locatiile." });
  }
}

export async function handlePosBackofficeNumberPreviews(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;

  try {
    const [invoice, receipt, transfer, consumption] = await Promise.all([
      getNextNumberPreview(auth.tenantId, "invoice"),
      getNextNumberPreview(auth.tenantId, "purchaseReceipt"),
      getNextNumberPreview(auth.tenantId, "transfer"),
      getNextNumberPreview(auth.tenantId, "consumption"),
    ]);

    return res.json({
      ok: true,
      previews: {
        invoice: invoice.value,
        receipt: receipt.value,
        transfer: transfer.value,
        consumption: consumption.value,
      },
    });
  } catch (error) {
    console.error("POS BACKOFFICE NUMBER PREVIEWS ERROR", error);
    return res.status(500).json({ ok: false, error: "Nu am putut calcula urmatoarele numere de document." });
  }
}

export async function handlePosBackofficeConsumptionCreate(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId || !auth?.terminalId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const parsed = PosBackofficeConsumptionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const tenantId = auth.tenantId;
  const terminal = await prisma.terminal.findUnique({
    where: { id: auth.terminalId },
    select: { locationId: true },
  });
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  const payload = parsed.data;
  const locationId = normalizeText(payload.locationId) || normalizeText(terminal?.locationId);
  if (!locationId) {
    return res.status(400).json({ ok: false, error: "Terminalul nu are locatie selectata pentru bonul de consum." });
  }

  try {
    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        companyId: company.id,
      },
      select: { id: true, name: true },
    });

    if (!location) {
      return res.status(404).json({ ok: false, error: "Locatia selectata nu exista." });
    }

    const productIds = payload.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId: company.id,
        id: { in: productIds },
      },
      select: { id: true },
    });
    const productIdsSet = new Set(products.map((item) => item.id));
    const missing = productIds.find((item) => !productIdsSet.has(item));
    if (missing) {
      return res.status(400).json({ ok: false, error: "Unul dintre produsele selectate nu mai exista." });
    }

    const created = await prisma.$transaction(async (tx) => {
      const draft = await createConsumptionDraft(tx, {
        tenantId,
        companyId: company.id,
        locationId,
        warehouseId: null,
        docDate: new Date(),
        note: normalizeText(payload.note) || null,
        source: "MANUAL",
        lines: payload.items.map((item) => ({
          ingredientId: item.productId,
          qty: item.qty,
          note: normalizeText(item.note) || null,
        })),
      });

      if (payload.postNow) {
        await validateConsumptionDoc(tx, {
          tenantId,
          companyId: company.id,
          docId: draft.id,
          actorId: null,
        });
        return tx.consumptionDoc.findUnique({
          where: { id: draft.id },
          select: {
            id: true,
            docNo: true,
            status: true,
          },
        });
      }

      return {
        id: draft.id,
        docNo: draft.docNo,
        status: draft.status,
      };
    });

    return res.status(201).json({
      ok: true,
      item: {
        id: created?.id,
        docNo: created?.docNo,
        status: created?.status,
        locationId: location.id,
        locationName: location.name,
      },
    });
  } catch (error) {
    console.error("POS BACKOFFICE CONSUMPTION ERROR", error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut salva bonul de consum.",
    });
  }
}

export async function handlePosBackofficeTransferCreate(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId || !auth?.terminalId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const parsed = PosBackofficeTransferSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const tenantId = auth.tenantId;
  const terminal = await prisma.terminal.findUnique({
    where: { id: auth.terminalId },
    select: { locationId: true },
  });
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });

  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  const payload = parsed.data;
  const fromLocationId = normalizeText(payload.fromLocationId) || normalizeText(terminal?.locationId);
  const toLocationId = normalizeText(payload.toLocationId);
  if (!fromLocationId) {
    return res.status(400).json({ ok: false, error: "Terminalul nu are locatie sursa selectata." });
  }
  if (!toLocationId) {
    return res.status(400).json({ ok: false, error: "Selecteaza locatia destinatie." });
  }
  if (fromLocationId === toLocationId) {
    return res.status(400).json({ ok: false, error: "Locatia sursa si destinatia trebuie sa fie diferite." });
  }

  try {
    const [fromLocation, toLocation] = await Promise.all([
      prisma.location.findFirst({
        where: { id: fromLocationId, tenantId, companyId: company.id },
        select: { id: true, name: true },
      }),
      prisma.location.findFirst({
        where: { id: toLocationId, tenantId, companyId: company.id },
        select: { id: true, name: true },
      }),
    ]);

    if (!fromLocation || !toLocation) {
      return res.status(404).json({ ok: false, error: "Una dintre locatii nu exista." });
    }

    const productIds = payload.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId: company.id,
        id: { in: productIds },
      },
      select: { id: true, name: true, uom: { select: { code: true } } },
    });
    const productMap = new Map(products.map((item) => [item.id, item]));

    const transferNo = await reserveNextNumber(prisma, tenantId, "transfer");
    await prisma.$transaction(async (tx) => {
      for (const line of payload.items) {
        const product = productMap.get(line.productId);
        if (!product) {
          throw new Error("Unul dintre produsele selectate nu mai exista.");
        }

        const sourceBalance = await tx.stockBalance.findUnique({
          where: {
            tenantId_companyId_locationId_productId_warehouseScope: {
              tenantId,
              companyId: company.id,
              locationId: fromLocationId,
              productId: line.productId,
              warehouseScope: "__NO_WAREHOUSE__",
            },
          },
        });

        const availableQty = Number(sourceBalance?.qty || 0);
        if (availableQty < line.qty) {
          throw new Error(
            `Stoc insuficient pentru ${product.name}. Disponibil: ${availableQty.toFixed(2)} ${product.uom?.code || ""}`.trim()
          );
        }

        await tx.stockBalance.update({
          where: {
            tenantId_companyId_locationId_productId_warehouseScope: {
              tenantId,
              companyId: company.id,
              locationId: fromLocationId,
              productId: line.productId,
              warehouseScope: "__NO_WAREHOUSE__",
            },
          },
          data: {
            qty: {
              decrement: line.qty,
            },
          },
        });

        await tx.stockBalance.upsert({
          where: {
            tenantId_companyId_locationId_productId_warehouseScope: {
              tenantId,
              companyId: company.id,
              locationId: toLocationId,
              productId: line.productId,
              warehouseScope: "__NO_WAREHOUSE__",
            },
          },
          update: {
            qty: {
              increment: line.qty,
            },
            warehouseScope: "__NO_WAREHOUSE__",
          },
          create: {
            tenantId,
            companyId: company.id,
            locationId: toLocationId,
            productId: line.productId,
            qty: line.qty,
            warehouseScope: "__NO_WAREHOUSE__",
          },
        });

        await tx.stockMove.create({
          data: {
            tenantId,
            companyId: company.id,
            locationId: fromLocationId,
            productId: line.productId,
            type: "OUT",
            qty: line.qty,
            refType: "TRANSFER",
            refId: transferNo,
            note: normalizeText(payload.note) || `Transfer ${transferNo} catre ${toLocation.name}`,
          },
        });

        await tx.stockMove.create({
          data: {
            tenantId,
            companyId: company.id,
            locationId: toLocationId,
            productId: line.productId,
            type: "IN",
            qty: line.qty,
            refType: "TRANSFER",
            refId: transferNo,
            note: normalizeText(payload.note) || `Transfer ${transferNo} din ${fromLocation.name}`,
          },
        });
      }
    });

    return res.status(201).json({
      ok: true,
      item: {
        transferNo,
        fromLocationId: fromLocation.id,
        fromLocationName: fromLocation.name,
        toLocationId: toLocation.id,
        toLocationName: toLocation.name,
        lines: payload.items.length,
      },
    });
  } catch (error) {
    console.error("POS BACKOFFICE TRANSFER ERROR", error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut salva transferul.",
    });
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
  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  try {
    const terminal = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, locationId: true },
    });

    if (!terminal?.locationId) {
      return res.status(400).json({ ok: false, error: "Terminal fara locatie selectata." });
    }

    let supplier: Prisma.SupplierGetPayload<object> | null = null;
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
                companyId: company.id,
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

export async function handlePosBackofficeInvoiceCreate(req: PosAuthRequest, res: Response) {
  const auth = await resolvePosAuthContext(req);
  if (!auth?.tenantId || !auth?.terminalId) {
    return res.status(401).json({ ok: false, error: "POS neautentificat." });
  }

  req.auth = auth;
  const parsed = PosBackofficeInvoiceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const tenantId = auth.tenantId;
  const terminalId = auth.terminalId;
  const payload = parsed.data;
  const company = await getPrimaryTenantCompany(tenantId, {
    select: { id: true },
  });
  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

  try {
    const terminal = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, locationId: true },
    });

    if (!terminal?.locationId) {
      return res.status(400).json({ ok: false, error: "Terminal fara locatie selectata." });
    }

    let customer: Prisma.CustomerGetPayload<object> | null = null;
    if (normalizeText(payload.customerId)) {
      customer = await prisma.customer.findFirst({
        where: {
          id: normalizeText(payload.customerId),
          tenantId,
          companyId: company.id,
        },
      });
      if (!customer) {
        return res.status(404).json({ ok: false, error: "Clientul nu a fost gasit." });
      }
    }

    const customerName = normalizeText(customer?.name || payload.customerName);
    if (!customerName) {
      return res.status(400).json({ ok: false, error: "Clientul este obligatoriu." });
    }

    const productIds = payload.items.map((item) => normalizeText(item.productId));
    const dbProducts = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
        companyId: company.id,
      },
      include: {
        vatRate: true,
        uom: true,
      },
    });

    const productMap = new Map(dbProducts.map((product) => [product.id, product]));

    for (const item of payload.items) {
      if (!productMap.get(normalizeText(item.productId))) {
        return res.status(404).json({ ok: false, error: "Un produs din factura nu a fost gasit." });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const docNo = await reserveNextNumber(tx, tenantId, "invoice");
      const invoice = await tx.salesInvoice.create({
        data: {
          tenantId,
          companyId: company.id,
          locationId: terminal.locationId!,
          customerId: customer?.id || null,
          docNo,
          docDate: new Date(),
          dueDate: new Date(),
          customerName,
          customerCode: customer?.code || normalizeText(payload.customerCode) || null,
          customerCif: customer?.cif || normalizeText(payload.customerCif) || null,
          customerRegNo: customer?.regNo || null,
          customerAddress: customer?.address || normalizeText(payload.customerAddress) || null,
          customerEmail: customer?.email || normalizeText(payload.customerEmail) || null,
          customerPhone: customer?.phone || normalizeText(payload.customerPhone) || null,
          currency: "RON",
          fxRate: 1,
          note: normalizeText(payload.note) || null,
          status: "ISSUED",
        },
      });

      let totalNetFc = 0;
      let totalVatFc = 0;
      let totalGrossFc = 0;

      for (const rawItem of payload.items) {
        const product = productMap.get(normalizeText(rawItem.productId))!;
        const qty = toNumber(rawItem.qty);
        const unitPriceFc = toNumber(rawItem.unitPriceFc);
        const vatRateValue =
          rawItem.vatRateValue !== undefined ? toNumber(rawItem.vatRateValue) : toNumber(product.vatRate?.rate);
        const lineNetFc = qty * unitPriceFc;
        const lineVatFc = (lineNetFc * vatRateValue) / 100;
        const lineGrossFc = lineNetFc + lineVatFc;

        totalNetFc += lineNetFc;
        totalVatFc += lineVatFc;
        totalGrossFc += lineGrossFc;

        await tx.salesInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: product.id,
            productName: product.name,
            productCode: product.sku || null,
            uomCode: product.uom?.code || null,
            uomStandardCode: product.uom?.code || null,
            vatCategoryCode: vatRateValue > 0 ? "S" : "Z",
            qty,
            unitPriceFc,
            vatRateValue,
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

      return tx.salesInvoice.update({
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
    });

    return res.status(201).json({
      ok: true,
      invoiceId: created.id,
      docNo: created.docNo,
      status: created.status,
      total: Number(created.totalGrossRon || 0),
    });
  } catch (error) {
    console.error("POS BACKOFFICE INVOICE CREATE ERROR", error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Nu am putut salva factura din POS.",
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

router.get("/api/v1/pos/backoffice/stock-live", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeStockLive(req, res);
});

router.get("/api/v1/pos/backoffice/locations", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeLocationsList(req, res);
});

router.get("/api/v1/pos/backoffice/number-previews", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeNumberPreviews(req, res);
});

router.post("/api/v1/pos/backoffice/receipts", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeReceiptCreate(req, res);
});

router.post("/api/v1/pos/backoffice/invoices", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeInvoiceCreate(req, res);
});

router.post("/api/v1/pos/backoffice/consumption", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeConsumptionCreate(req, res);
});

router.post("/api/v1/pos/backoffice/transfers", requirePosAuth, async (req: PosAuthRequest, res: Response) => {
  return handlePosBackofficeTransferCreate(req, res);
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
  if (!company?.id) {
    return res.status(400).json({ ok: false, error: "Nu exista firma activa pentru acest terminal." });
  }

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

  const productIdentifiers = payload.lines.map((line) => normalizeText(line.productId)).filter(Boolean);

  const dbProducts = await prisma.product.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
        OR: [
          { id: { in: productIdentifiers } },
          { sku: { in: productIdentifiers } },
        ],
      },
    include: {
      vatRate: true,
      category: true,
      uom: true,
    },
  });

  const productMap = new Map<string, (typeof dbProducts)[number]>();
  dbProducts.forEach((product) => {
    productMap.set(product.id, product);
    productMap.set(normalizeText(product.sku), product);
  });

  for (const line of payload.lines) {
    const product = productMap.get(normalizeText(line.productId));
    if (!product) {
      return res.status(404).json({ ok: false, error: "Produs inexistent in vanzare." });
    }
  }

  const recipes = await prisma.recipe.findMany({
      where: {
        tenantId,
        companyId: company?.id || null,
        productId: { in: dbProducts.map((product) => product.id) },
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
    const product = productMap.get(normalizeText(line.productId))!;
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

  const rawPaymentType = String(payload.paymentType || "CASH").toUpperCase();
  const normalizedPaymentType =
    rawPaymentType === "MODERN" || rawPaymentType === "PAID"
      ? "CARD"
      : rawPaymentType === "CASH" || rawPaymentType === "CARD" || rawPaymentType === "MIXED"
      ? rawPaymentType
      : "CASH";
  const normalizedSubtotal = toNumber(payload.subtotal) || totalProductLines + totalSgr;
  const normalizedMerchandiseSubtotal = toNumber(payload.merchandiseSubtotal) || totalProductLines;
  const normalizedSgrTotal = toNumber(payload.sgrTotal) || totalSgr;
  const normalizedLineDiscountTotal = Math.max(
    0,
    toNumber(payload.lineDiscountTotal) ||
      receiptLines
        .filter((line) => line.type === "PRODUCT")
        .reduce((sum, line) => sum + toNumber(line.lineDiscountTotal), 0)
  );
  const normalizedCartDiscountTotal = Math.max(0, toNumber(payload.cartDiscountTotal));
  const normalizedDiscountTotal = Math.max(
    0,
    toNumber(payload.discountTotal) || normalizedLineDiscountTotal + normalizedCartDiscountTotal
  );
  const normalizedCartDiscountPercent = Math.max(0, toNumber(payload.cartDiscountPercent));
  const rawCashAmount = payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null;
  const rawCardAmount = payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null;
  const rawOtherAmount =
    payload.otherAmount !== undefined
      ? toNumber(payload.otherAmount)
      : payload.otherTotal !== undefined
      ? toNumber(payload.otherTotal)
      : null;

  const normalizedCashAmount =
    rawCashAmount !== null
      ? rawCashAmount
      : normalizedPaymentType === "CASH"
      ? totalWithSgr
      : normalizedPaymentType === "MIXED"
      ? 0
      : 0;

  const normalizedCardAmount =
    normalizedPaymentType === "CARD"
      ? rawCardAmount !== null && rawCardAmount > 0
        ? rawCardAmount
        : rawOtherAmount !== null && rawOtherAmount > 0
        ? rawOtherAmount
        : totalWithSgr
      : rawCardAmount !== null
      ? rawCardAmount
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
      const product = productMap.get(normalizeText(line.productId))!;
      const recipe = recipeMap.get(product.id) || null;

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
          productId: product.id,
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
            productId: product.id,
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
            companyId: company.id,
            locationId,
          productId: product.id,
          qty: qtyDecimal,
        });

        await tx.stockMove.create({
            data: {
              tenantId,
              companyId: company.id,
              locationId,
            productId: product.id,
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





