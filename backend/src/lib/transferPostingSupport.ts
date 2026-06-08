import { Prisma } from "@prisma/client"
import { decrementStockBalanceStrict, incrementStockBalance } from "./stock"
import { allocateProductLots } from "./stockLots"
import { prisma } from "./prisma"

type TransferPostingItem = {
  id: string
  productId: string
  qty: Prisma.Decimal | number | string | null
  unitPrice: Prisma.Decimal | number | string | null
  lineValue: Prisma.Decimal | number | string | null
}

type TransferPostingDoc = {
  id: string
  docNo: string | null
  fromLocationId: string
  fromWarehouseId?: string | null
  toLocationId: string
  toWarehouseId?: string | null
  items: TransferPostingItem[]
}

type PostTransferDocumentParams = {
  tenantId: string
  companyId: string
  doc: TransferPostingDoc
  fromLocationName?: string
  toLocationName?: string
}

export async function recalcTransferDocument(transferId: string) {
  const items = await prisma.transferDocItem.findMany({
    where: { transferId },
  })

  const totalQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  const totalValue = items.reduce((sum, item) => sum + Number(item.lineValue || 0), 0)

  return prisma.transferDoc.update({
    where: { id: transferId },
    data: {
      totalQty: new Prisma.Decimal(totalQty),
      totalValue: new Prisma.Decimal(totalValue),
    },
  })
}

export async function postTransferDocumentLines(
  tx: Prisma.TransactionClient,
  params: PostTransferDocumentParams,
) {
  for (const item of params.doc.items) {
    const qty = Number(item.qty || 0)
    const qtyDecimal = new Prisma.Decimal(qty)
    const product = await tx.product.findFirst({
      where: { id: item.productId, tenantId: params.tenantId, companyId: params.companyId },
      include: { uom: true },
    })
    const trackLots = Boolean(product?.trackLot || product?.trackExpiry)

    if (trackLots) {
      const allocations = await allocateProductLots(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        costMethod: product?.costMethod || "FIFO",
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await decrementStockBalanceStrict(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await incrementStockBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.toLocationId,
        warehouseId: params.doc.toWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
      })

      for (const allocation of allocations) {
        const destinationLot = await tx.stockLot.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.toLocationId,
            warehouseId: params.doc.toWarehouseId || null,
            productId: item.productId,
            lotNo: allocation.lotNo,
            expiryDate: allocation.expiryDate || null,
            receivedAt: new Date(),
            initialQty: allocation.qty,
            remainingQty: allocation.qty,
            unitCostNetRon: allocation.unitCost,
            totalRemainingValue: allocation.totalCost,
          },
        })

        await tx.transferDocItemLot.create({
          data: {
            transferDocItemId: item.id,
            sourceStockLotId: allocation.stockLotId,
            destinationStockLotId: destinationLot.id,
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            lotNo: allocation.lotNo,
            expiryDate: allocation.expiryDate || null,
          },
        })

        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.fromLocationId,
            warehouseId: params.doc.fromWarehouseId || null,
            productId: item.productId,
            lotId: allocation.stockLotId,
            type: "OUT",
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            refType: "TRANSFER",
            refId: params.doc.id,
            refItemId: item.id,
            note: `Nota transfer ${params.doc.docNo} catre ${params.toLocationName || "-"}`,
          },
        })

        await tx.stockMove.create({
          data: {
            tenantId: params.tenantId,
            companyId: params.companyId,
            locationId: params.doc.toLocationId,
            warehouseId: params.doc.toWarehouseId || null,
            productId: item.productId,
            lotId: destinationLot.id,
            type: "IN",
            qty: allocation.qty,
            unitCost: allocation.unitCost,
            totalValue: allocation.totalCost,
            refType: "TRANSFER",
            refId: params.doc.id,
            refItemId: item.id,
            note: `Nota transfer ${params.doc.docNo} din ${params.fromLocationName || "-"}`,
          },
        })
      }
    } else {
      await decrementStockBalanceStrict(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.fromLocationId,
        warehouseId: params.doc.fromWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
        productName: product?.name || "produs",
        uomCode: product?.uom?.code || null,
      })

      await incrementStockBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        locationId: params.doc.toLocationId,
        warehouseId: params.doc.toWarehouseId || undefined,
        productId: item.productId,
        qty: qtyDecimal,
      })

      await tx.stockMove.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: params.doc.fromLocationId,
          warehouseId: params.doc.fromWarehouseId || null,
          productId: item.productId,
          type: "OUT",
          qty: qtyDecimal,
          unitCost: new Prisma.Decimal(item.unitPrice || 0),
          totalValue: new Prisma.Decimal(item.lineValue || 0),
          refType: "TRANSFER",
          refId: params.doc.id,
          refItemId: item.id,
          note: `Nota transfer ${params.doc.docNo} catre ${params.toLocationName || "-"}`,
        },
      })

      await tx.stockMove.create({
        data: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          locationId: params.doc.toLocationId,
          warehouseId: params.doc.toWarehouseId || null,
          productId: item.productId,
          type: "IN",
          qty: qtyDecimal,
          unitCost: new Prisma.Decimal(item.unitPrice || 0),
          totalValue: new Prisma.Decimal(item.lineValue || 0),
          refType: "TRANSFER",
          refId: params.doc.id,
          refItemId: item.id,
          note: `Nota transfer ${params.doc.docNo} din ${params.fromLocationName || "-"}`,
        },
      })
    }
  }

  await tx.transferDoc.update({
    where: { id: params.doc.id },
    data: { status: "POSTED" },
  })
}
