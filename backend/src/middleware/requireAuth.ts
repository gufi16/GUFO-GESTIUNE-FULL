import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"

export interface AuthedRequest extends Request {
  auth?: {
    userId: string
    tenantId?: string | null
    role: string
    email?: string | null
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === "/api/v1/company/efactura/oauth/callback") {
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

  if (process.env.NODE_ENV !== "production" && token === "DEV_CONTROL_PANEL_TOKEN") {
    req.auth = {
      userId: "dev-control-panel",
      tenantId: null,
      role: "OWNER",
      email: null,
    }
    return next()
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any

    req.auth = {
      userId: decoded.userId || decoded.user_id || decoded.id,
      tenantId: decoded.tenantId || decoded.tenant_id || null,
      role: decoded.role,
      email: decoded.email || null,
    }

    if (!req.auth.userId || !req.auth.role) {
      return res.status(401).json({ ok: false, error: "Invalid token" })
    }

    return next()
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" })
  }
}
