// @ts-nocheck
import { Prisma } from "@prisma/client"
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { createConsumptionDraft, validateConsumptionDoc, cancelConsumptionDoc } from "../lib/consumptionDocs"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildCompanyScopedTenantWhere, requireRequestCompanyId } from "../lib/companyScope"
import { ensureDefaultWarehouseForLocation } from "../lib/warehouse"

const router = Router()

function toNumber(value: any) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function consumptionStatusLabel(status?: string) {
  if (status === "VALIDATED") return "Validat"
  if (status === "CANCELLED") return "Anulat"
  return "Draft"
}

function consumptionSourceLabel(source?: string) {
  if (source === "POS_RECIPE") return "POS / Retetar"
  if (source === "SALES_AGGREGATE") return "Generat din vanzari"
  return "Manual"
}

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function formatDateLabel(value?: Date | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

async function ensureLocation(tenantId: string, companyId: string, locationId: string) {
  return prisma.location.findFirst({
    where: {
      id: locationId,
      tenantId,
      companyId,
    },
    select: { id: true, name: true, code: true },
  })
}

async function ensureWarehouse(tenantId: string, companyId: string, locationId: string, warehouseId?: string) {
  return prisma.$transaction(async (tx) => {
    if (warehouseId) {
      const explicitWarehouse = await tx.warehouse.findFirst({
        where: {
          id: warehouseId,
          tenantId,
          companyId,
          locationId,
        },
        select: { id: true, name: true, code: true, locationId: true },
      })
      if (explicitWarehouse) return explicitWarehouse
    }

    return ensureDefaultWarehouseForLocation(tx, {
      tenantId,
      companyId,
      locationId,
    })
  })
}

async function loadProducts(tenantId: string, companyId: string, productIds: string[]) {
  const rows = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
      id: { in: productIds },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      costPrice: true,
      uom: { select: { code: true, name: true } },
    },
  })
  return new Map(rows.map((row) => [row.id, row]))
}

async function buildAggregateConsumptionPayload(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    companyId: string
    locationId: string
    warehouseId?: string | null
    dateFrom: Date
    dateTo: Date
    includeManual?: boolean
  }
) {
  const sourceDocs = await tx.consumptionDoc.findMany({
    where: {
      ...buildCompanyScopedTenantWhere(params.tenantId, params.companyId),
      locationId: params.locationId,
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      docDate: {
        gte: params.dateFrom,
        lte: params.dateTo,
      },
      source: params.includeManual ? { in: ["POS_RECIPE", "MANUAL"] as any } : "POS_RECIPE",
      status: "VALIDATED",
      aggregateParentId: null,
    },
    include: {
      items: {
        include: {
          ingredient: true,
        },
      },
    },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  })

  const ingredientMap = new Map<string, { ingredientId: string; qty: number; totalCost: number }>()

  for (const doc of sourceDocs) {
    for (const item of doc.items) {
      const qty = toNumber(item.qty)
      const totalCost = toNumber(item.totalCost)
      if (qty <= 0) continue
      const existing = ingredientMap.get(item.ingredientId)
      if (existing) {
        existing.qty += qty
        existing.totalCost += totalCost
      } else {
        ingredientMap.set(item.ingredientId, {
          ingredientId: item.ingredientId,
          qty,
          totalCost,
        })
      }
    }
  }

  return {
    sourceDocs,
    lines: Array.from(ingredientMap.values()).map((item) => ({
      ingredientId: item.ingredientId,
      qty: item.qty,
      unitCost: item.qty > 0 ? item.totalCost / item.qty : 0,
      totalCost: item.totalCost,
    })),
  }
}

async function buildConsumptionDocDetail(tenantId: string, companyId: string, id: string) {
  const doc = await prisma.consumptionDoc.findFirst({
    where: {
      id,
      ...buildCompanyScopedTenantWhere(tenantId, companyId, { id }),
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      warehouse: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      sale: {
        select: {
          id: true,
          receiptNo: true,
          soldAt: true,
          total: true,
          paymentType: true,
          cashAmount: true,
          cardAmount: true,
          operatorName: true,
          createdAt: true,
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
      },
      batchSales: {
        select: {
          id: true,
          receiptNo: true,
          soldAt: true,
          total: true,
          paymentType: true,
          operatorName: true,
        },
        orderBy: [{ soldAt: "asc" }, { createdAt: "asc" }],
      },
      sourceDocs: {
        select: {
          id: true,
          docNo: true,
          docDate: true,
          totalValue: true,
          sale: {
            select: {
              receiptNo: true,
            },
          },
        },
        orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
      },
      items: {
        include: {
          ingredient: {
            select: {
              id: true,
              name: true,
              sku: true,
              costPrice: true,
              trackLot: true,
              trackExpiry: true,
              costMethod: true,
              uom: { select: { code: true, name: true } },
            },
          },
          finishedProduct: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          lotAllocations: {
            include: {
              stockLot: {
                select: {
                  id: true,
                  lotNo: true,
                  expiryDate: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!doc) return null

  const ingredientIds = doc.items.map((item) => item.ingredientId)
  const balances = ingredientIds.length
    ? await prisma.stockBalance.findMany({
        where: {
          tenantId,
          companyId,
          locationId: doc.locationId,
          ...(doc.warehouseId ? { warehouseId: doc.warehouseId } : {}),
          productId: { in: ingredientIds },
        },
        select: {
          productId: true,
          qty: true,
        },
      })
    : []
  const stockMap = new Map(balances.map((row) => [row.productId, toNumber(row.qty)]))

  const totalQty = doc.items.reduce((sum, item) => sum + toNumber(item.qty), 0)
  const totalValue = doc.items.reduce((sum, item) => sum + toNumber(item.totalCost), 0) || toNumber(doc.totalValue)

  return {
    id: doc.id,
    docNo: doc.docNo,
    docDate: doc.docDate,
    note: doc.note,
    source: doc.source,
    sourceLabel: consumptionSourceLabel(doc.source),
    sourcePeriodStart: doc.sourcePeriodStart,
    sourcePeriodEnd: doc.sourcePeriodEnd,
    status: doc.status,
    statusLabel: consumptionStatusLabel(doc.status),
    totalValue,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    validatedAt: doc.validatedAt,
    validatedBy: doc.validatedBy,
    cancelledAt: doc.cancelledAt,
    cancelledBy: doc.cancelledBy,
    location: doc.location,
    warehouse: doc.warehouse,
    sale: doc.sale
      ? {
          id: doc.sale.id,
          receiptNo: doc.sale.receiptNo,
          soldAt: doc.sale.soldAt,
          total: Number(doc.sale.total || 0),
          paymentType: doc.sale.paymentType,
          cashAmount: doc.sale.cashAmount !== null ? Number(doc.sale.cashAmount) : null,
          cardAmount: doc.sale.cardAmount !== null ? Number(doc.sale.cardAmount) : null,
          operatorName: doc.sale.operatorName,
          createdAt: doc.sale.createdAt,
          items: doc.sale.items.map((saleItem) => ({
            id: saleItem.id,
            qty: Number(saleItem.qty || 0),
            unitPrice: Number(saleItem.unitPrice || 0),
            vatRate: saleItem.vatRate,
            product: saleItem.product,
          })),
        }
      : null,
    batchSales: (doc.batchSales || []).map((sale) => ({
      id: sale.id,
      receiptNo: sale.receiptNo,
      soldAt: sale.soldAt,
      total: Number(sale.total || 0),
      paymentType: sale.paymentType,
      operatorName: sale.operatorName,
    })),
    sourceDocs: (doc.sourceDocs || []).map((sourceDoc) => ({
      id: sourceDoc.id,
      docNo: sourceDoc.docNo,
      docDate: sourceDoc.docDate,
      totalValue: Number(sourceDoc.totalValue || 0),
      receiptNo: sourceDoc.sale?.receiptNo || null,
    })),
    itemsCount: doc.items.length,
    totalQty,
    items: doc.items.map((item) => ({
      id: item.id,
      qty: Number(item.qty || 0),
      note: item.note,
      unitCost: Number(item.unitCost || 0),
      totalCost: Number(item.totalCost || 0),
      costMethod: item.costMethod || null,
      lotAllocations: (item.lotAllocations || []).map((allocation) => ({
        id: allocation.id,
        qty: Number(allocation.qty || 0),
        unitCost: Number(allocation.unitCost || 0),
        totalCost: Number(allocation.totalCost || 0),
        lotId: allocation.stockLotId,
        lotNo: allocation.stockLot?.lotNo || "-",
        expiryDate: allocation.stockLot?.expiryDate || null,
      })),
      currentStock: stockMap.get(item.ingredientId) ?? 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      finishedProduct: item.finishedProduct,
      ingredient: item.ingredient,
    })),
  }
}

router.post("/api/v1/consumption-docs", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const locationId = String(req.body?.locationId || "").trim()
    const requestedWarehouseId = String(req.body?.warehouseId || "").trim()
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : ""
    const docDate = req.body?.docDate ? new Date(String(req.body.docDate)) : new Date()
    const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : []

    if (!locationId) {
      return res.status(400).json({ ok: false, error: "Selecteaza locatia pentru bonul de consum." })
    }
    if (!itemsRaw.length) {
      return res.status(400).json({ ok: false, error: "Adauga cel putin un produs in bonul de consum." })
    }

    const normalizedItems = itemsRaw
      .map((item: any) => ({
        ingredientId: String(item?.productId || item?.ingredientId || "").trim(),
        qty: Number(item?.qty || 0),
        note: typeof item?.note === "string" ? item.note.trim() : "",
      }))
      .filter((item: any) => item.ingredientId && Number.isFinite(item.qty) && item.qty > 0)

    if (!normalizedItems.length) {
      return res.status(400).json({ ok: false, error: "Cantitatile din bonul de consum sunt invalide." })
    }

    const location = await ensureLocation(tenantId, companyId, locationId)
    if (!location) {
      return res.status(404).json({ ok: false, error: "Locatia selectata nu exista." })
    }
    const warehouse = await ensureWarehouse(tenantId, companyId, locationId, requestedWarehouseId)

    const productIds = normalizedItems.map((item: any) => item.ingredientId)
    const productMap = await loadProducts(tenantId, companyId, productIds)
    const missingProductId = normalizedItems.find((item: any) => !productMap.has(item.ingredientId))?.ingredientId
    if (missingProductId) {
      return res.status(400).json({ ok: false, error: "Unul dintre produsele selectate nu mai exista in nomenclator." })
    }

    const result = await prisma.$transaction(async (tx) => {
      return createConsumptionDraft(tx, {
        tenantId,
        companyId,
        locationId,
        warehouseId: warehouse?.id || null,
        docDate,
        note,
        source: "MANUAL",
        lines: normalizedItems,
      })
    })

    return res.status(201).json({
      ok: true,
      item: {
        id: result.id,
        docNo: result.docNo,
        docDate: result.docDate,
        status: result.status,
        statusLabel: consumptionStatusLabel(result.status),
        locationId,
        locationName: location.name,
        warehouseId: warehouse?.id || null,
        warehouseName: warehouse?.name || null,
      },
    })
  } catch (error: any) {
    console.error("CONSUMPTION DOC CREATE ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut salva bonul de consum.",
    })
  }
})

router.put("/api/v1/consumption-docs/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id || "").trim()
    const locationId = String(req.body?.locationId || "").trim()
    const requestedWarehouseId = String(req.body?.warehouseId || "").trim()
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : ""
    const docDate = req.body?.docDate ? new Date(String(req.body.docDate)) : new Date()
    const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : []

    const existingDoc = await prisma.consumptionDoc.findFirst({
      where: {
        id,
        ...buildCompanyScopedTenantWhere(tenantId, companyId, { id }),
      },
      select: {
        id: true,
        status: true,
        source: true,
      },
    })

    if (!existingDoc) {
      return res.status(404).json({ ok: false, error: "Bonul de consum nu exista." })
    }
    if (existingDoc.status !== "DRAFT") {
      return res.status(400).json({ ok: false, error: "Doar documentele DRAFT pot fi modificate." })
    }
    if (existingDoc.source !== "MANUAL") {
      return res.status(400).json({ ok: false, error: "Bonurile generate automat nu pot fi editate manual." })
    }
    if (!locationId) {
      return res.status(400).json({ ok: false, error: "Selecteaza locatia pentru bonul de consum." })
    }
    if (!itemsRaw.length) {
      return res.status(400).json({ ok: false, error: "Adauga cel putin un produs in bonul de consum." })
    }

    const normalizedItems = itemsRaw
      .map((item: any) => ({
        ingredientId: String(item?.productId || item?.ingredientId || "").trim(),
        qty: Number(item?.qty || 0),
        note: typeof item?.note === "string" ? item.note.trim() : "",
      }))
      .filter((item: any) => item.ingredientId && Number.isFinite(item.qty) && item.qty > 0)

    if (!normalizedItems.length) {
      return res.status(400).json({ ok: false, error: "Cantitatile din bonul de consum sunt invalide." })
    }

    const location = await ensureLocation(tenantId, companyId, locationId)
    if (!location) {
      return res.status(404).json({ ok: false, error: "Locatia selectata nu exista." })
    }
    const warehouse = await ensureWarehouse(tenantId, companyId, locationId, requestedWarehouseId)

    const productIds = normalizedItems.map((item: any) => item.ingredientId)
    const productMap = await loadProducts(tenantId, companyId, productIds)
    const missingProductId = normalizedItems.find((item: any) => !productMap.has(item.ingredientId))?.ingredientId
    if (missingProductId) {
      return res.status(400).json({ ok: false, error: "Unul dintre produsele selectate nu mai exista in nomenclator." })
    }

    await prisma.$transaction(async (tx) => {
      await tx.consumptionDoc.update({
        where: { id },
        data: {
          locationId,
          warehouseId: warehouse?.id || null,
          docDate,
          note: note || null,
          totalValue: new Prisma.Decimal(0),
        },
      })

      await tx.consumptionDocItem.deleteMany({ where: { consumptionDocId: id } })

      for (const line of normalizedItems) {
        await tx.consumptionDocItem.create({
          data: {
            consumptionDocId: id,
            ingredientId: line.ingredientId,
            qty: new Prisma.Decimal(line.qty),
            note: line.note || null,
          },
        })
      }
    })

    const item = await buildConsumptionDocDetail(tenantId, companyId, id)
    return res.json({ ok: true, item })
  } catch (error: any) {
    console.error("CONSUMPTION DOC UPDATE ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut actualiza bonul de consum.",
    })
  }
})

router.post("/api/v1/consumption-docs/generate-from-sales", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const locationId = String(req.body?.locationId || "").trim()
    const requestedWarehouseId = String(req.body?.warehouseId || "").trim()
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : ""
    const includeManual = Boolean(req.body?.includeManual)
    const docDate = req.body?.docDate ? new Date(String(req.body.docDate)) : new Date()
    const dateFromInput = req.body?.dateFrom ? new Date(String(req.body.dateFrom)) : docDate
    const dateToInput = req.body?.dateTo ? new Date(String(req.body.dateTo)) : docDate

    if (!locationId) {
      return res.status(400).json({ ok: false, error: "Selecteaza locatia pentru bonul de consum." })
    }
    if (Number.isNaN(dateFromInput.getTime()) || Number.isNaN(dateToInput.getTime())) {
      return res.status(400).json({ ok: false, error: "Intervalul de generare este invalid." })
    }

    const dateFrom = startOfDay(dateFromInput)
    const dateTo = endOfDay(dateToInput)
    if (dateFrom > dateTo) {
      return res.status(400).json({ ok: false, error: "Data de inceput nu poate fi dupa data de sfarsit." })
    }

    const location = await ensureLocation(tenantId, companyId, locationId)
    if (!location) {
      return res.status(404).json({ ok: false, error: "Locatia selectata nu exista." })
    }
    const warehouse = await ensureWarehouse(tenantId, companyId, locationId, requestedWarehouseId)

    const generated = await prisma.$transaction(async (tx) => {
      const payload = await buildAggregateConsumptionPayload(tx, {
        tenantId,
        companyId,
        locationId,
        warehouseId: warehouse?.id || null,
        dateFrom,
        dateTo,
        includeManual,
      })

      if (!payload.lines.length || !payload.sourceDocs.length) {
        throw new Error(`Nu exista bonuri de consum ${includeManual ? "manuale sau POS / Retetar" : "POS / Retetar"} neagregate in intervalul selectat.`)
      }

      const details = [formatDateLabel(dateFrom)]
      if (formatDateLabel(dateTo) && formatDateLabel(dateTo) !== details[0]) details.push(formatDateLabel(dateTo))
      const doc = await createConsumptionDraft(tx, {
        tenantId,
        companyId,
        locationId,
        warehouseId: warehouse?.id || null,
        source: "SALES_AGGREGATE",
        sourcePeriodStart: dateFrom,
        sourcePeriodEnd: dateTo,
        docDate,
        note: note || `Generat din bonuri ${includeManual ? "manuale + POS / Retetar" : "POS / Retetar"} pentru perioada ${details.join(" - ")}`,
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          qty: line.qty,
        })),
      })

      for (const line of payload.lines) {
        await tx.consumptionDocItem.updateMany({
          where: {
            consumptionDocId: doc.id,
            ingredientId: line.ingredientId,
          },
          data: {
            unitCost: new Prisma.Decimal(line.unitCost),
            totalCost: new Prisma.Decimal(line.totalCost),
            costMethod: "SUMMARY",
          },
        })
      }

      await tx.consumptionDoc.update({
        where: { id: doc.id },
        data: {
          status: "VALIDATED",
          totalValue: new Prisma.Decimal(payload.lines.reduce((sum, line) => sum + line.totalCost, 0)),
          validatedAt: new Date(),
          validatedBy: req.auth?.userId || null,
        },
      })

      await tx.consumptionDoc.updateMany({
        where: {
          id: {
            in: payload.sourceDocs.map((sourceDoc) => sourceDoc.id),
          },
        },
        data: {
          aggregateParentId: doc.id,
        },
      })

      return {
        doc,
        sourceDocsCount: payload.sourceDocs.length,
      }
    })

    const item = await buildConsumptionDocDetail(tenantId, companyId, generated.doc.id)
    return res.status(201).json({
      ok: true,
      item,
      summary: {
        sourceDocsCount: generated.sourceDocsCount,
      },
    })
  } catch (error: any) {
    console.error("CONSUMPTION DOC GENERATE FROM SALES ERROR:", error)
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut genera bonul de consum din vanzari.",
    })
  }
})

router.post("/api/v1/consumption-docs/:id/validate", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id || "").trim()

    await prisma.$transaction(async (tx) => {
      await validateConsumptionDoc(tx, {
        tenantId,
        companyId,
        docId: id,
        actorId: req.auth?.userId || null,
        allowNegativeStock: false,
      })
    })

    const item = await buildConsumptionDocDetail(tenantId, companyId, id)
    return res.json({ ok: true, item })
  } catch (error: any) {
    console.error("CONSUMPTION DOC VALIDATE ERROR:", error)
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut valida bonul de consum.",
    })
  }
})

router.post("/api/v1/consumption-docs/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id || "").trim()

    const existingDoc = await prisma.consumptionDoc.findFirst({
      where: {
        id,
        ...buildCompanyScopedTenantWhere(tenantId, companyId, { id }),
      },
      select: {
        id: true,
        source: true,
        status: true,
      },
    })

    if (!existingDoc) {
      return res.status(404).json({ ok: false, error: "Bonul de consum nu exista." })
    }

    await prisma.$transaction(async (tx) => {
      if (existingDoc.source === "SALES_AGGREGATE") {
        if (existingDoc.status !== "VALIDATED") {
          throw new Error("Doar bonurile agregate validate pot fi anulate.")
        }
        await tx.consumptionDoc.updateMany({
          where: {
            aggregateParentId: id,
          },
          data: {
            aggregateParentId: null,
          },
        })
        await tx.consumptionDoc.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: req.auth?.userId || null,
          },
        })
        return
      }

      await cancelConsumptionDoc(tx, {
        tenantId,
        companyId,
        docId: id,
        actorId: req.auth?.userId || null,
      })
    })

    const item = await buildConsumptionDocDetail(tenantId, companyId, id)
    return res.json({ ok: true, item })
  } catch (error: any) {
    console.error("CONSUMPTION DOC CANCEL ERROR:", error)
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut anula bonul de consum.",
    })
  }
})

router.get("/api/v1/consumption-docs", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null
    const locationId = req.query.locationId ? String(req.query.locationId) : null
    const q = req.query.q ? String(req.query.q).trim() : ""
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : ""

    const docs = await prisma.consumptionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        ...(locationId ? { locationId } : {}),
        ...(status ? { status: status as any } : {}),
        ...(dateFrom || dateTo
          ? {
              docDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { docNo: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
                { sale: { is: { receiptNo: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: {
        location: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        sale: {
          select: {
            id: true,
            receiptNo: true,
            soldAt: true,
            total: true,
            paymentType: true,
            operatorName: true,
          },
        },
        batchSales: {
          select: {
            id: true,
            receiptNo: true,
            soldAt: true,
            total: true,
            paymentType: true,
            operatorName: true,
          },
        },
        sourceDocs: {
          select: {
            id: true,
          },
        },
        items: {
          include: {
            ingredient: { select: { id: true, name: true, sku: true } },
            finishedProduct: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    })

    const result = docs.map((doc) => {
      const totalQty = doc.items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
      const totalValue = doc.items.reduce((sum, item) => sum + Number(item.totalCost || 0), 0) || Number(doc.totalValue || 0)
      const finishedProductsMap = new Map<string, { id: string; name: string; sku: string }>()

      for (const item of doc.items) {
        if (item.finishedProduct) {
          finishedProductsMap.set(item.finishedProduct.id, {
            id: item.finishedProduct.id,
            name: item.finishedProduct.name,
            sku: item.finishedProduct.sku,
          })
        }
      }

      return {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note,
        source: doc.source,
        sourceLabel: consumptionSourceLabel(doc.source),
        sourcePeriodStart: doc.sourcePeriodStart,
        sourcePeriodEnd: doc.sourcePeriodEnd,
        status: doc.status,
        statusLabel: consumptionStatusLabel(doc.status),
        totalValue,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        validatedAt: doc.validatedAt,
        cancelledAt: doc.cancelledAt,
        location: doc.location,
        warehouse: doc.warehouse,
        sale: doc.sale
          ? {
              id: doc.sale.id,
              receiptNo: doc.sale.receiptNo,
              soldAt: doc.sale.soldAt,
              total: Number(doc.sale.total || 0),
              paymentType: doc.sale.paymentType,
              operatorName: doc.sale.operatorName,
            }
          : null,
        batchSalesCount: doc.batchSales.length,
        sourceDocsCount: doc.sourceDocs.length,
        itemsCount: doc.items.length,
        totalQty,
        finishedProducts: Array.from(finishedProductsMap.values()),
      }
    })

    return res.json({
      ok: true,
      items: result,
    })
  } catch (error) {
    console.error("CONSUMPTION DOCS LIST ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut incarca bonurile de consum.",
    })
  }
})

router.get("/api/v1/consumption-docs/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id)
    const item = await buildConsumptionDocDetail(tenantId, companyId, id)

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "Bonul de consum nu exista.",
      })
    }

    return res.json({ ok: true, item })
  } catch (error) {
    console.error("CONSUMPTION DOC DETAIL ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut incarca bonul de consum.",
    })
  }
})

export default router
