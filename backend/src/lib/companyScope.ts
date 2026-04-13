import { prisma } from "./prisma"
import { AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompany } from "./companyResolver"

export async function resolveRequestCompany(req: AuthedRequest) {
  const tenantId = req.auth?.tenantId ?? null
  if (!tenantId) {
    return null
  }

  return resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)
}

export async function requireRequestCompany(req: AuthedRequest) {
  const company = await resolveRequestCompany(req)

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
