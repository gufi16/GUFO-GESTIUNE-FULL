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
import { assertPersistentUploadsConfig, ensureUploadSubdir, getUploadsRoot } from "./lib/uploads"
import { loadEnv } from "./lib/loadEnv"
import {
  clearControlAuthCookie,
  clearControlCsrfCookie,
  clearErpAuthCookie,
  clearErpCsrfCookie,
  clearErpTenantCookie,
  CONTROL_AUTH_COOKIE,
  CONTROL_CSRF_COOKIE,
  ERP_AUTH_COOKIE,
  ERP_CSRF_COOKIE,
  setControlAuthCookie,
  setControlCsrfCookie,
  setErpAuthCookie,
  setErpCsrfCookie,
  setErpTenantCookie,
  WEB_SESSION_TTL_MS,
} from "./lib/browserAuthCookies"
import {
  getHostnameFromUrl,
  getOriginHostname,
  getRequestHostname,
  getTenantSubdomainFromHostname,
  getTenantSubdomainFromRequest,
  isHostedGufoBrowserRequest,
  resolveRequestedTenantId,
} from "./lib/tenantRequest"
import { createBrowserCsrfToken, issuePasswordResetToken } from "./lib/passwordReset"

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
import posRouter from "./routes/pos"
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
import webAuthRouter from "./routes/webAuth"
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
const ALLOW_API_ORIGIN = process.env.ALLOW_API_ORIGIN === "true"
const ALLOW_DEV_CONTROL_PANEL_LOGIN = process.env.ALLOW_DEV_CONTROL_PANEL_LOGIN === "true"
const JWT_SECRET = getJwtSecret()
const corsOriginTenantCache = new Map<string, { allowed: boolean; expiresAt: number }>()
const CORS_TENANT_CACHE_TTL_MS = 1000 * 60 * 5

const uploadsDir = getUploadsRoot()
const uploadsConfig = assertPersistentUploadsConfig()
ensureUploadSubdir("products")
ensureUploadSubdir("categories")

if (!String(process.env.UPLOADS_DIR || "").trim()) {
  console.warn(
    `[uploads] UPLOADS_DIR is not set. Files are stored in ${uploadsDir}. ` +
      `In Docker production you should mount this path persistently, otherwise rebuilds can remove uploaded files.`
  )
} else {
  console.info(`[uploads] Persistent storage root: ${uploadsConfig.effectiveRoot}`)
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

async function isAllowedOrigin(origin?: string) {
  if (!origin) return true
  if (CORS_ORIGINS.includes(origin)) return true

  const hostname = getHostnameFromUrl(origin)
  if (!hostname) return false

  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return true
  if (hostname === "app.gufo.ink") return true
  if (hostname === "test.gufo.ink") return true
  if (hostname === "api.gufo.ink") return ALLOW_API_ORIGIN

  const subdomain = getTenantSubdomainFromHostname(hostname)
  if (!subdomain) return false

  const cached = corsOriginTenantCache.get(subdomain)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed
  }

  const tenant = await prisma.tenant.findUnique({
    where: { subdomain },
    select: { id: true },
  })

  const allowed = Boolean(tenant?.id)
  corsOriginTenantCache.set(subdomain, {
    allowed,
    expiresAt: Date.now() + CORS_TENANT_CACHE_TTL_MS,
  })
  return allowed
}

app.use(
  cors({
    origin(origin, callback) {
      void isAllowedOrigin(origin)
        .then((allowed) => callback(null, allowed))
        .catch((error) => {
          console.error("cors-origin-check-failed", error)
          callback(null, false)
        })
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gufo-erp-backend",
    time: new Date().toISOString(),
  })
})

app.get("/api/v1/company/efactura/oauth/callback", handleAnafOauthCallback)

app.use(productsRouter)
app.use(metaRouter)
app.use(posRouter)
app.use(webAuthRouter)
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
