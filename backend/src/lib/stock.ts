// @ts-nocheck
import { Prisma } from "@prisma/client"
const NO_WAREHOUSE_SCOPE = "__NO_WAREHOUSE__"

function stockWarehouseScope(warehouseId?: string | null) {
  const trimmed = String(warehouseId || "").trim()
  return trimmed || NO_WAREHOUSE_SCOPE
}

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function getAvailableStockQty(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  locationId: string,
  productId: string,
  warehouseId?: string
) {
  const balance = await tx.stockBalance.findFirst({
    where: {
      tenantId,
      companyId,
      locationId,
      productId,
      ...(warehouseId ? { warehouseId } : {}),
    },
  })

  return {
    balance,
    qty: toNumber(balance?.qty),
  }
}

export async function assertSufficientStock(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    locationId: string
    warehouseId?: string
    productId: string
    requiredQty: Prisma.Decimal | number
    productName: string
    uomCode?: string | null
  }
) {
  const requiredQty = toNumber(params.requiredQty)
  const { qty } = await getAvailableStockQty(tx, params.tenantId, params.companyId, params.locationId, params.productId, params.warehouseId)

  if (qty < requiredQty) {
    throw new Error(
      `Stoc insuficient pentru ${params.productName}. Disponibil: ${qty.toFixed(2)} ${String(params.uomCode || "").trim()}`.trim()
    )
  }
}

export async function decrementStockBalanceStrict(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    locationId: string
    warehouseId?: string
    productId: string
    qty: Prisma.Decimal | number
    productName: string
    uomCode?: string | null
  }
) {
  await assertSufficientStock(tx, {
    tenantId: params.tenantId,
    companyId: params.companyId,
    locationId: params.locationId,
    warehouseId: params.warehouseId,
    productId: params.productId,
    requiredQty: params.qty,
    productName: params.productName,
    uomCode: params.uomCode,
  })

  return tx.stockBalance.update({
    where: {
      tenantId_companyId_locationId_productId_warehouseScope: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.locationId,
        productId: params.productId,
        warehouseScope: stockWarehouseScope(params.warehouseId),
      },
    },
    data: {
      qty: {
        decrement: params.qty,
      },
      warehouseScope: stockWarehouseScope(params.warehouseId),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
    },
  })
}

export async function decrementStockBalanceAllowNegative(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    locationId: string
    warehouseId?: string
    productId: string
    qty: Prisma.Decimal | number
  }
) {
  return tx.stockBalance.upsert({
    where: {
      tenantId_companyId_locationId_productId_warehouseScope: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.locationId,
        productId: params.productId,
        warehouseScope: stockWarehouseScope(params.warehouseId),
      },
    },
    update: {
      qty: {
        decrement: params.qty,
      },
      warehouseScope: stockWarehouseScope(params.warehouseId),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
    },
    create: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      warehouseId: params.warehouseId || null,
      warehouseScope: stockWarehouseScope(params.warehouseId),
      productId: params.productId,
      qty: new Prisma.Decimal(0).minus(params.qty),
    },
  })
}

export async function incrementStockBalance(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    locationId: string
    warehouseId?: string
    productId: string
    qty: Prisma.Decimal | number
  }
) {
  return tx.stockBalance.upsert({
    where: {
      tenantId_companyId_locationId_productId_warehouseScope: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.locationId,
        productId: params.productId,
        warehouseScope: stockWarehouseScope(params.warehouseId),
      },
    },
    update: {
      qty: {
        increment: params.qty,
      },
      warehouseScope: stockWarehouseScope(params.warehouseId),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
    },
    create: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      warehouseId: params.warehouseId || null,
      warehouseScope: stockWarehouseScope(params.warehouseId),
      productId: params.productId,
      qty: new Prisma.Decimal(params.qty),
    },
  })
}
