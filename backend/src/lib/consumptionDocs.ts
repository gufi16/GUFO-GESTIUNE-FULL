import { Prisma } from "@prisma/client"
import { reserveNextNumber } from "./numbering"
import {
  assertSufficientStock,
  decrementStockBalanceAllowNegative,
  decrementStockBalanceStrict,
  incrementStockBalance,
} from "./stock"
import { allocateProductLots, restoreLotAllocations } from "./stockLots"
import { ensureDefaultWarehouseForLocation } from "./warehouse"

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

type DraftLineInput = {
  finishedProductId?: string | null
  ingredientId: string
  qty: Prisma.Decimal | number
  note?: string | null
}

export async function createConsumptionDraft(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    locationId: string
    warehouseId?: string | null
    saleId?: string | null
    source?: "MANUAL" | "POS_RECIPE"
    docDate?: Date
    note?: string | null
    lines: DraftLineInput[]
  }
) {
  const docNo = await reserveNextNumber(tx, params.tenantId, "consumption")
  const warehouse = params.warehouseId
    ? await (tx as any).warehouse.findFirst({
        where: {
          id: params.warehouseId,
          tenantId: params.tenantId,
          locationId: params.locationId,
        },
      })
    : await ensureDefaultWarehouseForLocation(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.locationId,
      })
  const doc = await tx.consumptionDoc.create({
    data: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      locationId: params.locationId,
      warehouseId: warehouse?.id || null,
      saleId: params.saleId || null,
      docNo,
      docDate: params.docDate || new Date(),
      source: params.source || "MANUAL",
      status: "DRAFT",
      note: params.note || null,
    } as any,
  })

  for (const line of params.lines) {
    await tx.consumptionDocItem.create({
      data: {
        consumptionDocId: doc.id,
        finishedProductId: line.finishedProductId || null,
        ingredientId: line.ingredientId,
        qty: new Prisma.Decimal(line.qty),
        note: line.note || null,
      },
    })
  }

  return doc
}

export async function validateConsumptionDoc(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    docId: string
    actorId?: string | null
    allowNegativeStock?: boolean
  }
) {
  const doc: any = await tx.consumptionDoc.findFirst({
    where: {
      id: params.docId,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: {
      location: true,
      items: {
        include: {
          ingredient: {
            include: {
              uom: true,
            },
          },
          lotAllocations: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!doc) throw new Error("Bonul de consum nu exista.")
  if (doc.status !== "DRAFT") throw new Error("Doar documentele DRAFT pot fi validate.")
  if (!doc.items.length) throw new Error("Bonul de consum nu are pozitii.")

  let totalValue = 0

  for (const item of doc.items) {
    const qty = new Prisma.Decimal(item.qty)
    const qtyNumber = toNumber(item.qty)
    const trackLots = Boolean(item.ingredient?.trackLot || item.ingredient?.trackExpiry)
    const costMethod = trackLots ? item.ingredient?.costMethod || "FIFO" : "AVG"
    let unitCost = Math.max(0, toNumber(item.ingredient?.costPrice))
    let totalCost = qtyNumber * unitCost
    let lotAllocations: any[] = []

    if (params.allowNegativeStock) {
      await decrementStockBalanceAllowNegative(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId || "",
        locationId: doc.locationId,
        warehouseId: doc.warehouseId || undefined,
        productId: item.ingredientId,
        qty,
      })
    } else {
      if (trackLots) {
        lotAllocations = await allocateProductLots(tx, {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: doc.locationId,
          warehouseId: doc.warehouseId || undefined,
          productId: item.ingredientId,
          qty,
          costMethod,
          productName: item.ingredient?.name || `produs ${item.ingredientId}`,
          uomCode: item.ingredient?.uom?.code || item.ingredient?.uom?.name || "",
        })
        totalCost = lotAllocations.reduce((sum, allocation) => sum + toNumber(allocation.totalCost), 0)
        unitCost = qtyNumber > 0 ? totalCost / qtyNumber : 0
      } else {
        await assertSufficientStock(tx, {
          tenantId: params.tenantId,
          companyId: params.companyId || "",
          locationId: doc.locationId,
          warehouseId: doc.warehouseId || undefined,
          productId: item.ingredientId,
          requiredQty: qty,
          productName: item.ingredient?.name || `produs ${item.ingredientId}`,
          uomCode: item.ingredient?.uom?.code || item.ingredient?.uom?.name || "",
        })
      }

      await decrementStockBalanceStrict(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId || "",
        locationId: doc.locationId,
        warehouseId: doc.warehouseId || undefined,
        productId: item.ingredientId,
        qty,
        productName: item.ingredient?.name || `produs ${item.ingredientId}`,
        uomCode: item.ingredient?.uom?.code || item.ingredient?.uom?.name || "",
      })
    }

    await tx.consumptionDocItem.update({
      where: { id: item.id },
      data: {
        unitCost: new Prisma.Decimal(unitCost),
        totalCost: new Prisma.Decimal(totalCost),
        costMethod,
      } as any,
    })

    if (lotAllocations.length) {
      for (const allocation of lotAllocations) {
        await tx.consumptionDocItemLot.create({
          data: {
            consumptionDocItemId: item.id,
            stockLotId: allocation.stockLotId,
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalCost: allocation.totalCost,
          },
        })

        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: doc.locationId,
            warehouseId: doc.warehouseId || null,
            productId: item.ingredientId,
            lotId: allocation.stockLotId,
            type: "OUT",
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            refType: "CONSUMPTION",
            refId: doc.id,
            refItemId: item.id,
            note: doc.note || `Consum ${doc.docNo}`,
          } as any,
        })
      }
    } else {
      await tx.stockMove.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: doc.locationId,
          warehouseId: doc.warehouseId || null,
          productId: item.ingredientId,
          type: "OUT",
          qty,
          unitCost: new Prisma.Decimal(unitCost),
          totalValue: new Prisma.Decimal(totalCost),
          refType: "CONSUMPTION",
          refId: doc.id,
          refItemId: item.id,
          note: doc.note || `Consum ${doc.docNo}`,
        } as any,
      })
    }

    totalValue += totalCost
  }

  return tx.consumptionDoc.update({
    where: { id: doc.id },
    data: {
      status: "VALIDATED",
      totalValue: new Prisma.Decimal(totalValue),
      validatedAt: new Date(),
      validatedBy: params.actorId || null,
    } as any,
  })
}

export async function cancelConsumptionDoc(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string | null
    docId: string
    actorId?: string | null
  }
) {
  const doc: any = await tx.consumptionDoc.findFirst({
    where: {
      id: params.docId,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: {
      items: {
        include: {
          ingredient: {
            include: {
              uom: true,
            },
          },
          lotAllocations: true,
        },
      },
    },
  })

  if (!doc) throw new Error("Bonul de consum nu exista.")
  if (doc.status === "CANCELLED") throw new Error("Bonul de consum este deja anulat.")

  if (doc.status === "VALIDATED") {
    for (const item of doc.items) {
      const qty = new Prisma.Decimal(item.qty)
      await incrementStockBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId || "",
        locationId: doc.locationId,
        warehouseId: doc.warehouseId || undefined,
        productId: item.ingredientId,
        qty,
      })

      if (Array.isArray(item.lotAllocations) && item.lotAllocations.length) {
        await restoreLotAllocations(
          tx,
          item.lotAllocations.map((allocation: any) => ({
            stockLotId: allocation.stockLotId,
            qty: allocation.qty,
            totalCost: allocation.totalCost,
          }))
        )

        for (const allocation of item.lotAllocations) {
          await tx.stockMove.create({
            data: {
              tenantId: params.tenantId,
              companyId: params.companyId,
              locationId: doc.locationId,
              warehouseId: doc.warehouseId || null,
              productId: item.ingredientId,
              lotId: allocation.stockLotId,
              type: "IN",
              qty: allocation.qty,
              unitCost: allocation.unitCost,
              totalValue: allocation.totalCost,
              refType: "CONSUMPTION",
              refId: doc.id,
              refItemId: item.id,
              note: `Anulare ${doc.docNo}`,
            } as any,
          })
        }
      } else {
        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: doc.locationId,
            warehouseId: doc.warehouseId || null,
            productId: item.ingredientId,
            type: "IN",
            qty,
            unitCost: item.unitCost || new Prisma.Decimal(0),
            totalValue: item.totalCost || new Prisma.Decimal(0),
            refType: "CONSUMPTION",
            refId: doc.id,
            refItemId: item.id,
            note: `Anulare ${doc.docNo}`,
          } as any,
        })
      }
    }
  }

  return tx.consumptionDoc.update({
    where: { id: doc.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: params.actorId || null,
    } as any,
  })
}
