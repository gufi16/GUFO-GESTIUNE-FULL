import { Router } from "express"
import { z } from "zod"
import { prisma as db } from "../lib/prisma"
import { buildCompanyScopedTenantWhere, requireRequestCompanyId } from "../lib/companyScope"
import { AuthedRequest, requireAuth } from "../middleware/requireAuth"

const router = Router()
// Keep ERP authentication scoped to this router's endpoints. A pathless router.use()
// would also intercept every later API route, including the public POS pairing route.
router.use("/api/v1/delivery-option-groups", requireAuth)

const ItemSchema = z.object({
  productId: z.string().min(1),
  priceAdjustment: z.coerce.number().min(0).default(0),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

const GroupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional(),
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]).default("MULTIPLE"),
  minSelections: z.coerce.number().int().min(0).max(50).default(0),
  maxSelections: z.coerce.number().int().min(1).max(50).default(1),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  productIds: z.array(z.string().min(1)).max(200).default([]),
  items: z.array(ItemSchema).max(200).default([]),
})

function tenantIdFor(req: AuthedRequest) {
  return String(req.auth?.tenantId || "").trim()
}

async function validateProductIds(tenantId: string, companyId: string, productIds: string[]) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))]
  if (!uniqueIds.length) return

  const products = await db.product.findMany({
    where: { id: { in: uniqueIds }, ...buildCompanyScopedTenantWhere(tenantId, companyId) },
    select: { id: true },
  })
  if (products.length !== uniqueIds.length) {
    throw new Error("Unele produse nu apartin firmei active.")
  }
}

const groupInclude = {
  productLinks: { orderBy: { sortOrder: "asc" as const }, select: { productId: true, sortOrder: true } },
  items: {
    orderBy: { sortOrder: "asc" as const },
    include: { product: { select: { id: true, name: true, sku: true, imageUrl: true, price: true, isSgr: true } } },
  },
}

router.get("/api/v1/delivery-option-groups", async (req: AuthedRequest, res) => {
  try {
    const tenantId = tenantIdFor(req)
    const companyId = await requireRequestCompanyId(req)
    const groups = await db.deliveryOptionGroup.findMany({
      where: { tenantId, companyId },
      include: groupInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
    return res.json({ ok: true, items: groups })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Nu am putut incarca optiunile." })
  }
})

router.post("/api/v1/delivery-option-groups", async (req: AuthedRequest, res) => {
  try {
    const tenantId = tenantIdFor(req)
    const companyId = await requireRequestCompanyId(req)
    const input = GroupSchema.parse(req.body)
    if (input.minSelections > input.maxSelections) throw new Error("Minimul de selectii nu poate depasi maximul.")
    await validateProductIds(tenantId, companyId, [...input.productIds, ...input.items.map((item) => item.productId)])

    const group = await db.deliveryOptionGroup.create({
      data: {
        tenantId,
        companyId,
        name: input.name,
        description: input.description || null,
        selectionMode: input.selectionMode,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        productLinks: { create: input.productIds.map((productId, index) => ({ productId, sortOrder: index })) },
        items: { create: input.items.map((item, index) => ({ ...item, sortOrder: item.sortOrder ?? index })) },
      },
      include: groupInclude,
    })
    return res.status(201).json({ ok: true, item: group })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Nu am putut salva grupul." })
  }
})

router.put("/api/v1/delivery-option-groups/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = tenantIdFor(req)
    const companyId = await requireRequestCompanyId(req)
    const input = GroupSchema.parse(req.body)
    if (input.minSelections > input.maxSelections) throw new Error("Minimul de selectii nu poate depasi maximul.")
    const existing = await db.deliveryOptionGroup.findFirst({ where: { id: req.params.id, tenantId, companyId }, select: { id: true } })
    if (!existing) return res.status(404).json({ ok: false, error: "Grupul nu exista." })
    await validateProductIds(tenantId, companyId, [...input.productIds, ...input.items.map((item) => item.productId)])

    const group = await db.deliveryOptionGroup.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description || null,
        selectionMode: input.selectionMode,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        productLinks: { deleteMany: {}, create: input.productIds.map((productId, index) => ({ productId, sortOrder: index })) },
        items: { deleteMany: {}, create: input.items.map((item, index) => ({ ...item, sortOrder: item.sortOrder ?? index })) },
      },
      include: groupInclude,
    })
    return res.json({ ok: true, item: group })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Nu am putut actualiza grupul." })
  }
})

router.delete("/api/v1/delivery-option-groups/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = tenantIdFor(req)
    const companyId = await requireRequestCompanyId(req)
    const result = await db.deliveryOptionGroup.deleteMany({ where: { id: req.params.id, tenantId, companyId } })
    if (!result.count) return res.status(404).json({ ok: false, error: "Grupul nu exista." })
    return res.json({ ok: true })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Nu am putut sterge grupul." })
  }
})

const ProductAssignmentSchema = z.object({
  productId: z.string().min(1),
  role: z.enum(["DISPLAY", "OPTION"]),
  priceAdjustment: z.coerce.number().min(0).default(0),
})

router.put("/api/v1/delivery-option-groups/:id/product-assignment", async (req: AuthedRequest, res) => {
  try {
    const tenantId = tenantIdFor(req)
    const companyId = await requireRequestCompanyId(req)
    const input = ProductAssignmentSchema.parse(req.body)
    const group = await db.deliveryOptionGroup.findFirst({ where: { id: req.params.id, tenantId, companyId }, select: { id: true } })
    if (!group) return res.status(404).json({ ok: false, error: "Grupul nu exista." })
    await validateProductIds(tenantId, companyId, [input.productId])
    if (input.role === "DISPLAY") {
      await db.deliveryProductOptionGroup.upsert({
        where: { productId_groupId: { productId: input.productId, groupId: group.id } },
        update: {}, create: { productId: input.productId, groupId: group.id },
      })
    } else {
      await db.deliveryOptionGroupItem.upsert({
        where: { groupId_productId: { groupId: group.id, productId: input.productId } },
        update: { priceAdjustment: input.priceAdjustment, isActive: true },
        create: { groupId: group.id, productId: input.productId, priceAdjustment: input.priceAdjustment },
      })
    }
    return res.json({ ok: true })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Nu am putut salva asocierea." })
  }
})

export default router
