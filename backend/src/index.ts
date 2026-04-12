// @ts-nocheck
import express from "express"
import cors from "cors"
import morgan from "morgan"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { z } from "zod"
import fs from "fs"
import path from "path"
import crypto from "crypto"

import { prisma } from "./lib/prisma"
import { hashSecret, signAccessToken, verifySecret } from "./lib/auth"
import { writeAuditLogFromRequest, writeExplicitAuditLog } from "./lib/audit"
import { requireAuth, AuthedRequest } from "./middleware/requireAuth"
import { hasSmtpConfig, sendMail } from "./lib/mailer"

import productsRouter from "./routes/products"
import metaRouter from "./routes/meta"
import posRouter, { buildCatalogPayload, handlePosSale, registerPairedPosSession, resolvePosAuthContext } from "./routes/pos"
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
import adminRouter from "./routes/admin"
import marketplaceRouter from "./routes/marketplace"
import salesInvoicesRouter from "./routes/salesInvoices"
import customersRouter from "./routes/customers"
import minutesDocsRouter from "./routes/minutesDocs"
import incomingEfacturaRouter from "./routes/incomingEfactura"
import spvClassicRouter from "./routes/spvClassic"
import usersRouter from "./routes/users"
import auditRouter from "./routes/audit"

dotenv.config()

const app = express()
app.set("trust proxy", true)
const PORT = Number(process.env.PORT || 3001)
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
const CORS_ORIGINS = CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean)
const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "dev_secret" : "")

const uploadsDir = path.join(process.cwd(), "uploads")
const productUploadsDir = path.join(uploadsDir, "products")
const categoryUploadsDir = path.join(uploadsDir, "categories")

fs.mkdirSync(productUploadsDir, { recursive: true })
fs.mkdirSync(categoryUploadsDir, { recursive: true })

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
  if (hostname === "app.gufo.ink" || hostname === "api.gufo.ink") return true
  if (hostname.endsWith(".gufo.ink")) return true

  return false
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
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
  res.on("finish", () => {
    void writeAuditLogFromRequest(req as AuthedRequest, res).catch((error) => {
      console.error("audit-log-write-failed", error)
    })
  })
  next()
})

function signPosToken(payload: { tenantId: string; terminalId: string; deviceId: string }) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is required in production")
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" })
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
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
  if (hostname === "gufo.ink" || hostname === "app.gufo.ink" || hostname === "api.gufo.ink") return null
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

async function resolveTenantIdFromRequestHost(req: express.Request) {
  const subdomain = getTenantSubdomainFromRequest(req)
  if (!subdomain) return null

  const tenant = await prisma.tenant.findFirst({
    where: { subdomain },
    select: { id: true },
  })

  return tenant?.id || null
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
})

const ResetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(6),
})

app.post("/api/v1/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const { email, password, tenantId, tenantSubdomain } = parsed.data
  const hostTenantId = await resolveTenantIdFromRequestHost(req)
  let requestedTenantId = tenantId || undefined

  if (!requestedTenantId && tenantSubdomain) {
    const tenant = await prisma.tenant.findFirst({
      where: { subdomain: normalizeSubdomain(tenantSubdomain) },
      select: { id: true },
    })
    requestedTenantId = tenant?.id || undefined
  }

  if (requestedTenantId && hostTenantId && requestedTenantId !== hostTenantId) {
    return res.status(403).json({ ok: false, error: "Tenantul nu corespunde subdomeniului." })
  }

  const scopedTenantId = requestedTenantId || hostTenantId || undefined

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

  const token = signAccessToken({
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    email: user.email,
  })

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
  })
})

app.get("/api/v1/public/domain-allow", async (req, res) => {
  const domain = String(req.query.domain || "").trim().toLowerCase().replace(/:\d+$/, "")

  if (!domain) {
    return res.status(400).send("missing domain")
  }

  if (domain === "app.gufo.ink" || domain === "api.gufo.ink") {
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

  const controlEmail = String(
    process.env.CONTROL_PANEL_EMAIL || (process.env.NODE_ENV !== "production" ? "owner@gufo.local" : "")
  )
    .trim()
    .toLowerCase()
  const controlPassword = String(
    process.env.CONTROL_PANEL_PASSWORD || (process.env.NODE_ENV !== "production" ? "gufo1234" : "")
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
  })

  return res.json({
    ok: true,
    access_token: token,
  })
})

app.post("/api/v1/auth/forgot-password", async (req, res) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  if (!hasSmtpConfig()) {
    return res.status(503).json({
      ok: false,
      error: "Resetarea parolei nu este configurata inca.",
    })
  }

  const email = parsed.data.email.trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: {
      email,
      isActive: true,
    },
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!user) {
    return res.json({
      ok: true,
      message: "Daca exista un cont pe acest email, am trimis instructiunile de resetare.",
    })
  }

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
    String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") ||
    String(req.headers.origin || "").trim().replace(/\/+$/, "") ||
    String(CORS_ORIGIN || "").trim().replace(/\/+$/, "")

  const resetUrl = `${publicBase}/reset-password?token=${rawToken}`

    try {
      await sendMail({
        to: user.email,
        subject: "Resetare parola Gufo ERP",
        text: [
          `Salut ${user.name},`,
          "",
          `Am primit o cerere de resetare a parolei pentru contul tau din ${user.tenant.name}.`,
          `Acceseaza linkul de mai jos pentru a seta o parola noua:`,
          resetUrl,
          "",
          "Linkul este valabil 60 de minute.",
          "Daca nu ai cerut resetarea parolei, poti ignora acest mesaj.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;color:#17324D">
            <h2 style="margin-bottom:12px">Resetare parola Gufo ERP</h2>
            <p>Salut <strong>${user.name}</strong>,</p>
            <p>Am primit o cerere de resetare a parolei pentru contul tau din <strong>${user.tenant.name}</strong>.</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#17324D;color:#fff;text-decoration:none;font-weight:700">
                Reseteaza parola
              </a>
            </p>
            <p style="margin-top:12px">Sau foloseste direct acest link:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p>Linkul este valabil 60 de minute.</p>
          </div>
        `,
      })
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
  const auth = req.auth!

  if (auth.role !== "OWNER") {
    return res.status(403).json({ ok: false, error: "Acces permis doar owner-ului" })
  }

  return res.json({
    ok: true,
    user_id: auth.userId,
    role: auth.role,
    email:
      auth.email ||
      process.env.CONTROL_PANEL_EMAIL ||
      (process.env.NODE_ENV !== "production" ? "owner@gufo.local" : "owner"),
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

  return res.json({
    ok: true,
    tenant_id: auth.tenantId,
    user_id: auth.userId,
    role: auth.role,
    name: user.name,
    email: user.email,
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
   DIRECT POS PAIR — prioritar, fără conflicte de router
====================================================== */

const DirectPosPairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  terminalLabel: z.string().optional(),
  terminal_label: z.string().optional(),
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
        error: "License key lipsă sau invalid",
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
        error: "Licență invalidă",
      })
    }

    const license = terminal.tenant.licenses[0]

    if (!license) {
      return res.status(404).json({
        ok: false,
        error: "Licență ERP inexistentă",
      })
    }

    if (license.isSuspended) {
      return res.status(403).json({
        ok: false,
        error: "Licența este suspendată",
      })
    }

    if (license.expiresAt <= new Date()) {
      return res.status(403).json({
        ok: false,
        error: "Licența este expirată",
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
      error: "Eroare internă la conectarea POS",
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
        error: "POS neautentificat. Fă pair din nou.",
      })
    }

    const company = await prisma.company.findUnique({
      where: { tenantId: auth.tenantId },
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
      error: "Eroare la încărcarea configurării POS",
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
        error: "POS neautentificat. Fă pair din nou.",
      })
    }

    const payload = await buildCatalogPayload(req, auth.tenantId)
    return res.json(payload)
  } catch (error) {
    console.error("INDEX POS CATALOG ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Eroare la încărcarea catalogului POS",
    })
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
app.use(adminRouter)
app.use(marketplaceRouter)
app.use(salesInvoicesRouter)
app.use(customersRouter)

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`)
})
