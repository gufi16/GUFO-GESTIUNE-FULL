import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { ensureTenantCompany, resolveTenantCompany } from "./companyResolver"

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

function numberWidthForKey(key: NumberingKey) {
  return key === "customer" || key === "supplier" ? 4 : 5
}

function buildFormattedNumber(prefix: string, nextNumber: number, key: NumberingKey) {
  const normalizedPrefix = normalizePrefix(prefix, "")
  const padded = String(Math.max(1, nextNumber)).padStart(numberWidthForKey(key), "0")
  return normalizedPrefix ? `${normalizedPrefix}-${padded}` : padded
}

function extractFormattedNumber(value: unknown, prefix: string) {
  const normalizedPrefix = normalizePrefix(prefix, "")
  const text = String(value || "").trim().toUpperCase()
  const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = text.match(new RegExp(`^${escapedPrefix}-(\\d+)$`, "i"))
  return match ? Number(match[1]) || 0 : 0
}

async function getExistingMaxNumber(
  client: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  key: NumberingKey,
  prefix: string
) {
  const normalizedPrefix = normalizePrefix(prefix, "")
  if (!normalizedPrefix) return 0

  if (key === "customer" || key === "supplier") {
    const where = {
      tenantId,
      code: {
        startsWith: `${normalizedPrefix}-`,
        mode: "insensitive" as const,
      },
    }
    const rows =
      key === "customer"
        ? await client.customer.findMany({ where, select: { code: true } })
        : await client.supplier.findMany({ where, select: { code: true } })

    return rows.reduce((max, row) => Math.max(max, extractFormattedNumber(row.code, prefix)), 0)
  }

  if (key === "invoice") {
    const rows = await client.salesInvoice.findMany({
      where: {
        tenantId,
        docNo: {
          startsWith: `${normalizedPrefix}-`,
          mode: "insensitive" as const,
        },
      },
      select: { docNo: true },
    })

    return rows.reduce((max, row) => Math.max(max, extractFormattedNumber(row.docNo, prefix)), 0)
  }

  return 0
}

async function ensureCompany(tenantId: string) {
  return ensureTenantCompany(prisma, tenantId, null, defaults)
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

  const existingMax = await getExistingMaxNumber(prisma, tenantId, key, prefix)
  const nextNumber = Math.max((counter?.value || 0) + 1, existingMax + 1)
  return {
    nextNumber,
    value: buildFormattedNumber(prefix, nextNumber, key),
    prefix,
  }
}

export async function reserveNextNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: NumberingKey
) {
  const company = await resolveTenantCompany(tx, tenantId, null)
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

  let counter = await tx.skuCounter.upsert({
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

  const prefix = config[keyMap[key]]
  const existingMax = await getExistingMaxNumber(tx, tenantId, key, prefix)
  const reservedValue = Math.max(counter.value, existingMax + 1)

  if (reservedValue !== counter.value) {
    counter = await tx.skuCounter.update({
      where: {
        tenantId_key: {
          tenantId,
          key,
        },
      },
      data: { value: reservedValue },
    })
  }

  return buildFormattedNumber(prefix, counter.value, key)
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
