import { Router } from "express"
import path from "path"
import fs from "fs"
import multer from "multer"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import { ProductClass, ProductionMode, RecipeStatus, SgrPackagingType, StockCostMethod, TerminalDeviceType } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildCompanyScopedTenantWhere, requireRequestCompanyId, resolveRequestCompany } from "../lib/companyScope"
import { suggestNcCodes } from "../lib/ncSuggest"
import { buildPublicUploadUrl, ensureUploadSubdir, normalizeStoredUploadUrl } from "../lib/uploads"
import { drawDocumentHero, drawSimpleTable, registerPdfFonts } from "../lib/professionalPdf"
import {
  ALL_PRODUCT_CLASSES,
  MENU_COMPONENT_CLASSES,
  RECIPE_INGREDIENT_CLASSES,
  RECIPE_REQUIRED_CLASSES,
  getNextAvailableProductSkuValue,
  mergeImageUrl,
  normalizeBoolean,
  normalizeImageUrl,
  normalizeProductFlags,
  normalizeProductionMode,
  normalizeStockCostMethod,
  serializeProduct,
  serializeRecipe,
  toNullableText,
  toNumber,
} from "../lib/productRouteSupport"

const router = Router()

type RecipeInputItemLike = {
  ingredientId?: unknown
  qty?: unknown
  lossPercent?: unknown
  sortOrder?: unknown
  notes?: unknown
}

const uploadsDir = ensureUploadSubdir("products")

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

function getScopedAuth(req: AuthedRequest) {
  const tenantId = String(req.auth?.tenantId || "").trim()
  return { tenantId }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function resolveSgrPackagingData(payload: unknown, isSgr: boolean) {
  if (!isSgr) {
    return { sgrPackagingType: null, sgrVolumeLiters: 0, error: "" }
  }

  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
  const type = String(body.sgrPackagingType || "").trim().toUpperCase()
  const sgrPackagingType =
    type === "PET" || type === "METAL" || type === "STICLA" ? (type as SgrPackagingType) : null
  const sgrVolumeLiters = toNumber(body.sgrVolumeLiters)

  if (!sgrPackagingType) {
    return { sgrPackagingType: null, sgrVolumeLiters: 0, error: "Pentru SGR selecteaza PET, doza metal sau sticla." }
  }

  if (sgrVolumeLiters < 0.1 || sgrVolumeLiters > 3) {
    return { sgrPackagingType: null, sgrVolumeLiters: 0, error: "Volumul SGR trebuie sa fie intre 0,1 si 3 litri." }
  }

  return { sgrPackagingType, sgrVolumeLiters, error: "" }
}

function exportMoney(value: unknown) {
  return `${toNumber(value).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
}

async function getNomenclatorExportData(req: AuthedRequest) {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) throw new Error("Unauthorized")

  const companyId = await requireRequestCompanyId(req)
  if (!companyId) throw new Error("Compania activa lipseste.")

  const [company, products] = await Promise.all([
    prisma.company.findFirst({
      where: { id: companyId, tenantId },
      select: { name: true, cui: true },
    }),
    prisma.product.findMany({
      where: { tenantId, companyId },
      include: {
        uom: { select: { code: true, name: true } },
        vatRate: { select: { rate: true } },
      },
      orderBy: [{ posSortOrder: "asc" }, { name: "asc" }],
    }),
  ])

  if (!company) throw new Error("Compania activa nu a fost gasita.")

  return { company, products }
}

async function resolveProductTerminalIds(tenantId: string, companyId: string, payload: unknown) {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
  const requestedIds = Array.isArray(body.terminalIds) ? body.terminalIds : []
  const normalizedIds = Array.from(
    new Set(
      requestedIds
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  )

  if (!normalizedIds.length) return [] as string[]

  const terminals = await prisma.terminal.findMany({
    where: {
      tenantId,
      companyId,
      deviceType: TerminalDeviceType.POS,
      id: { in: normalizedIds },
    },
    select: { id: true },
  })

  if (terminals.length !== normalizedIds.length) {
    throw new Error("Unele POS-uri selectate nu exista.")
  }

  return terminals.map((terminal) => terminal.id)
}

function hasBarcodePayload(body: Record<string, unknown> | null | undefined) {
  if (!body) return false
  return Object.prototype.hasOwnProperty.call(body, "barcode") || Object.prototype.hasOwnProperty.call(body, "barcodes")
}

function normalizeBarcodeList(value: unknown) {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value]
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of rawValues) {
    const text = String(raw || "").trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(text)
  }

  return normalized
}

function normalizeCrossSellProductIds(value: unknown) {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value]
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of rawValues) {
    const text = String(raw || "").trim()
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
  }

  return normalized
}

function normalizeProductPosSortOrder(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.round(parsed))
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
      imageUrl: buildPublicUploadUrl("products", req.file.filename)
    })
  }
)

router.get("/api/v1/products", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
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
      terminalAccesses: {
        select: {
          terminalId: true,
        },
      },
      barcodes: {
        orderBy: { createdAt: "asc" }
      },
      category: {
        include: {
          department: true,
          parentCategory: {
            select: {
              id: true,
              name: true,
            },
          },
        }
      },
      crossSellLinks: {
        include: {
          targetProduct: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      },
      recipe: {
        include: {
          items: true
        }
      }
    },
    orderBy: [{ posSortOrder: "asc" }, { name: "asc" }]
  })

  res.json({ ok: true, items: items.map(serializeProduct) })
})

router.get("/api/v1/products/export/xlsx", async (req: AuthedRequest, res) => {
  try {
    const { company, products } = await getNomenclatorExportData(req)
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Gufo ERP"
    workbook.created = new Date()
    const sheet = workbook.addWorksheet("Nomenclator produse", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    })

    sheet.mergeCells("A1:F1")
    sheet.getCell("A1").value = "NOMENCLATOR PRODUSE"
    sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } }
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "17324D" } }
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
    sheet.getRow(1).height = 28

    sheet.mergeCells("A2:F2")
    sheet.getCell("A2").value = `${company.name}${company.cui ? ` | CUI: ${company.cui}` : ""} | Generat: ${new Date().toLocaleDateString("ro-RO")}`
    sheet.getCell("A2").font = { italic: true, color: { argb: "475569" } }

    sheet.columns = [
      { key: "sku", width: 18 },
      { key: "name", width: 42 },
      { key: "uom", width: 12 },
      { key: "sgr", width: 12 },
      { key: "vat", width: 14 },
      { key: "price", width: 24 },
    ]
    sheet.getRow(3).values = ["Cod produs", "Denumire produs", "UM", "SGR", "Cota TVA", "Pret vanzare cu TVA"]
    const headerRow = sheet.getRow(3)
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } }
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "167D72" } }
    headerRow.alignment = { horizontal: "center", vertical: "middle" }
    headerRow.height = 22

    products.forEach((product) => {
      const row = sheet.addRow({
        sku: product.sku,
        name: product.name,
        uom: product.uom?.code || product.uom?.name || "-",
        sgr: product.isSgr ? "Da" : "Nu",
        vat: product.vatRate ? `${toNumber(product.vatRate.rate)}%` : "Neplatitor TVA",
        price: toNumber(product.price),
      })
      row.getCell("F").numFmt = '#,##0.00 "RON"'
      if (product.isSgr) {
        row.getCell("D").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E8F8F1" } }
        row.getCell("D").font = { bold: true, color: { argb: "167D72" } }
      }
    })

    sheet.autoFilter = { from: "A3", to: { row: Math.max(3, products.length + 3), column: 6 } }
    sheet.eachRow((row) => {
      row.alignment = { vertical: "middle" }
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "D7DEEA" } },
          left: { style: "thin", color: { argb: "D7DEEA" } },
          bottom: { style: "thin", color: { argb: "D7DEEA" } },
          right: { style: "thin", color: { argb: "D7DEEA" } },
        }
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", 'attachment; filename="Nomenclator_produse.xlsx"')
    res.send(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
  } catch (error) {
    console.error("PRODUCTS XLSX EXPORT ERROR:", error)
    res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut exporta produsele in Excel.") })
  }
})

router.get("/api/v1/products/export/pdf", async (req: AuthedRequest, res) => {
  try {
    const { company, products } = await getNomenclatorExportData(req)
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, info: { Title: "Nomenclator produse", Author: "Gufo ERP" } })
    const fonts = registerPdfFonts(doc)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", 'attachment; filename="Nomenclator_produse.pdf"')
    doc.pipe(res)

    const y = drawDocumentHero(doc, fonts, {
      title: "NOMENCLATOR PRODUSE",
      subtitle: "Lista produse, TVA, SGR si preturi de vanzare cu TVA",
      companyName: company.name,
      companyLines: [company.cui ? `CUI: ${company.cui}` : ""].filter(Boolean),
      rightPairs: [
        { label: "Produse", value: String(products.length) },
        { label: "Generat", value: new Date().toLocaleDateString("ro-RO") },
      ],
      margin: 36,
    })

    drawSimpleTable(doc, fonts, {
      margin: 36,
      y,
      columns: [
        { label: "Cod produs", width: 95 },
        { label: "Denumire produs", width: 275 },
        { label: "UM", width: 70, align: "center" },
        { label: "SGR", width: 65, align: "center" },
        { label: "Cota TVA", width: 90, align: "right" },
        { label: "Pret vanzare cu TVA", width: 135, align: "right" },
      ],
      rows: products.map((product) => [
        product.sku,
        product.name,
        product.uom?.code || product.uom?.name || "-",
        product.isSgr ? "Da" : "Nu",
        product.vatRate ? `${toNumber(product.vatRate.rate)}%` : "Neplatitor",
        exportMoney(product.price),
      ]),
      drawHeader: () => {
        doc.font(fonts.bold).fontSize(11).fillColor("#17324D").text("NOMENCLATOR PRODUSE - continuare", 36, 36)
        return 58
      },
    })
    doc.end()
  } catch (error) {
    console.error("PRODUCTS PDF EXPORT ERROR:", error)
    if (!res.headersSent) res.status(400).json({ ok: false, error: getErrorMessage(error, "Nu am putut exporta produsele in PDF.") })
  }
})

router.get("/api/v1/products/next-sku", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })

  try {
    const preview = await getNextAvailableProductSkuValue(prisma, tenantId, companyId)
    res.json({ ok: true, sku: preview.sku })
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: getErrorMessage(e, "Nu pot genera urmatorul SKU.") })
  }
})

router.get("/api/v1/products/nc-suggest", async (req: AuthedRequest, res) => {
  const name = String(req.query.name || "").trim()
  if (!name) {
    return res.status(400).json({ ok: false, error: "Scrie numele produsului pentru sugestie." })
  }

  const suggestions = suggestNcCodes(name)
  return res.json({
    ok: true,
    suggestions,
    best: suggestions[0] || null,
  })
})

router.post("/api/v1/products", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })

  const company = await resolveRequestCompany(req, {
    select: {
      isVatPayer: true
    }
  })

  const isVatPayer = company?.isVatPayer ?? true

  const name = String(req.body?.name || "").trim()
  const imageUrl = normalizeImageUrl(req.body?.imageUrl, normalizeStoredUploadUrl)
  const vatRateIdRaw = String(req.body?.vatRateId || "").trim()
  const vatRateId = isVatPayer ? vatRateIdRaw : null
  const uomId = String(req.body?.uomId || "").trim()
  const purchaseUomIdRaw = String(req.body?.purchaseUomId || "").trim()
  const purchaseUomId = purchaseUomIdRaw || null
  const purchaseFactor = toNumber(req.body?.purchaseFactor || 1)
  const price = toNumber(req.body?.price || 0)
  const costPrice = toNumber(req.body?.costPrice || 0)
  const netWeightKg = Math.max(0, toNumber(req.body?.netWeightKg || 0))
  const grossWeightKg = Math.max(0, toNumber(req.body?.grossWeightKg || 0))
  const categoryIdRaw = String(req.body?.categoryId || "").trim()
  const categoryId = categoryIdRaw || null
  const departmentIdRaw = String(req.body?.departmentId || "").trim()
  const requestedDepartmentId = departmentIdRaw || null
  const ncCode = toNullableText(req.body?.ncCode)?.toUpperCase() || null
  const requestedSku = String(req.body?.sku || "").trim()
  const classValue = String(req.body?.class || "MARFA").trim() as ProductClass
  const normalizedPurchaseUomId = classValue === "PRODUS_FIN" ? uomId : purchaseUomId
  const normalizedPurchaseFactor = classValue === "PRODUS_FIN" ? 1 : purchaseFactor
  let productionMode = normalizeProductionMode(req.body?.productionMode || "AUTO") as ProductionMode | null
  const trackLot = Boolean(req.body?.trackLot)
  const trackExpiry = Boolean(req.body?.trackExpiry)
  let costMethod = normalizeStockCostMethod(req.body?.costMethod || "AVG") as StockCostMethod | null
  const requestedIsActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive)
  const requestedRequiresRecipe =
    req.body?.requiresRecipe === undefined
      ? RECIPE_REQUIRED_CLASSES.includes(classValue as (typeof RECIPE_REQUIRED_CLASSES)[number])
      : Boolean(req.body?.requiresRecipe)
  const requestedVisibleInPos =
    req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)
  const requestedIsSgr = req.body?.isSgr === undefined ? false : Boolean(req.body?.isSgr)
  const requestedIsFiscalRiskProduct =
    req.body?.isFiscalRiskProduct === undefined ? false : Boolean(req.body?.isFiscalRiskProduct)
  const requestedIsMenu = normalizeBoolean(req.body?.isMenu, false)
  const requestedPublishToGlovo = normalizeBoolean(req.body?.publishToGlovo, false)
  const terminalIds = await resolveProductTerminalIds(tenantId, companyId, req.body)
  const requestedPosMenuCategory = toNullableText(req.body?.posMenuCategory)
  const posMenuCategory = requestedIsMenu ? requestedPosMenuCategory : null
  const posSortOrder = normalizeProductPosSortOrder(req.body?.posSortOrder)
  const requestedBarcodes = normalizeBarcodeList(req.body?.barcodes ?? req.body?.barcode)
  const requestedCrossSellProductIds = normalizeCrossSellProductIds(req.body?.crossSellProductIds)

  if (!ALL_PRODUCT_CLASSES.includes(classValue)) {
    return res.status(400).json({ ok: false, error: "Clasificare produs invalida." })
  }

  if (!productionMode) {
    return res.status(400).json({ ok: false, error: "Mod de productie invalid." })
  }

  if (!costMethod) {
    return res.status(400).json({ ok: false, error: "Metoda de cost este invalida." })
  }

  const finalProductionMode = productionMode
  const finalCostMethod = costMethod

  if (trackExpiry && !trackLot) {
    return res.status(400).json({ ok: false, error: "Pentru urmarirea expirarii trebuie activata si urmarirea pe lot." })
  }

  if (costMethod === "FEFO" && !trackExpiry) {
    return res.status(400).json({ ok: false, error: "FEFO necesita urmarire expirare activa pe produs." })
  }

  const { price: normalizedPrice, isVisibleInPos, isSgr } = normalizeProductFlags(classValue, {
    price,
    isVisibleInPos: requestedVisibleInPos,
    isSgr: requestedIsSgr
  })
  const sgrPackaging = resolveSgrPackagingData(req.body, isSgr)

  if (sgrPackaging.error) {
    return res.status(400).json({ ok: false, error: sgrPackaging.error })
  }

  console.log("[PRODUCT_CREATE] normalized", {
    classValue,
    received: {
      sku: req.body?.sku,
      name: req.body?.name,
      price: req.body?.price,
      costPrice: req.body?.costPrice,
      isVisibleInPos: req.body?.isVisibleInPos,
      isSgr: req.body?.isSgr
    },
    parsed: {
      price,
      costPrice,
      requestedVisibleInPos,
      requestedIsSgr
    },
    normalized: {
      normalizedPrice,
      isVisibleInPos,
      isSgr
    }
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

  if (requestedIsMenu && !posMenuCategory) {
    return res.status(400).json({ ok: false, error: "Categoria de meniu POS este obligatorie pentru articolele de tip meniu." })
  }

  if (normalizedPurchaseFactor <= 0) {
    return res.status(400).json({ ok: false, error: "Factorul trebuie sa fie mai mare decat 0." })
  }

  if (requestedIsFiscalRiskProduct) {
    if (!ncCode) {
      return res.status(400).json({ ok: false, error: "Codul NC este obligatoriu pentru bunurile cu risc fiscal ridicat." })
    }
    if (netWeightKg <= 0) {
      return res.status(400).json({ ok: false, error: "Greutatea neta / UM trebuie sa fie mai mare decat 0 pentru bunurile cu risc fiscal ridicat." })
    }
    if (grossWeightKg <= 0) {
      return res.status(400).json({ ok: false, error: "Greutatea bruta / UM trebuie sa fie mai mare decat 0 pentru bunurile cu risc fiscal ridicat." })
    }
  }

  const [vatRate, fallbackVatRate, uom, purchaseUom, category, department, crossSellProducts] = await Promise.all([
    vatRateId
      ? prisma.vatRate.findFirst({
          where: {
            id: vatRateId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    !isVatPayer
      ? prisma.vatRate.findFirst({
          where: {
            ...buildCompanyScopedTenantWhere(tenantId, companyId),
            rate: 0,
            isActive: true
          }
        })
      : Promise.resolve(null),
    prisma.uom.findFirst({
      where: {
        id: uomId,
        ...buildCompanyScopedTenantWhere(tenantId, companyId)
      }
    }),
    normalizedPurchaseUomId
      ? prisma.uom.findFirst({
          where: {
            id: normalizedPurchaseUomId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    categoryId
      ? prisma.category.findFirst({
          where: {
            id: categoryId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          },
          include: {
            department: true,
            parentCategory: {
              select: {
                id: true,
                name: true,
              },
            },
          }
        })
      : Promise.resolve(null),
    requestedDepartmentId
      ? prisma.department.findFirst({
          where: {
            id: requestedDepartmentId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    requestedCrossSellProductIds.length
      ? prisma.product.findMany({
          where: {
            id: { in: requestedCrossSellProductIds },
            tenantId,
            companyId,
            isActive: true,
          },
          select: { id: true },
        })
      : Promise.resolve([])
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

    if (category?.parentCategory?.id && category.parentCategory.id === category.id) {
      return res.status(400).json({ ok: false, error: "Subcategoria selectata este invalida." })
    }

  if (requestedDepartmentId && !department) {
    return res.status(404).json({ ok: false, error: "Departamentul nu exista." })
  }

  if (crossSellProducts.length !== requestedCrossSellProductIds.length) {
    return res.status(400).json({ ok: false, error: "Unele produse cross-sell nu exista sau nu apartin companiei active." })
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
      const forcedInactiveBecauseMissingRecipe = requestedRequiresRecipe

      const resolvedDepartmentId = category?.departmentId || department?.id || null

      const created = await tx.product.create({
        data: {
          tenantId,
          companyId,
          sku: finalSku,
          name,
          imageUrl,
          class: classValue,
          vatRateId: vatRate?.id || fallbackVatRate?.id || vatRateIdRaw,
          uomId,
          purchaseUomId: normalizedPurchaseUomId || uomId,
          purchaseFactor: normalizedPurchaseFactor,
          categoryId,
          departmentId: resolvedDepartmentId,
          ncCode: requestedIsFiscalRiskProduct ? ncCode : null,
          isFiscalRiskProduct: requestedIsFiscalRiskProduct,
          netWeightKg: requestedIsFiscalRiskProduct ? netWeightKg : 0,
          grossWeightKg: requestedIsFiscalRiskProduct ? grossWeightKg : 0,
          price: normalizedPrice,
          costPrice,
          trackLot,
          trackExpiry,
          costMethod: finalCostMethod,
          requiresRecipe: requestedRequiresRecipe,
          posSortOrder,
          isActive: forcedInactiveBecauseMissingRecipe ? false : requestedIsActive,
          isMenu: requestedIsMenu,
          posMenuCategory,
          isVisibleInPos,
          publishToGlovo: requestedPublishToGlovo,
          isSgr,
          sgrValue: isSgr ? 0.5 : 0,
          sgrPackagingType: sgrPackaging.sgrPackagingType,
          sgrVolumeLiters: sgrPackaging.sgrVolumeLiters,
          productionMode: finalProductionMode
        },
      })

      if (terminalIds.length) {
        await tx.terminalProductAccess.createMany({
          data: terminalIds.map((terminalId) => ({
            terminalId,
            productId: created.id,
          })),
        })
      }

      if (requestedBarcodes.length) {
        const duplicateBarcode = await tx.productBarcode.findFirst({
          where: {
            tenantId,
            barcode: { in: requestedBarcodes },
          },
          select: {
            barcode: true,
          },
        })

        if (duplicateBarcode) {
          throw new Error(`Codul de bare ${duplicateBarcode.barcode} este deja folosit pe alt produs.`)
        }

        await tx.productBarcode.createMany({
          data: requestedBarcodes.map((barcode) => ({
            tenantId,
            productId: created.id,
            barcode,
          })),
        })
      }

      if (requestedCrossSellProductIds.length) {
        await tx.productCrossSell.createMany({
          data: requestedCrossSellProductIds
            .filter((targetProductId) => targetProductId != created.id)
            .map((targetProductId, index) => ({
              tenantId,
              sourceProductId: created.id,
              targetProductId,
              sortOrder: index + 1,
            })),
        })
      }

      const withBarcodes = await tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          vatRate: true,
          uom: true,
          purchaseUom: true,
          department: true,
          terminalAccesses: {
            select: {
              terminalId: true,
            },
          },
          barcodes: {
            orderBy: { createdAt: "asc" }
          },
          category: {
            include: {
              department: true,
              parentCategory: {
                select: {
                  id: true,
                  name: true,
                },
              },
            }
          },
          crossSellLinks: {
            include: {
              targetProduct: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          recipe: {
            include: {
              items: true
            }
          }
        }
      })

      return {
        ...withBarcodes,
        forcedInactiveBecauseMissingRecipe
      }
    })

    console.log("[PRODUCT_CREATE] saved", {
      id: item.id,
      sku: item.sku,
      class: item.class,
      price: item.price,
      costPrice: item.costPrice,
      isVisibleInPos: item.isVisibleInPos,
      isSgr: item.isSgr
    })

    res.json({ ok: true, item: serializeProduct(item) })
  } catch (e: unknown) {
    console.error("[PRODUCT_CREATE] error", e)
    res.status(400).json({ ok: false, error: getErrorMessage(e, "Nu am putut salva produsul.") })
  }
})

router.put("/api/v1/products/:id", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const id = String(req.params.id)

  const company = await resolveRequestCompany(req, {
    select: {
      isVatPayer: true
    }
  })

  const isVatPayer = company?.isVatPayer ?? true

  const name = String(req.body?.name || "").trim()
  const requestedImageUrl = normalizeImageUrl(req.body?.imageUrl, normalizeStoredUploadUrl)
  const vatRateIdRaw = String(req.body?.vatRateId || "").trim()
  const vatRateId = isVatPayer ? vatRateIdRaw : null
  const uomId = String(req.body?.uomId || "").trim()
  const purchaseUomIdRaw = String(req.body?.purchaseUomId || "").trim()
  const purchaseUomId = purchaseUomIdRaw || null
  const purchaseFactor = toNumber(req.body?.purchaseFactor || 1)
  const price = toNumber(req.body?.price || 0)
  const costPrice = toNumber(req.body?.costPrice || 0)
  const netWeightKg = Math.max(0, toNumber(req.body?.netWeightKg || 0))
  const grossWeightKg = Math.max(0, toNumber(req.body?.grossWeightKg || 0))
  const categoryIdRaw = String(req.body?.categoryId || "").trim()
  const categoryId = categoryIdRaw || null
  const departmentIdRaw = String(req.body?.departmentId || "").trim()
  const requestedDepartmentId = departmentIdRaw || null
  const ncCode = toNullableText(req.body?.ncCode)?.toUpperCase() || null
  const classValue = String(req.body?.class || "MARFA").trim() as ProductClass
  const normalizedPurchaseUomId = classValue === "PRODUS_FIN" ? uomId : purchaseUomId
  const normalizedPurchaseFactor = classValue === "PRODUS_FIN" ? 1 : purchaseFactor
  let productionMode = normalizeProductionMode(req.body?.productionMode || "AUTO") as ProductionMode | null
  const trackLot = Boolean(req.body?.trackLot)
  const trackExpiry = Boolean(req.body?.trackExpiry)
  let costMethod = normalizeStockCostMethod(req.body?.costMethod ?? "AVG") as StockCostMethod | null
  const requestedIsActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive)
  const requestedRequiresRecipe =
    req.body?.requiresRecipe === undefined ? undefined : Boolean(req.body?.requiresRecipe)
  const requestedVisibleInPos =
    req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)
  const requestedIsSgr = req.body?.isSgr === undefined ? false : Boolean(req.body?.isSgr)
  const requestedIsFiscalRiskProduct =
    req.body?.isFiscalRiskProduct === undefined ? false : Boolean(req.body?.isFiscalRiskProduct)
  const requestedIsMenu = normalizeBoolean(req.body?.isMenu, false)
  const requestedPublishToGlovo = normalizeBoolean(req.body?.publishToGlovo, false)
  const requestedPosMenuCategory = toNullableText(req.body?.posMenuCategory)
  const posMenuCategory = requestedIsMenu ? requestedPosMenuCategory : null
  const requestedPosSortOrder = req.body?.posSortOrder
  const shouldUpdateBarcodes = hasBarcodePayload(req.body as Record<string, unknown> | undefined)
  const requestedBarcodes = normalizeBarcodeList(req.body?.barcodes ?? req.body?.barcode)
  const requestedCrossSellProductIds = normalizeCrossSellProductIds(req.body?.crossSellProductIds)
  const terminalIds = await resolveProductTerminalIds(tenantId, companyId, req.body)

  if (!ALL_PRODUCT_CLASSES.includes(classValue)) {
    return res.status(400).json({ ok: false, error: "Clasificare produs invalida." })
  }

  if (!productionMode) {
    return res.status(400).json({ ok: false, error: "Mod de productie invalid." })
  }

  if (!costMethod) {
    return res.status(400).json({ ok: false, error: "Metoda de cost este invalida." })
  }

  if (trackExpiry && !trackLot) {
    return res.status(400).json({ ok: false, error: "Pentru urmarirea expirarii trebuie activata si urmarirea pe lot." })
  }

  if (costMethod === "FEFO" && !trackExpiry) {
    return res.status(400).json({ ok: false, error: "FEFO necesita urmarire expirare activa pe produs." })
  }

  const { price: normalizedPrice, isVisibleInPos, isSgr } = normalizeProductFlags(classValue, {
    price,
    isVisibleInPos: requestedVisibleInPos,
    isSgr: requestedIsSgr
  })
  const sgrPackaging = resolveSgrPackagingData(req.body, isSgr)

  if (sgrPackaging.error) {
    return res.status(400).json({ ok: false, error: sgrPackaging.error })
  }

  if (!name) {
    return res.status(400).json({ ok: false, error: "Denumirea produsului este obligatorie." })
  }

  if (isVatPayer && !vatRateId) {
    return res.status(400).json({ ok: false, error: "TVA este obligatoriu." })
  }

  if (!uomId) {
    return res.status(400).json({ ok: false, error: "UM este obligatorie." })
  }

  if (requestedIsMenu && !posMenuCategory) {
    return res.status(400).json({ ok: false, error: "Categoria de meniu POS este obligatorie pentru articolele de tip meniu." })
  }

  if (normalizedPurchaseFactor <= 0) {
    return res.status(400).json({ ok: false, error: "Factorul trebuie sa fie mai mare decat 0." })
  }

  if (requestedIsFiscalRiskProduct) {
    if (!ncCode) {
      return res.status(400).json({ ok: false, error: "Codul NC este obligatoriu pentru bunurile cu risc fiscal ridicat." })
    }
    if (netWeightKg <= 0) {
      return res.status(400).json({ ok: false, error: "Greutatea neta / UM trebuie sa fie mai mare decat 0 pentru bunurile cu risc fiscal ridicat." })
    }
    if (grossWeightKg <= 0) {
      return res.status(400).json({ ok: false, error: "Greutatea bruta / UM trebuie sa fie mai mare decat 0 pentru bunurile cu risc fiscal ridicat." })
    }
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

  const imageUrl = mergeImageUrl(requestedImageUrl, current.imageUrl, normalizeStoredUploadUrl)
  const posSortOrder = normalizeProductPosSortOrder(requestedPosSortOrder ?? current.posSortOrder ?? 0)

  productionMode = normalizeProductionMode(
    req.body?.productionMode ?? current.productionMode ?? "AUTO"
  ) as ProductionMode | null
  costMethod = normalizeStockCostMethod(
    req.body?.costMethod ?? current.costMethod ?? "AVG"
  ) as StockCostMethod | null
  const finalRequestedRequiresRecipe =
    requestedRequiresRecipe === undefined ? current.requiresRecipe === true : requestedRequiresRecipe

  if (!productionMode) {
    return res.status(400).json({ ok: false, error: "Mod de productie invalid." })
  }

  if (!costMethod) {
    return res.status(400).json({ ok: false, error: "Metoda de cost este invalida." })
  }

  const finalUpdatedProductionMode = productionMode
  const finalUpdatedCostMethod = costMethod

  const [vatRate, fallbackVatRate, uom, purchaseUom, category, department, existingRecipe, crossSellProducts] = await Promise.all([
    vatRateId
      ? prisma.vatRate.findFirst({
          where: {
            id: vatRateId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    !isVatPayer
      ? prisma.vatRate.findFirst({
          where: {
            ...buildCompanyScopedTenantWhere(tenantId, companyId),
            rate: 0,
            isActive: true
          }
        })
      : Promise.resolve(null),
    prisma.uom.findFirst({
      where: {
        id: uomId,
        ...buildCompanyScopedTenantWhere(tenantId, companyId)
      }
    }),
    normalizedPurchaseUomId
      ? prisma.uom.findFirst({
          where: {
            id: normalizedPurchaseUomId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    categoryId
      ? prisma.category.findFirst({
          where: {
            id: categoryId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          },
          include: {
            department: true,
            parentCategory: {
              select: {
                id: true,
                name: true,
              },
            },
          }
        })
      : Promise.resolve(null),
    requestedDepartmentId
      ? prisma.department.findFirst({
          where: {
            id: requestedDepartmentId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })
      : Promise.resolve(null),
    prisma.recipe.findFirst({
      where: {
        tenantId,
        companyId,
        productId: id
      }
    }),
    requestedCrossSellProductIds.length
      ? prisma.product.findMany({
          where: {
            id: { in: requestedCrossSellProductIds },
            tenantId,
            companyId,
            isActive: true,
          },
          select: { id: true },
        })
      : Promise.resolve([])
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

    if (category?.parentCategory?.id && category.parentCategory.id === category.id) {
      return res.status(400).json({ ok: false, error: "Subcategoria selectata este invalida." })
    }

  if (requestedDepartmentId && !department) {
    return res.status(404).json({ ok: false, error: "Departamentul nu exista." })
  }

  if (requestedCrossSellProductIds.some((productId) => productId === id)) {
    return res.status(400).json({ ok: false, error: "Produsul nu poate avea cross-sell catre el insusi." })
  }

  if (crossSellProducts.length !== requestedCrossSellProductIds.length) {
    return res.status(400).json({ ok: false, error: "Unele produse cross-sell nu exista sau nu apartin companiei active." })
  }

  try {
    const forcedInactiveBecauseMissingRecipe = finalRequestedRequiresRecipe && !existingRecipe

    const resolvedDepartmentId = category?.departmentId || department?.id || null

    const item = await prisma.$transaction(async (tx) => {
      if (shouldUpdateBarcodes) {
        const duplicateBarcode = requestedBarcodes.length
          ? await tx.productBarcode.findFirst({
              where: {
                tenantId,
                barcode: { in: requestedBarcodes },
                productId: { not: id },
              },
              select: {
                barcode: true,
              },
            })
          : null

        if (duplicateBarcode) {
          throw new Error(`Codul de bare ${duplicateBarcode.barcode} este deja folosit pe alt produs.`)
        }
      }

      await tx.product.update({
        where: { id },
        data: {
          name,
          imageUrl,
          class: classValue,
          vatRateId: vatRate?.id || fallbackVatRate?.id || current.vatRateId,
          uomId,
          purchaseUomId: normalizedPurchaseUomId || uomId,
          purchaseFactor: normalizedPurchaseFactor,
          categoryId,
          departmentId: resolvedDepartmentId,
          ncCode: requestedIsFiscalRiskProduct ? ncCode : null,
          isFiscalRiskProduct: requestedIsFiscalRiskProduct,
          netWeightKg: requestedIsFiscalRiskProduct ? netWeightKg : 0,
          grossWeightKg: requestedIsFiscalRiskProduct ? grossWeightKg : 0,
          price: normalizedPrice,
          costPrice,
          trackLot,
          trackExpiry,
          costMethod: finalUpdatedCostMethod,
          requiresRecipe: finalRequestedRequiresRecipe,
          posSortOrder,
          isActive: forcedInactiveBecauseMissingRecipe ? false : requestedIsActive,
          isMenu: requestedIsMenu,
          posMenuCategory,
          isVisibleInPos,
          publishToGlovo: requestedPublishToGlovo,
          isSgr,
          sgrValue: isSgr ? 0.5 : 0,
          sgrPackagingType: sgrPackaging.sgrPackagingType,
          sgrVolumeLiters: sgrPackaging.sgrVolumeLiters,
          productionMode: finalUpdatedProductionMode
        }
      })

      if (shouldUpdateBarcodes) {
        await tx.productBarcode.deleteMany({
          where: {
            tenantId,
            productId: id,
          }
        })

        if (requestedBarcodes.length) {
          await tx.productBarcode.createMany({
            data: requestedBarcodes.map((barcode) => ({
              tenantId,
              productId: id,
              barcode,
            })),
          })
        }
      }

      await tx.terminalProductAccess.deleteMany({
        where: {
          productId: id,
        },
      })

      if (terminalIds.length) {
        await tx.terminalProductAccess.createMany({
          data: terminalIds.map((terminalId) => ({
            terminalId,
            productId: id,
          })),
        })
      }

      await tx.productCrossSell.deleteMany({
        where: {
          sourceProductId: id,
        },
      })

      if (requestedCrossSellProductIds.length) {
        await tx.productCrossSell.createMany({
          data: requestedCrossSellProductIds.map((targetProductId, index) => ({
            tenantId,
            sourceProductId: id,
            targetProductId,
            sortOrder: index + 1,
          })),
        })
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          vatRate: true,
          uom: true,
          purchaseUom: true,
          department: true,
          barcodes: {
            orderBy: { createdAt: "asc" }
          },
          terminalAccesses: {
            select: {
              terminalId: true,
            },
          },
          category: {
            include: {
              department: true,
              parentCategory: {
                select: {
                  id: true,
                  name: true,
                },
              },
            }
          },
          crossSellLinks: {
            include: {
              targetProduct: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          recipe: {
            include: {
              items: true
            }
          }
        }
      })
    })

    console.log("[PRODUCT_UPDATE] saved", {
      id,
      class: item.class,
      price: item.price,
      costPrice: item.costPrice,
      isVisibleInPos: item.isVisibleInPos,
      isSgr: item.isSgr
    })

    res.json({
      ok: true,
      item: {
        ...serializeProduct(item),
        forcedInactiveBecauseMissingRecipe
      }
    })
  } catch (e: unknown) {
    console.error("[PRODUCT_UPDATE] error", e)
    res.status(400).json({ ok: false, error: "Nu am putut actualiza produsul." })
  }
})

router.get("/api/v1/products/:id/recipe", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
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
    recipe: serializeRecipe(recipe)
  })
})

router.post("/api/v1/products/:id/recipe", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
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
  const status = String(req.body?.status || "DRAFT").trim() as RecipeStatus
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
  }> = itemsRaw.map((line: RecipeInputItemLike, index: number) => ({
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

  const allowedIngredientClasses: readonly string[] = product.isMenu === true
    ? MENU_COMPONENT_CLASSES
    : RECIPE_INGREDIENT_CLASSES

  const invalidIngredient = ingredients.find(
    (ingredient) => !allowedIngredientClasses.includes(String(ingredient.class))
  )

  if (invalidIngredient) {
    return res.status(400).json({
      ok: false,
      error:
        product.isMenu === true
          ? "In meniuri sunt permise doar produse din clasele PRODUS_FIN, MARFA sau SEMIFABRICATE."
          : "In retetar sunt permise doar ingrediente din clasele MATERIE_PRIMA, MARFA sau SEMIFABRICATE."
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
              status,
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
              status,
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
      recipe: serializeRecipe(recipe),
      productActivated: activateProduct
    })
  } catch (e: unknown) {
    return res.status(400).json({
      ok: false,
      error: getErrorMessage(e, "Nu am putut salva retetarul.")
    })
  }
})

router.delete("/api/v1/products/:id", async (req: AuthedRequest, res) => {
  const { tenantId } = getScopedAuth(req)
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
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












