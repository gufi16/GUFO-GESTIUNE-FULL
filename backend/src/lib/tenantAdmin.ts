import { UserRole } from "@prisma/client"
import { Response } from "express"
import { AuthedRequest } from "../middleware/requireAuth"

function normalizedControlPanelEmail() {
  return String(process.env.CONTROL_PANEL_EMAIL || "").trim().toLowerCase()
}

export function hasTenantAdminAccess(req: AuthedRequest) {
  const role = req.auth?.role
  const email = String(req.auth?.email || "").trim().toLowerCase()
  const controlPanelEmail = normalizedControlPanelEmail()

  const isTenantAdmin = Boolean(
    req.auth?.tenantId && (role === UserRole.OWNER || role === UserRole.ADMIN),
  )
  const isGlobalControlPanelAdmin = Boolean(
    controlPanelEmail &&
      email === controlPanelEmail &&
      (role === UserRole.OWNER || role === UserRole.ADMIN),
  )

  return isTenantAdmin || isGlobalControlPanelAdmin
}

export function ensureTenantAdminAccess(req: AuthedRequest, res: Response) {
  if (!hasTenantAdminAccess(req)) {
    res.status(403).json({ ok: false, error: "Acces permis doar administratorilor." })
    return false
  }
  return true
}
