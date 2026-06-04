import type { Prisma, PrismaClient } from "@prisma/client"

const RECIPE_REQUIRED_CLASSES = ["PRODUS_FIN", "SEMIFABRICATE"] as const
const RECIPE_INGREDIENT_CLASSES = ["MATERIE_PRIMA", "MARFA", "SEMIFABRICATE"] as const
const MENU_COMPONENT_CLASSES = ["PRODUS_FIN", "MARFA", "SEMIFABRICATE"] as const
const PRODUCTION_MODE_VALUES = ["AUTO", "MANUAL"] as const
const STOCK_COST_METHOD_VALUES = ["AVG", "FIFO", "FEFO"] as const

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
  TAXA_VERDE: { allowPrice: true, allowPos: true, allowSgr: true },
}

export const ALL_PRODUCT_CLASSES = Object.keys(PRODUCT_CLASS_RULES)
export { MENU_COMPONENT_CLASSES, PRODUCTION_MODE_VALUES, RECIPE_INGREDIENT_CLASSES, RECIPE_REQUIRED_CLASSES, STOCK_COST_METHOD_VALUES }

type ProductClient = PrismaClient | Prisma.TransactionClient

function getClassRules(classValue: string) {
  return PRODUCT_CLASS_RULES[classValue] || null
}

export function normalizeProductFlags(
  classValue: string,
  payload: { price: number; isVisibleInPos: boolean; isSgr: boolean }
) {
  const rules = getClassRules(classValue)

  if (!rules) {
    throw new Error("Clasificare produs invalida.")
  }

  return {
    price: payload.price,
    isVisibleInPos: rules.allowPos ? payload.isVisibleInPos : false,
    isSgr: rules.allowSgr ? payload.isSgr : false,
  }
}

export function normalizeProductionMode(value: unknown) {
  const mode = String(value || "AUTO").trim().toUpperCase()
  return PRODUCTION_MODE_VALUES.includes(mode as (typeof PRODUCTION_MODE_VALUES)[number]) ? mode : null
}

export function normalizeStockCostMethod(value: unknown) {
  const method = String(value || "AVG").trim().toUpperCase()
  return STOCK_COST_METHOD_VALUES.includes(method as (typeof STOCK_COST_METHOD_VALUES)[number]) ? method : null
}

export function toNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".").trim()
  if (!normalized) return 0
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

export function serializeProduct(item: any) {
  if (!item) return item

  return {
    ...item,
    price: toNumber(item.price),
    costPrice: toNumber(item.costPrice),
    purchaseFactor: toNumber(item.purchaseFactor || 1),
    netWeightKg: toNumber(item.netWeightKg || 0),
    grossWeightKg: toNumber(item.grossWeightKg || 0),
    sgrValue: toNumber(item.sgrValue || 0),
    trackLot: item.trackLot === true,
    trackExpiry: item.trackExpiry === true,
    costMethod: item.costMethod || "AVG",
    vatRate: item.vatRate
      ? {
          ...item.vatRate,
          rate: toNumber(item.vatRate.rate),
        }
      : item.vatRate,
  }
}

export function serializeRecipe(recipe: any) {
  if (!recipe) return recipe

  return {
    ...recipe,
    yieldQty: toNumber(recipe.yieldQty || 1),
    items: Array.isArray(recipe.items)
      ? recipe.items.map((item: any) => ({
          ...item,
          qty: toNumber(item.qty || 0),
          lossPercent: toNumber(item.lossPercent || 0),
          ingredient: item.ingredient
            ? {
                ...serializeProduct(item.ingredient),
                uom: item.ingredient.uom
                  ? {
                      ...item.ingredient.uom,
                    }
                  : item.ingredient.uom,
              }
            : item.ingredient,
        }))
      : [],
  }
}

export function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback
  return Boolean(value)
}

export function toNullableText(value: unknown) {
  const text = String(value || "").trim()
  return text || null
}

export function normalizeImageUrl(value: unknown, normalizeStoredUploadUrl: (value: unknown) => string | null) {
  return normalizeStoredUploadUrl(value)
}

export function mergeImageUrl(
  requestedImageUrl: string | null,
  currentImageUrl: string | null,
  normalizeStoredUploadUrl: (value: unknown) => string | null
) {
  if (!requestedImageUrl) return currentImageUrl || null

  const normalized = normalizeStoredUploadUrl(requestedImageUrl)
  if (normalized) return normalized

  return currentImageUrl || null
}

function padNumber(value: number, size = 6) {
  return String(value).padStart(size, "0")
}

export async function getNextAvailableProductSkuValue(
  client: ProductClient,
  tenantId: string,
  companyId: string
) {
  const counter = await client.skuCounter.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: "product",
      },
    },
  })

  let nextValue = (counter?.value || 0) + 1

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = padNumber(nextValue + attempt)
    const existing = await client.product.findFirst({
      where: {
        tenantId,
        companyId,
        sku: candidate,
      },
      select: { id: true },
    })

    if (!existing) {
      return {
        sku: candidate,
        value: nextValue + attempt,
      }
    }
  }

  throw new Error("Nu pot genera urmatorul SKU disponibil.")
}
