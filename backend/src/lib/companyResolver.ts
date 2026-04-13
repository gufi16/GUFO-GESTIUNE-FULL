// @ts-nocheck
import { prisma } from "./prisma"

const DEFAULT_COMPANY_CODE = "FIRMA-1"

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
