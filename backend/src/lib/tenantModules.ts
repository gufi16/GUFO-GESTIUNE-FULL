import { prisma } from "./prisma"

export async function hasTenantModule(tenantId: string, moduleCode: string) {
  const item = await prisma.tenantModule.findFirst({
    where: {
      tenantId,
      enabled: true,
      module: {
        code: moduleCode,
        isActive: true,
      },
    },
    select: {
      id: true,
    },
  })

  return Boolean(item)
}

export async function requireTenantModule(tenantId: string, moduleCode: string) {
  const enabled = await hasTenantModule(tenantId, moduleCode)
  return {
    enabled,
    error: enabled ? null : `Modulul ${moduleCode} nu este activ pe licenta acestui client.`,
  }
}
