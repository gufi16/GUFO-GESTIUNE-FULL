import { prisma } from "./prisma"
import { AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompanyForAuth } from "./companyResolver"

export async function resolveRequestCompany(req: AuthedRequest, extra: Record<string, any> = {}) {
  if (!req.auth?.tenantId) {
    return null
  }

  return resolveTenantCompanyForAuth(prisma, req.auth, extra)
}

export async function requireRequestCompany(req: AuthedRequest, extra: Record<string, any> = {}) {
  const company = await resolveRequestCompany(req, extra)

  if (!company) {
    throw new Error("Nu exista nicio firma activa pentru acest cont.")
  }

  return company
}

export async function requireRequestCompanyId(req: AuthedRequest) {
  const company = await requireRequestCompany(req)
  return company.id
}

export function buildCompanyWhere<T extends Record<string, any>>(
  tenantId: string,
  companyId: string,
  extra: T = {} as T
) {
  return {
    tenantId,
    companyId,
    ...extra,
  }
}

export function buildCompanyScopedTenantWhere<T extends Record<string, any>>(
  tenantId: string,
  companyId: string,
  extra: T = {} as T
) {
  return {
    tenantId,
    OR: [{ companyId }, { companyId: null }],
    ...extra,
  }
}
