import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/auth";

export type AuthedRequest = Request & {
  auth?: { tenantId: string; userId: string; role: string };
};

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const decoded = verifyAccessToken(token);
    req.auth = { tenantId: decoded.tenantId, userId: decoded.userId, role: decoded.role };
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}