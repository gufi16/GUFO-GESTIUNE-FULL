import { UserRole } from "@prisma/client"
import { Response } from "express"
import { AuthedRequest } from "../middleware/requireAuth"

export function hasTenantAdminAccess(req: AuthedRequest) {
  return Boolean(
    req.auth?.tenantId && (req.auth?.role === UserRole.OWNER || req.auth?.role === UserRole.ADMIN)
  )
}

export function ensureTenantAdminAccess(req: AuthedRequest, res: Response) {
  if (!hasTenantAdminAccess(req)) {
    res.status(403).json({ ok: false, error: "Acces permis doar administratorilor." })
    return false
  }
  return true
}
