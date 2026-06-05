import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

const DEFAULT_COMPANY_CODE = "FIRMA-1"
const DEFAULT_COMPANY_ORDER_BY: Prisma.CompanyOrderByWithRelationInput[] = [{ isDefault: "desc" }, { createdAt: "asc" }]

type CompanyResolverClient = {
  company: {
    findFirst?: (args: Prisma.CompanyFindFirstArgs) => Promise<unknown>
    findMany: (args: Prisma.CompanyFindManyArgs) => Promise<unknown[]>
    create?: (args: Prisma.CompanyCreateArgs) => Promise<unknown>
    update?: (args: Prisma.CompanyUpdateArgs) => Promise<unknown>
  }
  userCompanyAccess: {
    findMany: (args: Prisma.UserCompanyAccessFindManyArgs) => Promise<unknown[]>
  }
  tenant?: {
    findUnique: (args: Prisma.TenantFindUniqueArgs) => Promise<{ name: string } | null>
  }
}
type CompanyQueryExtra = Record<string, unknown>
type CompanyAccessRow = { companyId: string | null }
type CompanyCreateSeedData = Partial<Prisma.CompanyUncheckedCreateInput>

export type CompanyAuthContext = {
  userId?: string | null
  tenantId?: string | null
  role?: string | null
  activeCompanyId?: string | null
}

function defaultOrderBy(): Prisma.CompanyOrderByWithRelationInput[] {
  return DEFAULT_COMPANY_ORDER_BY
}

function toCompanyFindFirstArgs(
  tenantId: string,
  extra: CompanyQueryExtra = {},
  activeCompanyId?: string | null,
): Prisma.CompanyFindFirstArgs {
  const rawArgs = extra as Prisma.CompanyFindFirstArgs
  const where = (rawArgs.where ?? {}) as Prisma.CompanyWhereInput

  return {
    ...rawArgs,
    where: {
      tenantId,
      ...(activeCompanyId ? { id: activeCompanyId } : {}),
      ...where,
    },
    orderBy: rawArgs.orderBy ?? defaultOrderBy(),
  }
}

function toCompanyFindManyArgs(tenantId: string, extra: CompanyQueryExtra = {}): Prisma.CompanyFindManyArgs {
  const rawArgs = extra as Prisma.CompanyFindManyArgs
  const where = (rawArgs.where ?? {}) as Prisma.CompanyWhereInput

  return {
    ...rawArgs,
    where: {
      tenantId,
      ...where,
    },
    orderBy: rawArgs.orderBy ?? defaultOrderBy(),
  }
}

function collectAllowedCompanyIds(rows: CompanyAccessRow[]): string[] {
  return Array.from(new Set(rows.map((row) => String(row.companyId ?? "").trim()).filter(Boolean)))
}

function sanitizeCompanyCreateData(data: CompanyCreateSeedData): CompanyCreateSeedData {
  const { tenantId: _tenantId, name: _name, code: _code, isDefault: _isDefault, ...rest } = data as CompanyCreateSeedData & {
    tenantId?: string
    name?: string
  }

  return rest
}

async function findCompanyByTenant(
  client: CompanyResolverClient,
  tenantId: string,
  activeCompanyId?: string | null,
  extra: CompanyQueryExtra = {},
): Promise<any> {
  if (!client.company.findFirst) {
    throw new Error("Company resolver client does not support findFirst.")
  }

  const baseArgs = toCompanyFindFirstArgs(tenantId, extra)

  if (activeCompanyId) {
    const activeCompany = await client.company.findFirst(toCompanyFindFirstArgs(tenantId, extra, activeCompanyId))

    if (activeCompany) {
      return activeCompany
    }
  }

  return client.company.findFirst(baseArgs)
}

export async function resolveTenantCompany(
  client: CompanyResolverClient,
  tenantId: string,
  activeCompanyId?: string | null,
  extra: CompanyQueryExtra = {},
): Promise<any> {
  return findCompanyByTenant(client, tenantId, activeCompanyId, extra)
}

export async function listTenantCompaniesForAuth(
  client: CompanyResolverClient,
  auth: CompanyAuthContext,
  extra: CompanyQueryExtra = {},
): Promise<any[]> {
  const tenantId = String(auth?.tenantId || "").trim()
  if (!tenantId) {
    return []
  }

  if (auth?.role === "OWNER" || auth?.role === "ADMIN") {
    return client.company.findMany(toCompanyFindManyArgs(tenantId, extra))
  }

  const userId = String(auth?.userId || "").trim()
  if (!userId) {
    return []
  }

  const accessRows = (await client.userCompanyAccess.findMany({
    where: { userId },
    select: { companyId: true },
  })) as CompanyAccessRow[]

  if (!accessRows.length) {
    return []
  }

  const allowedCompanyIds = collectAllowedCompanyIds(accessRows)
  if (!allowedCompanyIds.length) {
    return []
  }

  const baseArgs = toCompanyFindManyArgs(tenantId, extra)
  const where = (baseArgs.where ?? {}) as Prisma.CompanyWhereInput

  return client.company.findMany({
    ...baseArgs,
    where: {
      ...where,
      id: { in: allowedCompanyIds },
    },
  })
}

export async function resolveTenantCompanyForAuth(
  client: CompanyResolverClient,
  auth: CompanyAuthContext,
  extra: CompanyQueryExtra = {},
): Promise<any> {
  const companies = await listTenantCompaniesForAuth(client, auth, extra)
  if (!companies.length) {
    return null
  }

  const activeCompanyId = String(auth?.activeCompanyId || "").trim()
  if (activeCompanyId) {
    const activeCompany = companies.find((company) => String(company?.id ?? "") === activeCompanyId)
    if (activeCompany) {
      return activeCompany
    }

    if (auth?.role !== "OWNER" && auth?.role !== "ADMIN") {
      return null
    }
  }

  if (companies.length === 1) {
    return companies[0]
  }

  if (auth?.role === "OWNER" || auth?.role === "ADMIN") {
    return companies.find((company) => Boolean(company?.isDefault)) || companies[0]
  }

  return null
}

export async function ensureTenantCompany(
  client: CompanyResolverClient,
  tenantId: string,
  activeCompanyId?: string | null,
  seedData: CompanyCreateSeedData = {},
): Promise<any> {
  if (!client.company.create) {
    throw new Error("Company resolver client does not support create.")
  }

  const existing = await findCompanyByTenant(client, tenantId, activeCompanyId)
  if (existing) {
    return existing
  }

  const tenant = client.tenant
    ? await client.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      })
    : null

  const sanitizedSeedData = sanitizeCompanyCreateData(seedData)

  return client.company.create({
    data: {
      tenantId,
      name: tenant?.name || "Companie",
      code: DEFAULT_COMPANY_CODE,
      isDefault: true,
      ...sanitizedSeedData,
    },
  })
}

export async function updateOrCreateTenantCompany(
  client: CompanyResolverClient,
  tenantId: string,
  activeCompanyId: string | null | undefined,
  updateData: CompanyCreateSeedData,
  createData: CompanyCreateSeedData = {},
): Promise<any> {
  if (!client.company.create || !client.company.update) {
    throw new Error("Company resolver client does not support update/create.")
  }

  const existing = await findCompanyByTenant(client, tenantId, activeCompanyId)
  if (existing) {
    return client.company.update({
      where: { id: existing.id },
      data: updateData,
    })
  }

  const tenant = client.tenant
    ? await client.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      })
    : null

  const sanitizedCreateData = sanitizeCompanyCreateData(createData)
  const sanitizedUpdateData = sanitizeCompanyCreateData(updateData)

  return client.company.create({
    data: {
      tenantId,
      name: tenant?.name || "Companie",
      code: DEFAULT_COMPANY_CODE,
      isDefault: true,
      ...sanitizedCreateData,
      ...sanitizedUpdateData,
    },
  })
}

export async function getPrimaryTenantCompany(tenantId: string, extra: CompanyQueryExtra = {}) {
  return resolveTenantCompany(prisma, tenantId, null, extra)
}
