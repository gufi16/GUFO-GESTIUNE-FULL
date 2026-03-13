import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()
router.use(requireAuth)

router.get("/api/v1/production-docs", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const q = String(req.query.q || "").trim()
    const locationId = String(req.query.locationId || "").trim()

    const docs = await prisma.productionDoc.findMany({
      where: {
        tenantId,
        ...(locationId ? { locationId } : {}),
        ...(q
          ? {
              OR: [
                { docNo: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
              },
            },
          },
        },
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    })

    const items = docs.map((doc) => ({
      id: doc.id,
      docNo: doc.docNo,
      docDate: doc.docDate,
      note: doc.note ?? "",
      locationId: doc.locationId,
      locationName: doc.location?.name ?? "",
      itemsCount: doc.items.length,
      totalQty: doc.items.reduce((sum, row) => sum + Number(row.qty || 0), 0),
      products: doc.items.map((row) => ({
        productId: row.productId,
        sku: row.product?.sku ?? "",
        name: row.product?.name ?? "",
        uom: row.product?.uom?.code ?? "",
        qty: Number(row.qty || 0),
      })),
    }))

    return res.json({ ok: true, items })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut încărca documentele de producție.",
    })
  }
})

router.get("/api/v1/production-docs/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const id = String(req.params.id || "").trim()

    const doc = await prisma.productionDoc.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                recipe: {
                  include: {
                    items: {
                      include: {
                        ingredient: {
                          include: {
                            uom: true,
                          },
                        },
                      },
                      orderBy: { sortOrder: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de producție nu există.",
      })
    }

    const items = doc.items.map((row) => {
      const yieldQty = Number(row.product?.recipe?.yieldQty || 1)
      const producedQty = Number(row.qty || 0)

      const ingredients =
        row.product?.recipe?.items?.map((recipeItem) => {
          const ingredientQty =
            (Number(recipeItem.qty || 0) * producedQty) / (yieldQty || 1)

          return {
            ingredientId: recipeItem.ingredientId,
            sku: recipeItem.ingredient?.sku ?? "",
            name: recipeItem.ingredient?.name ?? "",
            uom: recipeItem.ingredient?.uom?.code ?? "",
            qty: ingredientQty,
          }
        }) || []

      return {
        id: row.id,
        productId: row.productId,
        sku: row.product?.sku ?? "",
        name: row.product?.name ?? "",
        uom: row.product?.uom?.code ?? "",
        qty: producedQty,
        ingredients,
      }
    })

    return res.json({
      ok: true,
      item: {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note ?? "",
        locationId: doc.locationId,
        locationName: doc.location?.name ?? "",
        itemsCount: items.length,
        totalQty: items.reduce((sum, row) => sum + row.qty, 0),
        items,
      },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut încărca documentul de producție.",
    })
  }
})

export default router