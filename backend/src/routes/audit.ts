import { UserRole } from "@prisma/client"
import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { AuthedRequest, requireAuth } from "../middleware/requireAuth"

const router = Router()

function ensureTenantAdmin(req: AuthedRequest, res: any) {
  const allowed = Boolean(
    req.auth?.tenantId && (req.auth?.role === UserRole.OWNER || req.auth?.role === UserRole.ADMIN),
  )

  if (!allowed) {
    res.status(403).json({ ok: false, error: "Acces permis doar administratorilor" })
    return false
  }

  return true
}

const AuditQuerySchema = z.object({
  q: z.string().optional(),
  actorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
})

router.get("/api/v1/audit-logs", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const parsed = AuditQuerySchema.safeParse(req.query || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const { q, actorId, dateFrom, dateTo } = parsed.data
  const limit = parsed.data.limit || 120
  const tenantId = req.auth!.tenantId!

  const where: any = {
    tenantId,
  }

  if (actorId) where.actorId = actorId

  const createdAt: Record<string, Date> = {}
  if (dateFrom) {
    const parsedFrom = new Date(dateFrom)
    if (!Number.isNaN(parsedFrom.getTime())) createdAt.gte = parsedFrom
  }
  if (dateTo) {
    const parsedTo = new Date(dateTo)
    if (!Number.isNaN(parsedTo.getTime())) createdAt.lte = parsedTo
  }
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt

  if (q?.trim()) {
    const term = q.trim()
    where.OR = [
      { action: { contains: term, mode: "insensitive" } },
      { entityType: { contains: term, mode: "insensitive" } },
    ]
  }

  const items = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      entityType: true,
      entityId: true,
      payload: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    },
  })

  const actorIds = Array.from(
    new Set(items.map((item) => item.actorId).filter((value): value is string => Boolean(value))),
  )
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      })
    : []

  const actorMap = new Map(users.map((user) => [user.id, user]))

  return res.json({
    ok: true,
    items: items.map((item) => {
      const actor = item.actorId ? actorMap.get(item.actorId) : null
      return {
        id: item.id,
        actorType: item.actorType,
        actorId: item.actorId,
        actorName: actor?.name || null,
        actorEmail: actor?.email || null,
        actorRole: actor?.role || null,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        payload: item.payload,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        createdAt: item.createdAt,
      }
    }),
  })
})

export default router
