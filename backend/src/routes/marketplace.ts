import { Router } from "express"
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

  return res.json({ ok: true, items })
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
    settingsJson: bodyParsed.data.settings || undefined,
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
  const location = await ensureLocationForTenant(tenantId, payload.locationId)
  if (!location) {
    return res.status(404).json({ ok: false, error: "Location not found" })
  }

  const externalOrder = await db.$transaction(async (tx: any) => {
    let integrationId = payload.integrationId || null

    if (!integrationId) {
      const foundIntegration = await tx.externalIntegration.findFirst({
        where: {
          tenantId,
          locationId: payload.locationId,
          platform: payload.platform,
        },
        orderBy: { createdAt: "desc" },
      })
      integrationId = foundIntegration?.id || null
    }

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
        placedAt: new Date(),
        status: "RECEIVED",
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
        placedAt: new Date(),
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
