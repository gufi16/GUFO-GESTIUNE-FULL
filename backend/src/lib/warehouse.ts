// @ts-nocheck
import { Prisma } from "@prisma/client"

function normalizeCode(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "MAIN"
}

export async function ensureDefaultWarehouseForLocation(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    locationId: string
    locationName?: string | null
    locationCode?: string | null
  }
) {
  const existing = await tx.warehouse.findFirst({
    where: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      isDefault: true,
    },
    orderBy: { createdAt: "asc" },
  })

  if (existing) return existing

  const location =
    params.locationName || params.locationCode
      ? {
          name: params.locationName || "Gestiune principala",
          code: params.locationCode || "MAIN",
        }
      : await tx.location.findFirst({
          where: {
            id: params.locationId,
            tenantId: params.tenantId,
            companyId: params.companyId,
          },
          select: { name: true, code: true },
        })

  const baseCode = normalizeCode(location?.code || "MAIN")

  return tx.warehouse.create({
    data: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      code: `${baseCode}-MAIN`,
      name: `Gestiune ${location?.name || "principala"}`,
      type: "GENERAL",
      isDefault: true,
      isActive: true,
    },
  })
}

export async function ensureDefaultWarehouseForLocationUsingPrisma(
  prismaLike: Prisma.TransactionClient,
  tenantId: string,
  companyId: string | null,
  locationId: string
) {
  return ensureDefaultWarehouseForLocation(prismaLike, {
    tenantId,
    companyId,
    locationId,
  })
}

export async function ensureDefaultWarehousesForCompany(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string
) {
  const locations = await tx.location.findMany({
    where: {
      tenantId,
      companyId,
    },
    select: {
      id: true,
      name: true,
      code: true,
      companyId: true,
    },
  })

  for (const location of locations) {
    await ensureDefaultWarehouseForLocation(tx, {
      tenantId,
      companyId: location.companyId || companyId,
      locationId: location.id,
      locationName: location.name,
      locationCode: location.code,
    })
  }
}

export async function resolveWarehouseForLocation(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    locationId: string
    warehouseId?: string | null
  }
) {
  const requestedId = String(params.warehouseId || "").trim()

  if (requestedId) {
    const explicitWarehouse = await tx.warehouse.findFirst({
      where: {
        id: requestedId,
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.locationId,
        isActive: true,
      },
    })

    if (!explicitWarehouse) {
      throw new Error("Gestiunea selectata nu exista pentru locatia aleasa.")
    }

    return explicitWarehouse
  }

  return ensureDefaultWarehouseForLocation(tx, {
    tenantId: params.tenantId,
    companyId: params.companyId,
    locationId: params.locationId,
  })
}
