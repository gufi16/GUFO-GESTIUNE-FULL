import { Router } from "express"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { decrementStockBalanceStrict, incrementStockBalance } from "../lib/stock"
import { reserveNextNumber } from "../lib/numbering"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

router.post("/api/v1/production", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth?.tenantId
    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "Tenant lipsa din sesiune."
      })
    }

    const companyId = await requireRequestCompanyId(req)
    if (!companyId) {
      return res.status(400).json({
        ok: false,
        error: "Firma activa este obligatorie."
      })
    }

    const locationId = String(req.body?.locationId || "").trim()
    const note = String(req.body?.note || "").trim() || null
    const items = Array.isArray(req.body?.items) ? req.body.items : []

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "Locatia este obligatorie."
      })
    }

    if (!items.length) {
      return res.status(400).json({
        ok: false,
        error: "Adauga cel putin un produs in productie."
      })
    }

    const normalizedItems: Array<{ productId: string; qty: number }> = items.map((row: any) => ({
      productId: String(row?.productId || "").trim(),
      qty: toNumber(row?.qty)
    }))

    for (const row of normalizedItems) {
      if (!row.productId) {
        return res.status(400).json({
          ok: false,
          error: "Exista produse fara ID."
        })
      }

      if (row.qty <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Cantitatea trebuie sa fie mai mare decat 0."
        })
      }
    }

    const productIds = Array.from(new Set(normalizedItems.map((x) => x.productId)))

    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId,
        id: { in: productIds }
      },
      include: {
        recipe: {
          include: {
            items: true
          }
        },
        uom: true
      }
    }) as Array<Prisma.ProductGetPayload<{
      include: {
        recipe: { include: { items: true } }
        uom: true
      }
    }>>

    if (products.length !== productIds.length) {
      return res.status(400).json({
        ok: false,
        error: "Unul sau mai multe produse nu exista."
      })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))

    for (const row of normalizedItems) {
      const product = productMap.get(row.productId)

      if (!product) {
        return res.status(400).json({
          ok: false,
          error: "Produs invalid in lista."
        })
      }

      if (!product.recipe || !product.recipe.items.length) {
        return res.status(400).json({
          ok: false,
          error: `Produsul "${product.name}" nu are retetar.`
        })
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const docNo = await reserveNextNumber(tx, tenantId, "production")

      const doc = await tx.productionDoc.create({
        data: {
          tenantId,
          companyId,
          locationId,
          docNo,
          docDate: new Date(),
          note
        }
      })

      for (const row of normalizedItems) {
        const product = productMap.get(row.productId)!
        const qtyDecimal = new Prisma.Decimal(row.qty)

        await tx.productionDocItem.create({
          data: {
            productionDocId: doc.id,
            productId: row.productId,
            qty: qtyDecimal
          }
        })

        const recipe = product.recipe
        const yieldQty = Math.max(toNumber(recipe?.yieldQty || 1), 0.000001)
        const recipeItems = Array.isArray(recipe?.items) ? recipe.items : []

        for (const recipeItem of recipeItems) {
          const baseQty = toNumber(recipeItem.qty)
          const lossPercent = toNumber(recipeItem.lossPercent)
          const computedQty = (baseQty * row.qty) / yieldQty
          const ingredientQtyNumber = computedQty * (1 + lossPercent / 100)
          const ingredientQty = new Prisma.Decimal(ingredientQtyNumber)

          await decrementStockBalanceStrict(tx, {
            tenantId,
            companyId,
            locationId,
            productId: recipeItem.ingredientId,
            qty: ingredientQty,
            productName: `ingredient pentru ${product.name}`
          })

          await tx.stockMove.create({
            data: {
              tenantId,
              locationId,
              productId: recipeItem.ingredientId,
              type: "OUT",
              qty: ingredientQty,
              refType: "PRODUCTION",
              refId: doc.id,
              note: `Consum productie ${product.name}`
            }
          })
        }

        await incrementStockBalance(tx, {
          tenantId,
          companyId,
          locationId,
          productId: row.productId,
          qty: qtyDecimal
        })

        await tx.stockMove.create({
          data: {
            tenantId,
            companyId,
            locationId,
            productId: row.productId,
            type: "IN",
            qty: qtyDecimal,
            refType: "PRODUCTION",
            refId: doc.id,
            note: `Productie ${product.name}`
          }
        })
      }

      return doc
    })

    return res.json({
      ok: true,
      message: "Productia a fost generata.",
      productionId: result.id
    })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Nu am putut genera productia."
    })
  }
})

export default router
