import { Prisma } from "@prisma/client"

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function getAvailableStockQty(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  productId: string
) {
  const balance = await tx.stockBalance.findUnique({
    where: {
      tenantId_locationId_productId: {
        tenantId,
        locationId,
        productId,
      },
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
    locationId: string
    productId: string
    requiredQty: Prisma.Decimal | number
    productName: string
    uomCode?: string | null
  }
) {
  const requiredQty = toNumber(params.requiredQty)
  const { qty } = await getAvailableStockQty(tx, params.tenantId, params.locationId, params.productId)

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
    locationId: string
    productId: string
    qty: Prisma.Decimal | number
    productName: string
    uomCode?: string | null
  }
) {
  await assertSufficientStock(tx, {
    tenantId: params.tenantId,
    locationId: params.locationId,
    productId: params.productId,
    requiredQty: params.qty,
    productName: params.productName,
    uomCode: params.uomCode,
  })

  return tx.stockBalance.update({
    where: {
      tenantId_locationId_productId: {
        tenantId: params.tenantId,
        locationId: params.locationId,
        productId: params.productId,
      },
    },
    data: {
      qty: {
        decrement: params.qty,
      },
    },
  })
}

export async function incrementStockBalance(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    locationId: string
    productId: string
    qty: Prisma.Decimal | number
  }
) {
  return tx.stockBalance.upsert({
    where: {
      tenantId_locationId_productId: {
        tenantId: params.tenantId,
        locationId: params.locationId,
        productId: params.productId,
      },
    },
    update: {
      qty: {
        increment: params.qty,
      },
    },
    create: {
      tenantId: params.tenantId,
      locationId: params.locationId,
      productId: params.productId,
      qty: new Prisma.Decimal(params.qty),
    },
  })
}
