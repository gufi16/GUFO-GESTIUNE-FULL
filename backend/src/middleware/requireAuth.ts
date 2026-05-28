import { Request, Response, NextFunction } from "express"
import { verifyAccessToken } from "../lib/auth"

export interface AuthedRequest extends Request {
  auth?: {
    userId: string
    tenantId?: string | null
    role: string
    email?: string | null
    activeCompanyId?: string | null
    controlPanel?: boolean
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
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

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Missing token" })
  }

  const token = authHeader.slice(7).trim()

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

    req.auth = {
      userId: decoded.userId || decoded.user_id || decoded.id,
      tenantId: decoded.tenantId || decoded.tenant_id || null,
      role: decoded.role,
      email: decoded.email || null,
      activeCompanyId: decoded.activeCompanyId || decoded.active_company_id || null,
      controlPanel: Boolean(decoded.controlPanel),
    }

    if (!req.auth.userId || !req.auth.role) {
      return res.status(401).json({ ok: false, error: "Invalid token" })
    }

    return next()
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" })
  }
}
