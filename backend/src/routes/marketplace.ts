import { Router, Request, Response } from "express"
import crypto from "crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()
const db = prisma

const PLATFORMS = ["GLOVO", "WOLT", "BOLT_FOOD"] as const
const PLATFORM_ENUM = z.enum(PLATFORMS)
const EXTERNAL_ORDER_STATUSES = [
  "RECEIVED",
  "ACKNOWLEDGED",
  "IN_KITCHEN",
  "READY",
  "READY_FOR_FISCAL",
  "FISCALIZED",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
] as const
type MarketplacePlatform = (typeof PLATFORMS)[number]
type MarketplaceOrderStatus = (typeof EXTERNAL_ORDER_STATUSES)[number]
type JsonRecord = Record<string, unknown>
type MarketplaceSettings = Record<string, unknown>
type TransactionClient = Prisma.TransactionClient
type MarketplaceOrderPayload = z.infer<typeof ImportMarketplaceOrderSchema>
type MinimalIntegration = {
  id: string
  tenantId: string
  locationId: string | null
  storeId: string | null
  accessToken: string | null
  webhookSecret: string | null
  settingsJson: unknown
}
type MinimalMappedProduct = {
  id: string
  sku: string | null
  departmentId: string | null
  vatRate: { rate: number } | null
}
type RecentExternalProduct = {
  integrationId: string | null
  externalProductId: string | null
  externalName: string
  sku: string | null
  mappingStatus: string
  orderItemId: string
  lastSeenAt: Date
  location: { id: string; name: string; code: string | null } | null
  platform: string | null
  mapped: boolean
}
type GlovoCatalogPreviewItem = {
  productId: string
  sku: string
  name: string
  price: number
  stockQty: number | null
  available: boolean
  externalProductId: string | null
  mapped: boolean
  issues: string[]
}
type GlovoBulkUpdateProduct = {
  id: string
  name: string
  price: number
  available: boolean
  image_url?: string
}
type GlovoCatalogPushHistoryEntry = {
  transactionId: string
  createdAt: string
  updatedAt: string
  status: string
  endpoint: string
  payload: {
    products: GlovoBulkUpdateProduct[]
  }
  summary?: Record<string, unknown>
  details: string[]
  rejectedProductIds: string[]
  response?: unknown
}
type HistoryStatus = Prisma.ExternalOrderStatusHistoryCreateInput["status"]
type HistorySource = Prisma.ExternalOrderStatusHistoryCreateInput["source"]

const ConnectIntegrationSchema = z.object({
  locationId: z.string().min(1),
  authType: z.enum(["OAUTH", "API_KEY", "PARTNER"]).default("PARTNER"),
  merchantId: z.string().trim().optional(),
  storeId: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  refreshToken: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
  settings: z.record(z.unknown()).optional(),
})

const ImportMarketplaceOrderSchema = z.object({
  platform: PLATFORM_ENUM,
  locationId: z.string().min(1),
  integrationId: z.string().trim().optional(),
  externalOrderId: z.string().min(1),
  externalOrderNumber: z.string().trim().optional(),
  customerName: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  customerNote: z.string().trim().optional(),
  paymentLabel: z.string().trim().optional(),
  currency: z.enum(["RON", "EUR", "USD", "HUF"]).default("RON"),
  subtotal: z.coerce.number().nonnegative().default(0),
  total: z.coerce.number().nonnegative().default(0),
  placedAt: z.coerce.date().optional(),
  displayNumber: z.string().trim().optional(),
  station: z.string().trim().optional(),
  items: z.array(
    z.object({
      externalLineId: z.string().trim().optional(),
      externalProductId: z.string().trim().optional(),
      name: z.string().min(1),
      sku: z.string().trim().optional(),
      qty: z.coerce.number().positive(),
      unitPrice: z.coerce.number().nonnegative().default(0),
      vatRate: z.coerce.number().int().nonnegative().optional(),
      note: z.string().trim().optional(),
      modifiers: z.array(z.string()).optional(),
      erpProductId: z.string().trim().optional(),
      departmentId: z.string().trim().optional(),
      station: z.string().trim().optional(),
    })
  ).min(1),
  rawPayload: z.unknown().optional(),
})

const ReadyStatusSchema = z.object({
  kitchenTicketId: z.string().min(1).optional(),
  message: z.string().trim().optional(),
})

function normalizeStatusMessage(message?: string) {
  const text = String(message || "").trim()
  return text || null
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isMarketplacePlatform(value: string): value is MarketplacePlatform {
  return PLATFORMS.includes(value as MarketplacePlatform)
}

function isMarketplaceOrderStatus(value: string): value is MarketplaceOrderStatus {
  return EXTERNAL_ORDER_STATUSES.includes(value as MarketplaceOrderStatus)
}

function integrationSettings(value: unknown): MarketplaceSettings {
  return isRecord(value) ? value : {}
}

function buildDraftCart(payload: z.infer<typeof ImportMarketplaceOrderSchema>) {
  return {
    source: "MARKETPLACE",
    platform: payload.platform,
    externalOrderId: payload.externalOrderId,
    externalOrderNumber: payload.externalOrderNumber || null,
    locationId: payload.locationId,
    paymentLabel: payload.paymentLabel || null,
    customer: {
      name: payload.customerName || null,
      phone: payload.customerPhone || null,
      note: payload.customerNote || null,
    },
    items: payload.items.map((item) => ({
      externalLineId: item.externalLineId || null,
      externalProductId: item.externalProductId || null,
      erpProductId: item.erpProductId || null,
      name: item.name,
      sku: item.sku || null,
      qty: item.qty,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate ?? null,
      note: item.note || null,
      modifiers: item.modifiers || [],
    })),
    totals: {
      subtotal: payload.subtotal,
      total: payload.total,
      currency: payload.currency,
    },
  }
}

async function ensureLocationForTenant(tenantId: string, locationId: string) {
  return db.location.findFirst({
    where: {
      id: locationId,
      tenantId,
      isActive: true,
    },
  })
}

async function resolveMarketplaceOrder<TInclude extends Prisma.ExternalOrderInclude>(
  tenantId: string,
  inputOrderId: string,
  include?: TInclude
): Promise<Prisma.ExternalOrderGetPayload<{ include: TInclude }> | null> {
  return db.externalOrder.findFirst({
    where: {
      tenantId,
      OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
    },
    include,
  }) as Promise<Prisma.ExternalOrderGetPayload<{ include: TInclude }> | null>
}

async function createOrderHistory(
  tenantId: string,
  externalOrderId: string,
  status: HistoryStatus,
  source: HistorySource,
  message?: string,
  payloadJson?: unknown
) {
  return db.externalOrderStatusHistory.create({
    data: {
      tenantId,
      externalOrderId,
      status,
      source,
      message: normalizeStatusMessage(message),
      payloadJson: payloadJson === undefined ? undefined : (payloadJson as Prisma.InputJsonValue),
    },
  })
}

function hmacHex(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return "{}"
  }
}

function toMoneyNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."))
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value === "object") {
    const obj = value as JsonRecord
    return (
      toMoneyNumber(obj.total) ||
      toMoneyNumber(obj.amount) ||
      toMoneyNumber(obj.value) ||
      toMoneyNumber(obj.gross) ||
      0
    )
  }
  return 0
}

function toGlovoMoneyNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return value / 100
    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return 0
    if (trimmed.includes(".") || trimmed.includes(",")) {
      const parsed = Number(trimmed.replace(",", "."))
      return Number.isFinite(parsed) ? parsed : 0
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed / 100 : 0
  }

  return toMoneyNumber(value)
}

function normalizeGlovoStoreId(value: unknown) {
  return String(value || "").trim()
}

function normalizeHttpsUrl(value: unknown) {
  const text = String(value || "").trim()
  return text.startsWith("https://") ? text : null
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
}

function parseGlovoRejectedProductIds(details: unknown) {
  const lines = normalizeStringArray(details)
  const ids = new Set<string>()

  for (const line of lines) {
    if (!/products not updated/i.test(line)) continue
    const match = line.match(/\[([^\]]*)\]/)
    if (!match) continue
    for (const rawId of match[1].split(",")) {
      const id = rawId.trim()
      if (id) ids.add(id)
    }
  }

  return [...ids]
}

function readGlovoPushHistory(settingsJson: unknown): GlovoCatalogPushHistoryEntry[] {
  const settings = integrationSettings(settingsJson)
  const raw = settings.glovoCatalogPushHistory
  if (!Array.isArray(raw)) return []

  const items: GlovoCatalogPushHistoryEntry[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const payload = isRecord(entry.payload) ? entry.payload : {}
    const products = Array.isArray(payload.products) ? payload.products : []
    const normalizedEntry: GlovoCatalogPushHistoryEntry = {
      transactionId: String(entry.transactionId || "").trim(),
      createdAt: String(entry.createdAt || "").trim(),
      updatedAt: String(entry.updatedAt || entry.createdAt || "").trim(),
      status: String(entry.status || "").trim(),
      endpoint: String(entry.endpoint || "").trim(),
      payload: {
        products: products
          .filter((item) => isRecord(item))
          .map((item) => {
            const record = item as JsonRecord
            const imageUrl = normalizeHttpsUrl(record.image_url)
            return {
              id: String(record.id || "").trim(),
              name: String(record.name || "").trim(),
              price: Number(record.price || 0),
              available: Boolean(record.available),
              ...(imageUrl ? { image_url: imageUrl } : {}),
            }
          })
          .filter((item) => item.id),
      },
      summary: isRecord(entry.summary) ? entry.summary : undefined,
      details: normalizeStringArray(entry.details),
      rejectedProductIds: normalizeStringArray(entry.rejectedProductIds),
      response: entry.response,
    }
    if (normalizedEntry.transactionId) {
      items.push(normalizedEntry)
    }
  }
  return items
}

async function writeGlovoPushHistory(tenantId: string, integrationId: string, updater: (current: GlovoCatalogPushHistoryEntry[]) => GlovoCatalogPushHistoryEntry[]) {
  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "GLOVO",
    },
    select: {
      id: true,
      settingsJson: true,
    },
  })

  if (!integration) return

  const settings = integrationSettings(integration.settingsJson)
  const nextHistory = updater(readGlovoPushHistory(integration.settingsJson)).slice(0, 20)

  await db.externalIntegration.update({
    where: { id: integration.id },
    data: {
      settingsJson: {
        ...settings,
        glovoCatalogPushHistory: nextHistory,
      } as Prisma.InputJsonValue,
    },
  })
}

async function appendGlovoPushHistoryEntry(
  tenantId: string,
  integrationId: string,
  entry: GlovoCatalogPushHistoryEntry
) {
  await writeGlovoPushHistory(tenantId, integrationId, (current) => [entry, ...current.filter((item) => item.transactionId !== entry.transactionId)])
}

async function updateGlovoPushHistoryEntry(
  tenantId: string,
  integrationId: string,
  transactionId: string,
  patch: Partial<GlovoCatalogPushHistoryEntry>
) {
  await writeGlovoPushHistory(tenantId, integrationId, (current) =>
    current.map((item) =>
      item.transactionId === transactionId
        ? {
            ...item,
            ...patch,
            payload: patch.payload || item.payload,
            details: patch.details || item.details,
            rejectedProductIds: patch.rejectedProductIds || item.rejectedProductIds,
            updatedAt: patch.updatedAt || new Date().toISOString(),
          }
        : item
    )
  )
}

function inferGlovoPartnerName(storeId: string) {
  const normalized = normalizeGlovoStoreId(storeId)
  const [partnerName] = normalized.split("__")
  return partnerName?.trim() || ""
}

function buildGlovoContractChecklist(integration: MinimalIntegration) {
  const settings = integrationSettings(integration.settingsJson)
  const storeId = normalizeGlovoStoreId(integration?.storeId)
  const partnerName = String(settings.partnerName || inferGlovoPartnerName(storeId)).trim()
  const tokenConfigured = Boolean(String(integration?.webhookSecret || integration?.accessToken || "").trim())
  const locationSelected = Boolean(String(integration?.locationId || "").trim())
  const targetTerminalSelected = Boolean(String(settings.targetTerminalId || settings.targetTerminalDeviceId || "").trim())
  const storeIdConfigured = Boolean(storeId)
  const storeIdLooksValid = storeId.includes("__")
  const chainIdConfigured = Boolean(String(settings.glovoChainId || "").trim())
  const clientIdConfigured = Boolean(String(settings.glovoClientId || "").trim())
  const clientSecretConfigured = Boolean(String(settings.glovoClientSecret || "").trim())
  const orderNotificationsEnabled = Boolean(settings.portalOrderNotificationsEnabled)
  const cancelNotificationsEnabled = Boolean(settings.portalCancelNotificationsEnabled)
  const menuManagedByIntegration = Boolean(settings.menuManagedByIntegration)

  return {
    partnerName,
    storeId,
    checks: {
      locationSelected,
      targetTerminalSelected,
      tokenConfigured,
      storeIdConfigured,
      chainIdConfigured,
      clientIdConfigured,
      clientSecretConfigured,
      storeIdLooksValid,
      orderNotificationsEnabled,
      cancelNotificationsEnabled,
      menuManagedByIntegration,
    },
    readyForLiveOrders:
      locationSelected &&
      targetTerminalSelected &&
      tokenConfigured &&
      storeIdConfigured &&
      chainIdConfigured &&
      clientIdConfigured &&
      clientSecretConfigured &&
      storeIdLooksValid &&
      orderNotificationsEnabled,
  }
}

async function enrichImportedItems(tenantId: string, integrationId: string | null, items: MarketplaceOrderPayload["items"]) {
  const externalIds = items.map((item) => item.externalProductId?.trim()).filter(Boolean) as string[]
  const skuCandidates = items
    .flatMap((item) => [item.sku?.trim(), item.externalProductId?.trim()])
    .filter(Boolean) as string[]
  const mappings = integrationId && externalIds.length > 0
    ? await db.marketplaceProductMapping.findMany({
        where: {
          tenantId,
          integrationId,
          externalProductId: { in: externalIds },
        },
      })
    : []

  const mappingByExternalId = new Map<string, (typeof mappings)[number]>(
    mappings.map((item) => [item.externalProductId, item])
  )
  const mappedProductIds = mappings.map((item) => item.erpProductId).filter(Boolean) as string[]
  const products = mappedProductIds.length > 0 || skuCandidates.length > 0
    ? await db.product.findMany({
        where: {
          tenantId,
          OR: [
            ...(mappedProductIds.length > 0 ? [{ id: { in: mappedProductIds } }] : []),
            ...(skuCandidates.length > 0 ? [{ sku: { in: skuCandidates } }] : []),
          ],
        },
        select: {
          id: true,
          sku: true,
          departmentId: true,
          vatRate: {
            select: {
              rate: true,
            },
          },
        },
      })
    : []
  const productById = new Map<string, MinimalMappedProduct>(products.map((item) => [item.id, item]))
  const productBySku = new Map<string, MinimalMappedProduct>(products.map((item) => [String(item.sku || "").trim(), item]))

  return items.map((item) => {
    const mapping = item.externalProductId ? mappingByExternalId.get(item.externalProductId) : null
    const erpProductId = item.erpProductId || mapping?.erpProductId || undefined
    const fallbackSku = String(item.sku || item.externalProductId || "").trim()
    const product = erpProductId
      ? productById.get(erpProductId)
      : fallbackSku
        ? productBySku.get(fallbackSku)
        : null
    return {
      ...item,
      erpProductId: erpProductId || product?.id || undefined,
      departmentId: item.departmentId || product?.departmentId || undefined,
      sku: item.sku || product?.sku || undefined,
      vatRate: item.vatRate ?? product?.vatRate?.rate ?? undefined,
    }
  })
}

async function buildGlovoCatalogPreview(tenantId: string, integrationId: string) {
  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "GLOVO",
    },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
    },
  })

  if (!integration) {
    throw new Error("Glovo integration not found")
  }

  const products = await db.product.findMany({
    where: {
      tenantId,
      publishToGlovo: true,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      isActive: true,
      isVisibleInPos: true,
    },
    orderBy: [{ name: "asc" }],
  })

  const mappings = await db.marketplaceProductMapping.findMany({
    where: {
      tenantId,
      integrationId,
      erpProductId: { in: products.map((item) => item.id) },
    },
    orderBy: [{ updatedAt: "desc" }],
  })

  const mappingByProductId = new Map<string, (typeof mappings)[number]>()
  for (const mapping of mappings) {
    if (mapping.erpProductId && !mappingByProductId.has(mapping.erpProductId)) {
      mappingByProductId.set(mapping.erpProductId, mapping)
    }
  }

  const stockRows = integration.locationId
    ? await db.stockBalance.findMany({
        where: {
          tenantId,
          locationId: integration.locationId,
          productId: { in: products.map((item) => item.id) },
        },
        select: {
          productId: true,
          qty: true,
        },
      })
    : []

  const stockQtyByProductId = new Map<string, number>()
  for (const row of stockRows) {
    const current = stockQtyByProductId.get(row.productId) || 0
    stockQtyByProductId.set(row.productId, current + Number(row.qty || 0))
  }

  const items: GlovoCatalogPreviewItem[] = products.map((product) => {
    const mapping = mappingByProductId.get(product.id) || null
    const externalProductId = String(mapping?.externalProductId || product.sku || "").trim() || null
    const stockQty = integration.locationId ? Number(stockQtyByProductId.get(product.id) ?? 0) : null
    const issues: string[] = []

    if (!product.isActive) issues.push("produs inactiv")
    if (!product.isVisibleInPos) issues.push("ascuns din POS")
    if (Number(product.price || 0) <= 0) issues.push("pret 0")
    if (!externalProductId) issues.push("fara externalProductId sau SKU")
    if (!mapping?.externalProductId) issues.push("fara mapare explicita, se foloseste SKU")

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      price: Number(product.price || 0),
      stockQty,
      available: Boolean(product.isActive && product.isVisibleInPos),
      externalProductId,
      mapped: Boolean(mapping?.externalProductId),
      issues,
    }
  })

  const readyItems = items.filter((item) => item.available && item.price > 0 && item.externalProductId)

  return {
    integration: {
      id: integration.id,
      storeId: integration.storeId,
      location: integration.location,
    },
    summary: {
      totalPublished: items.length,
      readyForUpdates: readyItems.length,
      explicitlyMapped: items.filter((item) => item.mapped).length,
      usingSkuFallback: items.filter((item) => !item.mapped && Boolean(item.externalProductId)).length,
      missingExternalId: items.filter((item) => !item.externalProductId).length,
      inactiveOrHidden: items.filter((item) => !item.available).length,
      zeroPrice: items.filter((item) => item.price <= 0).length,
    },
    items,
  }
}

function resolveGlovoApiBaseUrl(integration: MinimalIntegration) {
  const settings = integrationSettings(integration.settingsJson)
  const configured = String(settings.glovoApiBaseUrl || process.env.GLOVO_API_BASE_URL || "https://api.glovoapp.com").trim()
  return configured.replace(/\/+$/, "")
}

function resolveGlovoAuthToken(integration: MinimalIntegration) {
  return String(integration.webhookSecret || integration.accessToken || "").trim()
}

async function ensureGlovoPushIntegration(tenantId: string, integrationId: string) {
  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "GLOVO",
      status: "ACTIVE",
    },
  })

  if (!integration) {
    throw new Error("Integrarea Glovo activa nu a fost gasita.")
  }

  const storeId = normalizeGlovoStoreId(integration.storeId)
  const authToken = resolveGlovoAuthToken(integration)
  const settings = integrationSettings(integration.settingsJson)

  if (!storeId) {
    throw new Error("Lipseste storeId pe integrarea Glovo.")
  }

  if (!authToken) {
    throw new Error("Lipseste tokenul Glovo pentru push de catalog.")
  }

  if (!settings.menuManagedByIntegration) {
    throw new Error("Pe integrarea Glovo nu este activat modulul de catalog gestionat prin integrare.")
  }

  return {
    integration,
    storeId,
    authToken,
    apiBaseUrl: resolveGlovoApiBaseUrl(integration),
  }
}

async function buildGlovoBulkUpdateProducts(tenantId: string, integrationId: string) {
  const preview = await buildGlovoCatalogPreview(tenantId, integrationId)
  const productIds = preview.items.map((item) => item.productId)
  const products = productIds.length > 0
    ? await db.product.findMany({
        where: {
          tenantId,
          id: { in: productIds },
        },
        select: {
          id: true,
          imageUrl: true,
        },
      })
    : []

  const productImageById = new Map<string, string | null>(
    products.map((item) => [item.id, normalizeHttpsUrl(item.imageUrl)])
  )

  const readyItems = preview.items.filter((item) => item.available && item.price > 0 && item.externalProductId)
  const payloadProducts: GlovoBulkUpdateProduct[] = readyItems.map((item) => {
    const payload: GlovoBulkUpdateProduct = {
      id: String(item.externalProductId),
      name: item.name,
      price: Number(item.price),
      available: Boolean(item.available),
    }
    const imageUrl = productImageById.get(item.productId)
    if (imageUrl) {
      payload.image_url = imageUrl
    }
    return payload
  })

  if (payloadProducts.length === 0) {
    throw new Error("Nu exista produse pregatite pentru push real Glovo.")
  }

  if (payloadProducts.length > 10000) {
    throw new Error("Catalogul depaseste limita Glovo de 10000 produse per request.")
  }

  return {
    preview,
    payload: {
      products: payloadProducts,
    },
  }
}

async function pushGlovoCatalogUpdate(tenantId: string, integrationId: string) {
  const { integration, storeId, authToken, apiBaseUrl } = await ensureGlovoPushIntegration(tenantId, integrationId)
  const { preview, payload } = await buildGlovoBulkUpdateProducts(tenantId, integrationId)
  return pushGlovoCatalogPayload(tenantId, integration.id, storeId, authToken, apiBaseUrl, payload, preview.summary)
}

async function pushGlovoCatalogPayload(
  tenantId: string,
  integrationId: string,
  storeId: string,
  authToken: string,
  apiBaseUrl: string,
  payload: { products: GlovoBulkUpdateProduct[] },
  summary?: Record<string, unknown>
) {
  const endpoint = `${apiBaseUrl}/webhook/stores/${encodeURIComponent(storeId)}/menu/updates`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let parsedResponse: unknown = null
  try {
    parsedResponse = responseText ? JSON.parse(responseText) : null
  } catch {
    parsedResponse = responseText || null
  }

  if (!response.ok) {
    throw new Error(
      `Glovo push failed (${response.status}): ${typeof parsedResponse === "string" ? parsedResponse : safeJsonStringify(parsedResponse)}`
    )
  }

  const transactionId = isRecord(parsedResponse) ? String(parsedResponse.transaction_id || "").trim() : ""
  if (!transactionId) {
    throw new Error("Glovo nu a returnat transaction_id pentru push-ul de catalog.")
  }

  const now = new Date().toISOString()
  await appendGlovoPushHistoryEntry(tenantId, integrationId, {
    transactionId,
    createdAt: now,
    updatedAt: now,
    status: "PROCESSING",
    endpoint,
    payload,
    summary,
    details: [],
    rejectedProductIds: [],
    response: parsedResponse,
  })

  return {
    integrationId,
    storeId,
    apiBaseUrl,
    endpoint,
    transactionId,
    payload,
    summary: summary || {},
    response: parsedResponse,
  }
}

async function verifyGlovoCatalogUpdateStatus(tenantId: string, integrationId: string, transactionId: string) {
  const { storeId, authToken, apiBaseUrl } = await ensureGlovoPushIntegration(tenantId, integrationId)
  const endpoint = `${apiBaseUrl}/webhook/stores/${encodeURIComponent(storeId)}/menu/updates/${encodeURIComponent(transactionId)}`

  const response = await fetch(endpoint, {
    headers: {
      Authorization: authToken,
      Accept: "application/json",
    },
  })

  const responseText = await response.text()
  let parsedResponse: unknown = null
  try {
    parsedResponse = responseText ? JSON.parse(responseText) : null
  } catch {
    parsedResponse = responseText || null
  }

  if (!response.ok) {
    throw new Error(
      `Glovo verify failed (${response.status}): ${typeof parsedResponse === "string" ? parsedResponse : safeJsonStringify(parsedResponse)}`
    )
  }

  const details = isRecord(parsedResponse) && Array.isArray(parsedResponse.details) ? normalizeStringArray(parsedResponse.details) : []
  const rejectedProductIds = parseGlovoRejectedProductIds(details)
  const status = isRecord(parsedResponse) ? String(parsedResponse.status || "").trim() : ""

  await updateGlovoPushHistoryEntry(tenantId, integrationId, transactionId, {
    status,
    details,
    rejectedProductIds,
    response: parsedResponse,
    updatedAt: new Date().toISOString(),
  })

  return {
    integrationId,
    storeId,
    apiBaseUrl,
    endpoint,
    transactionId,
    status,
    details,
    rejectedProductIds,
    promotionStatuses: isRecord(parsedResponse) && Array.isArray(parsedResponse.promotion_statuses) ? parsedResponse.promotion_statuses : [],
    response: parsedResponse,
  }
}

async function importMarketplaceOrderForTenant(tenantId: string, rawPayload: MarketplaceOrderPayload) {
  const location = await ensureLocationForTenant(tenantId, rawPayload.locationId)
  if (!location) {
    throw new Error("Location not found")
  }

  let integrationId = rawPayload.integrationId || null
  if (!integrationId) {
    const foundIntegration = await db.externalIntegration.findFirst({
      where: {
        tenantId,
        locationId: rawPayload.locationId,
        platform: rawPayload.platform,
      },
      orderBy: { createdAt: "desc" },
    })
    integrationId = foundIntegration?.id || null
  }

  const payload = {
    ...rawPayload,
    items: await enrichImportedItems(tenantId, integrationId, rawPayload.items),
  }

  return db.$transaction(async (tx: TransactionClient) => {
    const order = await tx.externalOrder.upsert({
      where: {
        tenantId_platform_externalOrderId: {
          tenantId,
          platform: payload.platform,
          externalOrderId: payload.externalOrderId,
        },
      },
      update: {
        tenantId,
        locationId: payload.locationId,
        integrationId,
        externalOrderNumber: payload.externalOrderNumber || null,
        customerName: payload.customerName || null,
        customerPhone: payload.customerPhone || null,
        customerNote: payload.customerNote || null,
        paymentLabel: payload.paymentLabel || null,
        currency: payload.currency,
        subtotal: payload.subtotal,
        total: payload.total,
        rawPayloadJson: (payload.rawPayload ?? payload) as Prisma.InputJsonValue,
        placedAt: payload.placedAt || new Date(),
        status: "RECEIVED",
        acknowledgedAt: null,
        readyAt: null,
        fiscalizedAt: null,
        cancelledAt: null,
      },
      create: {
        tenantId,
        locationId: payload.locationId,
        integrationId,
        platform: payload.platform,
        externalOrderId: payload.externalOrderId,
        externalOrderNumber: payload.externalOrderNumber || null,
        customerName: payload.customerName || null,
        customerPhone: payload.customerPhone || null,
        customerNote: payload.customerNote || null,
        paymentLabel: payload.paymentLabel || null,
        currency: payload.currency,
        subtotal: payload.subtotal,
        total: payload.total,
        rawPayloadJson: (payload.rawPayload ?? payload) as Prisma.InputJsonValue,
        placedAt: payload.placedAt || new Date(),
        status: "RECEIVED",
      },
    })

    await tx.externalOrderItem.deleteMany({
      where: { externalOrderId: order.id },
    })

    if (payload.items.length > 0) {
      await tx.externalOrderItem.createMany({
        data: payload.items.map((item) => ({
          externalOrderId: order.id,
          externalLineId: item.externalLineId || null,
          externalProductId: item.externalProductId || null,
          name: item.name,
          sku: item.sku || null,
          qty: item.qty,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate ?? null,
          note: item.note || null,
          modifiersJson: item.modifiers ? ({ items: item.modifiers } as Prisma.InputJsonValue) : undefined,
          erpProductId: item.erpProductId || null,
          mappingStatus: item.erpProductId ? "MAPPED" : "UNMAPPED",
        })),
      })
    }

    const kitchenTicket = await tx.kitchenTicket.upsert({
      where: { externalOrderId: order.id },
      update: {
        status: "NEW",
        source: "MARKETPLACE",
        displayNumber: payload.displayNumber || payload.externalOrderNumber || payload.externalOrderId,
        station: payload.station || null,
        note: payload.customerNote || null,
      },
      create: {
        tenantId,
        locationId: payload.locationId,
        externalOrderId: order.id,
        source: "MARKETPLACE",
        status: "NEW",
        displayNumber: payload.displayNumber || payload.externalOrderNumber || payload.externalOrderId,
        station: payload.station || null,
        note: payload.customerNote || null,
      },
    })

    await tx.kitchenTicketItem.deleteMany({
      where: { kitchenTicketId: kitchenTicket.id },
    })

    if (payload.items.length > 0) {
      await tx.kitchenTicketItem.createMany({
        data: payload.items.map((item) => ({
          kitchenTicketId: kitchenTicket.id,
          productId: item.erpProductId || null,
          name: item.name,
          qty: item.qty,
          departmentId: item.departmentId || null,
          station: item.station || payload.station || null,
          note: item.note || null,
          modifiersJson: item.modifiers ? ({ items: item.modifiers } as Prisma.InputJsonValue) : undefined,
        })),
      })
    }

    const draftCart = buildDraftCart(payload)

    await tx.saleDraft.upsert({
      where: { externalOrderId: order.id },
      update: {
        status: "OPEN",
        cartJson: draftCart as Prisma.InputJsonValue,
        subtotal: payload.subtotal,
        total: payload.total,
      },
      create: {
        tenantId,
        locationId: payload.locationId,
        externalOrderId: order.id,
        status: "OPEN",
        cartJson: draftCart as Prisma.InputJsonValue,
        subtotal: payload.subtotal,
        total: payload.total,
      },
    })

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId,
        externalOrderId: order.id,
        status: "RECEIVED",
        source: "BACKEND",
        message: "Marketplace order imported into ERP staging flow.",
        payloadJson: {
          platform: payload.platform,
          itemsCount: payload.items.length,
        } as Prisma.InputJsonValue,
      },
    })

    return tx.externalOrder.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        kitchenTicket: true,
        saleDraft: true,
      },
    })
  })
}

async function setMarketplaceLifecycleStatus(tenantId: string, inputOrderId: string, status: "RECEIVED" | "ACKNOWLEDGED" | "IN_KITCHEN" | "READY_FOR_FISCAL" | "DELIVERED" | "CANCELLED", source: "PLATFORM" | "KDS" | "POS" | "ERP", message: string, payloadJson?: unknown) {
  const order = await resolveMarketplaceOrder(tenantId, inputOrderId, {
    kitchenTicket: true,
    saleDraft: true,
  })
  if (!order) return null

  const now = new Date()
  await db.$transaction(async (tx: TransactionClient) => {
    await tx.externalOrder.update({
      where: { id: order.id },
      data: {
        status,
        ...(status === "ACKNOWLEDGED" ? { acknowledgedAt: now } : {}),
        ...(status === "READY_FOR_FISCAL" ? { readyAt: now } : {}),
        ...(status === "DELIVERED" ? { fiscalizedAt: order.fiscalizedAt || now } : {}),
        ...(status === "CANCELLED" ? { cancelledAt: now } : {}),
      },
    })

    if (order.kitchenTicket) {
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data:
          status === "READY_FOR_FISCAL"
            ? { status: "READY", readyAt: now }
            : status === "IN_KITCHEN"
              ? { status: "IN_PROGRESS" }
              : status === "DELIVERED"
                ? { status: "COMPLETED", completedAt: now }
                : status === "CANCELLED"
                  ? { status: "CANCELLED" }
                  : { status: "NEW" },
      })
    }

    if (order.saleDraft) {
      const nextDraftStatus =
        status === "READY_FOR_FISCAL"
          ? "READY_FOR_FISCAL"
          : status === "DELIVERED"
            ? "FISCALIZED"
            : status === "CANCELLED"
              ? "CANCELLED"
              : "OPEN"
      await tx.saleDraft.update({
        where: { id: order.saleDraft.id },
        data: { status: nextDraftStatus },
      })
    }

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId,
        externalOrderId: order.id,
        status,
        source,
        message,
        payloadJson: payloadJson ?? undefined,
      },
    })
  })

  return resolveMarketplaceOrder(tenantId, order.id, {
    items: true,
    kitchenTicket: true,
    saleDraft: true,
  })
}

async function fetchWoltOrderV2(orderId: string, token: string) {
  const response = await fetch(`https://pos-integration-service.wolt.com/v2/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  })
  if (!response.ok) {
    throw new Error(`Wolt order fetch failed with ${response.status}`)
  }
  return response.json()
}

function normalizeWoltOrderToImportPayload(integration: MinimalIntegration, payload: unknown): MarketplaceOrderPayload {
  const source = isRecord(payload) ? payload : {}
  const items = Array.isArray(source.items) ? source.items : []
  const payment = isRecord(source.payment) ? source.payment : {}
  const subtotal = toMoneyNumber(source.basket_price)
  const total =
    toMoneyNumber(source.price) ||
    toMoneyNumber(source.total_price) ||
    subtotal + toMoneyNumber(source.fees)

  return {
    platform: "WOLT",
    locationId: String(integration.locationId || "").trim(),
    integrationId: integration.id,
    externalOrderId: String(source.id || "").trim(),
    externalOrderNumber: String(source.order_number || "").trim() || undefined,
    customerName: String(source.consumer_name || "").trim() || undefined,
    customerPhone: String(source.consumer_phone_number || "").trim() || undefined,
    customerNote: String(source.consumer_comment || "").trim() || undefined,
    paymentLabel:
      String(
        payment.type ||
        payment.payment_type ||
        source.payment_type ||
        source.payment_method ||
        ""
      ).trim() || undefined,
    currency: "RON",
    subtotal,
    total,
    displayNumber: String(source.order_number || source.id || "").trim() || undefined,
    station: undefined,
    items: items.map((item, index: number) => {
      const row = isRecord(item) ? item : {}
      const quantity = Number(row.quantity || row.qty || 1) || 1
      const lineTotal = toMoneyNumber(row.price) || toMoneyNumber(row.total_price)
      return {
        externalLineId: String(row.id || `${String(source.id || "wolt")}-${index + 1}`).trim(),
        externalProductId: String(row.pos_product_id || row.merchant_supplied_id || row.id || "").trim() || undefined,
        name: String(row.name || row.item_name || "Produs Wolt").trim(),
        sku: String(row.merchant_supplied_id || row.sku || "").trim() || undefined,
        qty: quantity,
        unitPrice: quantity > 0 ? (lineTotal > 0 ? lineTotal / quantity : toMoneyNumber(row.unit_price)) : 0,
        vatRate: Number(row.vat_percentage ?? row.vat_rate ?? 0) || undefined,
        note: String(row.comment || row.note || "").trim() || undefined,
        modifiers: Array.isArray(row.options)
          ? row.options.map((option) => String((isRecord(option) ? option.name : "") || "").trim()).filter(Boolean)
          : undefined,
        erpProductId: undefined,
        departmentId: undefined,
        station: undefined,
      }
    }),
    rawPayload: source,
  }
}

function normalizeGlovoOrderToImportPayload(integration: MinimalIntegration, payload: unknown): MarketplaceOrderPayload {
  const source = isRecord(payload) ? payload : {}
  const products = Array.isArray(source.products) ? source.products : Array.isArray(source.items) ? source.items : []
  const total =
    toGlovoMoneyNumber(source.payment_total) ||
    toGlovoMoneyNumber(source.total_price) ||
    toGlovoMoneyNumber(source.total) ||
    products.reduce(
      (sum: number, item) =>
        sum + toGlovoMoneyNumber(isRecord(item) ? item.price : 0) * (Number(isRecord(item) ? item.quantity || 1 : 1) || 1),
      0
    )
  const subtotal = toGlovoMoneyNumber(source.subtotal) || total
  const customerNotes = [
    String(source.special_requirements || "").trim(),
    String(source.comments || source.notes || source.customer_note || "").trim(),
    String(source.allergy_info || "").trim(),
  ].filter(Boolean)
  const placedAtRaw = String(source.order_time || "").trim()
  const placedAt = placedAtRaw ? new Date(placedAtRaw.replace(" ", "T")) : undefined
  const customer = isRecord(source.customer) ? source.customer : {}
  const payment = isRecord(source.payment) ? source.payment : {}

  return {
    platform: "GLOVO",
    locationId: String(integration.locationId || "").trim(),
    integrationId: integration.id,
    externalOrderId: String(source.id || source.order_id || "").trim(),
    externalOrderNumber: String(source.order_code || source.order_number || "").trim() || undefined,
    customerName: String(customer.name || source.customer_name || "").trim() || undefined,
    customerPhone: String(customer.phone_number || customer.phone || source.customer_phone || "").trim() || undefined,
    customerNote: customerNotes.join(" | ") || undefined,
    paymentLabel:
      String(
        payment.type ||
        payment.payment_type ||
        source.payment_method ||
        source.payment_type ||
        ""
      ).trim() || undefined,
    currency: "RON",
    subtotal,
    total,
    placedAt: placedAt && !Number.isNaN(placedAt.getTime()) ? placedAt : undefined,
    displayNumber: String(source.order_code || source.id || source.order_id || "").trim() || undefined,
    station: undefined,
    items: products.map((item, index: number) => {
      const row = isRecord(item) ? item : {}
      const quantity = Number(row.quantity || row.qty || 1) || 1
      const unitPrice = toGlovoMoneyNumber(row.price) || toGlovoMoneyNumber(row.unit_price)
      return {
        externalLineId: String(row.purchased_product_id || row.id || row.product_id || `${String(source.id || "glovo")}-${index + 1}`).trim(),
        externalProductId: String(row.product_id || row.id || "").trim() || undefined,
        name: String(row.name || row.product_name || "Produs Glovo").trim(),
        sku: String(row.sku || "").trim() || undefined,
        qty: quantity,
        unitPrice,
        vatRate: Number(row.vat_percentage ?? row.vat_rate ?? 0) || undefined,
        note: String(row.comment || row.note || "").trim() || undefined,
        modifiers: Array.isArray(row.attributes)
          ? row.attributes.map((option) => String((isRecord(option) ? option.name : "") || "").trim()).filter(Boolean)
          : undefined,
        erpProductId: undefined,
        departmentId: undefined,
        station: undefined,
      }
    }),
    rawPayload: source,
  }
}

async function findMatchingGlovoIntegration(payload: unknown, routeStoreId?: string) {
  const source = isRecord(payload) ? payload : {}
  const storeId = normalizeGlovoStoreId(routeStoreId || source.store_id || source.storeId)
  const token = String(source._glovoToken || "").trim()

  const integrations = await db.externalIntegration.findMany({
    where: {
      platform: "GLOVO",
      status: "ACTIVE",
      ...(storeId ? { storeId } : {}),
    },
  })

  return integrations.find((integration) => {
    const secret = String(integration.webhookSecret || integration.accessToken || "").trim()
    if (secret && token) return secret === token
    if (secret && !token) return false
    return true
  }) || null
}

async function processGlovoWebhook(req: Request, res: Response, kind: "ORDER" | "CANCEL") {
  const token = String(req.header("Authorization") || req.header("X-Glovo-Webhook-Token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim()
  const payload = {
    ...(req.body || {}),
    _glovoToken: token,
  }
  const storeId = normalizeGlovoStoreId(req.params.storeId || req.body?.store_id || req.body?.storeId)
  const orderId = String(req.body?.id || req.body?.order_id || "").trim()

  const matchedIntegration = await findMatchingGlovoIntegration(payload, storeId)
  if (!matchedIntegration) {
    return res.status(404).json({ ok: false, error: "No Glovo integration matched webhook." })
  }

  try {
    const rawStatus = String(req.body?.status || req.body?.order_status || "").trim().toUpperCase()

    if (kind === "CANCEL" || ["CANCELLED", "CANCELED"].includes(rawStatus)) {
      if (orderId) {
        await setMarketplaceLifecycleStatus(
          matchedIntegration.tenantId,
          orderId,
          "CANCELLED",
          "PLATFORM",
          "Glovo cancellation notification received.",
          req.body,
        )
      }
      return res.json({ ok: true })
    }

    const parsedPayload = normalizeGlovoOrderToImportPayload(matchedIntegration, req.body)
    const externalOrder = await importMarketplaceOrderForTenant(matchedIntegration.tenantId, parsedPayload)
    if (!externalOrder) {
      throw new Error("Glovo order import did not return an ERP order.")
    }

    if (["ACCEPTED"].includes(rawStatus)) {
      await setMarketplaceLifecycleStatus(
        matchedIntegration.tenantId,
        externalOrder.id,
        "ACKNOWLEDGED",
        "PLATFORM",
        "Glovo webhook marked order as accepted.",
        req.body
      )
    }

    if (["READY_FOR_PICKUP", "READY"].includes(rawStatus)) {
      await setMarketplaceLifecycleStatus(
        matchedIntegration.tenantId,
        externalOrder.id,
        "READY_FOR_FISCAL",
        "PLATFORM",
        "Glovo webhook marked order as ready for pickup.",
        req.body
      )
    }

    return res.json({ ok: true, orderId: externalOrder.id })
  } catch (error: unknown) {
    return res.status(500).json({ ok: false, error: getErrorMessage(error, "Glovo webhook failed") })
  }
}

router.post("/api/v1/marketplace/webhooks/wolt", async (req, res) => {
  const payload = req.body || {}
  const order = payload?.order || {}
  const venueId = String(order?.venue_id || "").trim()
  const externalVenueId = String(payload?.external_venue_id || order?.external_venue_id || "").trim()
  const orderId = String(order?.id || "").trim()
  const signature = String(req.header("WOLT-SIGNATURE") || "").trim().toLowerCase()

  const integrations = await db.externalIntegration.findMany({
    where: {
      platform: "WOLT",
      status: "ACTIVE",
    },
  })

  const matchedIntegration = integrations.find((integration) => {
    const storeMatches = externalVenueId && integration.storeId && integration.storeId === externalVenueId
    const merchantMatches = venueId && integration.merchantId && integration.merchantId === venueId
    const secret = String(integration.webhookSecret || "").trim()
    if (secret && signature) {
      const expected = hmacHex(secret, safeJsonStringify(payload)).toLowerCase()
      if (expected !== signature) return false
    }
    return storeMatches || merchantMatches
  })

  if (!matchedIntegration) {
    return res.status(404).json({ ok: false, error: "No Wolt integration matched webhook." })
  }

  try {
    const eventStatus = String(order?.status || "").trim().toUpperCase()

    if (["CANCELED", "REJECTED"].includes(eventStatus)) {
      if (orderId) {
        await setMarketplaceLifecycleStatus(
          matchedIntegration.tenantId,
          orderId,
          "CANCELLED",
          "PLATFORM",
          "Wolt webhook marked order as cancelled.",
          payload
        )
      }
      return res.json({ ok: true })
    }

    if (eventStatus === "DELIVERED" && orderId) {
      await setMarketplaceLifecycleStatus(
        matchedIntegration.tenantId,
        orderId,
        "DELIVERED",
        "PLATFORM",
        "Wolt webhook marked order as delivered.",
        payload
      )
      return res.json({ ok: true })
    }

    const token = String(matchedIntegration.accessToken || "").trim()
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing Wolt access token on integration." })
    }

    const orderData = await fetchWoltOrderV2(orderId, token)
    const importPayload = normalizeWoltOrderToImportPayload(matchedIntegration, orderData)
    const externalOrder = await importMarketplaceOrderForTenant(matchedIntegration.tenantId, importPayload)
    if (!externalOrder) {
      throw new Error("Wolt order import did not return an ERP order.")
    }

    if (eventStatus === "PRODUCTION") {
      await setMarketplaceLifecycleStatus(
        matchedIntegration.tenantId,
        externalOrder.id,
        "IN_KITCHEN",
        "PLATFORM",
        "Wolt webhook marked order as in production.",
        payload
      )
    }

    if (eventStatus === "READY") {
      await setMarketplaceLifecycleStatus(
        matchedIntegration.tenantId,
        externalOrder.id,
        "READY_FOR_FISCAL",
        "PLATFORM",
        "Wolt webhook marked order as ready.",
        payload
      )
    }

    return res.json({ ok: true, orderId: externalOrder.id })
  } catch (error: unknown) {
    return res.status(500).json({ ok: false, error: getErrorMessage(error, "Wolt webhook failed") })
  }
})

router.post("/api/v1/marketplace/webhooks/glovo/:storeId?", async (req, res) => {
  return processGlovoWebhook(req, res, "ORDER")
})

router.post("/api/v1/marketplace/webhooks/glovo/order/:storeId?", async (req, res) => {
  return processGlovoWebhook(req, res, "ORDER")
})

router.post("/api/v1/marketplace/webhooks/glovo/cancel/:storeId?", async (req, res) => {
  return processGlovoWebhook(req, res, "CANCEL")
})

router.use(requireAuth)

router.get("/api/v1/marketplace/platforms", (_req, res) => {
  return res.json({
    ok: true,
    items: [
      { code: "GLOVO", label: "Glovo", capabilities: ["ORDERS", "KDS", "READY_FOR_FISCAL"] },
      { code: "WOLT", label: "Wolt", capabilities: ["ORDERS", "KDS", "READY_FOR_FISCAL"] },
      { code: "BOLT_FOOD", label: "Bolt Food", capabilities: ["ORDERS_PENDING_ACCESS", "KDS", "READY_FOR_FISCAL"] },
    ],
  })
})

router.get("/api/v1/marketplace/integrations", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const items = await db.externalIntegration.findMany({
    where: { tenantId },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
    },
    orderBy: [{ platform: "asc" }, { createdAt: "desc" }],
  })

  const enrichedItems = items.map((item) => ({
    ...item,
    contract: item.platform === "GLOVO" ? buildGlovoContractChecklist(item) : null,
  }))

  return res.json({ ok: true, items: enrichedItems })
})

router.get("/api/v1/marketplace/integrations/glovo/catalog-preview", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.query.integrationId || "").trim()
  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  try {
    const preview = await buildGlovoCatalogPreview(tenantId, integrationId)
    return res.json({ ok: true, ...preview })
  } catch (error: unknown) {
    return res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut genera preview-ul Glovo.") })
  }
})

router.get("/api/v1/marketplace/integrations/glovo/push-history", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.query.integrationId || "").trim()
  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "GLOVO",
    },
    select: {
      id: true,
      settingsJson: true,
    },
  })

  if (!integration) {
    return res.status(404).json({ ok: false, error: "Integrarea Glovo nu a fost gasita." })
  }

  return res.json({
    ok: true,
    items: readGlovoPushHistory(integration.settingsJson),
  })
})

router.post("/api/v1/marketplace/integrations/glovo/push-catalog", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.body?.integrationId || "").trim()
  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  try {
    const result = await pushGlovoCatalogUpdate(tenantId, integrationId)
    return res.json({ ok: true, ...result })
  } catch (error: unknown) {
    return res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut trimite catalogul la Glovo.") })
  }
})

router.post("/api/v1/marketplace/integrations/glovo/retry-push", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.body?.integrationId || "").trim()
  const transactionId = String(req.body?.transactionId || "").trim()
  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  try {
    const { storeId, authToken, apiBaseUrl, integration } = await ensureGlovoPushIntegration(tenantId, integrationId)
    const history = readGlovoPushHistory(integration.settingsJson)
    const selectedEntry = transactionId
      ? history.find((item) => item.transactionId === transactionId)
      : history[0]

    if (!selectedEntry?.payload?.products?.length) {
      throw new Error("Nu exista payload salvat pentru retry Glovo.")
    }

    const result = await pushGlovoCatalogPayload(
      tenantId,
      integrationId,
      storeId,
      authToken,
      apiBaseUrl,
      selectedEntry.payload,
      selectedEntry.summary
    )

    return res.json({
      ok: true,
      retriedFromTransactionId: selectedEntry.transactionId,
      ...result,
    })
  } catch (error: unknown) {
    return res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut relansa push-ul Glovo.") })
  }
})

router.get("/api/v1/marketplace/integrations/glovo/push-status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.query.integrationId || "").trim()
  const transactionId = String(req.query.transactionId || "").trim()

  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  if (!transactionId) {
    return res.status(400).json({ ok: false, error: "transactionId is required" })
  }

  try {
    const result = await verifyGlovoCatalogUpdateStatus(tenantId, integrationId, transactionId)
    return res.json({ ok: true, ...result })
  } catch (error: unknown) {
    return res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut verifica statusul push-ului Glovo.") })
  }
})

router.get("/api/v1/marketplace/orders", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const platform = String(req.query.platform || "").trim().toUpperCase()
  const status = String(req.query.status || "").trim().toUpperCase()
  const locationId = String(req.query.locationId || "").trim()
  const q = String(req.query.q || "").trim()

  const where: Prisma.ExternalOrderWhereInput = { tenantId }
  if (platform && isMarketplacePlatform(platform)) where.platform = platform
  if (status && isMarketplaceOrderStatus(status)) where.status = status
  if (locationId) where.locationId = locationId
  if (q) {
    where.OR = [
      { externalOrderId: { contains: q, mode: "insensitive" } },
      { externalOrderNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ]
  }

  const items = await db.externalOrder.findMany({
    where,
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
      integration: {
        select: {
          id: true,
          platform: true,
          status: true,
          locationId: true,
          merchantId: true,
          storeId: true,
        },
      },
      kitchenTicket: {
        select: {
          id: true,
          status: true,
          displayNumber: true,
          sentToKdsAt: true,
          readyAt: true,
          completedAt: true,
        },
      },
      saleDraft: {
        select: {
          id: true,
          status: true,
          subtotal: true,
          total: true,
          updatedAt: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 8,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 120,
  })

  return res.json({ ok: true, items })
})

router.get("/api/v1/marketplace/mappings", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.query.integrationId || "").trim()

  const mappings = await db.marketplaceProductMapping.findMany({
    where: {
      tenantId,
      ...(integrationId ? { integrationId } : {}),
    },
    include: {
      integration: {
        include: {
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      },
      erpProduct: {
        select: {
          id: true,
          sku: true,
          name: true,
          trackLot: true,
          trackExpiry: true,
          costMethod: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  })

  const recentItems = await db.externalOrderItem.findMany({
    where: {
      externalOrder: {
        tenantId,
        ...(integrationId ? { integrationId } : {}),
      },
    },
    include: {
      externalOrder: {
        select: {
          id: true,
          platform: true,
          integrationId: true,
          locationId: true,
          updatedAt: true,
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  })

  const mappedKeySet = new Set(
    mappings.map((item) => `${item.integrationId}::${item.externalProductId}`),
  )

  const seenRecent = new Map<string, RecentExternalProduct>()
  for (const item of recentItems) {
    const integrationKey = `${item.externalOrder?.integrationId || ""}::${item.externalProductId || item.name}`
    if (seenRecent.has(integrationKey)) continue
    seenRecent.set(integrationKey, {
      integrationId: item.externalOrder?.integrationId || null,
      externalProductId: item.externalProductId || null,
      externalName: item.name,
      sku: item.sku || null,
      mappingStatus: item.mappingStatus,
      orderItemId: item.id,
      lastSeenAt: item.updatedAt,
      location: item.externalOrder?.location || null,
      platform: item.externalOrder?.platform || null,
      mapped: mappedKeySet.has(`${item.externalOrder?.integrationId || ""}::${item.externalProductId || ""}`),
    })
  }

  return res.json({
    ok: true,
    mappings,
    recentExternalProducts: Array.from(seenRecent.values()),
  })
})

router.post("/api/v1/marketplace/mappings", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.body?.integrationId || "").trim()
  const externalProductId = String(req.body?.externalProductId || "").trim()
  const externalName = String(req.body?.externalName || "").trim() || null
  const erpProductId = String(req.body?.erpProductId || "").trim() || null

  if (!integrationId || !externalProductId) {
    return res.status(400).json({ ok: false, error: "integrationId si externalProductId sunt obligatorii." })
  }

  const integration = await db.externalIntegration.findFirst({
    where: { id: integrationId, tenantId },
  })
  if (!integration) {
    return res.status(404).json({ ok: false, error: "Integrarea marketplace nu exista." })
  }

  const product = erpProductId
    ? await db.product.findFirst({
        where: { id: erpProductId, tenantId },
        select: { id: true, name: true, sku: true, trackLot: true, trackExpiry: true, costMethod: true },
      })
    : null

  if (erpProductId && !product) {
    return res.status(404).json({ ok: false, error: "Produsul ERP nu exista." })
  }

  const mapping = await db.marketplaceProductMapping.upsert({
    where: {
      integrationId_externalProductId: {
        integrationId,
        externalProductId,
      },
    },
    update: {
      externalName,
      erpProductId,
      status: erpProductId ? "MAPPED" : "UNMAPPED",
      lastSeenAt: new Date(),
    },
    create: {
      tenantId,
      integrationId,
      externalProductId,
      externalName,
      erpProductId,
      status: erpProductId ? "MAPPED" : "UNMAPPED",
      lastSeenAt: new Date(),
    },
    include: {
      integration: {
        include: {
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      },
      erpProduct: {
        select: {
          id: true,
          sku: true,
          name: true,
          trackLot: true,
          trackExpiry: true,
          costMethod: true,
        },
      },
    },
  })

  await db.externalOrderItem.updateMany({
    where: {
      externalProductId,
      externalOrder: {
        tenantId,
        integrationId,
      },
    },
    data: {
      erpProductId,
      mappingStatus: erpProductId ? "MAPPED" : "UNMAPPED",
    },
  })

  return res.json({ ok: true, mapping })
})

router.post("/api/v1/marketplace/integrations/:platform/connect", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const platformParsed = PLATFORM_ENUM.safeParse(req.params.platform)
  if (!platformParsed.success) {
    return res.status(400).json({ ok: false, error: "Platform invalid" })
  }

  const bodyParsed = ConnectIntegrationSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({ ok: false, error: bodyParsed.error.flatten() })
  }

  const location = await ensureLocationForTenant(tenantId, bodyParsed.data.locationId)
  if (!location) {
    return res.status(404).json({ ok: false, error: "Location not found" })
  }

  const incomingSettings: JsonRecord = bodyParsed.data.settings && typeof bodyParsed.data.settings === "object"
    ? { ...bodyParsed.data.settings }
    : {}

  if (platformParsed.data === "GLOVO") {
    const normalizedStoreId = normalizeGlovoStoreId(bodyParsed.data.storeId)
    if (!normalizedStoreId) {
      return res.status(400).json({ ok: false, error: "Glovo are nevoie de Store ID / LID din portal." })
    }

    const partnerName = String(incomingSettings.partnerName || inferGlovoPartnerName(normalizedStoreId)).trim()
    incomingSettings.partnerName = partnerName || undefined
    incomingSettings.portalOrderNotificationsEnabled = Boolean(incomingSettings.portalOrderNotificationsEnabled)
    incomingSettings.portalCancelNotificationsEnabled = Boolean(incomingSettings.portalCancelNotificationsEnabled)
    incomingSettings.menuManagedByIntegration = Boolean(incomingSettings.menuManagedByIntegration)
    incomingSettings.glovoStoreIdLooksValid = normalizedStoreId.includes("__")
  }

  const existingIntegration = await db.externalIntegration.findFirst({
    where: {
      tenantId,
      locationId: location.id,
      platform: platformParsed.data,
    },
    orderBy: { createdAt: "desc" },
  })

  const integrationSettingsJson =
    Object.keys(incomingSettings).length > 0 ? (incomingSettings as Prisma.InputJsonValue) : undefined

  const integrationUpdatePayload: Prisma.ExternalIntegrationUncheckedUpdateInput = {
    status: "ACTIVE",
    authType: bodyParsed.data.authType,
    merchantId: bodyParsed.data.merchantId || null,
    storeId: bodyParsed.data.storeId || null,
    accessToken: bodyParsed.data.accessToken || null,
    refreshToken: bodyParsed.data.refreshToken || null,
    webhookSecret: bodyParsed.data.webhookSecret || null,
    settingsJson: integrationSettingsJson,
  }

  const integrationCreatePayload: Prisma.ExternalIntegrationUncheckedCreateInput = {
    tenantId,
    locationId: location.id,
    platform: platformParsed.data,
    status: "ACTIVE",
    authType: bodyParsed.data.authType,
    merchantId: bodyParsed.data.merchantId || null,
    storeId: bodyParsed.data.storeId || null,
    accessToken: bodyParsed.data.accessToken || null,
    refreshToken: bodyParsed.data.refreshToken || null,
    webhookSecret: bodyParsed.data.webhookSecret || null,
    settingsJson: integrationSettingsJson,
  }

  const integration = existingIntegration
    ? await db.externalIntegration.update({
        where: { id: existingIntegration.id },
        data: integrationUpdatePayload,
        include: {
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      })
    : await db.externalIntegration.create({
        data: integrationCreatePayload,
        include: {
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      })

  return res.json({
    ok: true,
    integration,
  })
})

router.post("/api/v1/marketplace/integrations/wolt/test-pull", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.body?.integrationId || "").trim()
  const orderId = String(req.body?.orderId || "").trim()
  if (!integrationId || !orderId) {
    return res.status(400).json({ ok: false, error: "integrationId and orderId are required" })
  }

  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "WOLT",
    },
  })
  if (!integration) {
    return res.status(404).json({ ok: false, error: "Wolt integration not found" })
  }

  try {
    const token = String(integration.accessToken || "").trim()
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing Wolt access token" })
    }
    const orderData = await fetchWoltOrderV2(orderId, token)
    const importPayload = normalizeWoltOrderToImportPayload(integration, orderData)
    const externalOrder = await importMarketplaceOrderForTenant(tenantId, importPayload)
    return res.json({ ok: true, order: externalOrder })
  } catch (error: unknown) {
    return res.status(500).json({ ok: false, error: getErrorMessage(error, "Wolt pull failed") })
  }
})

router.post("/api/v1/marketplace/integrations/glovo/test-import", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const integrationId = String(req.body?.integrationId || "").trim()
  if (!integrationId) {
    return res.status(400).json({ ok: false, error: "integrationId is required" })
  }

  const integration = await db.externalIntegration.findFirst({
    where: {
      id: integrationId,
      tenantId,
      platform: "GLOVO",
    },
  })
  if (!integration) {
    return res.status(404).json({ ok: false, error: "Glovo integration not found" })
  }

  try {
    const requestOrder = req.body?.order || req.body || {}
    const normalizedTestOrder = {
      ...requestOrder,
      customer: {
        ...(requestOrder?.customer || {}),
        name: String(requestOrder?.customer?.name || requestOrder?.customer_name || "Client test Glovo").trim(),
        phone_number: String(requestOrder?.customer?.phone_number || requestOrder?.customer?.phone || requestOrder?.customer_phone || "0722000000").trim(),
      },
      payment: {
        ...(requestOrder?.payment || {}),
        type: String(requestOrder?.payment?.type || requestOrder?.payment?.payment_type || requestOrder?.payment_type || "PAID").trim(),
        payment_type: String(requestOrder?.payment?.payment_type || requestOrder?.payment?.type || requestOrder?.payment_type || "PAID").trim(),
      },
    }
    const importPayload = normalizeGlovoOrderToImportPayload(integration, normalizedTestOrder)
    const externalOrder = await importMarketplaceOrderForTenant(tenantId, importPayload)
    return res.json({ ok: true, order: externalOrder })
  } catch (error: unknown) {
    return res.status(500).json({ ok: false, error: getErrorMessage(error, "Glovo import failed") })
  }
})

router.post("/api/v1/marketplace/orders/import", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const parsed = ImportMarketplaceOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const payload = parsed.data
  let externalOrder
  try {
    externalOrder = await importMarketplaceOrderForTenant(tenantId, payload)
  } catch (error: unknown) {
    return res.status(400).json({ ok: false, error: getErrorMessage(error, "Import failed") })
  }

  return res.status(201).json({
    ok: true,
    order: externalOrder,
  })
})

router.get("/api/v1/marketplace/orders/ready-for-fiscal", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const items = await db.externalOrder.findMany({
    where: {
      tenantId,
      status: "READY_FOR_FISCAL",
    },
    include: {
      location: {
        select: { id: true, name: true, code: true },
      },
      saleDraft: {
        select: { id: true, status: true, total: true, subtotal: true, updatedAt: true },
      },
      kitchenTicket: {
        select: { id: true, status: true, displayNumber: true, readyAt: true },
      },
      items: true,
    },
    orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }],
  })

  return res.json({
    ok: true,
    items,
  })
})

router.post("/api/v1/marketplace/orders/:externalOrderId/kds-ready", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const bodyParsed = ReadyStatusSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({ ok: false, error: bodyParsed.error.flatten() })
  }

  const inputOrderId = String(req.params.externalOrderId || "").trim()
  if (!inputOrderId) {
    return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
  }

  const order = await resolveMarketplaceOrder(tenantId, inputOrderId, {
    kitchenTicket: true,
    saleDraft: true,
  })

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" })
  }

  const now = new Date()

  const updated = await db.$transaction(async (tx: TransactionClient) => {
    const updatedOrder = await tx.externalOrder.update({
      where: { id: order.id },
      data: {
        status: "READY_FOR_FISCAL",
        readyAt: now,
      },
    })

    if (order.kitchenTicket) {
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data: {
          status: "READY",
          readyAt: now,
        },
      })
    } else if (bodyParsed.data.kitchenTicketId) {
      await tx.kitchenTicket.update({
        where: { id: bodyParsed.data.kitchenTicketId },
        data: {
          status: "READY",
          readyAt: now,
        },
      })
    }

    if (order.saleDraft) {
      await tx.saleDraft.update({
        where: { id: order.saleDraft.id },
        data: {
          status: "READY_FOR_FISCAL",
        },
      })
    }

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId,
        externalOrderId: order.id,
        status: "READY_FOR_FISCAL",
        source: "KDS",
        message: normalizeStatusMessage(bodyParsed.data.message) || "KDS marked marketplace order as ready.",
        payloadJson: {
          kitchenTicketId: bodyParsed.data.kitchenTicketId || order.kitchenTicket?.id || null,
        } as Prisma.InputJsonValue,
      },
    })

    return updatedOrder
  })

  return res.json({
    ok: true,
    externalOrderId: updated.id,
    status: updated.status,
    readyAt: updated.readyAt,
  })
})

router.post("/api/v1/marketplace/orders/:externalOrderId/load-cart", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const inputOrderId = String(req.params.externalOrderId || "").trim()
  if (!inputOrderId) {
    return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
  }

  const order = await resolveMarketplaceOrder(tenantId, inputOrderId, {
    saleDraft: true,
    location: {
      select: { id: true, name: true, code: true },
    },
  })

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" })
  }

  if (!order.saleDraft) {
    return res.status(404).json({ ok: false, error: "Sale draft not found for marketplace order" })
  }

  if (order.saleDraft.status === "CANCELLED") {
    return res.status(400).json({ ok: false, error: "Sale draft is cancelled" })
  }

  await createOrderHistory(
    tenantId,
    order.id,
    order.status,
    "POS",
    "POS requested marketplace cart load.",
    { saleDraftId: order.saleDraft.id }
  )

  return res.json({
    ok: true,
    externalOrder: {
      id: order.id,
      externalOrderId: order.externalOrderId,
      externalOrderNumber: order.externalOrderNumber,
      platform: order.platform,
      status: order.status,
      location: order.location,
    },
    saleDraft: {
      id: order.saleDraft.id,
      status: order.saleDraft.status,
      subtotal: Number(order.saleDraft.subtotal || 0),
      total: Number(order.saleDraft.total || 0),
      cart: order.saleDraft.cartJson,
    },
  })
})

const FiscalizedOrderSchema = z.object({
  saleId: z.string().trim().optional(),
  receiptNo: z.string().trim().optional(),
  clientSaleId: z.string().trim().optional(),
  message: z.string().trim().optional(),
})

router.post("/api/v1/marketplace/orders/:externalOrderId/fiscalized", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing tenant context" })
  }

  const parsed = FiscalizedOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const inputOrderId = String(req.params.externalOrderId || "").trim()
  if (!inputOrderId) {
    return res.status(400).json({ ok: false, error: "Missing externalOrderId" })
  }

  const order = await resolveMarketplaceOrder(tenantId, inputOrderId, {
    saleDraft: true,
    kitchenTicket: true,
    sale: {
      select: { id: true, receiptNo: true, clientSaleId: true },
    },
  })

  if (!order) {
    return res.status(404).json({ ok: false, error: "Marketplace order not found" })
  }

  const sale = parsed.data.saleId
    ? await db.sale.findFirst({
        where: {
          id: parsed.data.saleId,
          tenantId,
        },
        select: { id: true, receiptNo: true, clientSaleId: true },
      })
    : null

  if (parsed.data.saleId && !sale) {
    return res.status(404).json({ ok: false, error: "Sale not found for tenant" })
  }

  const now = new Date()

  const updatedOrder = await db.$transaction(async (tx: TransactionClient) => {
    const nextOrder = await tx.externalOrder.update({
      where: { id: order.id },
      data: {
        status: "FISCALIZED",
        fiscalizedAt: now,
      },
    })

    if (order.saleDraft) {
      await tx.saleDraft.update({
        where: { id: order.saleDraft.id },
        data: {
          status: "FISCALIZED",
        },
      })
    }

    if (order.kitchenTicket) {
      await tx.kitchenTicket.update({
        where: { id: order.kitchenTicket.id },
        data: {
          status: "COMPLETED",
          completedAt: now,
        },
      })
    }

    await tx.externalOrderStatusHistory.create({
      data: {
        tenantId,
        externalOrderId: order.id,
        status: "FISCALIZED",
        source: "ERP",
        message: normalizeStatusMessage(parsed.data.message) || "Marketplace order fiscalized in ERP.",
        payloadJson: {
          saleId: sale?.id || order.sale?.id || null,
          receiptNo: parsed.data.receiptNo || sale?.receiptNo || order.sale?.receiptNo || null,
          clientSaleId: parsed.data.clientSaleId || sale?.clientSaleId || order.sale?.clientSaleId || null,
        } as Prisma.InputJsonValue,
      },
    })

    return nextOrder
  })

  return res.json({
    ok: true,
    externalOrderId: updatedOrder.id,
    status: updatedOrder.status,
    fiscalizedAt: updatedOrder.fiscalizedAt,
  })
})

export default router
