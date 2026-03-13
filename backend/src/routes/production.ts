import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

router.post("/api/v1/production", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const locationId = String(req.body?.locationId || "").trim()
  const productId = String(req.body?.productId || "").trim()
  const qty = toNumber(req.body?.qty)
  const note = String(req.body?.note || "").trim()

  if (!locationId) {
    return res.status(400).json({ ok: false, error: "locationId este obligatoriu." })
  }

  if (!productId) {
    return res.status(400).json({ ok: false, error: "productId este obligatoriu." })
  }

  if (qty <= 0) {
    return res.status(400).json({ ok: false, error: "Cantitatea trebuie să fie > 0." })
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: { recipe: { include: { items: true } }, uom: true }
  })

  if (!product) {
    return res.status(404).json({ ok: false, error: "Produsul nu există." })
  }

  if (!product.recipe || !product.recipe.items.length) {
    return res.status(400).json({ ok: false, error: "Produsul nu are rețetar." })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {

      const docNo = `PROD-${Date.now()}`

      const doc = await tx.productionDoc.create({
        data: {
          tenantId,
          locationId,
          docNo,
          docDate: new Date(),
          note
        }
      })

      await tx.productionDocItem.create({
        data: {
          productionDocId: doc.id,
          productId,
          qty
        }
      })

      for (const item of product.recipe.items) {

        const ingredientQty =
          (Number(item.qty) * qty) / Number(product.recipe.yieldQty)

        const balance = await tx.stockBalance.findUnique({
          where: {
            tenantId_locationId_productId: {
              tenantId,
              locationId,
              productId: item.ingredientId
            }
          }
        })

        const available = Number(balance?.qty || 0)

        if (available < ingredientQty) {
          throw new Error(`Stoc insuficient pentru ingredient.`)
        }

        await tx.stockBalance.update({
          where: {
            tenantId_locationId_productId: {
              tenantId,
              locationId,
              productId: item.ingredientId
            }
          },
          data: {
            qty: {
              decrement: ingredientQty
            }
          }
        })

        await tx.stockMove.create({
          data: {
            tenantId,
            locationId,
            productId: item.ingredientId,
            type: "OUT",
            qty: ingredientQty,
            refType: "PRODUCTION",
            refId: doc.id,
            note: `Consum producție ${product.name}`
          }
        })
      }

      await tx.stockBalance.upsert({
        where: {
          tenantId_locationId_productId: {
            tenantId,
            locationId,
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
          locationId,
          productId,
          qty
        }
      })

      await tx.stockMove.create({
        data: {
          tenantId,
          locationId,
          productId,
          type: "IN",
          qty,
          refType: "PRODUCTION",
          refId: doc.id,
          note: "Producție produs finit"
        }
      })

      return doc
    })

    res.json({
      ok: true,
      message: "Producția a fost generată.",
      productionId: result.id
    })
  } catch (e: any) {
    res.status(400).json({
      ok: false,
      error: e?.message || "Nu am putut genera producția."
    })
  }
})

export default router