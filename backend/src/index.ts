// @ts-nocheck
import express from "express"
import cors from "cors"
import morgan from "morgan"
import cookieParser from "cookie-parser"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { z } from "zod"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { ensureUploadSubdir, getUploadsRoot } from "./lib/uploads"
import { loadEnv } from "./lib/loadEnv"

import { prisma } from "./lib/prisma"
import { getPrimaryTenantCompany } from "./lib/companyResolver"
import { getJwtSecret, hashSecret, signAccessToken, verifySecret } from "./lib/auth"
import { writeAuditLogFromRequest, writeExplicitAuditLog } from "./lib/audit"
import { requireAuth, AuthedRequest } from "./middleware/requireAuth"
import { hasSmtpConfig, sendMail } from "./lib/mailer"
import { repairDeepStrings } from "./lib/textRepair"
import { hasGlobalControlPanelOwnerAccess } from "./lib/tenantAdmin"

import productsRouter from "./routes/products"
import metaRouter from "./routes/meta"
import posRouter, { buildCatalogPayload, createPosMarketplaceHistory, handlePosBackofficeProductsSearch, handlePosBackofficeReceiptCreate, handlePosBackofficeSalesSummary, handlePosBackofficeSuppliersSearch, handlePosCustomersSearch, handlePosDailyClosure, handlePosOperatorLogin, handlePosOperatorsList, handlePosReceiptInvoice, handlePosReceiptsList, handlePosSale, normalizePosMarketplaceKdsStatus, registerPairedPosSession, resolvePosAuthContext, resolvePosMarketplaceOrder, syncGlovoPartnerCancellationForOrder, syncGlovoPartnerStatusForOrder } from "./routes/pos"
import stockRouter from "./routes/stock"
import purchaseRouter from "./routes/purchase"
import companyRouter, { handleAnafOauthCallback } from "./routes/company"
import purchaseReceiptsPdf from "./routes/purchaseReceiptsPdf"
import transferRouter from "./routes/transfer"
import dashboardRoutes from "./routes/dashboard"
import consumptionRouter from "./routes/consumption"
import consumptionDocsPdf from "./routes/consumptionDocsPdf"
import productionRouter from "./routes/production"
import productionDocsRouter from "./routes/productionDocs"
import inventoryRouter from "./routes/inventory"
import inventoryDocsPdf from "./routes/inventoryDocsPdf"
import reportsRouter from "./routes/reports"
import accountingExportRouter from "./routes/accountingExport"
import adminRouter from "./routes/admin"
import marketplaceRouter from "./routes/marketplace"
import salesInvoicesRouter from "./routes/salesInvoices"
import customersRouter from "./routes/customers"
import minutesDocsRouter from "./routes/minutesDocs"
import incomingEfacturaRouter from "./routes/incomingEfactura"
import spvClassicRouter from "./routes/spvClassic"
import usersRouter from "./routes/users"
import auditRouter from "./routes/audit"
import gufoAiRouter from "./routes/gufoAi"
import financeRouter from "./routes/finance"
import backupsRouter from "./routes/backups"
import eTransportRegistryRouter from "./routes/etrransport"

loadEnv()

const app = express()
app.set("trust proxy", true)
const PORT = Number(process.env.PORT || 3001)
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
const CORS_ORIGINS = CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean)
const ALLOW_DEV_CONTROL_PANEL_LOGIN = process.env.ALLOW_DEV_CONTROL_PANEL_LOGIN === "true"
const JWT_SECRET = getJwtSecret()
const authRateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const AUTH_RATE_LIMITS = {
  erpLogin: 10,
  controlPanelLogin: 8,
  forgotPassword: 6,
} as const

const uploadsDir = getUploadsRoot()
ensureUploadSubdir("products")
ensureUploadSubdir("categories")

const ERP_AUTH_COOKIE = "gufo_erp_session"
const CONTROL_AUTH_COOKIE = "gufo_control_session"
const ERP_CSRF_COOKIE = "gufo_erp_csrf"
const CONTROL_CSRF_COOKIE = "gufo_control_csrf"
const WEB_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

if (!String(process.env.UPLOADS_DIR || "").trim()) {
  console.warn(
    `[uploads] UPLOADS_DIR is not set. Files are stored in ${uploadsDir}. ` +
      `In Docker production you should mount this path persistently, otherwise rebuilds can remove uploaded files.`
  )
}

function isSecureCookieRequest(req: express.Request) {
  const originHost = getOriginHostname(req)
  const requestHost = getRequestHostname(req)
  const host = originHost || requestHost
  return !/^(localhost|127\.0\.0\.1)$/i.test(host)
}

function buildAuthCookieOptions(req: express.Request) {
  const secure = isSecureCookieRequest(req)
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  }
}

function buildCsrfCookieOptions(req: express.Request) {
  const secure = isSecureCookieRequest(req)
  return {
    httpOnly: false,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: WEB_SESSION_TTL_MS,
  }
}

function setErpAuthCookie(req: express.Request, res: express.Response, token: string) {
  res.cookie(ERP_AUTH_COOKIE, token, buildAuthCookieOptions(req))
}

function clearErpAuthCookie(req: express.Request, res: express.Response) {
  res.clearCookie(ERP_AUTH_COOKIE, {
    ...buildAuthCookieOptions(req),
    maxAge: undefined,
  })
}

function setErpCsrfCookie(req: express.Request, res: express.Response, token: string) {
  res.cookie(ERP_CSRF_COOKIE, token, buildCsrfCookieOptions(req))
}

function clearErpCsrfCookie(req: express.Request, res: express.Response) {
  res.clearCookie(ERP_CSRF_COOKIE, {
    ...buildCsrfCookieOptions(req),
    maxAge: undefined,
  })
}

function setControlAuthCookie(req: express.Request, res: express.Response, token: string) {
  res.cookie(CONTROL_AUTH_COOKIE, token, buildAuthCookieOptions(req))
}

function clearControlAuthCookie(req: express.Request, res: express.Response) {
  res.clearCookie(CONTROL_AUTH_COOKIE, {
    ...buildAuthCookieOptions(req),
    maxAge: undefined,
  })
}

function setControlCsrfCookie(req: express.Request, res: express.Response, token: string) {
  res.cookie(CONTROL_CSRF_COOKIE, token, buildCsrfCookieOptions(req))
}

function clearControlCsrfCookie(req: express.Request, res: express.Response) {
  res.clearCookie(CONTROL_CSRF_COOKIE, {
    ...buildCsrfCookieOptions(req),
    maxAge: undefined,
  })
}

function createBrowserCsrfToken() {
  return crypto.randomBytes(24).toString("hex")
}

async function createWebSession(input: {
  tenantId?: string | null
  userId?: string | null
  role: string
  email?: string | null
  activeCompanyId?: string | null
  controlPanel?: boolean
}) {
  return prisma.webSession.create({
    data: {
      tenantId: input.tenantId || null,
      userId: input.userId || null,
      role: input.role,
      email: input.email || null,
      activeCompanyId: input.activeCompanyId || null,
      controlPanel: Boolean(input.controlPanel),
      expiresAt: new Date(Date.now() + WEB_SESSION_TTL_MS),
    },
  })
}

async function touchWebSession(sessionId?: string | null, patch?: { activeCompanyId?: string | null }) {
  if (!sessionId) return null
  return prisma.webSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      ...(patch && Object.prototype.hasOwnProperty.call(patch, "activeCompanyId")
        ? { activeCompanyId: patch.activeCompanyId ?? null }
        : {}),
      expiresAt: new Date(Date.now() + WEB_SESSION_TTL_MS),
    },
  })
}

async function revokeWebSession(sessionId?: string | null) {
  if (!sessionId) return
  await prisma.webSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })
}

function shouldValidateCsrf(req: express.Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return false
  if (!req.path.startsWith("/api/")) return false
  if (
    req.path === "/api/v1/auth/login" ||
    req.path === "/api/v1/admin/auth/login" ||
    req.path === "/api/v1/auth/forgot-password" ||
    req.path === "/api/v1/auth/reset-password"
  ) {
    return false
  }
  if (String(req.headers.authorization || "").startsWith("Bearer ")) return false
  return Boolean(req.cookies?.[ERP_AUTH_COOKIE] || req.cookies?.[CONTROL_AUTH_COOKIE])
}

app.disable("etag")

function getHostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function isAllowedOrigin(origin?: string) {
  if (!origin) return true
  if (CORS_ORIGINS.includes(origin)) return true

  const hostname = getHostnameFromUrl(origin)
  if (!hostname) return false

  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return true
  if (hostname === "app.gufo.ink" || hostname === "test.gufo.ink" || hostname === "api.gufo.ink") return true
  if (hostname.endsWith(".gufo.ink")) return true

  return false
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
)
app.use((req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader("Surrogate-Control", "no-store")
  }
  next()
})
app.use(express.json({ limit: "10mb" }))
app.use(cookieParser())
app.use(morgan("dev"))
app.use("/uploads", express.static(uploadsDir))
app.use((req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = ((body: any) => originalJson(repairDeepStrings(body))) as typeof res.json
  next()
})
app.use((req, res, next) => {
  res.on("finish", () => {
    void writeAuditLogFromRequest(req as AuthedRequest, res).catch((error) => {
      console.error("audit-log-write-failed", error)
    })
  })
  next()
})
app.use((req, res, next) => {
  if (!shouldValidateCsrf(req)) {
    return next()
  }

  const expectedToken =
    String(req.cookies?.[ERP_CSRF_COOKIE] || "").trim() ||
    String(req.cookies?.[CONTROL_CSRF_COOKIE] || "").trim()
  const providedToken = String(req.headers["x-csrf-token"] || "").trim()

  if (!expectedToken || !providedToken || expectedToken !== providedToken) {
    return res.status(403).json({
      ok: false,
      error: "CSRF validation failed",
    })
  }

  return next()
})

function signPosToken(payload: { tenantId: string; terminalId: string; deviceId: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" })
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

const ACTIVE_MARKETPLACE_ORDER_STATUSES = [
  "RECEIVED",
  "ACKNOWLEDGED",
  "IN_KITCHEN",
  "READY",
  "READY_FOR_FISCAL",
] as const

function parseMarketplaceSettings(settingsJson: unknown) {
  if (!settingsJson) return {}
  if (typeof settingsJson === "object") return settingsJson as Record<string, any>
  if (typeof settingsJson !== "string") return {}
  try {
    return JSON.parse(settingsJson) as Record<string, any>
  } catch {
    return {}
  }
}

function parseLooseJsonObject(value: unknown) {
  if (!value) return {}
  if (typeof value === "object") return value as Record<string, any>
  if (typeof value !== "string") return {}
  try {
    return JSON.parse(value) as Record<string, any>
  } catch {
    return {}
  }
}

function pickFirstNonBlank(...values: unknown[]) {
  for (const value of values) {
    const text = normalizeText(value)
    if (text) return text
  }
  return ""
}

async function resolveMarketplacePosAuth(req: express.Request) {
  const resolved = await resolvePosAuthContext(req as any)
  if (resolved?.tenantId) {
    return resolved
  }

  const terminalId = normalizeText(req.query.terminalId)
  const licenseKey = normalizeText(req.query.licenseKey)
  const terminalDeviceId = normalizeText(req.query.terminalDeviceId)
  const androidDeviceId = normalizeText(req.query.deviceId)

  if (!terminalId && !licenseKey && !terminalDeviceId && !androidDeviceId) {
    return null
  }

  const terminal = await prisma.terminal.findFirst({
    where: {
      OR: [
        ...(terminalId ? [{ id: terminalId }] : []),
        ...(licenseKey ? [{ deviceId: licenseKey }] : []),
        ...(terminalDeviceId ? [{ deviceId: terminalDeviceId }] : []),
        ...(androidDeviceId ? [{ deviceId: androidDeviceId }] : []),
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
  })

  if (!terminal) {
    console.warn("INDEX MARKETPLACE AUTH MISS", {
      terminalId,
      licenseKey,
      terminalDeviceId,
      androidDeviceId,
      path: req.path,
    })
    return null
  }

  const license = terminal.tenant?.licenses?.[0]
  if (license && (license.isSuspended || license.expiresAt <= new Date())) {
    return null
  }

  console.warn("INDEX MARKETPLACE AUTH FALLBACK", {
    terminalId,
    licenseKey,
    terminalDeviceId,
    androidDeviceId,
    resolvedTerminalId: terminal.id,
    resolvedTerminalDeviceId: terminal.deviceId,
    path: req.path,
  })

  return {
    tenantId: terminal.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId,
  }
}

async function resolveMarketplaceTerminalLocationId(terminalId?: string | null) {
  if (!terminalId) return ""
  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    select: { locationId: true, label: true, deviceId: true },
  })
  return terminal?.locationId || ""
}

function computeMarketplaceVisibility(
  order: any,
  auth: { terminalId?: string; deviceId?: string },
  terminalLocationId: string
) {
  const settings = parseMarketplaceSettings(order?.integration?.settingsJson)
  const targetTerminalId = normalizeText(settings?.targetTerminalId)
  const targetTerminalDeviceId = normalizeText(settings?.targetTerminalDeviceId)
  const explicitTarget = Boolean(targetTerminalId || targetTerminalDeviceId)
  const matchesTerminalId = !!(targetTerminalId && auth.terminalId && targetTerminalId === auth.terminalId)
  const matchesDeviceId = !!(targetTerminalDeviceId && auth.deviceId && targetTerminalDeviceId === auth.deviceId)
  const locationMatches = !order?.integration?.locationId || order.integration.locationId === terminalLocationId
  const visible = explicitTarget ? matchesTerminalId || matchesDeviceId : locationMatches
  const reason = explicitTarget
    ? matchesTerminalId
      ? "matched-terminal-id"
      : matchesDeviceId
        ? "matched-device-id"
        : "target-mismatch"
    : locationMatches
      ? "matched-location"
      : "location-mismatch"
  return {
    visible,
    reason,
    authTerminalId: auth.terminalId || null,
    authDeviceId: auth.deviceId || null,
    targetTerminalId: targetTerminalId || null,
    targetTerminalDeviceId: targetTerminalDeviceId || null,
  }
}

function normalizeSubdomain(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

function getRateLimitKey(req: express.Request, scope: string, identifier?: string | null) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim()
  const ip = forwardedFor || req.ip || "unknown-ip"
  const id = String(identifier || "").trim().toLowerCase()
  return id ? `${scope}:${ip}:${id}` : `${scope}:${ip}`
}

function checkSimpleRateLimit(
  req: express.Request,
  res: express.Response,
  scope: keyof typeof AUTH_RATE_LIMITS,
  identifier?: string | null
) {
  const now = Date.now()
  const key = getRateLimitKey(req, scope, identifier)
  const limit = AUTH_RATE_LIMITS[scope]
  const bucket = authRateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    authRateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    res.setHeader("Retry-After", String(retryAfterSeconds))
    res.status(429).json({
      ok: false,
      error: "Prea multe incercari. Reincearca in cateva minute.",
    })
    return false
  }

  bucket.count += 1
  authRateLimitBuckets.set(key, bucket)
  return true
}

function getRequestHostname(req: express.Request) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
  return forwardedHost.replace(/:\d+$/, "")
}

function getOriginHostname(req: express.Request) {
  const origin = String(req.headers.origin || "").trim()
  if (origin) return getHostnameFromUrl(origin)

  const referer = String(req.headers.referer || "").trim()
  if (referer) return getHostnameFromUrl(referer)

  return ""
}

function getTenantSubdomainFromHostname(hostname: string) {
  if (!hostname) return null
  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return null
  if (hostname === "gufo.ink" || hostname === "app.gufo.ink" || hostname === "test.gufo.ink" || hostname === "api.gufo.ink") return null
  if (!hostname.endsWith(".gufo.ink")) return null

  const parts = hostname.split(".")
  if (parts.length < 3) return null

  const subdomain = parts[0]
  if (!subdomain || ["app", "api", "www", "admin", "cp"].includes(subdomain)) return null
  return subdomain
}

function getTenantSubdomainFromRequest(req: express.Request) {
  const hostnames = [getRequestHostname(req), getOriginHostname(req)]

  for (const hostname of hostnames) {
    const subdomain = getTenantSubdomainFromHostname(hostname)
    if (subdomain) return subdomain
  }

  return null
}

async function listTenantCompanies(tenantId?: string | null) {
  if (!tenantId) return []
  return prisma.company.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      cui: true,
      isDefault: true,
    },
  })
}

async function listAccessibleCompaniesForUser(user: {
  id: string
  tenantId?: string | null
  role?: string | null
}) {
  const companies = await listTenantCompanies(user.tenantId)
  if (!companies.length) return companies

  if (user.role === "OWNER" || user.role === "ADMIN") {
    return companies
  }

  const accessRows = await prisma.userCompanyAccess.findMany({
    where: { userId: user.id },
    select: { companyId: true },
  })

  if (!accessRows.length) {
    return []
  }

  const allowedIds = new Set(accessRows.map((row) => row.companyId))
  return companies.filter((company) => allowedIds.has(company.id))
}

async function resolveActiveCompanyForUser(
  user: { id: string; tenantId?: string | null; role?: string | null },
  activeCompanyId?: string | null
) {
  const companies = await listAccessibleCompaniesForUser(user)
  if (!companies.length) {
    return {
      companies,
      activeCompany: null,
    }
  }

  const activeCompany =
    (activeCompanyId ? companies.find((company) => company.id === activeCompanyId) : null) ||
    (companies.length === 1 ? companies[0] : null) ||
    companies.find((company) => company.isDefault) ||
    companies[0]

  return {
    companies,
    activeCompany,
  }
}

async function resolveTenantIdFromRequestHost(req: express.Request) {
  const subdomain = getTenantSubdomainFromRequest(req)
  if (!subdomain) return null

  const tenant = await prisma.tenant.findFirst({
    where: { subdomain },
    select: { id: true },
  })

  return tenant?.id || null
}

async function resolveRequestedTenantId(
  req: express.Request,
  tenantId?: string | null,
  tenantSubdomain?: string | null
) {
  const hostTenantId = await resolveTenantIdFromRequestHost(req)
  let requestedTenantId = String(tenantId || "").trim() || undefined

  if (!requestedTenantId && tenantSubdomain) {
    const tenant = await prisma.tenant.findFirst({
      where: { subdomain: normalizeSubdomain(tenantSubdomain) },
      select: { id: true },
    })
    requestedTenantId = tenant?.id || undefined
  }

  if (requestedTenantId && hostTenantId && requestedTenantId !== hostTenantId) {
    throw new Error("Tenantul nu corespunde subdomeniului.")
  }

  return requestedTenantId || hostTenantId || undefined
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gufo-erp-backend",
    time: new Date().toISOString(),
  })
})

app.get("/api/v1/company/efactura/oauth/callback", handleAnafOauthCallback)

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  tenantId: z.string().optional(),
  tenantSubdomain: z.string().optional(),
})

const ControlPanelLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
})

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
  tenantId: z.string().optional(),
  tenantSubdomain: z.string().optional(),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(6),
})

const SelectCompanySchema = z.object({
  companyId: z.string().min(10),
})

app.post("/api/v1/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req, res, "erpLogin", parsed.data.email)) return

  const { email, password, tenantId, tenantSubdomain } = parsed.data
  let scopedTenantId: string | undefined
  try {
    scopedTenantId = await resolveRequestedTenantId(req, tenantId, tenantSubdomain)
  } catch (error: any) {
    return res.status(403).json({ ok: false, error: error?.message || "Tenant invalid." })
  }

  const candidates = await prisma.user.findMany({
    where: {
      email,
      isActive: true,
      ...(scopedTenantId ? { tenantId: scopedTenantId } : {}),
    },
    orderBy: { createdAt: "desc" },
  })

  if (candidates.length === 0) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" })
  }

  if (!scopedTenantId) {
    const distinctTenantIds = new Set(candidates.map((candidate) => String(candidate.tenantId || "")))
    if (distinctTenantIds.size > 1) {
      return res.status(409).json({
        ok: false,
        error: "Acest email exista in mai multe conturi. Foloseste subdomeniul firmei sau selecteaza tenantul corect.",
      })
    }
  }

  let user: (typeof candidates)[number] | null = null
  for (const candidate of candidates) {
    const ok = await verifySecret(password, candidate.passwordHash)
    if (ok) {
      user = candidate
      break
    }
  }

  if (!user) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" })
  }

  const { companies, activeCompany } = await resolveActiveCompanyForUser(user, null)
  const session = await createWebSession({
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    email: user.email,
    activeCompanyId: companies.length === 1 ? activeCompany?.id || null : null,
    controlPanel: false,
  })
  const csrfToken = createBrowserCsrfToken()

  const token = signAccessToken({
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    email: user.email,
    activeCompanyId: companies.length === 1 ? activeCompany?.id || null : null,
    sessionId: session.id,
  })
  setErpAuthCookie(req, res, token)
  setErpCsrfCookie(req, res, csrfToken)

  void writeExplicitAuditLog({
    tenantId: user.tenantId,
    actorType: user.role === "OWNER" ? "OWNER" : "USER",
    actorId: user.id,
    action: "AUTH_LOGIN_SUCCESS",
    entityType: "AuthSession",
    entityId: user.id,
    payload: {
      email: user.email,
      role: user.role,
      source: getRequestHostname(req) || getOriginHostname(req) || null,
    },
    ipAddress: req.ip || null,
    userAgent: req.get("user-agent") || null,
  }).catch((error) => {
    console.error("audit-login-write-failed", error)
  })

  return res.json({
    ok: true,
    access_token: token,
    csrf_token: csrfToken,
    active_company_id: companies.length === 1 ? activeCompany?.id || null : null,
    requires_company_selection: companies.length > 1,
    companies: companies.map((company) => ({
      id: company.id,
      name: company.name,
      code: company.code,
      cui: company.cui,
      isDefault: company.isDefault,
    })),
  })
})

app.post("/api/v1/auth/select-company", requireAuth, async (req: AuthedRequest, res) => {
  const auth = req.auth!
  if (!auth.tenantId) {
    return res.status(403).json({ ok: false, error: "Selectia firmei este disponibila doar in ERP." })
  }

  const parsed = SelectCompanySchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const company = await prisma.company.findFirst({
    where: {
      id: parsed.data.companyId,
      tenantId: auth.tenantId,
    },
    select: {
      id: true,
      name: true,
      code: true,
      cui: true,
      isDefault: true,
    },
  })

  if (!company) {
    return res.status(404).json({ ok: false, error: "Firma selectata nu exista." })
  }

  const allowedCompanies = await listAccessibleCompaniesForUser({
    id: auth.userId,
    tenantId: auth.tenantId,
    role: auth.role,
  })

  if (!allowedCompanies.some((item) => item.id === company.id)) {
    return res.status(403).json({ ok: false, error: "Nu ai acces la firma selectata." })
  }

  const token = signAccessToken({
    tenantId: auth.tenantId,
    userId: auth.userId,
    role: auth.role,
    email: auth.email || undefined,
    activeCompanyId: company.id,
    sessionId: auth.sessionId || null,
  })
  await touchWebSession(auth.sessionId, { activeCompanyId: company.id })
  const csrfToken = String(req.cookies?.[ERP_CSRF_COOKIE] || "").trim() || createBrowserCsrfToken()
  setErpAuthCookie(req, res, token)
  setErpCsrfCookie(req, res, csrfToken)

  return res.json({
    ok: true,
    access_token: token,
    csrf_token: csrfToken,
    active_company_id: company.id,
    company: {
      id: company.id,
      name: company.name,
      code: company.code,
      cui: company.cui,
      isDefault: company.isDefault,
    },
  })
})

app.get("/api/v1/public/domain-allow", async (req, res) => {
  const domain = String(req.query.domain || "").trim().toLowerCase().replace(/:\d+$/, "")

  if (!domain) {
    return res.status(400).send("missing domain")
  }

  if (domain === "app.gufo.ink" || domain === "test.gufo.ink" || domain === "api.gufo.ink") {
    return res.status(200).send("ok")
  }

  const subdomain = getTenantSubdomainFromHostname(domain)
  if (!subdomain) {
    return res.status(403).send("forbidden")
  }

  const tenant = await prisma.tenant.findFirst({
    where: { subdomain },
    select: { id: true },
  })

  if (!tenant) {
    return res.status(403).send("forbidden")
  }

  return res.status(200).send("ok")
})

app.post("/api/v1/admin/auth/login", async (req, res) => {
  const parsed = ControlPanelLoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req, res, "controlPanelLogin", parsed.data.email)) return

  const controlEmail = String(
    process.env.CONTROL_PANEL_EMAIL ||
      (process.env.NODE_ENV !== "production" && ALLOW_DEV_CONTROL_PANEL_LOGIN ? "owner@gufo.local" : "")
  )
    .trim()
    .toLowerCase()
  const controlPassword = String(
    process.env.CONTROL_PANEL_PASSWORD ||
      (process.env.NODE_ENV !== "production" && ALLOW_DEV_CONTROL_PANEL_LOGIN ? "gufo1234" : "")
  )

  if (!controlEmail || !controlPassword) {
    return res.status(503).json({ ok: false, error: "Control Panel auth is not configured" })
  }

  if (
    parsed.data.email.trim().toLowerCase() !== controlEmail ||
    parsed.data.password !== controlPassword
  ) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" })
  }

  const token = signAccessToken({
    tenantId: null,
    userId: "control-panel-owner",
    role: "OWNER",
    email: controlEmail,
    controlPanel: true,
    sessionId: (
      await createWebSession({
        tenantId: null,
        userId: null,
        role: "OWNER",
        email: controlEmail,
        controlPanel: true,
      })
    ).id,
  })
  const csrfToken = createBrowserCsrfToken()
  setControlAuthCookie(req, res, token)
  setControlCsrfCookie(req, res, csrfToken)

  return res.json({
    ok: true,
    access_token: token,
    csrf_token: csrfToken,
  })
})

app.post("/api/v1/auth/logout", async (req: AuthedRequest, res) => {
  const authHeader = String(req.headers.authorization || "")
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const cookieToken = String(req.cookies?.[ERP_AUTH_COOKIE] || "").trim()
  const token = bearerToken || cookieToken
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sessionId?: string | null }
      await revokeWebSession(decoded.sessionId || null)
    } catch {}
  }
  clearErpAuthCookie(req, res)
  clearErpCsrfCookie(req, res)
  return res.json({ ok: true })
})

app.post("/api/v1/admin/auth/logout", async (req: AuthedRequest, res) => {
  const authHeader = String(req.headers.authorization || "")
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const cookieToken = String(req.cookies?.[CONTROL_AUTH_COOKIE] || "").trim()
  const token = bearerToken || cookieToken
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sessionId?: string | null }
      await revokeWebSession(decoded.sessionId || null)
    } catch {}
  }
  clearControlAuthCookie(req, res)
  clearControlCsrfCookie(req, res)
  return res.json({ ok: true })
})

app.post("/api/v1/auth/forgot-password", async (req, res) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req, res, "forgotPassword", parsed.data.email)) return

  if (!hasSmtpConfig()) {
    return res.status(503).json({
      ok: false,
      error: "Resetarea parolei nu este configurata inca.",
    })
  }

  const email = parsed.data.email.trim().toLowerCase()
  let scopedTenantId: string | undefined
  try {
    scopedTenantId = await resolveRequestedTenantId(req, parsed.data.tenantId, parsed.data.tenantSubdomain)
  } catch {
    return res.json({
      ok: true,
      message: "Daca exista un cont pe acest email, am trimis instructiunile de resetare.",
    })
  }

  const users = await prisma.user.findMany({
    where: {
      email,
      isActive: true,
      ...(scopedTenantId ? { tenantId: scopedTenantId } : {}),
    },
    include: {
      tenant: {
        select: {
          name: true,
          subdomain: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!users.length) {
    return res.json({
      ok: true,
      message: "Daca exista un cont pe acest email, am trimis instructiunile de resetare.",
    })
  }

  try {
    for (const user of users) {
      await prisma.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          usedAt: new Date(),
        },
      })

      const rawToken = crypto.randomBytes(32).toString("hex")
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60)

      await prisma.passwordResetToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      })

      const publicBase =
        (user.tenant?.subdomain ? `https://${user.tenant.subdomain}.gufo.ink` : "") ||
        String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") ||
        String(req.headers.origin || "").trim().replace(/\/+$/, "") ||
        String(CORS_ORIGIN || "").trim().replace(/\/+$/, "")

      const resetUrl = `${publicBase}/reset-password?token=${rawToken}`
      const tenantName = String(user.tenant?.name || "firma ta").trim()
      const tenantSubdomain = String(user.tenant?.subdomain || "").trim().toLowerCase()
      const tenantBackofficeLabel = tenantSubdomain
        ? `${tenantName} (${tenantSubdomain}.gufo.ink)`
        : tenantName

      await sendMail({
        to: user.email,
        fromName: "Notificari cont",
        subject: "Cerere de resetare a parolei",
        text: [
          `Salut ${user.name},`,
          "",
          `Am primit o cerere de resetare a parolei pentru contul asociat cu ${tenantBackofficeLabel}.`,
          "",
          "Pentru a seta o parola noua, foloseste butonul din email sau linkul de mai jos:",
          "Sau foloseste direct acest link:",
          resetUrl,
          "",
          "Linkul este valabil 60 de minute.",
          "Daca nu ai solicitat aceasta actiune, poti ignora in siguranta acest mesaj.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;color:#17324D;line-height:1.6">
            <h2 style="margin-bottom:12px">Cerere de resetare a parolei</h2>
            <p>Salut <strong>${user.name}</strong>,</p>
            <p>Am primit o cerere de resetare a parolei pentru contul asociat cu <strong>${tenantBackofficeLabel}</strong>.</p>
            <p>Pentru a seta o parola noua, foloseste butonul de mai jos:</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#17324D;color:#fff;text-decoration:none;font-weight:700">
                Reseteaza parola
              </a>
            </p>
            <p style="margin-top:12px">Sau foloseste direct acest link:</p>
            <p style="word-break:break-word"><a href="${resetUrl}">${resetUrl}</a></p>
            <p><strong>Linkul este valabil 60 de minute.</strong></p>
            <p>Daca nu ai solicitat aceasta actiune, poti ignora in siguranta acest mesaj.</p>
          </div>
        `,
      })
    }
  } catch (error) {
    console.error("FORGOT PASSWORD MAIL ERROR", error)
    return res.status(502).json({
      ok: false,
      error: "Nu am putut trimite emailul de resetare. Verifica setarile SMTP.",
    })
  }

  return res.json({
    ok: true,
    message: "Daca exista un cont pe acest email, am trimis instructiunile de resetare.",
  })
})

app.post("/api/v1/auth/reset-password", async (req, res) => {
  const parsed = ResetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex")
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  })

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !resetToken.user.isActive) {
    return res.status(400).json({ ok: false, error: "Linkul de resetare este invalid sau expirat." })
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash: await hashSecret(parsed.data.password),
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ])

  return res.json({
    ok: true,
    message: "Parola a fost actualizata. Te poti autentifica din nou.",
  })
})

app.get("/api/v1/admin/me", requireAuth, async (req: AuthedRequest, res) => {
  if (!hasGlobalControlPanelOwnerAccess(req)) {
    return res.status(403).json({ ok: false, error: "Acces permis doar owner-ului" })
  }

  const auth = req.auth!
  await touchWebSession(auth.sessionId, { activeCompanyId: null })
  const token = signAccessToken({
    tenantId: null,
    userId: auth.userId,
    role: auth.role,
    email: auth.email || undefined,
    controlPanel: true,
    sessionId: auth.sessionId || null,
  })
  const csrfToken = String(req.cookies?.[CONTROL_CSRF_COOKIE] || "").trim() || createBrowserCsrfToken()
  setControlAuthCookie(req, res, token)
  setControlCsrfCookie(req, res, csrfToken)

  return res.json({
    ok: true,
    access_token: token,
    csrf_token: csrfToken,
    user_id: auth.userId,
    role: auth.role,
    email: auth.email || process.env.CONTROL_PANEL_EMAIL || "owner",
  })
})

app.get("/api/v1/me", requireAuth, async (req: AuthedRequest, res) => {
  const auth = req.auth!
  let user = await prisma.user.findUnique({
    where: { id: auth.userId },
  })

  if (!user && auth.tenantId && auth.email) {
    user = await prisma.user.findFirst({
      where: {
        tenantId: auth.tenantId,
        email: auth.email,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    })
  }

  if (!user && auth.tenantId) {
    user = await prisma.user.findFirst({
      where: {
        tenantId: auth.tenantId,
        isActive: true,
        role: {
          in: ["OWNER", "ADMIN"],
        },
      },
      orderBy: { createdAt: "asc" },
    })
  }

  if (!user) {
    console.warn("ME USER NOT FOUND", {
      auth,
    })
    return res.status(404).json({ ok: false, error: "User not found" })
  }

  const license = await prisma.license.findFirst({
    where: {
      tenantId: auth.tenantId,
      isSuspended: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  })

  const activeTenantModules = await prisma.tenantModule.findMany({
    where: {
      tenantId: auth.tenantId,
      enabled: true,
    },
    include: {
      module: {
        select: {
          code: true,
        },
      },
    },
  })

  const modules = license
    ? [
        license.modDashboard ? "dashboard" : null,
        license.modDocuments ? "documents" : null,
        license.modInventory ? "inventory" : null,
        license.modNomenclature ? "nomenclature" : null,
        license.modSettings ? "settings" : null,
        license.modPos ? "pos" : null,
        license.modReports ? "reports" : null,
        ...activeTenantModules.map((row) => row.module.code),
      ].filter(Boolean)
    : []

  const { companies, activeCompany } = await resolveActiveCompanyForUser(
    { id: auth.userId, tenantId: auth.tenantId, role: auth.role },
    auth.activeCompanyId
  )
  const token = signAccessToken({
    tenantId: auth.tenantId,
    userId: auth.userId,
    role: auth.role,
    email: user.email,
    activeCompanyId: activeCompany?.id || null,
    sessionId: auth.sessionId || null,
  })
  await touchWebSession(auth.sessionId, { activeCompanyId: activeCompany?.id || null })
  const csrfToken = String(req.cookies?.[ERP_CSRF_COOKIE] || "").trim() || createBrowserCsrfToken()
  setErpAuthCookie(req, res, token)
  setErpCsrfCookie(req, res, csrfToken)

  return res.json({
    ok: true,
    access_token: token,
    csrf_token: csrfToken,
    tenant_id: auth.tenantId,
    user_id: auth.userId,
    role: auth.role,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl || null,
    avatarUrl: user.imageUrl || null,
    active_company_id: activeCompany?.id || null,
    requires_company_selection: companies.length > 1 && !auth.activeCompanyId,
    companies: companies.map((company) => ({
      id: company.id,
      name: company.name,
      code: company.code,
      cui: company.cui,
      isDefault: company.isDefault,
    })),
    modules,
    license: license
      ? {
          expiresAt: license.expiresAt,
          limits: {
            locations: license.limitLocations,
            terminals: license.limitTerminals,
          },
        }
      : null,
  })
})

const LicenseActivateSchema = z.object({
  license_key: z.string().min(6),
  device_id: z.string().min(3),
  app_version: z.string().min(1),
  location_code: z.string().optional(),
})

app.post("/api/v1/license/activate", async (req, res) => {
  const parsed = LicenseActivateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const license_key = parsed.data.license_key.trim()
  const device_id = parsed.data.device_id.trim()
  const app_version = parsed.data.app_version.trim()
  const location_code = parsed.data.location_code?.trim()

  const candidates = await prisma.license.findMany({
    where: {
      isSuspended: false,
      expiresAt: { gt: new Date() },
    },
    include: {
      tenant: true,
    },
    take: 100,
  })

  let found: (typeof candidates)[number] | null = null

  for (const c of candidates) {
    const match = await bcrypt.compare(license_key, c.keyHash)
    if (match) {
      found = c
      break
    }
  }

  if (!found) {
    return res.status(401).json({
      ok: false,
      valid: false,
      error: "Invalid or expired license",
    })
  }

  let locationId: string | null = null

  if (location_code) {
    const loc = await prisma.location.findFirst({
      where: {
        tenantId: found.tenantId,
        code: location_code,
      },
    })
    if (loc) locationId = loc.id
  }

  const terminal = await prisma.terminal.upsert({
    where: {
      tenantId_deviceId: {
        tenantId: found.tenantId,
        deviceId: device_id,
      },
    },
    update: {
      locationId: locationId ?? undefined,
      label: `Android POS (${app_version})`,
    },
    create: {
      tenantId: found.tenantId,
      deviceId: device_id,
      locationId: locationId ?? undefined,
      label: `Android POS (${app_version})`,
      isLockedToLocation: true,
    },
  })

  const pos_token = signPosToken({
    tenantId: found.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId,
  })

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
  })
})

/* ======================================================
   DIRECT POS PAIR — prioritar, fara conflicte de router
====================================================== */

const DirectPosPairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  terminalLabel: z.string().optional(),
  terminal_label: z.string().optional(),
})

const DirectPosValidateSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
})

app.post("/api/v1/pos/validate", async (req, res) => {
  console.log("🔥 INDEX POS VALIDATE HIT", req.body)

  try {
    const parsed = DirectPosValidateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        allowed: false,
        error: parsed.error.flatten(),
      })
    }

    const licenseKey = normalizeText(parsed.data.licenseKey ?? parsed.data.license_key)

    if (!licenseKey || licenseKey.length < 3) {
      return res.status(400).json({
        ok: false,
        allowed: false,
        error: "Licenta POS este invalida",
      })
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
    })

    if (!terminal) {
      return res.status(404).json({
        ok: false,
        allowed: false,
        error: "Licenta invalida",
      })
    }

    const license = terminal.tenant.licenses[0]

    if (!license) {
      return res.status(404).json({
        ok: false,
        allowed: false,
        error: "Licenta ERP inexistenta",
      })
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "Licenta este suspendata",
      })
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "Licenta este expirata",
      })
    }

    if (!license.modPos) {
      return res.status(403).json({
        ok: false,
        allowed: false,
        error: "POS nu este activ",
      })
    }

    const terminalsCount = await prisma.terminal.count({
      where: { tenantId: terminal.tenantId },
    })

    const withinLimit = terminalsCount <= license.limitTerminals

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
    })
  } catch (error) {
    console.error("INDEX POS VALIDATE ERROR:", error)
    return res.status(500).json({
      ok: false,
      allowed: false,
      error: "Eroare interna la validarea POS",
    })
  }
})

app.post("/api/v1/pos/pair", async (req, res) => {
  console.log("🔥 INDEX POS PAIR HIT", req.body)

  try {
    const parsed = DirectPosPairSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() })
    }

    const body = parsed.data
    const licenseKey = normalizeText(body.licenseKey ?? body.license_key)
    const incomingDeviceId = normalizeText(body.deviceId ?? body.device_id)
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) || "Android POS"

    if (!licenseKey || licenseKey.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "License key lipsa sau invalid",
      })
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
    })

    if (!terminal) {
      return res.status(404).json({
        ok: false,
        error: "Licenta invalida",
      })
    }

    const license = terminal.tenant.licenses[0]

    if (!license) {
      return res.status(404).json({
        ok: false,
        error: "Licenta ERP inexistenta",
      })
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        error: "Licenta este suspendata",
      })
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        error: "Licenta este expirata",
      })
    }

    if (!license.modPos) {
      return res.status(403).json({
        ok: false,
        error: "POS nu este activ",
      })
    }

    if (incomingDeviceId && incomingDeviceId !== terminal.deviceId) {
      console.warn("POS PAIR DEVICE MISMATCH", {
        incomingDeviceId,
        licenseKey,
        terminalDeviceId: terminal.deviceId,
      })
    }

    if (terminalLabel && terminal.label !== terminalLabel) {
      await prisma.terminal.update({
        where: { id: terminal.id },
        data: { label: terminalLabel },
      })
    }

    const locations = await prisma.location.findMany({
      where: {
        tenantId: terminal.tenantId,
        isActive: true,
      },
      orderBy: { name: "asc" },
    })

    const token = signPosToken({
      tenantId: terminal.tenantId,
      terminalId: terminal.id,
      deviceId: terminal.deviceId,
    })

    registerPairedPosSession(req, {
      tenantId: terminal.tenantId,
      terminalId: terminal.id,
      deviceId: terminal.deviceId,
    })

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
    })
  } catch (error) {
    console.error("INDEX POS PAIR ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Eroare interna la conectarea POS",
    })
  }
})

app.get("/api/v1/pos/config", async (req, res) => {
  console.log("🔥 INDEX POS CONFIG HIT")

  try {
    const auth = await resolvePosAuthContext(req as any)
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fa pair din nou.",
      })
    }

    const company = await getPrimaryTenantCompany(auth.tenantId, {
      select: {
        posSyncInterval: true,
        isVatPayer: true,
      },
    })

    return res.json({
      ok: true,
      syncIntervalMinutes: company?.posSyncInterval ?? 5,
      isVatPayer: company?.isVatPayer ?? true,
      allowedIntervals: [1, 2, 3, 4, 5, 10, 15, 20, 25, 30],
    })
  } catch (error) {
    console.error("INDEX POS CONFIG ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Eroare la incarcarea configurarii POS",
    })
  }
})

app.get("/api/v1/pos/catalog", async (req, res) => {
  console.log("🔥 INDEX POS CATALOG HIT")

  try {
    const auth = await resolvePosAuthContext(req as any)
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fa pair din nou.",
      })
    }

    const payload = await buildCatalogPayload(req, auth.tenantId)
    return res.json(payload)
  } catch (error) {
    console.error("INDEX POS CATALOG ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Eroare la incarcarea catalogului POS",
    })
  }
})

app.get("/api/v1/pos/marketplace/orders", async (req, res) => {
  console.log("INDEX POS MARKETPLACE ORDERS HIT", req.query)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fa pair din nou.",
      })
    }

    const terminalLocationId = await resolveMarketplaceTerminalLocationId(auth.terminalId)
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
    })

    const visibleItems = items.filter((item) =>
      computeMarketplaceVisibility(item, auth, terminalLocationId).visible
    )

    return res.json({ ok: true, items: visibleItems })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE ORDERS ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la incarcarea comenzilor marketplace" })
  }
})

app.get("/api/v1/pos/marketplace/debug", async (req, res) => {
  console.log("INDEX POS MARKETPLACE DEBUG HIT", req.query)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({
        ok: false,
        error: "POS neautentificat. Fa pair din nou.",
      })
    }

    const terminal = auth.terminalId
      ? await prisma.terminal.findUnique({
          where: { id: auth.terminalId },
          select: {
            id: true,
            label: true,
            deviceId: true,
            locationId: true,
            location: { select: { id: true, name: true } },
          },
        })
      : null
    const terminalLocationId = terminal?.locationId || ""

    const items = await prisma.externalOrder.findMany({
      where: {
        tenantId: auth.tenantId,
        status: { in: [...ACTIVE_MARKETPLACE_ORDER_STATUSES] },
      },
      include: {
        location: { select: { id: true, name: true, code: true } },
        integration: { select: { id: true, locationId: true, settingsJson: true } },
        kitchenTicket: { select: { id: true, status: true, displayNumber: true } },
        items: { select: { id: true, name: true, qty: true, externalProductId: true, mappingStatus: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    })

    const withVisibility = items.map((item) => ({
      id: item.id,
      externalOrderId: item.externalOrderId,
      externalOrderNumber: item.externalOrderNumber,
      platform: item.platform,
      status: item.status,
      location: item.location,
      visibility: computeMarketplaceVisibility(item, auth, terminalLocationId),
    }))

    return res.json({
      ok: true,
      auth: {
        terminalId: auth.terminalId || null,
        deviceId: auth.deviceId || null,
      },
      terminal: terminal
        ? {
            id: terminal.id,
            label: terminal.label,
            deviceId: terminal.deviceId,
            locationId: terminal.locationId,
            name: terminal.location?.name || null,
          }
        : null,
      counts: {
        totalActiveInLocation: items.length,
        visibleToCurrentPos: withVisibility.filter((item) => item.visibility.visible).length,
      },
      items: withVisibility,
    })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE DEBUG ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la debug marketplace" })
  }
})

app.post("/api/v1/pos/marketplace/:externalOrderId/accept", async (req, res) => {
  console.log("INDEX POS MARKETPLACE ACCEPT HIT", req.params, req.query)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({ ok: false, error: "POS neautentificat. Fa pair din nou." })
    }

    const inputOrderId = String(req.params.externalOrderId || "").trim()
    if (!inputOrderId) {
      return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
    }

    const order = await resolvePosMarketplaceOrder(auth as any, inputOrderId, {
      saleDraft: true,
      kitchenTicket: true,
    })
    if (!order) {
      return res.status(404).json({ ok: false, error: "Marketplace order not found" })
    }

    const nextStatus = order.status === "RECEIVED" ? "ACKNOWLEDGED" : order.status
    await prisma.$transaction(async (tx: any) => {
      if (nextStatus !== order.status || order.cancelledAt) {
        await tx.externalOrder.update({
          where: { id: order.id },
          data: {
            status: nextStatus,
            acknowledgedAt: nextStatus === "ACKNOWLEDGED" ? new Date() : order.acknowledgedAt,
            cancelledAt: null,
          },
        })
      }

      if (order.saleDraft?.id && order.saleDraft.status === "CANCELLED") {
        await tx.saleDraft.update({
          where: { id: order.saleDraft.id },
          data: { status: "OPEN" },
        })
      }

      if (order.kitchenTicket?.id && order.kitchenTicket.status === "CANCELLED") {
        await tx.kitchenTicket.update({
          where: { id: order.kitchenTicket.id },
          data: { status: "NEW", completedAt: null, readyAt: null },
        })
      }
    })

    await createPosMarketplaceHistory(auth as any, order.id, nextStatus, "POS", "Marketplace order accepted in POS.", {
      terminalId: auth.terminalId || null,
    })

    let glovoSync: any = { skipped: true, reason: "not-run" }
    try {
      glovoSync = await syncGlovoPartnerStatusForOrder(auth as any, { ...order, status: nextStatus }, nextStatus, "POS")
      if (glovoSync?.skipped && glovoSync?.reason && glovoSync.reason !== "not-glovo") {
        await createPosMarketplaceHistory(auth as any, order.id, nextStatus, "GLOVO", `Glovo sync nu a fost trimis la acceptare: ${glovoSync.reason}.`, glovoSync)
      }
    } catch (error: any) {
      glovoSync = { skipped: false, error: error?.message || "Glovo accept sync failed." }
      await createPosMarketplaceHistory(auth as any, order.id, nextStatus, "GLOVO", `Glovo sync a esuat la acceptare: ${glovoSync.error}`, glovoSync)
    }

    return res.json({ ok: true, externalOrderId: order.id, status: nextStatus, glovoSync })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE ACCEPT ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la acceptarea comenzii marketplace" })
  }
})

app.post("/api/v1/pos/marketplace/:externalOrderId/reject", async (req, res) => {
  console.log("INDEX POS MARKETPLACE REJECT HIT", req.params, req.query, req.body)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({ ok: false, error: "POS neautentificat. Fa pair din nou." })
    }

    const inputOrderId = String(req.params.externalOrderId || "").trim()
    if (!inputOrderId) {
      return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
    }

    const reason = String(req.body?.reason || "OTHER").trim() || "OTHER"
    const order = await resolvePosMarketplaceOrder(auth as any, inputOrderId, {
      saleDraft: true,
      kitchenTicket: true,
    })
    if (!order) {
      return res.status(404).json({ ok: false, error: "Marketplace order not found" })
    }

    const now = new Date()
    await prisma.$transaction(async (tx: any) => {
      await tx.externalOrder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
        },
      })

      if (order.kitchenTicket) {
        await tx.kitchenTicket.update({
          where: { id: order.kitchenTicket.id },
          data: { status: "CANCELLED" },
        })
      }

      if (order.saleDraft) {
        await tx.saleDraft.update({
          where: { id: order.saleDraft.id },
          data: { status: "CANCELLED" },
        })
      }
    })

    await createPosMarketplaceHistory(auth as any, order.id, "CANCELLED", "POS", "Marketplace order rejected in POS.", {
      terminalId: auth.terminalId || null,
      reason,
    })

    let glovoSync: any = { skipped: true, reason: "not-run" }
    try {
      glovoSync = await syncGlovoPartnerCancellationForOrder(auth as any, { ...order, status: "CANCELLED" }, "POS", reason)
      if (glovoSync?.skipped && glovoSync?.reason && glovoSync.reason !== "not-glovo") {
        await createPosMarketplaceHistory(auth as any, order.id, "CANCELLED", "GLOVO", `Glovo cancel sync nu a fost trimis: ${glovoSync.reason}.`, glovoSync)
      }
    } catch (error: any) {
      glovoSync = { skipped: false, error: error?.message || "Glovo reject sync failed." }
      await createPosMarketplaceHistory(auth as any, order.id, "CANCELLED", "GLOVO", `Glovo cancel sync a esuat: ${glovoSync.error}`, glovoSync)
    }

    return res.json({ ok: true, externalOrderId: order.id, status: "CANCELLED", glovoSync })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE REJECT ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la refuzul comenzii marketplace" })
  }
})

app.post("/api/v1/pos/marketplace/:externalOrderId/send-to-kds", async (req, res) => {
  console.log("INDEX POS MARKETPLACE SEND TO KDS HIT", req.params, req.query)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({ ok: false, error: "POS neautentificat. Fa pair din nou." })
    }

    const inputOrderId = String(req.params.externalOrderId || "").trim()
    if (!inputOrderId) {
      return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
    }

    const order = await resolvePosMarketplaceOrder(auth as any, inputOrderId, {
      kitchenTicket: true,
      saleDraft: true,
    })
    if (!order) {
      return res.status(404).json({ ok: false, error: "Marketplace order not found" })
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.externalOrder.update({
        where: { id: order.id },
        data: { status: "IN_KITCHEN" },
      })
      if (order.kitchenTicket) {
        await tx.kitchenTicket.update({
          where: { id: order.kitchenTicket.id },
          data: { status: "NEW" },
        })
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
      })
    })

    return res.json({ ok: true, externalOrderId: order.id, status: "IN_KITCHEN" })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE SEND TO KDS ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la trimiterea comenzii spre KDS" })
  }
})

app.post("/api/v1/pos/marketplace/:externalOrderId/kds-status", async (req, res) => {
  console.log("INDEX POS MARKETPLACE KDS STATUS HIT", req.params, req.body)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({ ok: false, error: "POS neautentificat. Fa pair din nou." })
    }

    const normalizedStatus = normalizePosMarketplaceKdsStatus(String(req.body?.status || ""))
    if (!normalizedStatus) {
      return res.status(400).json({ ok: false, error: "Unsupported marketplace KDS status" })
    }

    const inputOrderId = String(req.params.externalOrderId || "").trim()
    if (!inputOrderId) {
      return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
    }

    const order = await resolvePosMarketplaceOrder(auth as any, inputOrderId, {
      kitchenTicket: true,
      saleDraft: true,
    })
    if (!order) {
      return res.status(404).json({ ok: false, error: "Marketplace order not found" })
    }

    const now = new Date()
    await prisma.$transaction(async (tx: any) => {
      await tx.externalOrder.update({
        where: { id: order.id },
        data: {
          status: normalizedStatus,
          ...(normalizedStatus === "READY_FOR_FISCAL" ? { readyAt: now } : {}),
          ...(normalizedStatus === "CANCELLED" ? { cancelledAt: now } : {}),
        },
      })

      if (order.kitchenTicket) {
        const kitchenPayload =
          normalizedStatus === "READY_FOR_FISCAL"
            ? { status: "READY", readyAt: now }
            : normalizedStatus === "IN_KITCHEN"
              ? { status: "IN_PROGRESS" }
              : normalizedStatus === "CANCELLED"
                ? { status: "CANCELLED" }
              : normalizedStatus === "ACKNOWLEDGED"
                ? { status: "NEW" }
                : { status: "NEW" }
        await tx.kitchenTicket.update({
          where: { id: order.kitchenTicket.id },
          data: kitchenPayload,
        })
      }

      if (order.saleDraft) {
        if (normalizedStatus === "READY_FOR_FISCAL") {
          await tx.saleDraft.update({
            where: { id: order.saleDraft.id },
            data: { status: "READY_FOR_FISCAL" },
          })
        } else if (normalizedStatus === "CANCELLED") {
          await tx.saleDraft.update({
            where: { id: order.saleDraft.id },
            data: { status: "CANCELLED" },
          })
        }
      }

      await tx.externalOrderStatusHistory.create({
        data: {
          tenantId: auth.tenantId,
          externalOrderId: order.id,
          status: normalizedStatus,
          source: "KDS",
          message: String(req.body?.message || "").trim() || `Marketplace order marked ${normalizedStatus} from POS KDS callback.`,
          payloadJson: { terminalId: auth.terminalId || null },
        },
      })
    })

    let glovoSync: any = { skipped: true, reason: "not-run" }
    try {
      glovoSync =
        normalizedStatus === "CANCELLED"
          ? await syncGlovoPartnerCancellationForOrder(
              auth as any,
              { ...order, status: "CANCELLED", cancelledAt: now },
              "KDS"
            )
          : await syncGlovoPartnerStatusForOrder(
              auth as any,
              { ...order, status: normalizedStatus, readyAt: normalizedStatus === "READY_FOR_FISCAL" ? now : order.readyAt },
              normalizedStatus,
              "KDS"
            )
      if (glovoSync?.skipped && glovoSync?.reason && glovoSync.reason !== "not-glovo") {
        await createPosMarketplaceHistory(auth as any, order.id, normalizedStatus, "GLOVO", `Glovo sync nu a fost trimis din KDS: ${glovoSync.reason}.`, glovoSync)
      }
    } catch (error: any) {
      glovoSync = { skipped: false, error: error?.message || "Glovo KDS sync failed." }
      await createPosMarketplaceHistory(auth as any, order.id, normalizedStatus, "GLOVO", `Glovo sync a esuat din KDS: ${glovoSync.error}`, glovoSync)
    }

    return res.json({ ok: true, externalOrderId: order.id, status: normalizedStatus, glovoSync })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE KDS STATUS ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la actualizarea statusului marketplace din KDS" })
  }
})

app.post("/api/v1/pos/marketplace/:externalOrderId/load-cart", async (req, res) => {
  console.log("INDEX POS MARKETPLACE LOAD CART HIT", req.params, req.query)
  try {
    const auth = await resolveMarketplacePosAuth(req)
    if (!auth?.tenantId) {
      return res.status(401).json({ ok: false, error: "POS neautentificat. Fa pair din nou." })
    }

    const inputOrderId = String(req.params.externalOrderId || "").trim()
    if (!inputOrderId) {
      return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
    }

    const order = await prisma.externalOrder.findFirst({
      where: {
        tenantId: auth.tenantId,
        OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
      },
      include: {
        integration: {
          select: { id: true, settingsJson: true, locationId: true },
        },
        saleDraft: true,
        location: { select: { id: true, name: true, code: true } },
      },
    })

    if (!order || !computeMarketplaceVisibility(order, auth, await resolveMarketplaceTerminalLocationId(auth.terminalId)).visible) {
      return res.status(404).json({ ok: false, error: "Marketplace order not found" })
    }
    if (!order.saleDraft) {
      return res.status(404).json({ ok: false, error: "Sale draft not found for marketplace order" })
    }
    if (order.saleDraft.status === "CANCELLED") {
      return res.status(400).json({ ok: false, error: "Sale draft is cancelled" })
    }

    await prisma.externalOrderStatusHistory.create({
      data: {
        tenantId: auth.tenantId,
        externalOrderId: order.id,
        status: order.status,
        source: "POS",
        message: "Marketplace order loaded into POS cart.",
        payloadJson: { terminalId: auth.terminalId || null },
      },
    })

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
      saleDraft: order.saleDraft
        ? {
            ...order.saleDraft,
            cart: order.saleDraft.cartJson ?? null,
          }
        : null,
    })
  } catch (error) {
    console.error("INDEX POS MARKETPLACE LOAD CART ERROR", error)
    return res.status(500).json({ ok: false, error: "Eroare la incarcarea comenzii marketplace" })
  }
})

app.post("/api/v1/pos/sales", async (req, res) => {
  console.log("🔥 INDEX POS SALES HIT", req.body)
  return handlePosSale(req as any, res)
})

app.post("/api/v1/pos/receipts", async (req, res) => {
  console.log("🔥 INDEX POS RECEIPTS HIT", req.body)
  return handlePosSale(req as any, res)
})

app.get("/api/v1/pos/receipts", async (req, res) => {
  console.log("🔥 INDEX POS RECEIPTS LIST HIT", req.query)
  return handlePosReceiptsList(req as any, res)
})

app.get("/api/v1/pos/customers", async (req, res) => {
  console.log("🔥 INDEX POS CUSTOMERS HIT", req.query)
  return handlePosCustomersSearch(req as any, res)
})

app.get("/api/v1/pos/operators", async (req, res) => {
  console.log("🔥 INDEX POS OPERATORS HIT", req.query)
  return handlePosOperatorsList(req as any, res)
})

app.post("/api/v1/pos/operators/login", async (req, res) => {
  console.log("🔥 INDEX POS OPERATOR LOGIN HIT", {
    name: req.body?.name || null,
  })
  return handlePosOperatorLogin(req as any, res)
})

app.get("/api/v1/pos/backoffice/sales-summary", async (req, res) => {
  console.log("🔥 INDEX POS BACKOFFICE SALES SUMMARY HIT", req.query)
  return handlePosBackofficeSalesSummary(req as any, res)
})

app.get("/api/v1/pos/backoffice/suppliers", async (req, res) => {
  console.log("🔥 INDEX POS BACKOFFICE SUPPLIERS HIT", req.query)
  return handlePosBackofficeSuppliersSearch(req as any, res)
})

app.get("/api/v1/pos/backoffice/products", async (req, res) => {
  console.log("🔥 INDEX POS BACKOFFICE PRODUCTS HIT", req.query)
  return handlePosBackofficeProductsSearch(req as any, res)
})

app.post("/api/v1/pos/backoffice/receipts", async (req, res) => {
  console.log("🔥 INDEX POS BACKOFFICE RECEIPTS HIT", req.body)
  return handlePosBackofficeReceiptCreate(req as any, res)
})

app.post("/api/v1/pos/receipts/:saleId/invoice", async (req, res) => {
  console.log("🔥 INDEX POS RECEIPTS INVOICE HIT", {
    saleId: req.params.saleId,
    body: req.body,
  })
  return handlePosReceiptInvoice(req as any, res)
})

app.post("/api/v1/pos/daily-closures", async (req, res) => {
  console.log("INDEX POS DAILY CLOSURE HIT", req.body)
  return handlePosDailyClosure(req as any, res)
})

app.use(productsRouter)
app.use(metaRouter)
app.use(posRouter)
app.use(stockRouter)
app.use(purchaseRouter)
app.use(minutesDocsRouter)
app.use(incomingEfacturaRouter)
app.use(spvClassicRouter)
app.use(usersRouter)
app.use(auditRouter)
app.use(gufoAiRouter)
app.use(companyRouter)
app.use("/api/v1/purchase-receipts", purchaseReceiptsPdf)
app.use(transferRouter)
app.use(dashboardRoutes)
app.use(consumptionRouter)
app.use("/api/v1/consumption-docs", consumptionDocsPdf)
app.use(productionRouter)
app.use(productionDocsRouter)
app.use(inventoryRouter)
app.use("/api/v1/inventory-docs", inventoryDocsPdf)
app.use(reportsRouter)
app.use(accountingExportRouter)
app.use(financeRouter)
app.use(backupsRouter)
app.use(eTransportRegistryRouter)
app.use(adminRouter)
app.use(marketplaceRouter)
app.use(salesInvoicesRouter)
app.use(customersRouter)

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`)
})
