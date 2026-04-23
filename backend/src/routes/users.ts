// @ts-nocheck
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
  posPin: z.string().trim().min(4).max(8).optional(),
  companyIds: z.array(z.string()).optional(),
})

const ToggleUserSchema = z.object({
  isActive: z.boolean(),
})

const UpdateUserCompaniesSchema = z.object({
  companyIds: z.array(z.string()).default([]),
})

const SetPosPinSchema = z.object({
  posPin: z.union([z.string().trim().min(4).max(8), z.literal(""), z.null()]).optional(),
})

async function listTenantCompanies(tenantId: string) {
  return prisma.company.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      cui: true,
      isDefault: true,
    },
  })
}

async function syncUserCompanyAccess(userId: string, companyIds: string[]) {
  await prisma.userCompanyAccess.deleteMany({
    where: { userId },
  })

  if (!companyIds.length) return

  await prisma.userCompanyAccess.createMany({
    data: companyIds.map((companyId) => ({
      userId,
      companyId,
    })),
    skipDuplicates: true,
  })
}

router.get("/api/v1/users", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const [users, availableCompanies] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: req.auth!.tenantId! },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        posPinHash: true,
        createdAt: true,
        updatedAt: true,
        companyAccesses: {
          select: {
            company: {
              select: {
                id: true,
                name: true,
                code: true,
                cui: true,
                isDefault: true,
              },
            },
          },
        },
      },
    }),
    listTenantCompanies(req.auth!.tenantId!),
  ])

  return res.json({
    ok: true,
    availableCompanies,
    items: users.map((user) => ({
      ...user,
      hasPosPin: Boolean(user.posPinHash),
      companies: user.companyAccesses.map((entry) => entry.company),
    })),
  })
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
  const availableCompanies = await listTenantCompanies(tenantId)
  const requestedCompanyIds = Array.from(new Set((parsed.data.companyIds || []).map((value) => String(value))))

  if (actorRole !== UserRole.OWNER && (requestedRole === UserRole.OWNER || requestedRole === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate crea admini sau owneri" })
  }

  const invalidCompanyIds = requestedCompanyIds.filter((companyId) => !availableCompanies.some((company) => company.id === companyId))
  if (invalidCompanyIds.length) {
    return res.status(400).json({ ok: false, error: "Una sau mai multe firme selectate nu exista." })
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
      posPinHash: parsed.data.posPin?.trim() ? await hashSecret(parsed.data.posPin.trim()) : null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      posPinHash: true,
      createdAt: true,
    },
  })

  if (requestedRole !== UserRole.OWNER && requestedRole !== UserRole.ADMIN) {
    await syncUserCompanyAccess(created.id, requestedCompanyIds)
  }

  return res.status(201).json({
    ok: true,
    item: {
      ...created,
      hasPosPin: Boolean(created.posPinHash),
      companies:
        requestedRole === UserRole.OWNER || requestedRole === UserRole.ADMIN
          ? availableCompanies
          : availableCompanies.filter((company) => requestedCompanyIds.includes(company.id)),
    },
    temporaryPassword: rawPassword,
  })
})

router.post("/api/v1/users/:id/pos-pin", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const parsed = SetPosPinSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId!
  const actorRole = req.auth!.role as UserRole
  const user = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
    },
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "Utilizatorul nu exista" })
  }

  if (actorRole !== UserRole.OWNER && (user.role === UserRole.OWNER || user.role === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate modifica PIN-ul POS pentru acest utilizator" })
  }

  const rawPin = typeof parsed.data.posPin === "string" ? parsed.data.posPin.trim() : ""
  const posPinHash = rawPin ? await hashSecret(rawPin) : null

  await prisma.user.update({
    where: { id: user.id },
    data: { posPinHash },
  })

  return res.json({
    ok: true,
    item: {
      id: user.id,
      hasPosPin: Boolean(posPinHash),
    },
  })
})

router.patch("/api/v1/users/:id/companies", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdmin(req, res)) return

  const parsed = UpdateUserCompaniesSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId!
  const actorRole = req.auth!.role as UserRole

  const user = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
    },
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "Utilizatorul nu exista" })
  }

  if (actorRole !== UserRole.OWNER && (user.role === UserRole.OWNER || user.role === UserRole.ADMIN)) {
    return res.status(403).json({ ok: false, error: "Doar owner-ul poate modifica accesul pentru acest utilizator" })
  }

  if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
    return res.status(400).json({ ok: false, error: "Administratorii au acces complet la toate firmele." })
  }

  const availableCompanies = await listTenantCompanies(tenantId)
  const requestedCompanyIds = Array.from(new Set(parsed.data.companyIds.map((value) => String(value))))
  const invalidCompanyIds = requestedCompanyIds.filter((companyId) => !availableCompanies.some((company) => company.id === companyId))

  if (invalidCompanyIds.length) {
    return res.status(400).json({ ok: false, error: "Una sau mai multe firme selectate nu exista." })
  }

  await syncUserCompanyAccess(user.id, requestedCompanyIds)

  return res.json({
    ok: true,
    item: {
      id: user.id,
      companies: availableCompanies.filter((company) => requestedCompanyIds.includes(company.id)),
    },
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
