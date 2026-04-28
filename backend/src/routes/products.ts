// @ts-nocheck
import { Router } from "express"
import path from "path"
import fs from "fs"
import multer from "multer"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

const uploadsDir = path.join(process.cwd(), "uploads", "products")
fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase()
    const safeExt = ext || ".jpg"
    const baseName = path
      .basename(file.originalname || "image", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50)

    cb(null, `${Date.now()}-${baseName}${safeExt}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)
    if (!ok) {
      cb(new Error("Sunt permise doar fisiere imagine: jpg, png, webp, gif."))
      return
    }
    cb(null, true)
  }
})

router.use(requireAuth)

const RECIPE_REQUIRED_CLASSES = ["PRODUS_FIN", "SEMIFABRICATE"]
const RECIPE_INGREDIENT_CLASSES = ["MATERIE_PRIMA", "MARFA", "SEMIFABRICATE"]
const PRODUCTION_MODE_VALUES = ["AUTO", "MANUAL"]

const PRODUCT_CLASS_RULES: Record<
  string,
  {
    allowPrice: boolean
    allowPos: boolean
    allowSgr: boolean
  }
> = {
  MATERIE_PRIMA: { allowPrice: true, allowPos: true, allowSgr: true },
  SEMIFABRICATE: { allowPrice: true, allowPos: true, allowSgr: true },
  PRODUS_FIN: { allowPrice: true, allowPos: true, allowSgr: true },
  MARFA: { allowPrice: true, allowPos: true, allowSgr: true },
  AMBALAJE: { allowPrice: true, allowPos: true, allowSgr: true },
  AMBALAJ_SGR: { allowPrice: true, allowPos: true, allowSgr: true },
  CONSUMABILE: { allowPrice: true, allowPos: true, allowSgr: true },
  REZIDUALE: { allowPrice: true, allowPos: true, allowSgr: true },
  ALTE_MATERIALE: { allowPrice: true, allowPos: true, allowSgr: true },
  SERVICIU_VANDUT: { allowPrice: true, allowPos: true, allowSgr: false },
  DISCOUNT_FINANCIAR_IESIRI: { allowPrice: true, allowPos: true, allowSgr: true },
  DISCOUNT_COMERCIAL_IESIRI: { allowPrice: true, allowPos: true, allowSgr: true },
  TAXA_VERDE: { allowPrice: true, allowPos: true, allowSgr: true }
}
const ALL_PRODUCT_CLASSES = Object.keys(PRODUCT_CLASS_RULES)

function getClassRules(classValue: string) {
  return PRODUCT_CLASS_RULES[classValue] || null
}

function normalizeProductFlags(classValue: string, payload: { price: number; isVisibleInPos: boolean; isSgr: boolean }) {
  const rules = getClassRules(classValue)

  if (!rules) {
    throw new Error("Clasificare produs invalida.")
  }

  return {
    price: rules.allowPrice ? payload.price : 0,
    isVisibleInPos: rules.allowPos ? payload.isVisibleInPos : false,
    isSgr: rules.allowSgr ? payload.isSgr : false
  }
}

function normalizeProductionMode(value: any) {
  const mode = String(value || "AUTO").trim().toUpperCase()
  return PRODUCTION_MODE_VALUES.includes(mode) ? mode : null
}

function toNumber(value: any) {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".").trim()
  if (!normalized) return 0
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function toNullableText(value: any) {
  const text = String(value || "").trim()
  return text || null
}

function padNumber(value: number, size = 6) {
  return String(value).padStart(size, "0")
}

async function getNextAvailableProductSkuValue(
  client: typeof prisma | Prisma.TransactionClient,
  tenantId: string,
  companyId: string
) {
  const counter = await client.skuCounter.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: "product"
      }
    }
  })

  let nextValue = (counter?.value || 0) + 1

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = padNumber(nextValue + attempt)
    const existing = await client.product.findFirst({
      where: {
        tenantId,
        companyId,
        sku: candidate
      },
      select: { id: true }
    })

    if (!existing) {
      return {
        sku: candidate,
        value: nextValue + attempt
      }
    }
  }

  throw new Error("Nu pot genera urmatorul SKU disponibil.")
}

function normalizeImageUrl(value: any) {
  const text = String(value || "").trim()
  return text || null
}

function buildPublicBaseUrl(req: any) {
  const explicitBase = String(
    process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || process.env.APP_PUBLIC_API_URL || ""
  )
    .trim()
    .replace(/\/+$/, "")

  if (explicitBase) return explicitBase

  const forwardedProto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim()
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim()

  return `${forwardedProto}://${forwardedHost}`
}

function buildPublicImageUrl(req: any, folder: "products" | "categories", filename: string) {
  return `${buildPublicBaseUrl(req)}/uploads/${folder}/${filename}`
}

router.post(
  "/api/v1/products/upload-image",
  upload.single("image"),
  async (req: AuthedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Nu ai selectat nicio imagine." })
    }

    return res.json({
      ok: true,
      imageUrl: buildPublicImageUrl(req, "products", req.file.filename)
    })
  }
)

router.get("/api/v1/products", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const q = String(req.query.q || "").trim()

  const items = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
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
      vatRate: true,
      uom: true,
      purchaseUom: true,
      department: true,
      category: {
        include: {
          department: true
        }
      },
      recipe: {
        include: {
          items: true
        }
      }
    },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, items })
})

router.get("/api/v1/products/next-sku", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  try {
    const preview = await getNextAvailableProductSkuValue(prisma, tenantId, companyId)
    res.json({ ok: true, sku: preview.sku })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || "Nu pot genera urmatorul SKU." })
  }
})

router.post("/api/v1/products", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId, {
    select: {
      isVatPayer: true
    }
  })

  const isVatPayer = company?.isVatPayer ?? true

  const name = String(req.body?.name || "").trim()
  const imageUrl = normalizeImageUrl(req.body?.imageUrl)
  const vatRateIdRaw = String(req.body?.vatRateId || "").trim()
  const vatRateId = isVatPayer ? vatRateIdRaw : null
  const uomId = String(req.body?.uomId || "").trim()
  const purchaseUomIdRaw = String(req.body?.purchaseUomId || "").trim()
  const purchaseUomId = purchaseUomIdRaw || null
  const purchaseFactor = toNumber(req.body?.purchaseFactor || 1)
  const price = toNumber(req.body?.price || 0)
  const costPrice = toNumber(req.body?.costPrice || 0)
  const categoryIdRaw = String(req.body?.categoryId || "").trim()
  const categoryId = categoryIdRaw || null
  const requestedSku = String(req.body?.sku || "").trim()
  const classValue = String(req.body?.class || "MARFA").trim()
  const normalizedPurchaseUomId = classValue === "PRODUS_FIN" ? uomId : purchaseUomId
  const normalizedPurchaseFactor = classValue === "PRODUS_FIN" ? 1 : purchaseFactor
  let productionMode = normalizeProductionMode(req.body?.productionMode || "AUTO")
  const requestedIsActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive)
  const requestedVisibleInPos =
    req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)
  const requestedIsSgr = req.body?.isSgr === undefined ? false : Boolean(req.body?.isSgr)

  if (!ALL_PRODUCT_CLASSES.includes(classValue)) {
    return res.status(400).json({ ok: false, error: "Clasificare produs invalida." })
  }

  if (!productionMode) {
    return res.status(400).json({ ok: false, error: "Mod de productie invalid." })
  }

  const { price: normalizedPrice, isVisibleInPos, isSgr } = normalizeProductFlags(classValue, {
    price,
    isVisibleInPos: requestedVisibleInPos,
    isSgr: requestedIsSgr
  })

  if (!name) {
    return res.status(400).json({ ok: false, error: "Denumirea produsului este obligatorie." })
  }

  if (isVatPayer && !vatRateId) {
    return res.status(400).json({ ok: false, error: "TVA este obligatoriu." })
  }

  if (!uomId) {
    return res.status(400).json({ ok: false, error: "UM este obligatorie." })
  }

  if (normalizedPurchaseFactor <= 0) {
    return res.status(400).json({ ok: false, error: "Factorul trebuie sa fie mai mare decat 0." })
  }

  const [vatRate, fallbackVatRate, uom, purchaseUom, category] = await Promise.all([
    vatRateId
      ? prisma.vatRate.findFirst({
          where: {
            id: vatRateId,
            tenantId
          }
        })
      : Promise.resolve(null),
    !isVatPayer
      ? prisma.vatRate.findFirst({
          where: {
            tenantId,
            rate: 0,
            isActive: true
          }
        })
      : Promise.resolve(null),
    prisma.uom.findFirst({
      where: {
        id: uomId,
        tenantId
      }
    }),
    normalizedPurchaseUomId
      ? prisma.uom.findFirst({
          where: {
            id: normalizedPurchaseUomId,
            tenantId
          }
        })
      : Promise.resolve(null),
    categoryId
      ? prisma.category.findFirst({
          where: {
            id: categoryId,
            tenantId
          },
          include: {
            department: true
          }
        })
      : Promise.resolve(null)
  ])

  if (isVatPayer && !vatRate) {
    return res.status(404).json({ ok: false, error: "TVA inexistent." })
  }

  if (!isVatPayer && !fallbackVatRate) {
    return res.status(400).json({ ok: false, error: "Lipseste cota TVA 0% pentru companiile neplatitoare de TVA." })
  }

  if (!isVatPayer && !fallbackVatRate) {
    return res.status(400).json({ ok: false, error: "Lipseste cota TVA 0% pentru companiile neplatitoare de TVA." })
  }

  if (!uom) {
    return res.status(404).json({ ok: false, error: "UM inexistenta." })
  }

  if (normalizedPurchaseUomId && !purchaseUom) {
    return res.status(404).json({ ok: false, error: "UM achizitie inexistenta." })
  }

  if (categoryId && !category) {
    return res.status(404).json({ ok: false, error: "Categoria nu exista." })
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      let finalSku = requestedSku
      if (requestedSku) {
        const existingSku = await tx.product.findFirst({
          where: {
            tenantId,
            companyId,
            sku: requestedSku
          },
          select: { id: true }
        })

        if (existingSku) {
          throw new Error("Exista deja un produs cu acest cod.")
        }
      } else {
        const preview = await getNextAvailableProductSkuValue(tx, tenantId, companyId)
        finalSku = preview.sku
        await tx.skuCounter.upsert({
          where: { tenantId_key: { tenantId, key: "product" } },
          update: { value: preview.value },
          create: { tenantId, key: "product", value: preview.value }
        })
      }
      const forcedInactiveBecauseMissingRecipe = RECIPE_REQUIRED_CLASSES.includes(classValue)

      const created = await tx.product.create({
        data: {
          tenantId,
          companyId,
          sku: finalSku,
          name,
          imageUrl,
          class: classValue as any,
          vatRateId: vatRate?.id || fallbackVatRate?.id || vatRateIdRaw,
          uomId,
          purchaseUomId: normalizedPurchaseUomId || uomId,
          purchaseFactor: normalizedPurchaseFactor,
          categoryId,
          departmentId: category?.departmentId || null,
          price: normalizedPrice,
          costPrice,
          isActive: forcedInactiveBecauseMissingRecipe ? false : requestedIsActive,
          isVisibleInPos,
          isSgr,
          sgrValue: isSgr ? 0.5 : 0,
          productionMode: productionMode as any
        },
        include: {
          vatRate: true,
          uom: true,
          purchaseUom: true,
          department: true,
          category: {
            include: {
              department: true
            }
          },
          recipe: {
            include: {
              items: true
            }
          }
        }
      })

      return {
        ...created,
        forcedInactiveBecauseMissingRecipe
      }
    })

    res.json({ ok: true, item })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || "Nu am putut salva produsul." })
  }
})

router.put("/api/v1/products/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId, {
    select: {
      isVatPayer: true
    }
  })

  const isVatPayer = company?.isVatPayer ?? true

  const name = String(req.body?.name || "").trim()
  const imageUrl = normalizeImageUrl(req.body?.imageUrl)
  const vatRateIdRaw = String(req.body?.vatRateId || "").trim()
  const vatRateId = isVatPayer ? vatRateIdRaw : null
  const uomId = String(req.body?.uomId || "").trim()
  const purchaseUomIdRaw = String(req.body?.purchaseUomId || "").trim()
  const purchaseUomId = purchaseUomIdRaw || null
  const purchaseFactor = toNumber(req.body?.purchaseFactor || 1)
  const price = toNumber(req.body?.price || 0)
  const costPrice = toNumber(req.body?.costPrice || 0)
  const categoryIdRaw = String(req.body?.categoryId || "").trim()
  const categoryId = categoryIdRaw || null
  const classValue = String(req.body?.class || "MARFA").trim()
  const normalizedPurchaseUomId = classValue === "PRODUS_FIN" ? uomId : purchaseUomId
  const normalizedPurchaseFactor = classValue === "PRODUS_FIN" ? 1 : purchaseFactor
  let productionMode = normalizeProductionMode(req.body?.productionMode || "AUTO")
  const requestedIsActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive)
  const requestedVisibleInPos =
    req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)
  const requestedIsSgr = req.body?.isSgr === undefined ? false : Boolean(req.body?.isSgr)

  if (!ALL_PRODUCT_CLASSES.includes(classValue)) {
    return res.status(400).json({ ok: false, error: "Clasificare produs invalida." })
  }

  if (!productionMode) {
    return res.status(400).json({ ok: false, error: "Mod de productie invalid." })
  }

  const { price: normalizedPrice, isVisibleInPos, isSgr } = normalizeProductFlags(classValue, {
    price,
    isVisibleInPos: requestedVisibleInPos,
    isSgr: requestedIsSgr
  })

  if (!name) {
    return res.status(400).json({ ok: false, error: "Denumirea produsului este obligatorie." })
  }

  if (isVatPayer && !vatRateId) {
    return res.status(400).json({ ok: false, error: "TVA este obligatoriu." })
  }

  if (!uomId) {
    return res.status(400).json({ ok: false, error: "UM este obligatorie." })
  }

  if (normalizedPurchaseFactor <= 0) {
    return res.status(400).json({ ok: false, error: "Factorul trebuie sa fie mai mare decat 0." })
  }

  const current = await prisma.product.findFirst({
    where: {
      id,
      tenantId,
      companyId
    }
  })

  if (!current) {
    return res.status(404).json({ ok: false, error: "Produsul nu exista." })
  }

  productionMode = normalizeProductionMode(
    req.body?.productionMode ?? current.productionMode ?? "AUTO"
  )

  const [vatRate, fallbackVatRate, uom, purchaseUom, category, existingRecipe] = await Promise.all([
    vatRateId
      ? prisma.vatRate.findFirst({
          where: {
            id: vatRateId,
            tenantId
          }
        })
      : Promise.resolve(null),
    !isVatPayer
      ? prisma.vatRate.findFirst({
          where: {
            tenantId,
            rate: 0,
            isActive: true
          }
        })
      : Promise.resolve(null),
    prisma.uom.findFirst({
      where: {
        id: uomId,
        tenantId
      }
    }),
    normalizedPurchaseUomId
      ? prisma.uom.findFirst({
          where: {
            id: normalizedPurchaseUomId,
            tenantId
          }
        })
      : Promise.resolve(null),
    categoryId
      ? prisma.category.findFirst({
          where: {
            id: categoryId,
            tenantId
          },
          include: {
            department: true
          }
        })
      : Promise.resolve(null),
    prisma.recipe.findFirst({
      where: {
        tenantId,
        companyId,
        productId: id
      }
    })
  ])

  if (isVatPayer && !vatRate) {
    return res.status(404).json({ ok: false, error: "TVA inexistent." })
  }

  if (!uom) {
    return res.status(404).json({ ok: false, error: "UM inexistenta." })
  }

  if (normalizedPurchaseUomId && !purchaseUom) {
    return res.status(404).json({ ok: false, error: "UM achizitie inexistenta." })
  }

  if (categoryId && !category) {
    return res.status(404).json({ ok: false, error: "Categoria nu exista." })
  }

  try {
    const forcedInactiveBecauseMissingRecipe =
      RECIPE_REQUIRED_CLASSES.includes(classValue) && !existingRecipe

    const item = await prisma.product.update({
      where: { id },
      data: {
        name,
        imageUrl,
        class: classValue as any,
        vatRateId: vatRate?.id || fallbackVatRate?.id || current.vatRateId,
        uomId,
        purchaseUomId: normalizedPurchaseUomId || uomId,
          purchaseFactor: normalizedPurchaseFactor,
        categoryId,
        departmentId: category?.departmentId || null,
        price: normalizedPrice,
        costPrice,
        isActive: forcedInactiveBecauseMissingRecipe ? false : requestedIsActive,
        isVisibleInPos,
        isSgr,
        sgrValue: isSgr ? 0.5 : 0,
        productionMode: productionMode as any
      },
      include: {
        vatRate: true,
        uom: true,
        purchaseUom: true,
        department: true,
        category: {
          include: {
            department: true
          }
        },
        recipe: {
          include: {
            items: true
          }
        }
      }
    })

    res.json({
      ok: true,
      item: {
        ...item,
        forcedInactiveBecauseMissingRecipe
      }
    })
  } catch {
    res.status(400).json({ ok: false, error: "Nu am putut actualiza produsul." })
  }
})

router.get("/api/v1/products/:id/recipe", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const productId = String(req.params.id)

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      tenantId,
      companyId
    },
    include: {
      uom: true
    }
  })

  if (!product) {
    return res.status(404).json({ ok: false, error: "Produsul nu exista." })
  }

  const recipe = await prisma.recipe.findFirst({
    where: {
      tenantId,
      companyId,
      productId
    },
    include: {
      items: {
        include: {
          ingredient: {
            include: {
              uom: true
            }
          }
        },
        orderBy: {
          sortOrder: "asc"
        }
      }
    }
  })

  return res.json({
    ok: true,
    product,
    recipe
  })
})

router.post("/api/v1/products/:id/recipe", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const productId = String(req.params.id)

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      tenantId,
      companyId
    }
  })

  if (!product) {
    return res.status(404).json({ ok: false, error: "Produsul nu exista." })
  }

  if (product.class !== "PRODUS_FIN" && product.class !== "SEMIFABRICATE") {
    return res.status(400).json({
      ok: false,
      error: "Retetarul se poate defini doar pentru PRODUS_FIN sau SEMIFABRICATE."
    })
  }

  const code = toNullableText(req.body?.code)
  const name = toNullableText(req.body?.name)
  const notes = toNullableText(req.body?.notes)
  const status = String(req.body?.status || "DRAFT").trim()
  const yieldQty = toNumber(req.body?.yieldQty || 1)
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive)
  const activateProduct = req.body?.activateProduct === undefined ? true : Boolean(req.body?.activateProduct)
  const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : []

  if (yieldQty <= 0) {
    return res.status(400).json({ ok: false, error: "Randamentul trebuie sa fie mai mare decat 0." })
  }

  if (!["DRAFT", "ACTIVE", "INACTIVE"].includes(status)) {
    return res.status(400).json({ ok: false, error: "Status retetar invalid." })
  }

  const normalizedItems: Array<{
    ingredientId: string
    qty: number
    lossPercent: number
    sortOrder: number
    notes: string | null
  }> = itemsRaw.map((line: any, index: number) => ({
    ingredientId: String(line?.ingredientId || "").trim(),
    qty: toNumber(line?.qty || 0),
    lossPercent: toNumber(line?.lossPercent || 0),
    sortOrder: Number.isFinite(Number(line?.sortOrder)) ? Number(line.sortOrder) : index + 1,
    notes: toNullableText(line?.notes)
  }))

  if (!normalizedItems.length) {
    return res.status(400).json({ ok: false, error: "Adauga cel putin un ingredient in retetar." })
  }

  for (const line of normalizedItems) {
    if (!line.ingredientId) {
      return res.status(400).json({ ok: false, error: "Exista ingrediente fara produs selectat." })
    }
    if (line.ingredientId === productId) {
      return res.status(400).json({ ok: false, error: "Produsul nu poate fi ingredient in propriul retetar." })
    }
    if (line.qty <= 0) {
      return res.status(400).json({ ok: false, error: "Cantitatea ingredientului trebuie sa fie mai mare decat 0." })
    }
    if (line.lossPercent < 0) {
      return res.status(400).json({ ok: false, error: "Pierderea nu poate fi negativa." })
    }
  }

  const ingredientIds = Array.from(new Set(normalizedItems.map((x) => x.ingredientId)))
  const ingredients = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
      id: { in: ingredientIds }
    },
    include: {
      uom: true
    }
  })

  if (ingredients.length !== ingredientIds.length) {
    return res.status(400).json({ ok: false, error: "Unul sau mai multe ingrediente nu exista." })
  }

  const invalidIngredient = ingredients.find(
    (ingredient) => !RECIPE_INGREDIENT_CLASSES.includes(String(ingredient.class))
  )

  if (invalidIngredient) {
    return res.status(400).json({
      ok: false,
      error:
        "In retetar sunt permise doar ingrediente din clasele MATERIE_PRIMA, MARFA sau SEMIFABRICATE."
    })
  }

  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({
        where: {
          tenantId,
          companyId,
          productId
        }
      })

      const savedRecipe = existing
        ? await tx.recipe.update({
            where: { id: existing.id },
            data: {
              code,
              name,
              notes,
              status: status as any,
              yieldQty,
              isActive
            }
          })
        : await tx.recipe.create({
            data: {
              tenantId,
              companyId,
              productId,
              code,
              name,
              notes,
              status: status as any,
              yieldQty,
              isActive
            }
          })

      await tx.recipeItem.deleteMany({
        where: {
          recipeId: savedRecipe.id
        }
      })

      if (normalizedItems.length) {
        await tx.recipeItem.createMany({
          data: normalizedItems.map((line) => ({
            recipeId: savedRecipe.id,
            ingredientId: line.ingredientId,
            qty: line.qty,
            lossPercent: line.lossPercent,
            sortOrder: line.sortOrder,
            notes: line.notes
          }))
        })
      }

      if (activateProduct) {
        await tx.product.update({
          where: { id: productId },
          data: { isActive: true }
        })
      }

      return tx.recipe.findUnique({
        where: {
          id: savedRecipe.id
        },
        include: {
          items: {
            include: {
              ingredient: {
                include: {
                  uom: true
                }
              }
            },
            orderBy: {
              sortOrder: "asc"
            }
          },
          product: true
        }
      })
    })

    return res.json({
      ok: true,
      recipe,
      productActivated: activateProduct
    })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Nu am putut salva retetarul."
    })
  }
})

router.delete("/api/v1/products/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const current = await prisma.product.findFirst({
    where: {
      id,
      tenantId,
      companyId
    }
  })

  if (!current) {
    return res.status(404).json({ ok: false, error: "Produsul nu exista." })
  }

  try {
    await prisma.product.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({ ok: false, error: "Produsul este utilizat si nu poate fi sters." })
  }
})

export default router










