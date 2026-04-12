import type { Response } from "express"
import type { AuthedRequest } from "../middleware/requireAuth"
import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "refreshToken",
  "accessToken",
  "authorization",
  "secret",
  "clientSecret",
])

function normalizeSegment(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function toActionName(method: string, path: string) {
  const cleanPath = path.replace(/^\/api\/v1\//, "").replace(/\/+$/, "")
  const segments = cleanPath.split("/").filter(Boolean)
  const scope = normalizeSegment(segments.slice(0, 2).join(" "))
    .replace(/\s+/g, "_")
    .toUpperCase()

  return `${method.toUpperCase()}_${scope || "API"}`
}

function toEntityType(path: string) {
  const cleanPath = path.replace(/^\/api\/v1\//, "").replace(/\/+$/, "")
  const [head = "Api"] = cleanPath.split("/").filter(Boolean)
  const base = normalizeSegment(head)
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

  return base || "Api"
}

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 3) return "[truncated]"

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeAuditValue(entry, depth + 1))
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40)
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        SENSITIVE_KEYS.has(key) ? "[redacted]" : sanitizeAuditValue(entry, depth + 1),
      ]),
    )
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value
  }

  return value
}

export function shouldWriteAuditLog(req: AuthedRequest, res: Response) {
  if (!req.auth?.userId || !req.auth?.tenantId) return false
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) return false
  if (!req.path.startsWith("/api/v1/")) return false
  if (req.path.startsWith("/api/v1/admin/")) return false
  if (req.path.startsWith("/api/v1/auth/")) return false
  if (req.path.startsWith("/api/v1/public/")) return false
  if (res.statusCode >= 400) return false
  return true
}

export async function writeAuditLogFromRequest(req: AuthedRequest, res: Response) {
  if (!shouldWriteAuditLog(req, res)) return

  const actorType = req.auth?.role === "OWNER" ? "OWNER" : "USER"

  await prisma.auditLog.create({
    data: {
      tenantId: req.auth?.tenantId,
      actorType,
      actorId: req.auth?.userId,
      action: toActionName(req.method, req.path),
      entityType: toEntityType(req.path),
      entityId: typeof req.params?.id === "string" ? req.params.id : null,
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      payload: sanitizeAuditValue({
        method: req.method,
        path: req.path,
        params: req.params || {},
        query: req.query || {},
        body: req.body || {},
        statusCode: res.statusCode,
      }) as Prisma.InputJsonValue,
    },
  })
}

export async function writeExplicitAuditLog(input: {
  tenantId?: string | null
  actorType?: "SYSTEM" | "OWNER" | "USER"
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  payload?: unknown
  ipAddress?: string | null
  userAgent?: string | null
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId || null,
      actorType: input.actorType || "SYSTEM",
      actorId: input.actorId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      payload: sanitizeAuditValue(input.payload) as Prisma.InputJsonValue,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    },
  })
}
