import { Router } from "express"
import crypto from "crypto"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()
const db = prisma as any

const PLATFORMS = ["GLOVO", "WOLT", "BOLT_FOOD"] as const
const PLATFORM_ENUM = z.enum(PLATFORMS)

const ConnectIntegrationSchema = z.object({
  locationId: z.string().min(1),
  authType: z.enum(["OAUTH", "API_KEY", "PARTNER"]).default("PARTNER"),
  merchantId: z.string().trim().optional(),
  storeId: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  refreshToken: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
  settings: z.record(z.any()).optional(),
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
  rawPayload: z.any().optional(),
})

const ReadyStatusSchema = z.object({
  kitchenTicketId: z.string().min(1).optional(),
  message: z.string().trim().optional(),
})

function normalizeStatusMessage(message?: string) {
  const text = String(message || "").trim()
  return text || null
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

async function resolveMarketplaceOrder(tenantId: string, inputOrderId: string, include: Record<string, unknown> = {}) {
  return db.externalOrder.findFirst({
    where: {
      tenantId,
      OR: [{ id: inputOrderId }, { externalOrderId: inputOrderId }],
    },
    include,
  })
}

async function createOrderHistory(tenantId: string, externalOrderId: string, status: string, source: string, message?: string, payloadJson?: unknown) {
  return db.externalOrderStatusHistory.create({
    data: {
      tenantId,
      externalOrderId,
      status,
      source,
      message: normalizeStatusMessage(message),
      payloadJson: payloadJson ?? undefined,
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
    const obj = value as any
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

function inferGlovoPartnerName(storeId: string) {
  const normalized = normalizeGlovoStoreId(storeId)
  const [partnerName] = normalized.split("__")
  return partnerName?.trim() || ""
}

function buildGlovoContractChecklist(integration: any) {
  const settings = integration?.settingsJson && typeof integration.settingsJson === "object"
    ? integration.settingsJson
    : {}
  const storeId = normalizeGlovoStoreId(integration?.storeId)
  const partnerName = String(settings?.partnerName || inferGlovoPartnerName(storeId)).trim()
  const tokenConfigured = Boolean(String(integration?.webhookSecret || integration?.accessToken || "").trim())
  const locationSelected = Boolean(String(integration?.locationId || "").trim())
  const targetTerminalSelected = Boolean(String(settings?.targetTerminalId || settings?.targetTerminalDeviceId || "").trim())
  const storeIdConfigured = Boolean(storeId)
  const storeIdLooksValid = storeId.includes("__")
  const chainIdConfigured = Boolean(String(settings?.glovoChainId || "").trim())
  const clientIdConfigured = Boolean(String(settings?.glovoClientId || "").trim())
  const clientSecretConfigured = Boolean(String(settings?.glovoClientSecret || "").trim())
  const orderNotificationsEnabled = Boolean(settings?.portalOrderNotificationsEnabled)
  const cancelNotificationsEnabled = Boolean(settings?.portalCancelNotificationsEnabled)
  const menuManagedByIntegration = Boolean(settings?.menuManagedByIntegration)

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

async function enrichImportedItems(tenantId: string, integrationId: string | null, items: z.infer<typeof ImportMarketplaceOrderSchema>["items"]) {
  const externalIds = items.map((item) => item.externalProductId?.trim()).filter(Boolean) as string[]
  const mappings = integrationId && externalIds.length > 0
    ? await db.marketplaceProductMapping.findMany({
        where: {
          tenantId,
          integrationId,
          externalProductId: { in: externalIds },
        },
      })
    : []

  const mappingByExternalId = new Map<string, any>(mappings.map((item: any) => [item.externalProductId, item]))
  const mappedProductIds = mappings.map((item: any) => item.erpProductId).filter(Boolean)
  const products = mappedProductIds.length > 0
    ? await db.product.findMany({
        where: {
          tenantId,
          id: { in: mappedProductIds },
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
  const productById = new Map<string, any>(products.map((item: any) => [item.id, item]))

  return items.map((item) => {
    const mapping = item.externalProductId ? mappingByExternalId.get(item.externalProductId) : null
    const erpProductId = item.erpProductId || mapping?.erpProductId || undefined
    const product = erpProductId ? productById.get(erpProductId) : null
    return {
      ...item,
      erpProductId,
      departmentId: item.departmentId || product?.departmentId || undefined,
      sku: item.sku || product?.sku || undefined,
      vatRate: item.vatRate ?? product?.vatRate?.rate ?? undefined,
    }
  })
}

async function importMarketplaceOrderForTenant(tenantId: string, rawPayload: z.infer<typeof ImportMarketplaceOrderSchema>) {
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

  return db.$transaction(async (tx: any) => {
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
        rawPayloadJson: payload.rawPayload ?? payload,
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
        rawPayloadJson: payload.rawPayload ?? payload,
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
          modifiersJson: item.modifiers ? { items: item.modifiers } : undefined,
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
          modifiersJson: item.modifiers ? { items: item.modifiers } : undefined,
        })),
      })
    }

    const draftCart = buildDraftCart(payload)

    await tx.saleDraft.upsert({
      where: { externalOrderId: order.id },
      update: {
        status: "OPEN",
        cartJson: draftCart,
        subtotal: payload.subtotal,
        total: payload.total,
      },
      create: {
        tenantId,
        locationId: payload.locationId,
        externalOrderId: order.id,
        status: "OPEN",
        cartJson: draftCart,
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
        },
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
  await db.$transaction(async (tx: any) => {
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

function normalizeWoltOrderToImportPayload(integration: any, payload: any): z.infer<typeof ImportMarketplaceOrderSchema> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const subtotal = toMoneyNumber(payload?.basket_price)
  const total =
    toMoneyNumber(payload?.price) ||
    toMoneyNumber(payload?.total_price) ||
    subtotal + toMoneyNumber(payload?.fees)

  return {
    platform: "WOLT",
    locationId: integration.locationId,
    integrationId: integration.id,
    externalOrderId: String(payload?.id || "").trim(),
    externalOrderNumber: String(payload?.order_number || "").trim() || undefined,
    customerName: String(payload?.consumer_name || "").trim() || undefined,
    customerPhone: String(payload?.consumer_phone_number || "").trim() || undefined,
    customerNote: String(payload?.consumer_comment || "").trim() || undefined,
    paymentLabel:
      String(
        payload?.payment?.type ||
        payload?.payment?.payment_type ||
        payload?.payment_type ||
        payload?.payment_method ||
        ""
      ).trim() || undefined,
    currency: "RON",
    subtotal,
    total,
    displayNumber: String(payload?.order_number || payload?.id || "").trim() || undefined,
    station: undefined,
    items: items.map((item: any, index: number) => {
      const quantity = Number(item?.quantity || item?.qty || 1) || 1
      const lineTotal = toMoneyNumber(item?.price) || toMoneyNumber(item?.total_price)
      return {
        externalLineId: String(item?.id || `${payload?.id || "wolt"}-${index + 1}`).trim(),
        externalProductId: String(item?.pos_product_id || item?.merchant_supplied_id || item?.id || "").trim() || undefined,
        name: String(item?.name || item?.item_name || "Produs Wolt").trim(),
        sku: String(item?.merchant_supplied_id || item?.sku || "").trim() || undefined,
        qty: quantity,
        unitPrice: quantity > 0 ? (lineTotal > 0 ? lineTotal / quantity : toMoneyNumber(item?.unit_price)) : 0,
        vatRate: Number(item?.vat_percentage ?? item?.vat_rate ?? 0) || undefined,
        note: String(item?.comment || item?.note || "").trim() || undefined,
        modifiers: Array.isArray(item?.options)
          ? item.options.map((option: any) => String(option?.name || "").trim()).filter(Boolean)
          : undefined,
        erpProductId: undefined,
        departmentId: undefined,
        station: undefined,
      }
    }),
    rawPayload: payload,
  }
}

function normalizeGlovoOrderToImportPayload(integration: any, payload: any): z.infer<typeof ImportMarketplaceOrderSchema> {
  const products = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload?.items) ? payload.items : []
  const total =
    toGlovoMoneyNumber(payload?.payment_total) ||
    toGlovoMoneyNumber(payload?.total_price) ||
    toGlovoMoneyNumber(payload?.total) ||
    products.reduce((sum: number, item: any) => sum + toGlovoMoneyNumber(item?.price) * (Number(item?.quantity || 1) || 1), 0)
  const subtotal = toGlovoMoneyNumber(payload?.subtotal) || total
  const customerNotes = [
    String(payload?.special_requirements || "").trim(),
    String(payload?.comments || payload?.notes || payload?.customer_note || "").trim(),
    String(payload?.allergy_info || "").trim(),
  ].filter(Boolean)
  const placedAtRaw = String(payload?.order_time || "").trim()
  const placedAt = placedAtRaw ? new Date(placedAtRaw.replace(" ", "T")) : undefined

  return {
    platform: "GLOVO",
    locationId: integration.locationId,
    integrationId: integration.id,
    externalOrderId: String(payload?.id || payload?.order_id || "").trim(),
    externalOrderNumber: String(payload?.order_code || payload?.order_number || "").trim() || undefined,
    customerName: String(payload?.customer?.name || payload?.customer_name || "").trim() || undefined,
    customerPhone: String(payload?.customer?.phone_number || payload?.customer?.phone || payload?.customer_phone || "").trim() || undefined,
    customerNote: customerNotes.join(" | ") || undefined,
    paymentLabel:
      String(
        payload?.payment?.type ||
        payload?.payment?.payment_type ||
        payload?.payment_method ||
        payload?.payment_type ||
        ""
      ).trim() || undefined,
    currency: "RON",
    subtotal,
    total,
    placedAt: placedAt && !Number.isNaN(placedAt.getTime()) ? placedAt : undefined,
    displayNumber: String(payload?.order_code || payload?.id || payload?.order_id || "").trim() || undefined,
    station: undefined,
    items: products.map((item: any, index: number) => {
      const quantity = Number(item?.quantity || item?.qty || 1) || 1
      const unitPrice = toGlovoMoneyNumber(item?.price) || toGlovoMoneyNumber(item?.unit_price)
      return {
        externalLineId: String(item?.purchased_product_id || item?.id || item?.product_id || `${payload?.id || "glovo"}-${index + 1}`).trim(),
        externalProductId: String(item?.product_id || item?.id || "").trim() || undefined,
        name: String(item?.name || item?.product_name || "Produs Glovo").trim(),
        sku: String(item?.sku || "").trim() || undefined,
        qty: quantity,
        unitPrice,
        vatRate: Number(item?.vat_percentage ?? item?.vat_rate ?? 0) || undefined,
        note: String(item?.comment || item?.note || "").trim() || undefined,
        modifiers: Array.isArray(item?.attributes)
          ? item.attributes.map((option: any) => String(option?.name || "").trim()).filter(Boolean)
          : undefined,
        erpProductId: undefined,
        departmentId: undefined,
        station: undefined,
      }
    }),
    rawPayload: payload,
  }
}

async function findMatchingGlovoIntegration(payload: any, routeStoreId?: string) {
  const storeId = normalizeGlovoStoreId(routeStoreId || payload?.store_id || payload?.storeId)
  const token = String(payload?._glovoToken || "").trim()

  const integrations = await db.externalIntegration.findMany({
    where: {
      platform: "GLOVO",
      status: "ACTIVE",
      ...(storeId ? { storeId } : {}),
    },
  })

  return integrations.find((integration: any) => {
    const secret = String(integration.webhookSecret || integration.accessToken || "").trim()
    if (secret && token) return secret === token
    if (secret && !token) return false
    return true
  }) || null
}

async function processGlovoWebhook(req: any, res: any, kind: "ORDER" | "CANCEL") {
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
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "Glovo webhook failed" })
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

  const matchedIntegration = integrations.find((integration: any) => {
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
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "Wolt webhook failed" })
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

  const enrichedItems = items.map((item: any) => ({
    ...item,
    contract: item.platform === "GLOVO" ? buildGlovoContractChecklist(item) : null,
  }))

  return res.json({ ok: true, items: enrichedItems })
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

  const where: any = { tenantId }
  if (platform && PLATFORMS.includes(platform as any)) where.platform = platform
  if (status) where.status = status
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
    mappings.map((item: any) => `${item.integrationId}::${item.externalProductId}`),
  )

  const seenRecent = new Map<string, any>()
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

  const incomingSettings = bodyParsed.data.settings && typeof bodyParsed.data.settings === "object"
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

  const integrationPayload = {
    status: "ACTIVE",
    authType: bodyParsed.data.authType,
    merchantId: bodyParsed.data.merchantId || null,
    storeId: bodyParsed.data.storeId || null,
    accessToken: bodyParsed.data.accessToken || null,
    refreshToken: bodyParsed.data.refreshToken || null,
    webhookSecret: bodyParsed.data.webhookSecret || null,
    settingsJson: Object.keys(incomingSettings).length > 0 ? incomingSettings : undefined,
  }

  const integration = existingIntegration
    ? await db.externalIntegration.update({
        where: { id: existingIntegration.id },
        data: integrationPayload,
        include: {
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      })
    : await db.externalIntegration.create({
        data: {
          tenantId,
          locationId: location.id,
          platform: platformParsed.data,
          ...integrationPayload,
        },
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
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "Wolt pull failed" })
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
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "Glovo import failed" })
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
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error?.message || "Import failed" })
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

  const updated = await db.$transaction(async (tx: any) => {
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
        },
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

  const updatedOrder = await db.$transaction(async (tx: any) => {
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
        },
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
