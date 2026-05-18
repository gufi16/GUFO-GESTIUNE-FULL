// @ts-nocheck
import { Prisma } from "@prisma/client"

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function toDecimal(value: Prisma.Decimal | number | string | null | undefined) {
  return new Prisma.Decimal(value ?? 0)
}

function zeroIfNegative(value: Prisma.Decimal) {
  return value.lessThan(0) ? new Prisma.Decimal(0) : value
}

function lotOrderBy(costMethod?: string | null) {
  if (costMethod === "FEFO") {
    return [{ expiryDate: "asc" }, { receivedAt: "asc" }, { createdAt: "asc" }]
  }
  return [{ receivedAt: "asc" }, { createdAt: "asc" }]
}

export async function listAvailableLots(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    locationId: string
    warehouseId?: string | null
    productId: string
    costMethod?: string | null
  }
) {
  return tx.stockLot.findMany({
    where: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      productId: params.productId,
      remainingQty: { gt: 0 },
    },
    orderBy: lotOrderBy(params.costMethod),
  })
}

export async function allocateProductLots(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    locationId: string
    warehouseId?: string | null
    productId: string
    qty: Prisma.Decimal | number
    costMethod?: string | null
    productName: string
    uomCode?: string | null
  }
) {
  const requiredQty = toNumber(params.qty)
  let remainingQtyToAllocate = requiredQty
  const lots = await listAvailableLots(tx, params)
  const allocations: Array<{
    stockLotId: string
    qty: Prisma.Decimal
    unitCost: Prisma.Decimal
    totalCost: Prisma.Decimal
    lotNo: string
    expiryDate: Date | null
  }> = []

  for (const lot of lots) {
    if (remainingQtyToAllocate <= 0) break

    const lotAvailableQty = toNumber(lot.remainingQty)
    if (lotAvailableQty <= 0) continue

    const allocatedQtyNumber = Math.min(lotAvailableQty, remainingQtyToAllocate)
    if (allocatedQtyNumber <= 0) continue

    const allocatedQty = toDecimal(allocatedQtyNumber)
    const unitCost = toDecimal(lot.unitCostNetRon)
    const totalCost = unitCost.mul(allocatedQty)
    const updatedRemainingQty = zeroIfNegative(toDecimal(lot.remainingQty).minus(allocatedQty))
    const updatedRemainingValue = zeroIfNegative(toDecimal(lot.totalRemainingValue).minus(totalCost))

    await tx.stockLot.update({
      where: { id: lot.id },
      data: {
        remainingQty: updatedRemainingQty,
        totalRemainingValue: updatedRemainingValue,
      },
    })

    allocations.push({
      stockLotId: lot.id,
      qty: allocatedQty,
      unitCost,
      totalCost,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate ?? null,
    })

    remainingQtyToAllocate -= allocatedQtyNumber
  }

  if (remainingQtyToAllocate > 0.000001) {
    throw new Error(
      `Stoc insuficient pe lot pentru ${params.productName}. Disponibil: ${(requiredQty - remainingQtyToAllocate).toFixed(2)} ${String(
        params.uomCode || ""
      ).trim()}`.trim()
    )
  }

  return allocations
}

export async function restoreLotAllocations(
  tx: Prisma.TransactionClient,
  allocations: Array<{
    stockLotId: string
    qty: Prisma.Decimal | number
    totalCost: Prisma.Decimal | number
  }>
) {
  for (const allocation of allocations) {
    await tx.stockLot.update({
      where: { id: allocation.stockLotId },
      data: {
        remainingQty: {
          increment: toDecimal(allocation.qty),
        },
        totalRemainingValue: {
          increment: toDecimal(allocation.totalCost),
        },
      },
    })
  }
}
