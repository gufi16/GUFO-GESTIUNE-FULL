import { Router } from "express"
import { InventoryStatus, Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { reserveNextNumber } from "../lib/numbering"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()
router.use(requireAuth)
const NO_WAREHOUSE_SCOPE = "__NO_WAREHOUSE__"

type InventoryItemInput = {
  productId?: unknown
  countedQty?: unknown
}

function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function warehouseScope(warehouseId?: string | null) {
  const trimmed = normalizeText(warehouseId)
  return trimmed || NO_WAREHOUSE_SCOPE
}

function parseDateStart(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function parseDateEnd(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(23, 59, 59, 999)
  return date
}

function normalizeItems(items: unknown[]) {
  return items.map((item) => {
    const row = (item ?? {}) as InventoryItemInput
    return {
      productId: normalizeText(row.productId),
      countedQty: toNumber(row.countedQty),
    }
  })
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

type InventoryValidationError = { ok: false; status: number; error: string }
type InventoryValidationSuccess = {
  ok: true
  location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>
  products: Awaited<ReturnType<typeof prisma.product.findMany>>
  productMap: Map<string, Awaited<ReturnType<typeof prisma.product.findMany>>[number]>
  balanceMap: Map<string, Awaited<ReturnType<typeof prisma.stockBalance.findMany>>[number]>
}

async function validateInventoryPayload(
  tenantId: string,
  companyId: string,
  locationId: string,
  warehouseId: string | null,
  items: Array<{ productId: string; countedQty: number }>
): Promise<InventoryValidationError | InventoryValidationSuccess> {
  if (!locationId) {
    return { ok: false, status: 400, error: "Locatia este obligatorie." }
  }

  if (!items.length) {
    return { ok: false, status: 400, error: "Adauga cel putin un produs in inventar." }
  }

  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      tenantId,
      companyId,
    }
  })

  if (!location) {
    return { ok: false, status: 404, error: "Locatia nu exista." }
  }

  for (const row of items) {
    if (!row.productId) {
      return { ok: false, status: 400, error: "Exista produse fara ID in document." }
    }

    if (row.countedQty < 0) {
      return { ok: false, status: 400, error: "Cantitatea numarata nu poate fi negativa." }
    }
  }

  const uniqueProductIds = Array.from(new Set(items.map((x) => x.productId)))

  if (uniqueProductIds.length !== items.length) {
    return {
      ok: false,
      status: 400,
      error: "Nu poti adauga acelasi produs de mai multe ori in acelasi inventar."
    }
  }

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
      id: {
        in: uniqueProductIds
      }
    },
    include: {
      uom: true,
      category: true,
      department: true
    }
  })

  if (products.length !== uniqueProductIds.length) {
    return {
      ok: false,
      status: 400,
      error: "Unul sau mai multe produse nu exista."
    }
  }

  const balances = await prisma.stockBalance.findMany({
    where: {
      tenantId,
      companyId,
      locationId,
      warehouseScope: warehouseScope(warehouseId),
      productId: {
        in: uniqueProductIds
      }
    }
  })

  const productMap = new Map(products.map((p) => [p.id, p]))
  const balanceMap = new Map(
    balances.map((b) => [`${b.locationId}:${warehouseScope(b.warehouseId)}:${b.productId}`, b])
  )

  return {
    ok: true,
    location,
    products,
    productMap,
    balanceMap
  }
}

async function buildInventoryResponse(tenantId: string, companyId: string, id: string) {
  const doc = await prisma.inventoryDoc.findFirst({
    where: {
      id,
      tenantId,
      companyId
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          code: true
        }
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              class: true,
              price: true,
              uom: {
                select: {
                  id: true,
                  code: true,
                  name: true
                }
              },
              category: {
                select: {
                  id: true,
                  name: true
                }
              },
              department: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ createdAt: "asc" }]
      }
    }
  })

  if (!doc) return null

  const items = doc.items.map((item) => ({
    id: item.id,
    product: {
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      class: item.product.class,
      price: Number(item.product.price || 0),
      uom: item.product.uom
        ? {
            id: item.product.uom.id,
            code: item.product.uom.code,
            name: item.product.uom.name
          }
        : null,
      category: item.product.category,
      department: item.product.department
    },
    systemQty: Number(item.systemQty || 0),
    countedQty: Number(item.countedQty || 0),
    differenceQty: Number(item.differenceQty || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }))

  const totalSystemQty = items.reduce((sum, item) => sum + item.systemQty, 0)
  const totalCountedQty = items.reduce((sum, item) => sum + item.countedQty, 0)
  const totalDifferenceQty = items.reduce((sum, item) => sum + item.differenceQty, 0)

  return {
    id: doc.id,
    docNo: doc.docNo,
    docDate: doc.docDate,
    note: doc.note,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    finalizedAt: doc.finalizedAt ?? null,
    location: doc.location,
    items,
    summary: {
      itemsCount: items.length,
      totalSystemQty,
      totalCountedQty,
      totalDifferenceQty
    }
  }
}

router.get("/api/v1/inventory-docs", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))

    const dateFrom = parseDateStart(req.query.dateFrom)
    const dateTo = parseDateEnd(req.query.dateTo)
    const locationId = req.query.locationId ? String(req.query.locationId) : null
    const q = req.query.q ? String(req.query.q).trim() : ""
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : ""

    const docs = await prisma.inventoryDoc.findMany({
      where: {
        tenantId,
        companyId,
        ...(locationId ? { locationId } : {}),
        ...(status && Object.values(InventoryStatus).includes(status as InventoryStatus)
          ? { status: status as InventoryStatus }
          : {}),
        ...(dateFrom || dateTo
          ? {
              docDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {}),
        ...(q
          ? {
              OR: [
                { docNo: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
                {
                  location: {
                    name: { contains: q, mode: "insensitive" }
                  }
                },
                {
                  items: {
                    some: {
                      product: {
                        OR: [
                          { name: { contains: q, mode: "insensitive" } },
                          { sku: { contains: q, mode: "insensitive" } }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          : {})
      },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true
              }
            }
          }
        }
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }]
    })

    const result = docs.map((doc) => {
      const totalSystemQty = doc.items.reduce((sum, item) => sum + Number(item.systemQty || 0), 0)
      const totalCountedQty = doc.items.reduce((sum, item) => sum + Number(item.countedQty || 0), 0)
      const totalDifferenceQty = doc.items.reduce((sum, item) => sum + Number(item.differenceQty || 0), 0)

      const positiveItems = doc.items.filter((item) => Number(item.differenceQty || 0) > 0).length
      const negativeItems = doc.items.filter((item) => Number(item.differenceQty || 0) < 0).length
      const zeroItems = doc.items.filter((item) => Number(item.differenceQty || 0) === 0).length

      return {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        finalizedAt: doc.finalizedAt ?? null,
        location: doc.location,
        itemsCount: doc.items.length,
        totalSystemQty,
        totalCountedQty,
        totalDifferenceQty,
        positiveItems,
        negativeItems,
        zeroItems
      }
    })

    return res.json({
      ok: true,
      items: result
    })
  } catch (error) {
    console.error("INVENTORY DOCS LIST ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut incarca documentele de inventar."
    })
  }
})

router.get("/api/v1/inventory-docs/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))
    const id = String(req.params.id)

    const item = await buildInventoryResponse(tenantId, companyId, id)

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de inventar nu exista."
      })
    }

    return res.json({
      ok: true,
      item
    })
  } catch (error) {
    console.error("INVENTORY DOC DETAILS ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut incarca documentul de inventar."
    })
  }
})

router.post("/api/v1/inventory", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))

    const locationId = normalizeText(req.body?.locationId)
    const requestedWarehouseId = normalizeText(req.body?.warehouseId) || null
    const note = normalizeText(req.body?.note) || null
    const items = normalizeItems(Array.isArray(req.body?.items) ? req.body.items : [])

    const validation = await validateInventoryPayload(tenantId, companyId, locationId, requestedWarehouseId, items)
    if (!validation.ok) {
      return res.status(validation.status).json({
        ok: false,
        error: validation.error
      })
    }

    const result = await prisma.$transaction(async (tx) => {
      const docNo = await reserveNextNumber(tx, tenantId, "inventory")

      const doc = await tx.inventoryDoc.create({
        data: {
          tenantId,
          companyId,
          locationId,
          warehouseId: requestedWarehouseId,
          docNo,
          docDate: new Date(),
          note,
          status: "DRAFT"
        }
      })

      for (const row of items) {
        const balanceKey = `${locationId}:${warehouseScope(requestedWarehouseId)}:${row.productId}`
        const existingBalance = validation.balanceMap.get(balanceKey)

        const systemQtyNumber = toNumber(existingBalance?.qty || 0)
        const countedQtyNumber = row.countedQty
        const differenceQtyNumber = countedQtyNumber - systemQtyNumber

        await tx.inventoryDocItem.create({
          data: {
            inventoryDocId: doc.id,
            productId: row.productId,
            systemQty: new Prisma.Decimal(systemQtyNumber),
            countedQty: new Prisma.Decimal(countedQtyNumber),
            differenceQty: new Prisma.Decimal(differenceQtyNumber)
          }
        })
      }

      return doc
    })

    const item = await buildInventoryResponse(tenantId, companyId, result.id)

    return res.json({
      ok: true,
      item
    })
  } catch (error) {
    console.error("INVENTORY CREATE ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: getErrorMessage(error, "Nu am putut genera documentul de inventar.")
    })
  }
})

router.put("/api/v1/inventory-docs/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))
    const id = String(req.params.id)

    const existingDoc = await prisma.inventoryDoc.findFirst({
      where: {
        id,
        tenantId,
        companyId
      }
    })

    if (!existingDoc) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de inventar nu exista."
      })
    }

    if (existingDoc.status !== "DRAFT") {
      return res.status(400).json({
        ok: false,
        error: "Doar inventarele in lucru pot fi modificate."
      })
    }

    const locationId = normalizeText(req.body?.locationId || existingDoc.locationId)
    const requestedWarehouseId = normalizeText(req.body?.warehouseId || existingDoc.warehouseId) || null
    const note = normalizeText(req.body?.note) || null
    const items = normalizeItems(Array.isArray(req.body?.items) ? req.body.items : [])

    const validation = await validateInventoryPayload(tenantId, companyId, locationId, requestedWarehouseId, items)
    if (!validation.ok) {
      return res.status(validation.status).json({
        ok: false,
        error: validation.error
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryDoc.update({
        where: { id },
        data: {
          locationId,
          warehouseId: requestedWarehouseId,
          note,
          docDate: req.body?.docDate ? new Date(String(req.body.docDate)) : existingDoc.docDate
        }
      })

      await tx.inventoryDocItem.deleteMany({
        where: {
          inventoryDocId: id
        }
      })

      for (const row of items) {
        const balanceKey = `${locationId}:${warehouseScope(requestedWarehouseId)}:${row.productId}`
        const existingBalance = validation.balanceMap.get(balanceKey)

        const systemQtyNumber = toNumber(existingBalance?.qty || 0)
        const countedQtyNumber = row.countedQty
        const differenceQtyNumber = countedQtyNumber - systemQtyNumber

        await tx.inventoryDocItem.create({
          data: {
            inventoryDocId: id,
            productId: row.productId,
            systemQty: new Prisma.Decimal(systemQtyNumber),
            countedQty: new Prisma.Decimal(countedQtyNumber),
            differenceQty: new Prisma.Decimal(differenceQtyNumber)
          }
        })
      }
    })

    const item = await buildInventoryResponse(tenantId, companyId, id)

    return res.json({
      ok: true,
      item
    })
  } catch (error) {
    console.error("INVENTORY UPDATE ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: getErrorMessage(error, "Nu am putut actualiza inventarul.")
    })
  }
})

router.post("/api/v1/inventory-docs/:id/finalize", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))
    const id = String(req.params.id)

    const doc = await prisma.inventoryDoc.findFirst({
      where: {
        id,
        tenantId,
        companyId
      },
      include: {
        items: true
      }
    })

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de inventar nu exista."
      })
    }

    if (doc.status !== "DRAFT") {
      return res.status(400).json({
        ok: false,
        error: "Inventarul este deja finalizat sau anulat."
      })
    }

    await prisma.$transaction(async (tx) => {
      for (const item of doc.items) {
        const countedQty = toNumber(item.countedQty)
        const differenceQty = toNumber(item.differenceQty)

        const existingBalance = await tx.stockBalance.findFirst({
          where: {
            tenantId,
            companyId,
            locationId: doc.locationId,
            warehouseScope: warehouseScope(doc.warehouseId),
            productId: item.productId
          }
        })

        if (existingBalance) {
          await tx.stockBalance.update({
            where: { id: existingBalance.id },
            data: {
              qty: new Prisma.Decimal(countedQty)
            }
          })
        } else {
          await tx.stockBalance.create({
            data: {
              tenantId,
              companyId,
              locationId: doc.locationId,
              warehouseId: doc.warehouseId || null,
              warehouseScope: warehouseScope(doc.warehouseId),
              productId: item.productId,
              qty: new Prisma.Decimal(countedQty)
            }
          })
        }

        if (differenceQty !== 0) {
          await tx.stockMove.create({
            data: {
              tenantId,
              companyId,
              locationId: doc.locationId,
              productId: item.productId,
              type: "ADJUST",
              qty: new Prisma.Decimal(differenceQty),
              refType: "INVENTORY",
              refId: doc.id,
              note: `Inventar ${doc.docNo}`
            }
          })
        }
      }

      await tx.inventoryDoc.update({
        where: { id: doc.id },
        data: {
          status: "FINALIZED",
          finalizedAt: new Date()
        }
      })
    })

    const item = await buildInventoryResponse(tenantId, companyId, id)

    return res.json({
      ok: true,
      item
    })
  } catch (error) {
    console.error("INVENTORY FINALIZE ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: getErrorMessage(error, "Nu am putut finaliza inventarul.")
    })
  }
})

router.post("/api/v1/inventory-docs/:id/cancel", async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth!.tenantId)
    const companyId = String(await requireRequestCompanyId(req))
    const id = String(req.params.id)

    const doc = await prisma.inventoryDoc.findFirst({
      where: {
        id,
        tenantId,
        companyId
      }
    })

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "Inventarul nu exista."
      })
    }

    if (doc.status !== "DRAFT") {
      return res.status(400).json({
        ok: false,
        error: "Doar inventarele in lucru pot fi anulate."
      })
    }

    await prisma.inventoryDoc.update({
      where: { id },
      data: {
        status: "CANCELLED"
      }
    })

    const item = await buildInventoryResponse(tenantId, companyId, id)

    return res.json({
      ok: true,
      item
    })
  } catch (error) {
    console.error("CANCEL INVENTORY ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: getErrorMessage(error, "Nu am putut anula inventarul.")
    })
  }
})

export default router
