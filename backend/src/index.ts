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

import { prisma } from "./lib/prisma"
import { signAccessToken, verifySecret } from "./lib/auth"
import { requireAuth, AuthedRequest } from "./middleware/requireAuth"

import productsRouter from "./routes/products"
import metaRouter from "./routes/meta"
import posRouter from "./routes/pos"
import stockRouter from "./routes/stock"
import purchaseRouter from "./routes/purchase"
import companyRouter from "./routes/company"
import purchaseReceiptsPdf from "./routes/purchaseReceiptsPdf"
import transferRouter from "./routes/transfer"
import dashboardRoutes from "./routes/dashboard"
import consumptionRouter from "./routes/consumption"
import consumptionDocsPdf from "./routes/consumptionDocsPdf"
import productionRouter from "./routes/production"
import productionDocsRouter from "./routes/productionDocs"

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 3001)
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret"

const uploadsDir = path.join(process.cwd(), "uploads")
const productUploadsDir = path.join(uploadsDir, "products")
const categoryUploadsDir = path.join(uploadsDir, "categories")

fs.mkdirSync(productUploadsDir, { recursive: true })
fs.mkdirSync(categoryUploadsDir, { recursive: true })

app.use(cors({ origin: CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: "10mb" }))
app.use(cookieParser())
app.use(morgan("dev"))
app.use("/uploads", express.static(uploadsDir))

function signPosToken(payload: { tenantId: string; terminalId: string; deviceId: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" })
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "poshard-saas-backend",
    time: new Date().toISOString()
  })
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  tenantId: z.string().optional()
})

app.post("/api/v1/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findFirst({
    where: {
      email,
      isActive: true
    }
  })

  if (!user) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" })
  }

  const ok = await verifySecret(password, user.passwordHash)
  if (!ok) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" })
  }

  const token = signAccessToken({
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role
  })

  return res.json({
    ok: true,
    access_token: token
  })
})

app.get("/api/v1/me", requireAuth, async (req: AuthedRequest, res) => {
  const auth = req.auth!
  const user = await prisma.user.findUnique({
    where: { id: auth.userId }
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "User not found" })
  }

  const license = await prisma.license.findFirst({
    where: {
      tenantId: auth.tenantId,
      isSuspended: false,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  })

  const modules = license
    ? [
        license.modDashboard ? "dashboard" : null,
        license.modDocuments ? "documents" : null,
        license.modInventory ? "inventory" : null,
        license.modNomenclature ? "nomenclature" : null,
        license.modSettings ? "settings" : null,
        license.modPos ? "pos" : null,
        license.modReports ? "reports" : null
      ].filter(Boolean)
    : []

  return res.json({
    ok: true,
    tenant_id: auth.tenantId,
    user_id: auth.userId,
    role: auth.role,
    modules,
    license: license
      ? {
          expiresAt: license.expiresAt,
          limits: {
            locations: license.limitLocations,
            terminals: license.limitTerminals
          }
        }
      : null
  })
})

const LicenseActivateSchema = z.object({
  license_key: z.string().min(6),
  device_id: z.string().min(3),
  app_version: z.string().min(1),
  location_code: z.string().optional()
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
      expiresAt: { gt: new Date() }
    },
    include: {
      tenant: true
    },
    take: 100
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
      error: "Invalid or expired license"
    })
  }

  let locationId: string | null = null

  if (location_code) {
    const loc = await prisma.location.findFirst({
      where: {
        tenantId: found.tenantId,
        code: location_code
      }
    })
    if (loc) locationId = loc.id
  }

  const terminal = await prisma.terminal.upsert({
    where: {
      tenantId_deviceId: {
        tenantId: found.tenantId,
        deviceId: device_id
      }
    },
    update: {
      locationId: locationId ?? undefined,
      label: `Android POS (${app_version})`
    },
    create: {
      tenantId: found.tenantId,
      deviceId: device_id,
      locationId: locationId ?? undefined,
      label: `Android POS (${app_version})`,
      isLockedToLocation: true
    }
  })

  const pos_token = signPosToken({
    tenantId: found.tenantId,
    terminalId: terminal.id,
    deviceId: terminal.deviceId
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
      documents: found.modDocuments
    }
  })
})

/* ======================================================
   POS PAIR PUBLIC - BYPASS DIRECT
====================================================== */

const PosPairSchema = z.object({
  licenseKey: z.string().optional(),
  license_key: z.string().optional(),
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  terminalLabel: z.string().optional(),
  terminal_label: z.string().optional()
})

app.post("/api/v1/pos/pair", async (req, res) => {
  try {
    console.log("INDEX POS PAIR BODY:", req.body)

    const parsed = PosPairSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() })
    }

    const body = parsed.data

    const licenseKey = normalizeText(body.licenseKey ?? body.license_key)
    const deviceId = normalizeText(body.deviceId ?? body.device_id)
    const terminalLabel =
      normalizeText(body.terminalLabel ?? body.terminal_label) || "Android POS"

    console.log("INDEX POS PAIR NORMALIZED:", {
      licenseKey,
      deviceId,
      terminalLabel
    })

    if (!licenseKey || licenseKey.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "License key lipsă sau invalid"
      })
    }

    if (!deviceId || deviceId.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Device ID lipsă sau invalid"
      })
    }

    const licenses = await prisma.license.findMany({
      where: {
        isSuspended: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" }
    })

    let found: (typeof licenses)[number] | null = null

    for (const lic of licenses) {
      const match = await bcrypt.compare(licenseKey, lic.keyHash)
      console.log("INDEX POS PAIR CHECK:", {
        licenseId: lic.id,
        tenantId: lic.tenantId,
        match
      })
      if (match) {
        found = lic
        break
      }
    }

    if (!found) {
      return res.status(401).json({
        ok: false,
        error: "Licență invalidă sau expirată"
      })
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
    })

    const locations = await prisma.location.findMany({
      where: { tenantId: found.tenantId },
      orderBy: { name: "asc" }
    })

    const token = signPosToken({
      tenantId: found.tenantId,
      terminalId: terminal.id,
      deviceId
    })

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
    })
  } catch (error) {
    console.error("INDEX POS PAIR ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Eroare internă la conectarea POS"
    })
  }
})

app.use(productsRouter)
app.use(metaRouter)
app.use(posRouter)
app.use(stockRouter)
app.use(purchaseRouter)
app.use(companyRouter)
app.use("/api/v1/purchase-receipts", purchaseReceiptsPdf)
app.use(transferRouter)
app.use(dashboardRoutes)
app.use(consumptionRouter)
app.use("/api/v1/consumption-docs", consumptionDocsPdf)
app.use(productionRouter)
app.use(productionDocsRouter)

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`)
})