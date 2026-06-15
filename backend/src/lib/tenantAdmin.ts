import { UserRole } from "@prisma/client"
import { Response } from "express"
import { AuthedRequest } from "../middleware/requireAuth"

function normalizedControlPanelEmail() {
  return String(process.env.CONTROL_PANEL_EMAIL || "").trim().toLowerCase()
}

export function hasGlobalControlPanelAccess(req: AuthedRequest) {
  const role = req.auth?.role
  const email = String(req.auth?.email || "").trim().toLowerCase()
  const controlPanelEmail = normalizedControlPanelEmail()
  const controlPanelUserId = String(req.auth?.userId || "").trim()

  if (!req.auth?.controlPanel || req.auth?.tenantId) {
    return false
  }

  if (role !== UserRole.OWNER && role !== UserRole.ADMIN) {
    return false
  }

  if (!controlPanelEmail || email === controlPanelEmail) {
    return true
  }

  // Allow real DB-backed owner/admin accounts that were explicitly authenticated
  // for control panel access, even when the legacy fixed env email differs.
  return controlPanelUserId !== "control-panel-owner"
}

export function hasGlobalControlPanelOwnerAccess(req: AuthedRequest) {
  return hasGlobalControlPanelAccess(req) && req.auth?.role === UserRole.OWNER
}

export function hasTenantAdminAccess(req: AuthedRequest) {
  const role = req.auth?.role

  const isTenantAdmin = Boolean(
    req.auth?.tenantId && (role === UserRole.OWNER || role === UserRole.ADMIN),
  )

  return isTenantAdmin || hasGlobalControlPanelAccess(req)
}

export function ensureTenantAdminAccess(req: AuthedRequest, res: Response) {
  if (!hasTenantAdminAccess(req)) {
    res.status(403).json({ ok: false, error: "Acces permis doar administratorilor." })
    return false
  }
  return true
}
