import { Prisma, PrismaClient } from "@prisma/client"

const transferEtransportInclude = Prisma.validator<Prisma.TransferDocInclude>()({
  fromLocation: true,
  fromWarehouse: true,
  toLocation: true,
  toWarehouse: true,
  items: {
    include: {
      product: {
        include: {
          uom: true,
          vatRate: true,
        },
      },
      uom: true,
      vatRate: true,
    },
    orderBy: { createdAt: "asc" },
  },
})

const transferReceiptSelect = Prisma.validator<Prisma.TransferDocSelect>()({
  id: true,
  docNo: true,
  eTransportUploadIndex: true,
  eTransportDownloadId: true,
  eTransportUit: true,
})

export type TransferEtransportDoc = Prisma.TransferDocGetPayload<{
  include: typeof transferEtransportInclude
}>

export type TransferEtransportReceiptDoc = Prisma.TransferDocGetPayload<{
  select: typeof transferReceiptSelect
}>

export async function findTransferDocForEtransport(
  db: PrismaClient | Prisma.TransactionClient,
  params: { id: string; tenantId: string; companyId: string },
) {
  return db.transferDoc.findFirst({
    where: {
      id: params.id,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: transferEtransportInclude,
  })
}

export async function updateTransferDocForEtransport(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    id: string
    data: Prisma.TransferDocUpdateInput
  },
) {
  return db.transferDoc.update({
    where: { id: params.id },
    data: params.data,
    include: transferEtransportInclude,
  })
}

export async function findTransferReceiptDocForEtransport(
  db: PrismaClient | Prisma.TransactionClient,
  params: { id: string; tenantId: string; companyId: string },
) {
  return db.transferDoc.findFirst({
    where: {
      id: params.id,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    select: transferReceiptSelect,
  })
}
