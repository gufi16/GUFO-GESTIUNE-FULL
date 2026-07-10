import crypto from "crypto"
import { Response, Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { createBrowserCsrfToken, issuePasswordResetToken } from "../lib/passwordReset"
import {
  CONTROL_AUTH_COOKIE,
  CONTROL_CSRF_COOKIE,
  ERP_AUTH_COOKIE,
  ERP_CSRF_COOKIE,
  clearControlAuthCookie,
  clearControlCsrfCookie,
  clearErpAuthCookie,
  clearErpCsrfCookie,
  clearErpTenantCookie,
  setControlAuthCookie,
  setControlCsrfCookie,
  setErpAuthCookie,
  setErpCsrfCookie,
  setErpTenantCookie,
  WEB_SESSION_TTL_MS,
} from "../lib/browserAuthCookies"
import {
  getOriginHostname,
  getRequestHostname,
  getTenantSubdomainFromHostname,
  getTenantSubdomainFromRequest,
  isHostedGufoBrowserRequest,
  resolveRequestedTenantId,
} from "../lib/tenantRequest"
import { hashSecret, signAccessToken, verifyAccessToken, verifySecret } from "../lib/auth"
import { hasSmtpConfig, sendMail } from "../lib/mailer"
import { hasGlobalControlPanelOwnerAccess } from "../lib/tenantAdmin"
import { writeExplicitAuditLog } from "../lib/audit"
import { AuthedRequest, requireAuth } from "../middleware/requireAuth"
import { loadEnv } from "../lib/loadEnv"
import { resolveEffectiveModuleCodes } from "../lib/moduleCatalog"

loadEnv()

const router = Router()
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
const ALLOW_DEV_CONTROL_PANEL_LOGIN = process.env.ALLOW_DEV_CONTROL_PANEL_LOGIN === "true"
const authRateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const AUTH_RATE_LIMITS = {
  erpLogin: 10,
  controlPanelLogin: 8,
  forgotPassword: 6,
} as const

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

function getRateLimitKey(req: AuthedRequest, scope: string, identifier?: string | null) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim()
  const ip = forwardedFor || req.ip || "unknown-ip"
  const id = String(identifier || "").trim().toLowerCase()
  return id ? `${scope}:${ip}:${id}` : `${scope}:${ip}`
}

function checkSimpleRateLimit(
  req: AuthedRequest,
  res: Response,
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

router.post("/api/v1/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req as AuthedRequest, res, "erpLogin", parsed.data.email)) return

  const { password, tenantId, tenantSubdomain } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()
  let scopedTenantId: string | undefined
  try {
    scopedTenantId = await resolveRequestedTenantId(req, tenantId, tenantSubdomain, {
      includeCookieFallback: false,
    })
  } catch (error: unknown) {
    return res.status(403).json({ ok: false, error: error instanceof Error ? error.message : "Tenant invalid." })
  }

  if (!scopedTenantId && isHostedGufoBrowserRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: "Autentificarea ERP este permisa doar pe subdomeniul clientului.",
    })
  }

  const candidates = await prisma.user.findMany({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
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

  const requestedSubdomain = getTenantSubdomainFromRequest(req, {
    includeCookieFallback: false,
  })
  const loginTenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { subdomain: true },
  })
  const loginTenantSubdomain = String(loginTenant?.subdomain || "").trim().toLowerCase()
  if (requestedSubdomain) {
    if (!loginTenantSubdomain || loginTenantSubdomain !== requestedSubdomain) {
      return res.status(403).json({
        ok: false,
        error: "Contul nu are acces pe acest subdomeniu.",
      })
    }
  }

  if (user.mustChangePassword) {
    const resetToken = await issuePasswordResetToken(user.id, user.tenantId)
    return res.status(403).json({
      ok: false,
      error: "Contul necesita schimbarea parolei inainte de autentificare.",
      requiresPasswordChange: true,
      resetToken,
    })
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
  if (loginTenantSubdomain) setErpTenantCookie(req, res, loginTenantSubdomain)
  else clearErpTenantCookie(req, res)

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

router.post("/api/v1/auth/select-company", requireAuth, async (req: AuthedRequest, res) => {
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
  const authTenant = await prisma.tenant.findUnique({
    where: { id: auth.tenantId },
    select: { subdomain: true },
  })
  const authTenantSubdomain = String(authTenant?.subdomain || "").trim().toLowerCase()
  if (authTenantSubdomain) {
    setErpTenantCookie(req, res, authTenantSubdomain)
  }

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

router.get("/api/v1/public/domain-allow", async (req, res) => {
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

router.post("/api/v1/admin/auth/login", async (req, res) => {
  const parsed = ControlPanelLoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req as AuthedRequest, res, "controlPanelLogin", parsed.data.email)) return

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
    // Keep going: a real OWNER account from the database may still authenticate.
  }

  const loginEmail = parsed.data.email.trim().toLowerCase()
  const loginPassword = parsed.data.password
  const matchesFixedControlAccount =
    Boolean(controlEmail && controlPassword) &&
    loginEmail === controlEmail &&
    loginPassword === controlPassword

  let controlUserId: string | null = null
  let controlRole: string = "OWNER"
  let controlSessionEmail = controlEmail || loginEmail

  if (!matchesFixedControlAccount) {
    const candidates = await prisma.user.findMany({
      where: {
        email: {
          equals: loginEmail,
          mode: "insensitive",
        },
        isActive: true,
        role: { in: ["OWNER", "ADMIN"] },
      },
      orderBy: { createdAt: "desc" },
    })

    let matchedOwner: (typeof candidates)[number] | null = null
    for (const candidate of candidates) {
      const ok = await verifySecret(loginPassword, candidate.passwordHash)
      if (ok) {
        matchedOwner = candidate
        break
      }
    }

    if (!matchedOwner) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" })
    }

    if (matchedOwner.mustChangePassword) {
      return res.status(403).json({
        ok: false,
        error: "Contul necesita schimbarea parolei inainte de autentificare.",
      })
    }

    controlUserId = matchedOwner.id
    controlRole = matchedOwner.role
    controlSessionEmail = matchedOwner.email
  }

  const token = signAccessToken({
    tenantId: null,
    userId: controlUserId || "control-panel-owner",
    role: controlRole,
    email: controlSessionEmail,
    controlPanel: true,
    sessionId: (
      await createWebSession({
        tenantId: null,
        userId: controlUserId,
        role: controlRole,
        email: controlSessionEmail,
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

router.post("/api/v1/auth/logout", async (req: AuthedRequest, res) => {
  const authHeader = String(req.headers.authorization || "")
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const cookieToken = String(req.cookies?.[ERP_AUTH_COOKIE] || "").trim()
  const token = bearerToken || cookieToken
  if (token) {
    try {
      const decoded = verifyAccessToken(token) as { sessionId?: string | null }
      await revokeWebSession(decoded.sessionId || null)
    } catch {}
  }
  clearErpAuthCookie(req, res)
  clearErpCsrfCookie(req, res)
  clearErpTenantCookie(req, res)
  return res.json({ ok: true })
})

router.post("/api/v1/admin/auth/logout", async (req: AuthedRequest, res) => {
  const authHeader = String(req.headers.authorization || "")
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const cookieToken = String(req.cookies?.[CONTROL_AUTH_COOKIE] || "").trim()
  const token = bearerToken || cookieToken
  if (token) {
    try {
      const decoded = verifyAccessToken(token) as { sessionId?: string | null }
      await revokeWebSession(decoded.sessionId || null)
    } catch {}
  }
  clearControlAuthCookie(req, res)
  clearControlCsrfCookie(req, res)
  return res.json({ ok: true })
})

router.post("/api/v1/auth/forgot-password", async (req, res) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }
  if (!checkSimpleRateLimit(req as AuthedRequest, res, "forgotPassword", parsed.data.email)) return

  if (!hasSmtpConfig()) {
    return res.status(503).json({
      ok: false,
      error: "Resetarea parolei nu este configurata inca.",
    })
  }

  const email = parsed.data.email.trim().toLowerCase()
  let scopedTenantId: string | undefined
  try {
    scopedTenantId = await resolveRequestedTenantId(req, parsed.data.tenantId, parsed.data.tenantSubdomain, {
      includeCookieFallback: false,
    })
  } catch {
    return res.json({
      ok: true,
      message: "Daca exista un cont pe acest email, am trimis instructiunile de resetare.",
    })
  }

  const users = await prisma.user.findMany({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
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
      const rawToken = await issuePasswordResetToken(user.id, user.tenantId)

      const publicBase =
        (user.tenant?.subdomain ? `https://${user.tenant.subdomain}.gufo.ink` : "") ||
        String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") ||
        String(req.headers.origin || "").trim().replace(/\/+$/, "") ||
        String(CORS_ORIGIN || "").trim().replace(/\/+$/, "")

      const resetUrl = `${publicBase}/reset-password?token=${rawToken}`
      const tenantName = String(user.tenant?.name || "firma ta").trim()
      const tenantSubdomain = String(user.tenant?.subdomain || "").trim().toLowerCase()
      const tenantBackofficeLabel = tenantSubdomain ? `${tenantName} (${tenantSubdomain}.gufo.ink)` : tenantName

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

router.post("/api/v1/auth/reset-password", async (req, res) => {
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
        mustChangePassword: false,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
        NOT: { id: resetToken.id },
      },
      data: { usedAt: new Date() },
    }),
    prisma.webSession.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
  ])

  return res.json({
    ok: true,
    message: "Parola a fost actualizata. Te poti autentifica din nou.",
  })
})

router.get("/api/v1/admin/me", requireAuth, async (req: AuthedRequest, res) => {
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

router.get("/api/v1/me", requireAuth, async (req: AuthedRequest, res) => {
  const auth = req.auth!
  if (!auth.tenantId) {
    return res.status(403).json({ ok: false, error: "Sesiune ERP invalida." })
  }
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
    },
    include: {
      module: {
        select: {
          code: true,
        },
      },
    },
  })

  const modules: string[] = license
    ? Array.from(
        resolveEffectiveModuleCodes(
          {
            dashboard: license.modDashboard,
            documents: license.modDocuments,
            inventory: license.modInventory,
            nomenclature: license.modNomenclature,
            settings: license.modSettings,
            pos: license.modPos,
            kds: license.modKds,
            reports: license.modReports,
          },
          activeTenantModules,
        ),
      )
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

export default router
