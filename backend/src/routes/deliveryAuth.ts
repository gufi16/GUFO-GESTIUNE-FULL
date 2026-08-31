import crypto from "crypto"
import { Router, type Request, type Response, type NextFunction } from "express"
import { DeliveryCustomerAuthProvider } from "@prisma/client"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { hashSecret, signAccessToken, verifyAccessToken, verifySecret } from "../lib/auth"

const router = Router()
const DELIVERY_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 45
const authRateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const AUTH_RATE_LIMIT_LIMIT = 12

export type DeliveryCustomerAuthRequest = Request & {
  deliveryCustomer?: {
    customerId: string
    sessionId: string
    email?: string | null
    phone?: string | null
  }
}

const RegisterSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).optional(),
  password: z.string().min(6),
}).refine((value) => Boolean(String(value.email || "").trim() || String(value.phone || "").trim()), {
  message: "Email sau telefon este obligatoriu.",
  path: ["email"],
})

const LoginSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(6),
})

const AddressSchema = z.object({
  label: z.string().trim().min(1),
  addressLine: z.string().trim().min(3),
  details: z.string().trim().optional(),
  city: z.string().trim().optional(),
  county: z.string().trim().optional(),
  country: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
})

function normalizeEmail(value: unknown) {
  const text = String(value || "").trim().toLowerCase()
  return text || null
}

function normalizePhone(value: unknown) {
  const text = String(value || "").trim().replace(/\s+/g, "")
  return text || null
}

function getRateLimitKey(req: Request, scope: string, identifier?: string | null) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim()
  const ip = forwardedFor || req.ip || "unknown-ip"
  const id = String(identifier || "").trim().toLowerCase()
  return id ? `${scope}:${ip}:${id}` : `${scope}:${ip}`
}

function checkSimpleRateLimit(req: Request, res: Response, scope: string, identifier?: string | null) {
  const now = Date.now()
  const key = getRateLimitKey(req, scope, identifier)
  const bucket = authRateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    authRateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  if (bucket.count >= AUTH_RATE_LIMIT_LIMIT) {
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

async function createDeliveryCustomerSession(customerId: string, email?: string | null) {
  const session = await prisma.deliveryCustomerSession.create({
    data: {
      customerId,
      expiresAt: new Date(Date.now() + DELIVERY_SESSION_TTL_MS),
      lastSeenAt: new Date(),
    },
  })

  const token = signAccessToken({
    tenantId: null,
    userId: customerId,
    role: "DELIVERY_CUSTOMER",
    email: email || undefined,
    sessionId: session.id,
  })

  return {
    session,
    token,
  }
}

async function revokeDeliveryCustomerSession(sessionId?: string | null) {
  if (!sessionId) return
  await prisma.deliveryCustomerSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })
}

function mapDeliveryCustomerResponse(customer: {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  authProvider: DeliveryCustomerAuthProvider
  addresses?: Array<{
    id: string
    label: string
    addressLine: string
    details: string | null
    city: string | null
    county: string | null
    country: string | null
    postalCode: string | null
    isDefault: boolean
  }>
}) {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    authProvider: customer.authProvider,
    addresses: (customer.addresses || []).map((address) => ({
      id: address.id,
      label: address.label,
      addressLine: address.addressLine,
      details: address.details,
      city: address.city,
      county: address.county,
      country: address.country,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    })),
  }
}

export async function requireDeliveryCustomerAuth(
  req: DeliveryCustomerAuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = String(req.headers.authorization || "")
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" })
  }

  try {
    const decoded = verifyAccessToken(token) as {
      userId?: string
      email?: string
      sessionId?: string | null
      role?: string
    }
    const customerId = String(decoded.userId || "").trim()
    const sessionId = String(decoded.sessionId || "").trim()
    if (!customerId || !sessionId || String(decoded.role || "").trim() !== "DELIVERY_CUSTOMER") {
      return res.status(401).json({ ok: false, error: "Invalid token" })
    }

    const session = await prisma.deliveryCustomerSession.findUnique({
      where: { id: sessionId },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
      },
    })

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return res.status(401).json({ ok: false, error: "Invalid session" })
    }

    if (!session.customer || !session.customer.isActive || session.customer.id !== customerId) {
      return res.status(401).json({ ok: false, error: "Invalid customer session" })
    }

    await prisma.deliveryCustomerSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + DELIVERY_SESSION_TTL_MS),
      },
    })

    req.deliveryCustomer = {
      customerId: session.customer.id,
      sessionId: session.id,
      email: session.customer.email,
      phone: session.customer.phone,
    }
    return next()
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" })
  }
}

router.post("/api/v1/public/delivery/auth/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req, res, "delivery-register", parsed.data.email || parsed.data.phone)) return

  const email = normalizeEmail(parsed.data.email)
  const phone = normalizePhone(parsed.data.phone)

  const existing = await prisma.deliveryCustomerAccount.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: { id: true },
  })

  if (existing) {
    return res.status(409).json({ ok: false, error: "Exista deja un cont cu acest email sau telefon." })
  }

  const passwordHash = await hashSecret(parsed.data.password)
  const customer = await prisma.deliveryCustomerAccount.create({
    data: {
      fullName: parsed.data.fullName.trim(),
      email,
      phone,
      passwordHash,
      authProvider: "PASSWORD",
      lastLoginAt: new Date(),
    },
    include: {
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  })

  const { session, token } = await createDeliveryCustomerSession(customer.id, customer.email)
  return res.status(201).json({
    ok: true,
    token,
    session: {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
    },
    customer: mapDeliveryCustomerResponse(customer),
  })
})

router.post("/api/v1/public/delivery/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req, res, "delivery-login", parsed.data.identifier)) return

  const identifier = parsed.data.identifier.trim()
  const email = normalizeEmail(identifier)
  const phone = normalizePhone(identifier)

  const customer = await prisma.deliveryCustomerAccount.findFirst({
    where: {
      authProvider: "PASSWORD",
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    include: {
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  })

  if (!customer?.passwordHash || !customer.isActive) {
    return res.status(401).json({ ok: false, error: "Credentiale invalide." })
  }

  const passwordOk = await verifySecret(parsed.data.password, customer.passwordHash)
  if (!passwordOk) {
    return res.status(401).json({ ok: false, error: "Credentiale invalide." })
  }

  await prisma.deliveryCustomerAccount.update({
    where: { id: customer.id },
    data: { lastLoginAt: new Date() },
  })

  const { session, token } = await createDeliveryCustomerSession(customer.id, customer.email)
  return res.json({
    ok: true,
    token,
    session: {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
    },
    customer: mapDeliveryCustomerResponse(customer),
  })
})

router.post("/api/v1/public/delivery/auth/logout", requireDeliveryCustomerAuth, async (req: DeliveryCustomerAuthRequest, res) => {
  await revokeDeliveryCustomerSession(req.deliveryCustomer?.sessionId)
  return res.json({ ok: true })
})

router.get("/api/v1/public/delivery/account/me", requireDeliveryCustomerAuth, async (req: DeliveryCustomerAuthRequest, res) => {
  const customer = await prisma.deliveryCustomerAccount.findUnique({
    where: { id: String(req.deliveryCustomer?.customerId || "") },
    include: {
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  })

  if (!customer || !customer.isActive) {
    return res.status(404).json({ ok: false, error: "Contul clientului nu a fost gasit." })
  }

  return res.json({
    ok: true,
    customer: mapDeliveryCustomerResponse(customer),
  })
})

router.post("/api/v1/public/delivery/account/addresses", requireDeliveryCustomerAuth, async (req: DeliveryCustomerAuthRequest, res) => {
  const parsed = AddressSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const customerId = String(req.deliveryCustomer?.customerId || "").trim()
  if (!customerId) {
    return res.status(401).json({ ok: false, error: "Missing customer context" })
  }

  const existingCount = await prisma.deliveryCustomerAddress.count({
    where: { customerId },
  })

  await prisma.$transaction(async (tx) => {
    if (existingCount === 0) {
      await tx.deliveryCustomerAddress.updateMany({
        where: { customerId },
        data: { isDefault: false },
      })
    }

    await tx.deliveryCustomerAddress.create({
      data: {
        customerId,
        label: parsed.data.label,
        addressLine: parsed.data.addressLine,
        details: parsed.data.details || null,
        city: parsed.data.city || null,
        county: parsed.data.county || null,
        country: parsed.data.country || "Romania",
        postalCode: parsed.data.postalCode || null,
        isDefault: existingCount === 0,
      },
    })
  })

  const customer = await prisma.deliveryCustomerAccount.findUnique({
    where: { id: customerId },
    include: {
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  })

  return res.json({
    ok: true,
    customer: customer ? mapDeliveryCustomerResponse(customer) : null,
  })
})

router.post("/api/v1/public/delivery/auth/social", async (_req, res) => {
  return res.status(501).json({
    ok: false,
    error: "Autentificarea Google/Facebook necesita configurarea cheilor OAuth pentru aplicatia Gufo Delivery.",
  })
})

export default router
