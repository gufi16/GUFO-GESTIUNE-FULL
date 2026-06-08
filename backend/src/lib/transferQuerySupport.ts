import { Prisma, PrismaClient } from "@prisma/client"

const transferDetailInclude = Prisma.validator<Prisma.TransferDocInclude>()({
  fromLocation: true,
  fromWarehouse: true,
  toLocation: true,
  toWarehouse: true,
  items: {
    include: {
      product: { include: { uom: true, vatRate: true } },
      uom: true,
      vatRate: true,
    },
    orderBy: { createdAt: "asc" },
  },
})

const transferDetailWithLotsInclude = Prisma.validator<Prisma.TransferDocInclude>()({
  fromLocation: true,
  fromWarehouse: true,
  toLocation: true,
  toWarehouse: true,
  items: {
    include: {
      product: { include: { uom: true, vatRate: true } },
      uom: true,
      vatRate: true,
      lotAllocations: true,
    },
    orderBy: { createdAt: "asc" },
  },
})

const transferPdfInclude = Prisma.validator<Prisma.TransferDocInclude>()({
  fromLocation: true,
  fromWarehouse: true,
  toLocation: true,
  toWarehouse: true,
  items: {
    include: {
      product: { include: { uom: true } },
      uom: true,
    },
    orderBy: { createdAt: "asc" },
  },
})

export async function findTransferDocDetail(
  db: PrismaClient | Prisma.TransactionClient,
  params: { id: string; tenantId: string; companyId: string },
) {
  return db.transferDoc.findFirst({
    where: {
      id: params.id,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: transferDetailInclude,
  })
}

export async function findTransferDocDetailWithLots(
  db: PrismaClient | Prisma.TransactionClient,
  params: { id: string; tenantId: string; companyId: string },
) {
  return db.transferDoc.findFirst({
    where: {
      id: params.id,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: transferDetailWithLotsInclude,
  })
}

export async function findTransferDocForPdf(
  db: PrismaClient | Prisma.TransactionClient,
  params: { id: string; tenantId: string; companyId: string },
) {
  return db.transferDoc.findFirst({
    where: {
      id: params.id,
      tenantId: params.tenantId,
      companyId: params.companyId,
    },
    include: transferPdfInclude,
  })
}
