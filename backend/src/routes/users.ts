import { UserRole } from "@prisma/client"
import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { AuthedRequest, requireAuth } from "../middleware/requireAuth"
import { hashSecret } from "../lib/auth"

const router = Router()

function requireTenantAdmin(req: AuthedRequest) {
  return Boolean(
    req.auth?.tenantId && (req.auth?.role === UserRole.OWNER || req.auth?.role === UserRole.ADMIN)
  )
}

function ensureTenantAdmin(req: AuthedRequest, res: any) {
  if (!requireTenantAdmin(req)) {
    res.status(403).json({ ok: false, error: "Acces permis doar administratorilor" })
    return false
  }
  return true
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let value = ""
  for (let index = 0; index < 10; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return value
}

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.nativeEnum(UserRole),
  password: z.string().min(6).optional(),
})

const ToggleUserSchema = z.object({
  isActive: z.boolean(),
})

router.get("/api/v1/users", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const users = await prisma.user.findMany({
    where: { tenantId: req.auth!.tenantId! },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return res.json({ ok: true, items: users })
})

router.post("/api/v1/users", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const parsed = CreateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId!
  const actorRole = req.auth!.role as UserRole
  const requestedRole = parsed.data.role

  if (actorRole !== UserRole.OWNER && (requestedRole === UserRole.OWNER || requestedRole === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate crea admini sau owneri" })
  }

  const existing = await prisma.user.findFirst({
    where: {
      tenantId,
      email: parsed.data.email.trim().toLowerCase(),
    },
  })

  if (existing) {
    return res.status(409).json({ ok: false, error: "Exista deja un utilizator cu acest email" })
  }

  const rawPassword = parsed.data.password?.trim() || generateTemporaryPassword()
  const created = await prisma.user.create({
    data: {
      tenantId,
      email: parsed.data.email.trim().toLowerCase(),
      name: parsed.data.name.trim(),
      role: requestedRole,
      isActive: true,
      passwordHash: await hashSecret(rawPassword),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  })

  return res.status(201).json({
    ok: true,
    item: created,
    temporaryPassword: rawPassword,
  })
})

router.post("/api/v1/users/:id/reset-password", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const tenantId = req.auth!.tenantId!
  const actorRole = req.auth!.role as UserRole

  const user = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "Utilizatorul nu exista" })
  }

  if (actorRole !== UserRole.OWNER && (user.role === UserRole.OWNER || user.role === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate reseta parola unui admin sau owner" })
  }

  const temporaryPassword = generateTemporaryPassword()

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(temporaryPassword) },
  })

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  return res.json({
    ok: true,
    item: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    temporaryPassword,
  })
})

router.patch("/api/v1/users/:id/status", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const parsed = ToggleUserSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId!
  const actorRole = req.auth!.role as UserRole
  const user = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "Utilizatorul nu exista" })
  }

  if (user.id === req.auth!.userId && !parsed.data.isActive) {
    return res.status(400).json({ ok: false, error: "Nu te poti dezactiva singur" })
  }

  if (actorRole !== UserRole.OWNER && (user.role === UserRole.OWNER || user.role === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate modifica acest utilizator" })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isActive: parsed.data.isActive },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  })

  return res.json({ ok: true, item: updated })
})

export default router
