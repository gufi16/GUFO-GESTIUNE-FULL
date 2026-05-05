// @ts-nocheck
import { Router } from "express"
import bcrypt from "bcryptjs"
import { UserRole } from "@prisma/client"
import { z } from "zod"

import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { hashSecret } from "../lib/auth"
import { buildTenantExportZip } from "../lib/tenantExport"

const router = Router()

function requireOwner(req: AuthedRequest, res: any, next: any) {
  if (!req.auth) {
    return res.status(401).json({ ok: false, error: "Missing token" })
  }

  if (req.auth.role !== UserRole.OWNER) {
    return res.status(403).json({ ok: false, error: "Acces permis doar owner-ului" })
  }

  next()
}

function slugify(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "client"
  )
}

const RESERVED_SUBDOMAINS = new Set(["app", "api", "www", "admin", "cp", "mail", "docs", "support"])

function normalizeSubdomain(value?: string | null) {
  const normalized = slugify(String(value || ""))
  return normalized || "client"
}

function buildTenantPortalUrl(subdomain?: string | null) {
  if (!subdomain) return null
  return `https://${subdomain}.gufo.ink`
}

function pickPrimaryCompany(companies?: Array<any> | null) {
  if (!Array.isArray(companies) || !companies.length) return null
  return companies.find((company) => company?.isDefault) || companies[0] || null
}

function serializeCompanySummary(company?: any | null) {
  if (!company) return null
  return {
    id: company.id,
    name: company.name,
    code: company.code,
    cui: company.cui,
    regNo: company.regNo,
    address: company.address,
    email: company.email,
    phone: company.phone,
    isDefault: company.isDefault,
    createdAt: company.createdAt,
  }
}

function toNullableText(value: unknown) {
  const text = String(value ?? "").trim()
  return text || null
}

function buildStructuredLocationAddress(data: {
  street?: string | null
  streetNo?: string | null
  building?: string | null
  staircase?: string | null
  floor?: string | null
  apartment?: string | null
  details?: string | null
}) {
  const streetLine = [data.street, data.streetNo ? `Nr. ${data.streetNo}` : null].filter(Boolean).join(" ").trim()
  const secondaryLine = [
    data.building ? `Bl. ${data.building}` : null,
    data.staircase ? `Sc. ${data.staircase}` : null,
    data.floor ? `Et. ${data.floor}` : null,
    data.apartment ? `Ap. ${data.apartment}` : null,
  ]
    .filter(Boolean)
    .join(", ")
    .trim()
  return [streetLine, secondaryLine, data.details].filter(Boolean).join(", ").trim() || null
}

function resolveOwnedCompany(companies: Array<any>, requestedCompanyId?: string | null) {
  if (!Array.isArray(companies) || !companies.length) return null
  if (requestedCompanyId) {
    return companies.find((company) => company.id === requestedCompanyId) || null
  }
  return pickPrimaryCompany(companies)
}

async function generateUniqueTenantSubdomain(value: string) {
  const base = normalizeSubdomain(value)
  let candidate = RESERVED_SUBDOMAINS.has(base) ? `${base}-client` : base
  let index = 1

  while (await prisma.tenant.findFirst({ where: { subdomain: candidate } })) {
    candidate = `${base}-${index}`.slice(0, 50)
    index += 1
  }

  if (RESERVED_SUBDOMAINS.has(candidate)) {
    candidate = `${candidate}-1`.slice(0, 50)
  }

  return candidate
}

function addDays(base: Date, days: number) {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

function parseOptionalDate(value?: string | null) {
  if (!value || !value.trim()) return undefined

  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value
  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return undefined
  }

  return date
}

function moduleMapFromLicense(license: {
  modDashboard: boolean
  modDocuments: boolean
  modInventory: boolean
  modNomenclature: boolean
  modSettings: boolean
  modPos: boolean
  modReports: boolean
}) {
  return {
    dashboard: Boolean(license.modDashboard),
    documents: Boolean(license.modDocuments),
    inventory: Boolean(license.modInventory),
    nomenclature: Boolean(license.modNomenclature),
    settings: Boolean(license.modSettings),
    pos: Boolean(license.modPos),
    reports: Boolean(license.modReports),
  }
}

function randomChunk(length = 4) {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length)
}

function generateTemporaryPassword(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let value = ""
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return value
}

async function generateUniqueLocationCode(tenantId: string, companyId: string | null | undefined, name: string) {
  const base = slugify(name).replace(/-/g, "").toUpperCase().slice(0, 6) || "LOC"
  let code = base
  let index = 1

  while (await prisma.location.findFirst({ where: { tenantId, companyId: companyId ?? null, code } })) {
    code = `${base}${index}`.slice(0, 10)
    index += 1
  }

  return code
}

async function generateUniqueDeviceId(tenantId: string, companyId: string | null | undefined) {
  let deviceId = `POS-${randomChunk(4)}-${randomChunk(4)}`

  while (await prisma.terminal.findFirst({ where: { tenantId, companyId: companyId ?? null, deviceId } })) {
    deviceId = `POS-${randomChunk(4)}-${randomChunk(4)}`
  }

  return deviceId
}

const CreateClientSchema = z.object({
  companyName: z.string().min(2),
  subdomain: z.string().optional(),
  cui: z.string().optional(),
  regNo: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  contactName: z.string().optional(),
  licenseKey: z.string().min(6),
  expiresAt: z.string().optional(),
  limitLocations: z.coerce.number().int().min(1).default(1),
  limitTerminals: z.coerce.number().int().min(1).default(1),
  modules: z
    .object({
      dashboard: z.boolean().default(true),
      documents: z.boolean().default(true),
      inventory: z.boolean().default(true),
      nomenclature: z.boolean().default(true),
      settings: z.boolean().default(true),
      pos: z.boolean().default(true),
      reports: z.boolean().default(false),
    })
    .default({
      dashboard: true,
      documents: true,
      inventory: true,
      nomenclature: true,
      settings: true,
      pos: true,
      reports: false,
    }),
})

const UpdateLicenseSchema = z.object({
  expiresAt: z.string().nullable().optional(),
  limitLocations: z.coerce.number().int().min(1).optional(),
  limitTerminals: z.coerce.number().int().min(1).optional(),
  isSuspended: z.boolean().optional(),
  modules: z
    .object({
      dashboard: z.boolean().optional(),
      documents: z.boolean().optional(),
      inventory: z.boolean().optional(),
      nomenclature: z.boolean().optional(),
      settings: z.boolean().optional(),
      pos: z.boolean().optional(),
      reports: z.boolean().optional(),
    })
    .optional(),
})

const ResetUserPasswordSchema = z.object({
  newPassword: z.string().min(4).optional(),
})

const AdminCreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.nativeEnum(UserRole),
  password: z.string().min(6).optional(),
})

const AdminUpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(2).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
})

const CreateLocationSchema = z.object({
  name: z.string().min(2),
  companyId: z.string().optional().nullable(),
  street: z.string().optional(),
  streetNo: z.string().optional(),
  building: z.string().optional(),
  staircase: z.string().optional(),
  floor: z.string().optional(),
  apartment: z.string().optional(),
  details: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
})

const CreateDeviceSchema = z.object({
  label: z.string().min(2),
})

const PosLicenseValidateSchema = z.object({
  licenseKey: z.string().min(3),
})

const PlatformEFacturaSchema = z.object({
  efacturaOauthClientId: z.string().optional(),
  efacturaOauthClientSecret: z.string().optional(),
  efacturaOauthRedirectUri: z.string().optional(),
  efacturaEnvironment: z.enum(["test", "prod"]).optional(),
})

const TenantEfacturaModuleSchema = z.object({
  enabled: z.boolean(),
})

const UpdateTenantSubdomainSchema = z.object({
  subdomain: z.string().min(2),
})

const AddTenantCompanySchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  cui: z.string().optional(),
  regNo: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
})

router.get("/api/v1/admin/platform/efactura", requireAuth, requireOwner, async (_req, res) => {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "global" },
  })

  return res.json({
    ok: true,
    item: {
      efacturaOauthClientId: config?.efacturaOauthClientId || "",
      efacturaOauthClientSecret: config?.efacturaOauthClientSecret || "",
      efacturaOauthRedirectUri: config?.efacturaOauthRedirectUri || "",
      efacturaEnvironment: config?.efacturaEnvironment || "test",
      configured: Boolean(
        config?.efacturaOauthClientId &&
          config?.efacturaOauthClientSecret &&
          config?.efacturaOauthRedirectUri,
      ),
    },
  })
})

router.post("/api/v1/admin/platform/efactura", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = PlatformEFacturaSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const data = parsed.data

  const config = await prisma.platformConfig.upsert({
    where: { key: "global" },
    update: {
      efacturaOauthClientId: data.efacturaOauthClientId?.trim() || null,
      efacturaOauthClientSecret: data.efacturaOauthClientSecret?.trim() || null,
      efacturaOauthRedirectUri: data.efacturaOauthRedirectUri?.trim() || null,
      efacturaEnvironment: data.efacturaEnvironment || "test",
    },
    create: {
      key: "global",
      efacturaOauthClientId: data.efacturaOauthClientId?.trim() || null,
      efacturaOauthClientSecret: data.efacturaOauthClientSecret?.trim() || null,
      efacturaOauthRedirectUri: data.efacturaOauthRedirectUri?.trim() || null,
      efacturaEnvironment: data.efacturaEnvironment || "test",
    },
  })

  await prisma.auditLog.create({
    data: {
      actorType: "OWNER",
      actorId: req.auth?.userId,
      action: "PLATFORM_EFACTURA_UPDATED",
      entityType: "PlatformConfig",
      entityId: config.id,
      payload: {
        efacturaEnvironment: config.efacturaEnvironment,
        hasClientId: Boolean(config.efacturaOauthClientId),
        hasClientSecret: Boolean(config.efacturaOauthClientSecret),
        hasRedirectUri: Boolean(config.efacturaOauthRedirectUri),
      },
    },
  })

  return res.json({
    ok: true,
    item: {
      efacturaOauthClientId: config.efacturaOauthClientId || "",
      efacturaOauthClientSecret: config.efacturaOauthClientSecret || "",
      efacturaOauthRedirectUri: config.efacturaOauthRedirectUri || "",
      efacturaEnvironment: config.efacturaEnvironment || "test",
      configured: Boolean(
        config.efacturaOauthClientId &&
          config.efacturaOauthClientSecret &&
          config.efacturaOauthRedirectUri,
      ),
    },
  })
})

router.post("/api/v1/admin/clients/:id/modules/efactura", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = TenantEfacturaModuleSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const moduleRecord = await prisma.appModule.upsert({
    where: { code: "efactura" },
    update: {
      name: "e-Factura",
      description: "Integrare ANAF e-Factura",
      target: "GESTIUNE",
      isActive: true,
    },
    create: {
      code: "efactura",
      name: "e-Factura",
      description: "Integrare ANAF e-Factura",
      target: "GESTIUNE",
      isCore: false,
      isActive: true,
    },
  })

  const relation = await prisma.tenantModule.upsert({
    where: {
      tenantId_moduleId: {
        tenantId: tenant.id,
        moduleId: moduleRecord.id,
      },
    },
    update: {
      enabled: parsed.data.enabled,
      source: "control_panel",
    },
    create: {
      tenantId: tenant.id,
      moduleId: moduleRecord.id,
      enabled: parsed.data.enabled,
      source: "control_panel",
    },
    include: {
      module: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorType: "OWNER",
      actorId: req.auth?.userId,
      action: "TENANT_EFACTURA_MODULE_UPDATED",
      entityType: "TenantModule",
      entityId: relation.id,
      payload: {
        tenantId: tenant.id,
        tenantName: tenant.name,
        enabled: relation.enabled,
        moduleCode: relation.module.code,
      },
    },
  })

  return res.json({
    ok: true,
    item: {
      id: relation.id,
      enabled: relation.enabled,
      code: relation.module.code,
      name: relation.module.name,
    },
  })
})

router.get("/api/v1/admin/clients", requireAuth, requireOwner, async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      companies: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
      users: {
        where: { isActive: true },
        select: { id: true },
      },
      locations: {
        where: { isActive: true },
        select: { id: true },
      },
      terminals: {
        select: { id: true },
      },
      licenses: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          plan: true,
        },
      },
      tenantModules: {
        where: { enabled: true },
        include: { module: true },
      },
    },
  })

  return res.json({
    ok: true,
    items: tenants.map((tenant) => {
      const primaryCompany = pickPrimaryCompany((tenant as any).companies)
      const latestLicense = tenant.licenses[0] || null
      const latestSubscription = tenant.subscriptions[0] || null

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.subdomain || primaryCompany?.cui || slugify(tenant.name),
        subdomain: tenant.subdomain,
        portalUrl: buildTenantPortalUrl(tenant.subdomain),
        company: primaryCompany
          ? {
              id: primaryCompany.id,
              name: primaryCompany.name,
              cui: primaryCompany.cui,
              email: primaryCompany.email,
              phone: primaryCompany.phone,
            }
          : null,
        status: !latestLicense
          ? "inactive"
          : latestLicense.isSuspended
            ? "suspended"
            : latestLicense.expiresAt > new Date()
              ? "active"
              : "expired",
        createdAt: tenant.createdAt,
        usersCount: tenant.users.length,
        locationsCount: tenant.locations.length,
        terminalsCount: tenant.terminals.length,
        license: latestLicense
          ? {
              id: latestLicense.id,
              expiresAt: latestLicense.expiresAt,
              isSuspended: latestLicense.isSuspended,
              limits: {
                locations: latestLicense.limitLocations,
                terminals: latestLicense.limitTerminals,
              },
              modules: moduleMapFromLicense(latestLicense),
            }
          : null,
        subscription: latestSubscription
          ? {
              id: latestSubscription.id,
              status: latestSubscription.status,
              billingStatus: latestSubscription.billingStatus,
              billingCycle: latestSubscription.billingCycle,
              price: latestSubscription.price,
              currency: latestSubscription.currency,
              nextBillingDate: latestSubscription.nextBillingDate,
              plan: latestSubscription.plan
                ? {
                    id: latestSubscription.plan.id,
                    code: latestSubscription.plan.code,
                    name: latestSubscription.plan.name,
                  }
                : null,
            }
          : null,
        activeModules: tenant.tenantModules.map((row) => ({
          code: row.module.code,
          name: row.module.name,
          limitValue: row.limitValue,
        })),
      }
    }),
  })
})

router.get("/api/v1/admin/clients/:id", requireAuth, requireOwner, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: {
      companies: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
      users: {
        where: { isActive: true },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          companyAccesses: {
            include: {
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
      },
      locations: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          companyId: true,
          company: {
            select: {
              id: true,
              name: true,
              code: true,
              isDefault: true,
            },
          },
        },
      },
      terminals: {
        orderBy: { createdAt: "desc" },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              code: true,
              isDefault: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              code: true,
              companyId: true,
              company: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  isDefault: true,
                },
              },
            },
          },
        },
      },
      licenses: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          plan: true,
        },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 80,
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
      },
      tenantModules: {
        where: { enabled: true },
        include: { module: true },
      },
    },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const latestLicense = tenant.licenses[0] || null
  const primaryCompany = pickPrimaryCompany((tenant as any).companies)
  const latestSubscription = tenant.subscriptions[0] || null
  const actorIds = Array.from(new Set(tenant.auditLogs.map((row) => row.actorId).filter(Boolean)))
  const actorUsers = actorIds.length
    ? await prisma.user.findMany({
        where: {
          id: { in: actorIds },
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      })
    : []
  const actorMap = new Map(actorUsers.map((user) => [user.id, user]))

  const terminalsByLocation = new Map<string, typeof tenant.terminals>()
  for (const terminal of tenant.terminals) {
    const key = terminal.locationId || "__unassigned__"
    const list = terminalsByLocation.get(key) || []
    list.push(terminal)
    terminalsByLocation.set(key, list)
  }

  return res.json({
    ok: true,
    item: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.subdomain || primaryCompany?.cui || slugify(tenant.name),
      subdomain: tenant.subdomain,
      portalUrl: buildTenantPortalUrl(tenant.subdomain),
      company: primaryCompany
        ? {
            id: primaryCompany.id,
            name: primaryCompany.name,
            cui: primaryCompany.cui,
            email: primaryCompany.email,
            phone: primaryCompany.phone,
            regNo: primaryCompany.regNo,
            address: primaryCompany.address,
          }
        : null,
      companies: Array.isArray((tenant as any).companies)
        ? (tenant as any).companies.map((company: any) => serializeCompanySummary(company))
        : [],
      status: !latestLicense
        ? "inactive"
        : latestLicense.isSuspended
          ? "suspended"
          : latestLicense.expiresAt > new Date()
            ? "active"
            : "expired",
      createdAt: tenant.createdAt,
      usersCount: tenant.users.length,
      locationsCount: tenant.locations.length,
      terminalsCount: tenant.terminals.length,
      users: tenant.users.map((user) => ({
        ...user,
        fullName: user.name,
        companies:
          user.role === "OWNER" || user.role === "ADMIN"
            ? (tenant as any).companies.map((company: any) => serializeCompanySummary(company))
            : Array.isArray(user.companyAccesses)
              ? user.companyAccesses.map((access) => serializeCompanySummary(access.company)).filter(Boolean)
              : [],
      })),
      locations: tenant.locations.map((location) => {
        const devices = terminalsByLocation.get(location.id) || []
        return {
          id: location.id,
          name: location.name,
          code: location.code,
          isActive: location.isActive,
          address: location.address,
          street: location.street,
          streetNo: location.streetNo,
          building: location.building,
          staircase: location.staircase,
          floor: location.floor,
          apartment: location.apartment,
          details: location.details,
          city: location.city,
          county: location.county,
          country: location.country,
          postalCode: location.postalCode,
          companyId: location.companyId,
          company: serializeCompanySummary(location.company),
          terminalsCount: devices.length,
          devices: devices.map((device) => ({
            id: device.id,
            deviceId: device.deviceId,
            label: device.label,
            createdAt: device.createdAt,
            isLockedToLocation: device.isLockedToLocation,
            licenseKey: device.deviceId,
            companyId: device.companyId,
            company: serializeCompanySummary(device.company),
          })),
        }
      }),
      terminals: tenant.terminals.map((terminal) => ({
        id: terminal.id,
        deviceId: terminal.deviceId,
        label: terminal.label,
        isLockedToLocation: terminal.isLockedToLocation,
        createdAt: terminal.createdAt,
        companyId: terminal.companyId,
        company: serializeCompanySummary(terminal.company),
        location: terminal.location,
      })),
      license: latestLicense
        ? {
            id: latestLicense.id,
            expiresAt: latestLicense.expiresAt,
            isSuspended: latestLicense.isSuspended,
            limits: {
              locations: latestLicense.limitLocations,
              terminals: latestLicense.limitTerminals,
            },
            modules: moduleMapFromLicense(latestLicense),
          }
        : null,
      subscription: latestSubscription
        ? {
            id: latestSubscription.id,
            status: latestSubscription.status,
            billingStatus: latestSubscription.billingStatus,
            billingCycle: latestSubscription.billingCycle,
            price: latestSubscription.price,
            currency: latestSubscription.currency,
            nextBillingDate: latestSubscription.nextBillingDate,
            plan: latestSubscription.plan
              ? {
                  id: latestSubscription.plan.id,
                  code: latestSubscription.plan.code,
                  name: latestSubscription.plan.name,
                }
              : null,
          }
        : null,
      activeModules: tenant.tenantModules.map((row) => ({
        code: row.module.code,
        name: row.module.name,
        limitValue: row.limitValue,
      })),
      auditLogs: tenant.auditLogs.map((entry) => {
        const actor = entry.actorId ? actorMap.get(entry.actorId) : null
        return {
          id: entry.id,
          actorType: entry.actorType,
          actorId: entry.actorId,
          actorName: actor?.name || null,
          actorEmail: actor?.email || null,
          actorRole: actor?.role || null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          payload: entry.payload,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          createdAt: entry.createdAt,
        }
      }),
    },
  })
})

router.patch("/api/v1/admin/clients/:id/subdomain", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = UpdateTenantSubdomainSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, subdomain: true },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const requestedSubdomain = normalizeSubdomain(parsed.data.subdomain)

  if (RESERVED_SUBDOMAINS.has(requestedSubdomain)) {
    return res.status(409).json({ ok: false, error: "Subdomeniul este rezervat." })
  }

  const existingTenant = await prisma.tenant.findFirst({
    where: {
      subdomain: requestedSubdomain,
      NOT: { id: tenant.id },
    },
    select: { id: true },
  })

  if (existingTenant) {
    return res.status(409).json({ ok: false, error: "Subdomeniul este deja folosit." })
  }

  const updatedTenant = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { subdomain: requestedSubdomain },
    select: {
      id: true,
      name: true,
      subdomain: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorType: "OWNER",
      actorId: req.auth?.userId,
      action: "TENANT_SUBDOMAIN_UPDATED",
      entityType: "Tenant",
      entityId: tenant.id,
      payload: {
        tenantName: tenant.name,
        previousSubdomain: tenant.subdomain,
        nextSubdomain: updatedTenant.subdomain,
      },
    },
  })

  return res.json({
    ok: true,
    item: {
      id: updatedTenant.id,
      name: updatedTenant.name,
      subdomain: updatedTenant.subdomain,
      portalUrl: buildTenantPortalUrl(updatedTenant.subdomain),
    },
  })
})

router.get("/api/v1/admin/clients/:id/export", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  try {
    const { zip, filename } = await buildTenantExportZip(req.params.id)

    await prisma.auditLog.create({
      data: {
        tenantId: req.params.id,
        actorType: "OWNER",
        actorId: req.auth?.userId,
        action: "TENANT_EXPORT_CREATED",
        entityType: "Tenant",
        entityId: req.params.id,
        payload: {
          filename,
        },
      },
    })

    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    return res.send(zip.toBuffer())
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut genera exportul clientului.",
    })
  }
})

router.post("/api/v1/admin/clients", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = CreateClientSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const data = parsed.data
  const now = new Date()
  const expiresAt = parseOptionalDate(data.expiresAt) || addDays(now, 30)
  const keyHash = await bcrypt.hash(data.licenseKey, 10)
  const keyPrefix = data.licenseKey.slice(0, 4).toUpperCase()
  const subdomain = await generateUniqueTenantSubdomain(data.subdomain?.trim() || data.companyName)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.companyName,
          subdomain,
          companies: {
            create: {
              name: data.companyName,
              code: "FIRMA-1",
              isDefault: true,
              cui: data.cui?.trim() || null,
              regNo: data.regNo?.trim() || null,
              address: data.address?.trim() || null,
              email: data.email?.trim() || null,
              phone: data.phone?.trim() || null,
            },
          },
          licenses: {
            create: {
              keyHash,
              keyPrefix,
              expiresAt,
              isSuspended: false,
              modDashboard: data.modules.dashboard,
              modDocuments: data.modules.documents,
              modInventory: data.modules.inventory,
              modNomenclature: data.modules.nomenclature,
              modSettings: data.modules.settings,
              modPos: data.modules.pos,
              modReports: data.modules.reports,
              limitLocations: data.limitLocations,
              limitTerminals: data.limitTerminals,
            },
          },
        },
        include: {
          companies: {
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          },
          licenses: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })

      const defaultPassword = "123456"
      const passwordHash = await bcrypt.hash(defaultPassword, 10)

      const erpUser = await tx.user.create({
        data: {
          email: data.email?.trim() || `admin@${tenant.id}.local`,
          name: data.contactName?.trim() || "Administrator",
          passwordHash,
          role: UserRole.OWNER,
          tenantId: tenant.id,
          isActive: true,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "TENANT_CREATED",
          entityType: "Tenant",
          entityId: tenant.id,
          payload: {
            companyName: data.companyName,
            subdomain,
            portalUrl: buildTenantPortalUrl(subdomain),
            modules: data.modules,
            limits: {
              locations: data.limitLocations,
              terminals: data.limitTerminals,
            },
            erpUser: {
              email: erpUser.email,
              fullName: erpUser.name,
              defaultPassword,
            },
          },
        },
      })

      return {
        tenant,
        erpUser,
        defaultPassword,
      }
    })

    return res.status(201).json({
      ok: true,
      item: {
        id: result.tenant.id,
        name: result.tenant.name,
        subdomain: result.tenant.subdomain,
        portalUrl: buildTenantPortalUrl(result.tenant.subdomain),
        company: pickPrimaryCompany((result.tenant as any).companies),
        companies: (result.tenant as any).companies || [],
        license: result.tenant.licenses[0] || null,
        erpUser: {
          id: result.erpUser.id,
          email: result.erpUser.email,
          fullName: result.erpUser.name,
          password: result.defaultPassword,
        },
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut crea clientul",
    })
  }
})

router.post("/api/v1/admin/clients/:id/companies", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = AddTenantCompanySchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const existingCompanies = await prisma.company.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, code: true, isDefault: true },
  })

  const suggestedCodeBase = slugify(parsed.data.code?.trim() || parsed.data.name).replace(/-/g, "_").toUpperCase().slice(0, 12) || "FIRMA"
  let nextCode = suggestedCodeBase
  let codeIndex = 2
  while (existingCompanies.some((company) => company.code === nextCode)) {
    nextCode = `${suggestedCodeBase}_${codeIndex}`.slice(0, 20)
    codeIndex += 1
  }

  const created = await prisma.company.create({
    data: {
      tenantId: tenant.id,
      name: parsed.data.name.trim(),
      code: nextCode,
      isDefault: existingCompanies.length === 0,
      cui: parsed.data.cui?.trim() || null,
      regNo: parsed.data.regNo?.trim() || null,
      address: parsed.data.address?.trim() || null,
      email: parsed.data.email?.trim() || null,
      phone: parsed.data.phone?.trim() || null,
      country: "RO",
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorType: "OWNER",
      actorId: req.auth?.userId,
      action: "TENANT_COMPANY_CREATED",
      entityType: "Company",
      entityId: created.id,
      payload: {
        tenantName: tenant.name,
        companyName: created.name,
        companyCode: created.code,
      },
    },
  })

  return res.status(201).json({
    ok: true,
    item: {
      id: created.id,
      name: created.name,
      code: created.code,
      cui: created.cui,
      regNo: created.regNo,
      address: created.address,
      email: created.email,
      phone: created.phone,
      isDefault: created.isDefault,
      createdAt: created.createdAt,
    },
  })
})

router.post("/api/v1/admin/clients/:id/users", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = AdminCreateUserSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const email = parsed.data.email.trim().toLowerCase()
  const existing = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      email,
    },
    select: { id: true },
  })

  if (existing) {
    return res.status(409).json({ ok: false, error: "Exista deja un utilizator cu acest email" })
  }

  const rawPassword = parsed.data.password?.trim() || generateTemporaryPassword()

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name: parsed.data.name.trim(),
          role: parsed.data.role,
          isActive: true,
          passwordHash: await hashSecret(rawPassword),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "ADMIN_PANEL_USER_CREATED",
          entityType: "User",
          entityId: created.id,
          payload: {
            tenantId: tenant.id,
            tenantName: tenant.name,
            email: created.email,
            fullName: created.name,
            role: created.role,
          },
        },
      })

      return created
    })

    return res.status(201).json({
      ok: true,
      item: {
        ...user,
        fullName: user.name,
      },
      temporaryPassword: rawPassword,
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut crea utilizatorul",
    })
  }
})

router.patch("/api/v1/admin/users/:userId", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = AdminUpdateUserSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: {
      id: true,
      tenantId: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      tenant: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!user) {
    return res.status(404).json({ ok: false, error: "User inexistent" })
  }

  const nextEmail = parsed.data.email?.trim().toLowerCase()
  if (nextEmail && nextEmail !== user.email) {
    const duplicate = await prisma.user.findFirst({
      where: {
        tenantId: user.tenantId,
        email: nextEmail,
        NOT: { id: user.id },
      },
      select: { id: true },
    })

    if (duplicate) {
      return res.status(409).json({ ok: false, error: "Exista deja un utilizator cu acest email" })
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: user.id },
        data: {
          email: nextEmail,
          name: parsed.data.name?.trim(),
          role: parsed.data.role,
          isActive: parsed.data.isActive,
          ...(parsed.data.password?.trim()
            ? { passwordHash: await hashSecret(parsed.data.password.trim()) }
            : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "ADMIN_PANEL_USER_UPDATED",
          entityType: "User",
          entityId: user.id,
          payload: {
            tenantId: user.tenantId,
            tenantName: user.tenant?.name,
            changes: {
              email: nextEmail,
              name: parsed.data.name?.trim(),
              role: parsed.data.role,
              isActive: parsed.data.isActive,
              passwordChanged: Boolean(parsed.data.password?.trim()),
            },
          },
        },
      })

      return next
    })

    return res.json({
      ok: true,
      item: {
        ...updated,
        fullName: updated.name,
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut actualiza utilizatorul",
    })
  }
})

router.post("/api/v1/admin/clients/:id/locations", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = CreateLocationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: {
      companies: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          code: true,
          cui: true,
          regNo: true,
          address: true,
          email: true,
          phone: true,
          isDefault: true,
          createdAt: true,
        },
      },
      licenses: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      locations: {
        where: { isActive: true },
        select: { id: true },
      },
    },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const license = tenant.licenses[0]
  if (!license) {
    return res.status(404).json({ ok: false, error: "Licenta ERP inexistenta" })
  }

  if (tenant.locations.length >= license.limitLocations) {
    return res.status(400).json({
      ok: false,
      error: `Clientul a atins limita de locatii (${license.limitLocations})`,
    })
  }

  try {
    const company = resolveOwnedCompany(tenant.companies, parsed.data.companyId)
    if (!company) {
      return res.status(400).json({
        ok: false,
        error: "Selecteaza firma pentru care vrei sa creezi locatia.",
      })
    }

    const code = await generateUniqueLocationCode(tenant.id, company.id, parsed.data.name)
    const street = toNullableText(parsed.data.street)
    const streetNo = toNullableText(parsed.data.streetNo)
    const building = toNullableText(parsed.data.building)
    const staircase = toNullableText(parsed.data.staircase)
    const floor = toNullableText(parsed.data.floor)
    const apartment = toNullableText(parsed.data.apartment)
    const details = toNullableText(parsed.data.details)
    const city = toNullableText(parsed.data.city)
    const county = toNullableText(parsed.data.county)
    const country = toNullableText(parsed.data.country) || "RO"
    const postalCode = toNullableText(parsed.data.postalCode)
    const address = buildStructuredLocationAddress({ street, streetNo, building, staircase, floor, apartment, details })

    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          name: parsed.data.name.trim(),
          code,
          address,
          street,
          streetNo,
          building,
          staircase,
          floor,
          apartment,
          details,
          city,
          county,
          country,
          postalCode,
          isActive: true,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "LOCATION_CREATED",
          entityType: "Location",
          entityId: created.id,
          payload: {
            companyId: company.id,
            companyName: company.name,
            name: created.name,
            code: created.code,
            address: created.address,
            city: created.city,
            county: created.county,
            postalCode: created.postalCode,
          },
        },
      })

      return created
    })

    return res.status(201).json({
      ok: true,
      item: {
        id: location.id,
        name: location.name,
        code: location.code,
        isActive: location.isActive,
        address: location.address,
        street: location.street,
        streetNo: location.streetNo,
        building: location.building,
        staircase: location.staircase,
        floor: location.floor,
        apartment: location.apartment,
        details: location.details,
        city: location.city,
        county: location.county,
        country: location.country,
        postalCode: location.postalCode,
        companyId: company.id,
        company: serializeCompanySummary(company),
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut crea locatia",
    })
  }
})

router.post("/api/v1/admin/locations/:id/devices", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = CreateDeviceSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          code: true,
          cui: true,
          regNo: true,
          address: true,
          email: true,
          phone: true,
          isDefault: true,
          createdAt: true,
        },
      },
      tenant: {
        include: {
          licenses: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          terminals: {
            select: { id: true },
          },
        },
      },
    },
  })

  if (!location) {
    return res.status(404).json({ ok: false, error: "Locatie inexistenta" })
  }

  const license = location.tenant.licenses[0]
  if (!license) {
    return res.status(404).json({ ok: false, error: "Licenta ERP inexistenta" })
  }

  if (!license.modPos) {
    return res.status(400).json({ ok: false, error: "POS nu este activ pe licenta clientului" })
  }

  if (location.tenant.terminals.length >= license.limitTerminals) {
    return res.status(400).json({
      ok: false,
      error: `Clientul a atins limita de device-uri POS (${license.limitTerminals})`,
    })
  }

  try {
    const deviceId = await generateUniqueDeviceId(location.tenantId, location.companyId)

    const terminal = await prisma.$transaction(async (tx) => {
      const created = await tx.terminal.create({
        data: {
          tenantId: location.tenantId,
          companyId: location.companyId,
          locationId: location.id,
          deviceId,
          label: parsed.data.label.trim(),
          isLockedToLocation: true,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: location.tenantId,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "POS_DEVICE_CREATED",
          entityType: "Terminal",
          entityId: created.id,
          payload: {
            companyId: location.companyId,
            companyName: location.company?.name || null,
            locationId: location.id,
            locationName: location.name,
            deviceId: created.deviceId,
            label: created.label,
          },
        },
      })

      return created
    })

    return res.status(201).json({
      ok: true,
      item: {
        id: terminal.id,
        label: terminal.label,
        deviceId: terminal.deviceId,
        licenseKey: terminal.deviceId,
        locationId: location.id,
        locationName: location.name,
        companyId: location.companyId,
        company: serializeCompanySummary(location.company),
        createdAt: terminal.createdAt,
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut crea device-ul POS",
    })
  }
})

router.patch("/api/v1/admin/clients/:id/license", requireAuth, requireOwner, async (req: AuthedRequest, res) => {
  const parsed = UpdateLicenseSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: {
      licenses: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })

  if (!tenant) {
    return res.status(404).json({ ok: false, error: "Client inexistent" })
  }

  const license = tenant.licenses[0]
  if (!license) {
    return res.status(404).json({ ok: false, error: "Licenta inexistenta" })
  }

  const data = parsed.data
  const expiresAt = parseOptionalDate(data.expiresAt)

  const updated = await prisma.$transaction(async (tx) => {
    const nextLicense = await tx.license.update({
      where: { id: license.id },
      data: {
        expiresAt: data.expiresAt === undefined ? undefined : expiresAt,
        limitLocations: data.limitLocations,
        limitTerminals: data.limitTerminals,
        isSuspended: data.isSuspended,
        modDashboard: data.modules?.dashboard,
        modDocuments: data.modules?.documents,
        modInventory: data.modules?.inventory,
        modNomenclature: data.modules?.nomenclature,
        modSettings: data.modules?.settings,
        modPos: data.modules?.pos,
        modReports: data.modules?.reports,
      },
    })

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorType: "OWNER",
        actorId: req.auth?.userId,
        action: "LICENSE_UPDATED",
        entityType: "License",
        entityId: nextLicense.id,
        payload: {
          tenantId: tenant.id,
          changes: data,
        },
      },
    })

    return nextLicense
  })

  return res.json({
    ok: true,
    item: {
      id: updated.id,
      expiresAt: updated.expiresAt,
      isSuspended: updated.isSuspended,
      limits: {
        locations: updated.limitLocations,
        terminals: updated.limitTerminals,
      },
      modules: moduleMapFromLicense(updated),
    },
  })
})

router.post(
  "/api/v1/admin/users/:userId/reset-password",
  requireAuth,
  requireOwner,
  async (req: AuthedRequest, res) => {
    const parsed = ResetUserPasswordSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() })
    }

    try {
      const { userId } = req.params
      const { newPassword } = parsed.data

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          tenantId: true,
          isActive: true,
        },
      })

      if (!user) {
        return res.status(404).json({ ok: false, error: "User inexistent" })
      }

      const password =
        newPassword && newPassword.trim().length >= 4
          ? newPassword.trim()
          : Math.random().toString(36).slice(-8)

      const passwordHash = await bcrypt.hash(password, 10)

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash,
          },
        })

        await tx.auditLog.create({
          data: {
            tenantId: user.tenantId,
            actorType: "OWNER",
            actorId: req.auth?.userId,
            action: "USER_PASSWORD_RESET",
            entityType: "User",
            entityId: userId,
            payload: {
              tenantId: user.tenantId,
              email: user.email,
              fullName: user.name,
            },
          },
        })
      })

      return res.json({
        ok: true,
        item: {
          userId: user.id,
          email: user.email,
          fullName: user.name,
          newPassword: password,
        },
      })
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "Nu am putut reseta parola",
      })
    }
  }
)

router.get("/api/v1/license/validate", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const license = await prisma.license.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  })

  if (!license) {
    return res.status(404).json({ ok: false, valid: false, error: "Licenta inexistenta" })
  }

  const activeModules = await prisma.tenantModule.findMany({
    where: { tenantId, enabled: true },
    include: { module: true },
  })

  const now = new Date()
  const valid = !license.isSuspended && license.expiresAt > now

  return res.json({
    ok: true,
    valid,
    tenantId,
    status: license.isSuspended ? "suspended" : license.expiresAt > now ? "active" : "expired",
    expiresAt: license.expiresAt,
    limits: {
      locations: license.limitLocations,
      terminals: license.limitTerminals,
    },
    modules: {
      ...moduleMapFromLicense(license),
      dynamic: activeModules.map((row) => ({
        code: row.module.code,
        name: row.module.name,
        target: row.module.target,
        limitValue: row.limitValue,
      })),
    },
  })
})

router.post("/api/v1/pos/validate", async (req, res) => {
  const parsed = PosLicenseValidateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      allowed: false,
      error: parsed.error.flatten(),
    })
  }

  const licenseKey = parsed.data.licenseKey.trim()

  const terminal = await prisma.terminal.findFirst({
    where: {
      deviceId: licenseKey,
    },
    include: {
      location: true,
      tenant: {
        include: {
          licenses: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  })

  if (!terminal) {
    return res.status(404).json({
      ok: false,
      allowed: false,
      error: "Licenta invalida",
    })
  }

  const license = terminal.tenant.licenses[0]

  if (!license) {
    return res.status(404).json({
      ok: false,
      allowed: false,
      error: "Licenta ERP inexistenta",
    })
  }

  if (license.isSuspended) {
    return res.status(403).json({
      ok: false,
      allowed: false,
      error: "Licenta este suspendata",
    })
  }

  if (license.expiresAt <= new Date()) {
    return res.status(403).json({
      ok: false,
      allowed: false,
      error: "Licenta este expirata",
    })
  }

  if (!license.modPos) {
    return res.status(403).json({
      ok: false,
      allowed: false,
      error: "POS nu este activ",
    })
  }

  const terminalsCount = await prisma.terminal.count({
    where: { tenantId: terminal.tenantId },
  })

  const withinLimit = terminalsCount <= license.limitTerminals

  return res.json({
    ok: true,
    allowed: withinLimit,
    tenantId: terminal.tenantId,
    terminal: {
      id: terminal.id,
      deviceId: terminal.deviceId,
      label: terminal.label,
      locationId: terminal.locationId,
      locationName: terminal.location?.name || null,
    },
    license: {
      expiresAt: license.expiresAt,
      posEnabled: license.modPos,
      licenseKey,
    },
  })
})

router.delete(
  "/api/v1/admin/terminals/:id",
  requireAuth,
  requireOwner,
  async (req, res) => {
    const terminal = await prisma.terminal.findUnique({
      where: { id: req.params.id },
    })

    if (!terminal) {
      return res.status(404).json({
        ok: false,
        error: "Terminal inexistent",
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.terminal.delete({
        where: { id: req.params.id },
      })

      await tx.auditLog.create({
        data: {
          tenantId: terminal.tenantId,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "POS_DEVICE_DELETED",
          entityType: "Terminal",
          entityId: terminal.id,
          payload: {
            deviceId: terminal.deviceId,
            label: terminal.label,
            locationId: terminal.locationId,
          },
        },
      })
    })

    return res.json({
      ok: true,
    })
  }
)

router.delete(
  "/api/v1/admin/locations/:id",
  requireAuth,
  requireOwner,
  async (req: AuthedRequest, res) => {
    const location = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        terminals: {
          select: { id: true },
        },
      },
    })

    if (!location) {
      return res.status(404).json({
        ok: false,
        error: "Locatie inexistenta",
      })
    }

    if (location.terminals.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Locatia are device-uri POS active si nu poate fi stearsa",
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.location.update({
        where: { id: location.id },
        data: {
          isActive: false,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: location.tenantId,
          actorType: "OWNER",
          actorId: req.auth?.userId,
          action: "LOCATION_DELETED",
          entityType: "Location",
          entityId: location.id,
          payload: {
            name: location.name,
            code: location.code,
          },
        },
      })
    })

    return res.json({
      ok: true,
    })
  }
)

export default router
