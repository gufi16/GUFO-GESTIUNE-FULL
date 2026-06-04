import { NextFunction, Response } from "express"
import { AuthedRequest } from "./requireAuth"
import { hasGlobalControlPanelOwnerAccess } from "../lib/tenantAdmin"

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ ok: false, error: "Missing token" })
  }

  if (!hasGlobalControlPanelOwnerAccess(req)) {
    return res.status(403).json({ ok: false, error: "Acces permis doar owner-ului" })
  }

  next()
}
