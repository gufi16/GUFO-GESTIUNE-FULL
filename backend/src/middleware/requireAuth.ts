import { Request, Response, NextFunction } from "express"
import { verifyAccessToken } from "../lib/auth"
import { prisma } from "../lib/prisma"

const ERP_AUTH_COOKIE = "gufo_erp_session"
const CONTROL_AUTH_COOKIE = "gufo_control_session"

export interface AuthedRequest extends Request {
  auth?: {
    userId: string
    tenantId?: string | null
    role: string
    email?: string | null
    activeCompanyId?: string | null
    controlPanel?: boolean
    sessionId?: string | null
  }
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === "/api/v1/company/efactura/oauth/callback") {
    return next()
  }

  if (req.path === "/api/v1/public/efactura/agent-download") {
    return next()
  }

  if (req.path === "/api/v1/public/efactura/agent-pairing/resolve") {
    return next()
  }

  if (req.path === "/api/v1/company/cui-lookup") {
    return next()
  }

  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const cookieToken =
    String(req.cookies?.[ERP_AUTH_COOKIE] || "").trim() ||
    String(req.cookies?.[CONTROL_AUTH_COOKIE] || "").trim()
  const token = bearerToken || cookieToken

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" })
  }

  const allowDevControlPanelToken =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_CONTROL_PANEL_TOKEN === "true"

  if (allowDevControlPanelToken && token === "DEV_CONTROL_PANEL_TOKEN") {
    req.auth = {
      userId: "dev-control-panel",
      tenantId: null,
      role: "OWNER",
      email: String(process.env.CONTROL_PANEL_EMAIL || "").trim().toLowerCase() || null,
      activeCompanyId: null,
      controlPanel: true,
    }
    return next()
  }

  try {
    const decoded = verifyAccessToken(token) as any

    if (decoded.sessionId) {
      const session = await (prisma as any).webSession.findUnique({
        where: { id: String(decoded.sessionId) },
        select: {
          id: true,
          userId: true,
          tenantId: true,
          role: true,
          email: true,
          activeCompanyId: true,
          controlPanel: true,
          expiresAt: true,
          revokedAt: true,
        },
      })

      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return res.status(401).json({ ok: false, error: "Invalid session" })
      }

      const decodedUserId = String(decoded.userId || decoded.user_id || decoded.id || "").trim()
      const decodedEmail = String(decoded.email || "").trim().toLowerCase()
      const sessionEmail = String(session.email || "").trim().toLowerCase()

      if (session.controlPanel) {
        if (!Boolean(decoded.controlPanel) || (sessionEmail && decodedEmail && sessionEmail !== decodedEmail)) {
          return res.status(401).json({ ok: false, error: "Invalid session" })
        }
      } else if (session.userId !== decodedUserId) {
        return res.status(401).json({ ok: false, error: "Invalid session" })
      }
    }

    req.auth = {
      userId: decoded.userId || decoded.user_id || decoded.id,
      tenantId: decoded.tenantId || decoded.tenant_id || null,
      role: decoded.role,
      email: decoded.email || null,
      activeCompanyId: decoded.activeCompanyId || decoded.active_company_id || null,
      controlPanel: Boolean(decoded.controlPanel),
      sessionId: decoded.sessionId || null,
    }

    if (!req.auth.userId || !req.auth.role) {
      return res.status(401).json({ ok: false, error: "Invalid token" })
    }

    return next()
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" })
  }
}
