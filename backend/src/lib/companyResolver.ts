// @ts-nocheck
import { prisma } from "./prisma"

const DEFAULT_COMPANY_CODE = "FIRMA-1"

export type CompanyAuthContext = {
  userId?: string | null
  tenantId?: string | null
  role?: string | null
  activeCompanyId?: string | null
}

function defaultOrderBy() {
  return [{ isDefault: "desc" }, { createdAt: "asc" }]
}

async function findCompanyByTenant(
  client: any,
  tenantId: string,
  activeCompanyId?: string | null,
  extra: Record<string, any> = {}
) {
  const { where = {}, ...rest } = extra || {}

  if (activeCompanyId) {
    const activeCompany = await client.company.findFirst({
      ...rest,
      where: {
        tenantId,
        id: activeCompanyId,
        ...where,
      },
    })

    if (activeCompany) {
      return activeCompany
    }
  }

  return client.company.findFirst({
    ...rest,
    where: {
      tenantId,
      ...where,
    },
    orderBy: rest.orderBy || defaultOrderBy(),
  })
}

export async function resolveTenantCompany(
  client: any,
  tenantId: string,
  activeCompanyId?: string | null,
  extra: Record<string, any> = {}
) {
  return findCompanyByTenant(client, tenantId, activeCompanyId, extra)
}

export async function listTenantCompaniesForAuth(
  client: any,
  auth: CompanyAuthContext,
  extra: Record<string, any> = {}
) {
  const tenantId = String(auth?.tenantId || "").trim()
  if (!tenantId) {
    return []
  }

  const { where = {}, ...rest } = extra || {}

  if (auth?.role === "OWNER" || auth?.role === "ADMIN") {
    return client.company.findMany({
      ...rest,
      where: {
        tenantId,
        ...where,
      },
      orderBy: rest.orderBy || defaultOrderBy(),
    })
  }

  const userId = String(auth?.userId || "").trim()
  if (!userId) {
    return []
  }

  const accessRows = await client.userCompanyAccess.findMany({
    where: { userId },
    select: { companyId: true },
  })

  if (!accessRows.length) {
    return []
  }

  const allowedCompanyIds = Array.from(new Set(accessRows.map((row: any) => String(row.companyId || "").trim()).filter(Boolean)))
  if (!allowedCompanyIds.length) {
    return []
  }

  return client.company.findMany({
    ...rest,
    where: {
      tenantId,
      id: { in: allowedCompanyIds },
      ...where,
    },
    orderBy: rest.orderBy || defaultOrderBy(),
  })
}

export async function resolveTenantCompanyForAuth(
  client: any,
  auth: CompanyAuthContext,
  extra: Record<string, any> = {}
) {
  const companies = await listTenantCompaniesForAuth(client, auth, extra)
  if (!companies.length) {
    return null
  }

  const activeCompanyId = String(auth?.activeCompanyId || "").trim()
  if (activeCompanyId) {
    const activeCompany = companies.find((company: any) => company.id === activeCompanyId)
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
    return companies.find((company: any) => company.isDefault) || companies[0]
  }

  return null
}

export async function ensureTenantCompany(
  client: any,
  tenantId: string,
  activeCompanyId?: string | null,
  seedData: Record<string, any> = {}
) {
  const existing = await findCompanyByTenant(client, tenantId, activeCompanyId)
  if (existing) {
    return existing
  }

  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })

  return client.company.create({
    data: {
      tenantId,
      name: tenant?.name || "Companie",
      code: DEFAULT_COMPANY_CODE,
      isDefault: true,
      ...seedData,
    },
  })
}

export async function updateOrCreateTenantCompany(
  client: any,
  tenantId: string,
  activeCompanyId: string | null | undefined,
  updateData: Record<string, any>,
  createData: Record<string, any> = {}
) {
  const existing = await findCompanyByTenant(client, tenantId, activeCompanyId)
  if (existing) {
    return client.company.update({
      where: { id: existing.id },
      data: updateData,
    })
  }

  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })

  return client.company.create({
    data: {
      tenantId,
      name: tenant?.name || "Companie",
      code: DEFAULT_COMPANY_CODE,
      isDefault: true,
      ...createData,
      ...updateData,
    },
  })
}

export async function getPrimaryTenantCompany(tenantId: string, extra: Record<string, any> = {}) {
  return resolveTenantCompany(prisma, tenantId, null, extra)
}
