// @ts-nocheck
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toPositiveInt(value: any, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const intValue = Math.floor(n)
  return intValue > 0 ? intValue : fallback
}

// stoc global: sumă pe toate locațiile
router.get("/api/v1/stock/global", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const q = String(req.query.q || "").trim()

  const grouped = await prisma.stockBalance.groupBy({
    by: ["productId"],
    where: { tenantId, companyId },
    _sum: { qty: true }
  })

  const productIds = grouped.map((g) => g.productId)

  if (productIds.length === 0) {
    return res.json({ ok: true, items: [] })
  }

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
      id: { in: productIds },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: {
      department: true,
      category: true,
      uom: true
    },
    orderBy: { name: "asc" }
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  const items = grouped
    .filter((g) => productMap.has(g.productId))
    .map((g) => {
      const p = productMap.get(g.productId)!
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        uom: p.uom?.code ?? "",
        department: p.department?.name ?? "",
        category: p.category?.name ?? "",
        totalQty: Number(g._sum.qty ?? 0)
      }
    })

  res.json({ ok: true, items })
})

// stoc pe locații
router.get("/api/v1/stock/by-location", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const locationId = String(req.query.locationId || "").trim()
  const q = String(req.query.q || "").trim()

  const whereBalance: any = { tenantId, companyId }
  if (locationId) whereBalance.locationId = locationId

  const balances = await prisma.stockBalance.findMany({
    where: whereBalance,
    include: {
      product: {
        include: {
          department: true,
          category: true,
          uom: true
        }
      },
      location: true
    },
    orderBy: [{ locationId: "asc" }, { productId: "asc" }]
  })

  const filtered = balances.filter((row) => {
    if (!q) return true
    const name = row.product?.name ?? ""
    const sku = row.product?.sku ?? ""
    return (
      name.toLowerCase().includes(q.toLowerCase()) ||
      sku.toLowerCase().includes(q.toLowerCase())
    )
  })

  const items = filtered.map((row) => ({
    id: row.id,
    locationId: row.locationId,
    locationName: row.location?.name ?? "",
    productId: row.productId,
    sku: row.product?.sku ?? "",
    name: row.product?.name ?? "",
    uom: row.product?.uom?.code ?? "",
    department: row.product?.department?.name ?? "",
    category: row.product?.category?.name ?? "",
    qty: Number(row.qty)
  }))

  res.json({ ok: true, items })
})

// mișcări de stoc cu filtru dată + paginare
router.get("/api/v1/stock/moves", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const productId = String(req.query.productId || "").trim()
  const locationId = String(req.query.locationId || "").trim()
  const q = String(req.query.q || "").trim()
  const fromDate = String(req.query.fromDate || "").trim()
  const toDate = String(req.query.toDate || "").trim()

  const page = toPositiveInt(req.query.page, 1)
  const limit = Math.min(toPositiveInt(req.query.limit, 20), 200)
  const skip = (page - 1) * limit

  const where: any = { tenantId, companyId }

  if (productId) where.productId = productId
  if (locationId) where.locationId = locationId

  if (fromDate || toDate) {
    where.createdAt = {}
    if (fromDate) {
      where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`)
    }
    if (toDate) {
      where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`)
    }
  }

  if (q) {
    where.OR = [
      { note: { contains: q, mode: "insensitive" } },
      { refType: { equals: q as any } },
      { refId: { contains: q, mode: "insensitive" } },
      { product: { name: { contains: q, mode: "insensitive" } } },
      { product: { sku: { contains: q, mode: "insensitive" } } },
      { location: { name: { contains: q, mode: "insensitive" } } }
    ]
  }

  const [total, moves] = await Promise.all([
    prisma.stockMove.count({ where }),
    prisma.stockMove.findMany({
      where,
      include: {
        product: {
          include: {
            uom: true
          }
        },
        location: true
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit
    })
  ])

  const items = moves.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    qty: Number(m.qty),
    refType: m.refType,
    refId: m.refId,
    note: m.note ?? "",
    productId: m.productId,
    sku: m.product?.sku ?? "",
    productName: m.product?.name ?? "",
    uom: m.product?.uom?.code ?? "",
    locationId: m.locationId,
    locationName: m.location?.name ?? ""
  }))

  return res.json({
    ok: true,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  })
})

// transfer stoc între locații
router.post("/api/v1/stock/transfer", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const fromLocationId = String(req.body?.fromLocationId || "").trim()
  const toLocationId = String(req.body?.toLocationId || "").trim()
  const productId = String(req.body?.productId || "").trim()
  const note = String(req.body?.note || "").trim()
  const qty = toNumber(req.body?.qty)

  if (!fromLocationId) {
    return res.status(400).json({ ok: false, error: "fromLocationId este obligatoriu." })
  }

  if (!toLocationId) {
    return res.status(400).json({ ok: false, error: "toLocationId este obligatoriu." })
  }

  if (!productId) {
    return res.status(400).json({ ok: false, error: "productId este obligatoriu." })
  }

  if (fromLocationId === toLocationId) {
    return res.status(400).json({ ok: false, error: "Locația sursă și destinația trebuie să fie diferite." })
  }

  if (qty <= 0) {
    return res.status(400).json({ ok: false, error: "Cantitatea trebuie să fie mai mare decât 0." })
  }

  const [fromLocation, toLocation, product] = await Promise.all([
    prisma.location.findFirst({
      where: { id: fromLocationId, tenantId }
    }),
    prisma.location.findFirst({
      where: { id: toLocationId, tenantId }
    }),
    prisma.product.findFirst({
      where: { id: productId, tenantId, companyId },
      include: { uom: true }
    })
  ])

  if (!fromLocation) {
    return res.status(404).json({ ok: false, error: "Locația sursă nu există." })
  }

  if (!toLocation) {
    return res.status(404).json({ ok: false, error: "Locația destinație nu există." })
  }

  if (!product) {
    return res.status(404).json({ ok: false, error: "Produsul nu există." })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sourceBalance = await tx.stockBalance.findUnique({
        where: {
          tenantId_companyId_locationId_productId: {
            tenantId,
            companyId,
            locationId: fromLocationId,
            productId
          }
        }
      })

      const availableQty = Number(sourceBalance?.qty || 0)

      if (availableQty < qty) {
        throw new Error(
          `Stoc insuficient în locația sursă. Disponibil: ${availableQty.toFixed(2)} ${product.uom?.code || ""}`.trim()
        )
      }

      await tx.stockBalance.update({
        where: {
          tenantId_companyId_locationId_productId: {
            tenantId,
            companyId,
            locationId: fromLocationId,
            productId
          }
        },
        data: {
          qty: {
            decrement: qty
          }
        }
      })

      await tx.stockBalance.upsert({
        where: {
          tenantId_companyId_locationId_productId: {
            tenantId,
            companyId,
            locationId: toLocationId,
            productId
          }
        },
        update: {
          qty: {
            increment: qty
          }
        },
        create: {
          tenantId,
          companyId,
          locationId: toLocationId,
          productId,
          qty
        }
      })

      const transferRefId = `TRANSFER:${Date.now()}:${productId}`

      const outMove = await tx.stockMove.create({
        data: {
          tenantId,
          companyId,
          locationId: fromLocationId,
          productId,
          type: "OUT",
          qty,
          refType: "TRANSFER",
          refId: transferRefId,
          note:
            note ||
            `Transfer către ${toLocation.name}`
        }
      })

      const inMove = await tx.stockMove.create({
        data: {
          tenantId,
          companyId,
          locationId: toLocationId,
          productId,
          type: "IN",
          qty,
          refType: "TRANSFER",
          refId: transferRefId,
          note:
            note ||
            `Transfer din ${fromLocation.name}`
        }
      })

      return {
        outMove,
        inMove
      }
    })

    return res.json({
      ok: true,
      message: "Transfer realizat cu succes.",
      transfer: {
        fromLocationId,
        fromLocationName: fromLocation.name,
        toLocationId,
        toLocationName: toLocation.name,
        productId,
        productName: product.name,
        qty,
        note,
        outMoveId: result.outMove.id,
        inMoveId: result.inMove.id
      }
    })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Nu am putut face transferul de stoc."
    })
  }
})

export default router
