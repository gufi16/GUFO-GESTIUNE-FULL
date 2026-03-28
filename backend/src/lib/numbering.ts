import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

type NumberingKey =
  | "invoice"
  | "purchaseReceipt"
  | "transfer"
  | "inventory"
  | "production"
  | "deterioration"
  | "priceChange"
  | "customer"
  | "supplier"

type NumberingConfig = {
  invoiceSeries: string
  purchaseSeries: string
  transferSeries: string
  inventorySeries: string
  productionSeries: string
  deteriorationSeries: string
  priceChangeSeries: string
  customerCodePrefix: string
  supplierCodePrefix: string
}

const defaults: NumberingConfig = {
  invoiceSeries: "FAC",
  purchaseSeries: "NIR",
  transferSeries: "TRF",
  inventorySeries: "INV",
  productionSeries: "PROD",
  deteriorationSeries: "PVD",
  priceChangeSeries: "PVP",
  customerCodePrefix: "CLI",
  supplierCodePrefix: "FUR",
}

const keyMap: Record<NumberingKey, keyof NumberingConfig> = {
  invoice: "invoiceSeries",
  purchaseReceipt: "purchaseSeries",
  transfer: "transferSeries",
  inventory: "inventorySeries",
  production: "productionSeries",
  deterioration: "deteriorationSeries",
  priceChange: "priceChangeSeries",
  customer: "customerCodePrefix",
  supplier: "supplierCodePrefix",
}

function normalizePrefix(value: unknown, fallback: string) {
  const cleaned = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, "")
    .slice(0, 12)

  return cleaned || fallback
}

function buildFormattedNumber(prefix: string, nextNumber: number) {
  const normalizedPrefix = normalizePrefix(prefix, "")
  const padded = String(Math.max(1, nextNumber)).padStart(5, "0")
  return normalizedPrefix ? `${normalizedPrefix}-${padded}` : padded
}

async function ensureCompany(tenantId: string) {
  const existing = await prisma.company.findUnique({ where: { tenantId } })
  if (existing) {
    return existing
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })

  return prisma.company.create({
    data: {
      tenantId,
      name: tenant?.name || "Companie",
      ...defaults,
    },
  })
}

export async function getNumberingConfig(tenantId: string) {
  const company = await ensureCompany(tenantId)

  return {
    invoiceSeries: normalizePrefix(company.invoiceSeries, defaults.invoiceSeries),
    purchaseSeries: normalizePrefix(company.purchaseSeries, defaults.purchaseSeries),
    transferSeries: normalizePrefix(company.transferSeries, defaults.transferSeries),
    inventorySeries: normalizePrefix(company.inventorySeries, defaults.inventorySeries),
    productionSeries: normalizePrefix(company.productionSeries, defaults.productionSeries),
    deteriorationSeries: normalizePrefix(company.deteriorationSeries, defaults.deteriorationSeries),
    priceChangeSeries: normalizePrefix(company.priceChangeSeries, defaults.priceChangeSeries),
    customerCodePrefix: normalizePrefix(company.customerCodePrefix, defaults.customerCodePrefix),
    supplierCodePrefix: normalizePrefix(company.supplierCodePrefix, defaults.supplierCodePrefix),
  }
}

export async function getNextNumberPreview(tenantId: string, key: NumberingKey) {
  const config = await getNumberingConfig(tenantId)
  const prefix = config[keyMap[key]]

  const counter = await prisma.skuCounter.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
  })

  const nextNumber = (counter?.value || 0) + 1
  return {
    nextNumber,
    value: buildFormattedNumber(prefix, nextNumber),
    prefix,
  }
}

export async function reserveNextNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: NumberingKey
) {
  const company = await tx.company.findUnique({ where: { tenantId } })
  const config = {
    invoiceSeries: normalizePrefix(company?.invoiceSeries, defaults.invoiceSeries),
    purchaseSeries: normalizePrefix(company?.purchaseSeries, defaults.purchaseSeries),
    transferSeries: normalizePrefix(company?.transferSeries, defaults.transferSeries),
    inventorySeries: normalizePrefix(company?.inventorySeries, defaults.inventorySeries),
    productionSeries: normalizePrefix(company?.productionSeries, defaults.productionSeries),
    deteriorationSeries: normalizePrefix(company?.deteriorationSeries, defaults.deteriorationSeries),
    priceChangeSeries: normalizePrefix(company?.priceChangeSeries, defaults.priceChangeSeries),
    customerCodePrefix: normalizePrefix(company?.customerCodePrefix, defaults.customerCodePrefix),
    supplierCodePrefix: normalizePrefix(company?.supplierCodePrefix, defaults.supplierCodePrefix),
  }

  const counter = await tx.skuCounter.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
    update: {
      value: {
        increment: 1,
      },
    },
    create: {
      tenantId,
      key,
      value: 1,
    },
  })

  return buildFormattedNumber(config[keyMap[key]], counter.value)
}

export function normalizeNumberingPayload(body: any) {
  return {
    invoiceSeries: normalizePrefix(body?.invoiceSeries, defaults.invoiceSeries),
    purchaseSeries: normalizePrefix(body?.purchaseSeries, defaults.purchaseSeries),
    transferSeries: normalizePrefix(body?.transferSeries, defaults.transferSeries),
    inventorySeries: normalizePrefix(body?.inventorySeries, defaults.inventorySeries),
    productionSeries: normalizePrefix(body?.productionSeries, defaults.productionSeries),
    deteriorationSeries: normalizePrefix(body?.deteriorationSeries, defaults.deteriorationSeries),
    priceChangeSeries: normalizePrefix(body?.priceChangeSeries, defaults.priceChangeSeries),
    customerCodePrefix: normalizePrefix(body?.customerCodePrefix, defaults.customerCodePrefix),
    supplierCodePrefix: normalizePrefix(body?.supplierCodePrefix, defaults.supplierCodePrefix),
  }
}
