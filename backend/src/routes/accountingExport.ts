// @ts-nocheck
import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompany, requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

const CONFIG_DEFAULTS = {
  exportTarget: "SAGA",
  articleCodeSource: "SKU",
  managementAnalytic: "LOCATION_CODE",
  customerAccount: "4111",
  supplierAccount: "401",
  salesAccount: "707",
  expenseAccount: "607",
  inventoryAccount: "371",
  vatCollectedAccount: "4427",
  vatDeductibleAccount: "4426",
  cashAccount: "5311",
  cardAccount: "5121",
}

const DEFAULT_STOCK_TYPES = [
  {
    code: "MARFA",
    name: "Marfa",
    inventoryAccount: "371",
    expenseAccount: "607",
    salesAccount: "707",
    analyticMode: "LOCATION_CODE",
    isDefault: true,
  },
  {
    code: "MATERII",
    name: "Materii prime",
    inventoryAccount: "301",
    expenseAccount: "601",
    salesAccount: "701",
    analyticMode: "LOCATION_CODE",
    isDefault: false,
  },
  {
    code: "PRODUSE",
    name: "Produse finite",
    inventoryAccount: "345",
    expenseAccount: "711",
    salesAccount: "701",
    analyticMode: "LOCATION_CODE",
    isDefault: false,
  },
  {
    code: "AMBALAJE",
    name: "Ambalaje si consumabile",
    inventoryAccount: "381",
    expenseAccount: "6028",
    salesAccount: "708",
    analyticMode: "LOCATION_CODE",
    isDefault: false,
  },
]

const UpdateConfigSchema = z.object({
  articleCodeSource: z.string().min(2),
  managementAnalytic: z.string().min(2),
  customerAccount: z.string().min(2),
  supplierAccount: z.string().min(2),
  salesAccount: z.string().min(2),
  expenseAccount: z.string().min(2),
  inventoryAccount: z.string().min(2),
  vatCollectedAccount: z.string().min(2),
  vatDeductibleAccount: z.string().min(2),
  cashAccount: z.string().min(2),
  cardAccount: z.string().min(2),
  defaultStockTypeId: z.string().optional().nullable(),
})

const StockTypeSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  inventoryAccount: z.string().min(2),
  expenseAccount: z.string().min(2),
  salesAccount: z.string().optional().nullable(),
  analyticMode: z.string().min(2).default("LOCATION_CODE"),
  isDefault: z.boolean().optional(),
})

const ProductAccountingSchema = z.object({
  accountingItemCode: z.string().trim().max(40).optional().nullable(),
  accountingStockTypeId: z.string().trim().optional().nullable(),
})

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const year = `${date.getFullYear()}`
  return `${day}.${month}.${year}`
}

function decimal(value: unknown, digits = 2) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits)
}

function slugCode(value: string, fallback = "COD") {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
      .slice(0, 20) || fallback
  )
}

function mapProductClassToDefaultCode(productClass?: string | null) {
  switch (productClass) {
    case "MARFA":
      return "MARFA"
    case "MATERIE_PRIMA":
    case "CONSUMABILE":
    case "ALTE_MATERIALE":
      return "MATERII"
    case "AMBALAJE":
      return "AMBALAJE"
    case "PRODUS_FIN":
    case "SEMIFABRICATE":
    case "REZIDUALE":
    default:
      return "PRODUSE"
  }
}

async function ensureDefaultStockTypes(tenantId: string, companyId: string) {
  const existing = await prisma.accountingStockType.findMany({
    where: { tenantId, companyId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  })

  if (existing.length) return existing

  await prisma.accountingStockType.createMany({
    data: DEFAULT_STOCK_TYPES.map((item) => ({
      tenantId,
      companyId,
      ...item,
    })),
  })

  return prisma.accountingStockType.findMany({
    where: { tenantId, companyId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  })
}

async function ensureAccountingConfig(tenantId: string, companyId: string) {
  let stockTypes = await ensureDefaultStockTypes(tenantId, companyId)
  let config = await prisma.accountingExportConfig.findUnique({
    where: { companyId },
  })

  if (!config) {
    config = await prisma.accountingExportConfig.create({
      data: {
        tenantId,
        companyId,
        ...CONFIG_DEFAULTS,
        defaultStockTypeId: stockTypes.find((item) => item.isDefault)?.id || stockTypes[0]?.id || null,
      },
    })
  }

  return { config, stockTypes }
}

function pickStockType(product: any, stockTypes: any[], config: any) {
  if (product?.accountingStockTypeId) {
    const matched = stockTypes.find((item) => item.id === product.accountingStockTypeId)
    if (matched) return matched
  }

  const byClass = stockTypes.find((item) => item.code === mapProductClassToDefaultCode(product?.class))
  if (byClass) return byClass

  if (config?.defaultStockTypeId) {
    const fromConfig = stockTypes.find((item) => item.id === config.defaultStockTypeId)
    if (fromConfig) return fromConfig
  }

  return stockTypes[0] || null
}

function downloadName(kind: string, from: string, to: string) {
  const safeKind = slugCode(kind, "EXPORT")
  const fromChunk = from ? from.replace(/[^0-9]/g, "") : "ALL"
  const toChunk = to ? to.replace(/[^0-9]/g, "") : "ALL"
  return `saga_${safeKind}_${fromChunk}_${toChunk}.xml`
}

function managementValue(config: any, location: { code?: string | null; name?: string | null } | null | undefined) {
  if (!location) return ""
  switch (config?.managementAnalytic) {
    case "LOCATION_NAME":
      return location.name || ""
    case "NONE":
      return ""
    case "LOCATION_CODE":
    default:
      return location.code || location.name || ""
  }
}

router.get("/api/v1/reports/accounting/saga/config", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const company = await requireRequestCompany(req)
  const companyId = company.id
  const { config, stockTypes } = await ensureAccountingConfig(tenantId, companyId)

  const [locations, vatRates] = await Promise.all([
    prisma.location.findMany({
      where: { tenantId, companyId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.vatRate.findMany({
      where: { tenantId, companyId, isActive: true },
      orderBy: { rate: "asc" },
      select: { id: true, name: true, rate: true, fiscalCode: true },
    }),
  ])

  return res.json({
    ok: true,
    item: {
      company: {
        id: company.id,
        name: company.name,
        code: company.code,
      },
      config,
      stockTypes,
      locations,
      vatRates,
      exportKinds: [
        { code: "products", label: "Articole" },
        { code: "customers", label: "Clienti" },
        { code: "suppliers", label: "Furnizori" },
        { code: "sales-invoices", label: "Facturi iesire" },
        { code: "purchase-receipts", label: "NIR / intrari" },
        { code: "consumption-docs", label: "Bonuri de consum" },
        { code: "production-docs", label: "Productie" },
      ],
    },
  })
})

router.patch("/api/v1/reports/accounting/saga/config", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = UpdateConfigSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  await ensureAccountingConfig(tenantId, companyId)

  const updated = await prisma.accountingExportConfig.update({
    where: { companyId },
    data: parsed.data,
  })

  return res.json({ ok: true, item: updated })
})

router.post("/api/v1/reports/accounting/saga/stock-types", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = StockTypeSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const data = parsed.data

  if (data.isDefault) {
    await prisma.accountingStockType.updateMany({
      where: { tenantId, companyId },
      data: { isDefault: false },
    })
  }

  const created = await prisma.accountingStockType.create({
    data: {
      tenantId,
      companyId,
      code: slugCode(data.code),
      name: data.name.trim(),
      inventoryAccount: data.inventoryAccount.trim(),
      expenseAccount: data.expenseAccount.trim(),
      salesAccount: data.salesAccount?.trim() || null,
      analyticMode: data.analyticMode.trim(),
      isDefault: Boolean(data.isDefault),
    },
  })

  return res.status(201).json({ ok: true, item: created })
})

router.patch("/api/v1/reports/accounting/saga/stock-types/:id", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = StockTypeSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const existing = await prisma.accountingStockType.findFirst({
    where: { id: req.params.id, tenantId, companyId },
  })

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Tipul de stoc nu exista." })
  }

  if (parsed.data.isDefault) {
    await prisma.accountingStockType.updateMany({
      where: { tenantId, companyId },
      data: { isDefault: false },
    })
  }

  const updated = await prisma.accountingStockType.update({
    where: { id: existing.id },
    data: {
      code: slugCode(parsed.data.code),
      name: parsed.data.name.trim(),
      inventoryAccount: parsed.data.inventoryAccount.trim(),
      expenseAccount: parsed.data.expenseAccount.trim(),
      salesAccount: parsed.data.salesAccount?.trim() || null,
      analyticMode: parsed.data.analyticMode.trim(),
      isDefault: Boolean(parsed.data.isDefault),
    },
  })

  return res.json({ ok: true, item: updated })
})

router.get("/api/v1/reports/accounting/saga/products", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const search = String(req.query.search || "").trim()

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      companyId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
              { accountingItemCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      vatRate: { select: { rate: true, fiscalCode: true, name: true } },
      uom: { select: { code: true, name: true } },
      accountingStockType: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ name: "asc" }],
    take: 150,
  })

  return res.json({ ok: true, items: products })
})

router.patch("/api/v1/reports/accounting/saga/products/:id", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = ProductAccountingSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const product = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId, companyId },
  })

  if (!product) {
    return res.status(404).json({ ok: false, error: "Produsul nu exista." })
  }

  if (parsed.data.accountingStockTypeId) {
    const stockType = await prisma.accountingStockType.findFirst({
      where: {
        id: parsed.data.accountingStockTypeId,
        tenantId,
        companyId,
      },
    })
    if (!stockType) {
      return res.status(400).json({ ok: false, error: "Tipul de stoc selectat nu exista." })
    }
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      accountingItemCode: parsed.data.accountingItemCode || null,
      accountingStockTypeId: parsed.data.accountingStockTypeId || null,
    },
    include: {
      accountingStockType: { select: { id: true, code: true, name: true } },
      vatRate: { select: { rate: true, fiscalCode: true, name: true } },
      uom: { select: { code: true, name: true } },
    },
  })

  return res.json({ ok: true, item: updated })
})

router.get("/api/v1/reports/accounting/saga/export", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const company = await requireRequestCompany(req)
  const companyId = company.id
  const kind = String(req.query.kind || "").trim().toLowerCase()
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date("2000-01-01T00:00:00")
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date()

  const { config, stockTypes } = await ensureAccountingConfig(tenantId, companyId)
  let xml = ""

  if (kind === "products") {
    const products = await prisma.product.findMany({
      where: { tenantId, companyId, isActive: true },
      include: {
        vatRate: true,
        uom: true,
        accountingStockType: true,
      },
      orderBy: { name: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Articole">`,
      `  <Articole>`,
      ...products.map((product) => {
        const stockType = pickStockType(product, stockTypes, config)
        const articleCode =
          config.articleCodeSource === "SKU"
            ? product.sku
            : product.accountingItemCode || product.sku

        return [
          `    <Articol>`,
          `      <Cod>${xmlEscape(articleCode)}</Cod>`,
          `      <Denumire>${xmlEscape(product.name)}</Denumire>`,
          `      <UM>${xmlEscape(product.uom?.code || "BUC")}</UM>`,
          `      <CotaTVA>${xmlEscape(product.vatRate?.rate ?? 0)}</CotaTVA>`,
          `      <CodTVA>${xmlEscape(product.vatRate?.fiscalCode || "")}</CodTVA>`,
          `      <TipStoc>${xmlEscape(stockType?.name || "")}</TipStoc>`,
          `      <ContStoc>${xmlEscape(stockType?.inventoryAccount || config.inventoryAccount)}</ContStoc>`,
          `      <ContCheltuiala>${xmlEscape(stockType?.expenseAccount || config.expenseAccount)}</ContCheltuiala>`,
          `      <ContVenit>${xmlEscape(stockType?.salesAccount || config.salesAccount)}</ContVenit>`,
          `      <PretVanzare>${decimal(product.price)}</PretVanzare>`,
          `    </Articol>`,
        ].join("\n")
      }),
      `  </Articole>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "customers") {
    const customers = await prisma.customer.findMany({
      where: { tenantId, companyId, isActive: true },
      orderBy: { name: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Clienti">`,
      `  <Clienti>`,
      ...customers.map((customer) =>
        [
          `    <Client>`,
          `      <Cod>${xmlEscape(customer.code || slugCode(customer.name, "CLI"))}</Cod>`,
          `      <Denumire>${xmlEscape(customer.name)}</Denumire>`,
          `      <CIF>${xmlEscape(customer.cif || "")}</CIF>`,
          `      <RegCom>${xmlEscape(customer.regNo || "")}</RegCom>`,
          `      <Adresa>${xmlEscape(customer.address || "")}</Adresa>`,
          `      <Telefon>${xmlEscape(customer.phone || "")}</Telefon>`,
          `      <Email>${xmlEscape(customer.email || "")}</Email>`,
          `      <Cont>${xmlEscape(config.customerAccount)}</Cont>`,
          `    </Client>`,
        ].join("\n")
      ),
      `  </Clienti>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "suppliers") {
    const suppliers = await prisma.supplier.findMany({
      where: { tenantId, companyId, isActive: true },
      orderBy: { name: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Furnizori">`,
      `  <Furnizori>`,
      ...suppliers.map((supplier) =>
        [
          `    <Furnizor>`,
          `      <Cod>${xmlEscape(supplier.code || slugCode(supplier.name, "FUR"))}</Cod>`,
          `      <Denumire>${xmlEscape(supplier.name)}</Denumire>`,
          `      <CIF>${xmlEscape(supplier.cif || "")}</CIF>`,
          `      <RegCom>${xmlEscape(supplier.regCom || "")}</RegCom>`,
          `      <Adresa>${xmlEscape(supplier.address || "")}</Adresa>`,
          `      <Telefon>${xmlEscape(supplier.phone || "")}</Telefon>`,
          `      <Email>${xmlEscape(supplier.email || "")}</Email>`,
          `      <Cont>${xmlEscape(config.supplierAccount)}</Cont>`,
          `    </Furnizor>`,
        ].join("\n")
      ),
      `  </Furnizori>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "sales-invoices") {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        tenantId,
        companyId,
        status: "ISSUED",
        docDate: { gte: from, lte: to },
      },
      include: {
        location: true,
        items: true,
      },
      orderBy: { docDate: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Iesiri">`,
      `  <Iesiri>`,
      ...invoices.map((invoice) =>
        [
          `    <Iesire>`,
          `      <Numar>${xmlEscape(invoice.docNo)}</Numar>`,
          `      <Data>${xmlEscape(formatDate(invoice.docDate))}</Data>`,
          `      <Scadenta>${xmlEscape(formatDate(invoice.dueDate || invoice.docDate))}</Scadenta>`,
          `      <Client>${xmlEscape(invoice.customerName)}</Client>`,
          `      <CIF>${xmlEscape(invoice.customerCif || "")}</CIF>`,
          `      <Gestiune>${xmlEscape(invoice.location?.code || invoice.location?.name || "")}</Gestiune>`,
          `      <ContClient>${xmlEscape(config.customerAccount)}</ContClient>`,
          `      <ContVenit>${xmlEscape(config.salesAccount)}</ContVenit>`,
          `      <ContTVA>${xmlEscape(config.vatCollectedAccount)}</ContTVA>`,
          `      <Valoare>${decimal(invoice.totalNetRon)}</Valoare>`,
          `      <TVA>${decimal(invoice.totalVatRon)}</TVA>`,
          `      <Total>${decimal(invoice.totalGrossRon)}</Total>`,
          `      <Linii>`,
          ...invoice.items.map((line) =>
            [
              `        <Linie>`,
              `          <Cod>${xmlEscape(line.productCode || slugCode(line.productName, "ART"))}</Cod>`,
              `          <Denumire>${xmlEscape(line.productName)}</Denumire>`,
              `          <UM>${xmlEscape(line.uomCode || "BUC")}</UM>`,
              `          <Cantitate>${decimal(line.qty, 3)}</Cantitate>`,
              `          <Pret>${decimal(line.unitPriceFc)}</Pret>`,
              `          <CotaTVA>${decimal(line.vatRateValue)}</CotaTVA>`,
              `          <Valoare>${decimal(line.lineNetRon)}</Valoare>`,
              `        </Linie>`,
            ].join("\n")
          ),
          `      </Linii>`,
          `    </Iesire>`,
        ].join("\n")
      ),
      `  </Iesiri>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "purchase-receipts") {
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        tenantId,
        companyId,
        status: "POSTED",
        docDate: { gte: from, lte: to },
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                accountingStockType: true,
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Intrari">`,
      `  <Intrari>`,
      ...receipts.map((receipt) =>
        [
          `    <Intrare>`,
          `      <Numar>${xmlEscape(receipt.docNo)}</Numar>`,
          `      <Data>${xmlEscape(formatDate(receipt.docDate))}</Data>`,
          `      <Furnizor>${xmlEscape(receipt.supplierName || "")}</Furnizor>`,
          `      <CIF>${xmlEscape(receipt.supplier?.cif || "")}</CIF>`,
          `      <Gestiune>${xmlEscape(receipt.location?.code || receipt.location?.name || "")}</Gestiune>`,
          `      <ContFurnizor>${xmlEscape(config.supplierAccount)}</ContFurnizor>`,
          `      <ContTVA>${xmlEscape(config.vatDeductibleAccount)}</ContTVA>`,
          `      <Valoare>${decimal(receipt.totalNetRon)}</Valoare>`,
          `      <TVA>${decimal(receipt.totalVatRon)}</TVA>`,
          `      <Total>${decimal(receipt.totalGrossRon)}</Total>`,
          `      <Linii>`,
          ...receipt.items.map((line) => {
            const stockType = pickStockType(line.product, stockTypes, config)
            return [
              `        <Linie>`,
              `          <Cod>${xmlEscape(line.product?.accountingItemCode || line.product?.sku || slugCode(line.product?.name || "ART", "ART"))}</Cod>`,
              `          <Denumire>${xmlEscape(line.product?.name || "")}</Denumire>`,
              `          <Cantitate>${decimal(line.stockQty || line.qty, 3)}</Cantitate>`,
              `          <Pret>${decimal(line.unitCostNetRon)}</Pret>`,
              `          <CotaTVA>${decimal(line.vatRateValue)}</CotaTVA>`,
              `          <ContStoc>${xmlEscape(stockType?.inventoryAccount || config.inventoryAccount)}</ContStoc>`,
              `          <ContCheltuiala>${xmlEscape(stockType?.expenseAccount || config.expenseAccount)}</ContCheltuiala>`,
              `        </Linie>`,
            ].join("\n")
          }),
          `      </Linii>`,
          `    </Intrare>`,
        ].join("\n")
      ),
      `  </Intrari>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "consumption-docs") {
    const documents = await prisma.consumptionDoc.findMany({
      where: {
        tenantId,
        companyId,
        docDate: { gte: from, lte: to },
      },
      include: {
        location: true,
        items: {
          include: {
            ingredient: {
              include: {
                accountingStockType: true,
                uom: true,
                vatRate: true,
              },
            },
            finishedProduct: {
              include: {
                accountingStockType: true,
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="BonuriConsum">`,
      `  <BonuriConsum>`,
      ...documents.map((document) =>
        [
          `    <BonConsum>`,
          `      <Numar>${xmlEscape(document.docNo)}</Numar>`,
          `      <Data>${xmlEscape(formatDate(document.docDate))}</Data>`,
          `      <Gestiune>${xmlEscape(managementValue(config, document.location))}</Gestiune>`,
          `      <Explicatie>${xmlEscape(document.note || "Bon de consum")}</Explicatie>`,
          `      <Linii>`,
          ...document.items.map((line) => {
            const stockType = pickStockType(line.ingredient, stockTypes, config)
            return [
              `        <Linie>`,
              `          <Cod>${xmlEscape(line.ingredient.accountingItemCode || line.ingredient.sku || slugCode(line.ingredient.name, "ART"))}</Cod>`,
              `          <Denumire>${xmlEscape(line.ingredient.name)}</Denumire>`,
              `          <UM>${xmlEscape(line.ingredient.uom?.code || "BUC")}</UM>`,
              `          <Cantitate>${decimal(line.qty, 3)}</Cantitate>`,
              `          <ContCheltuiala>${xmlEscape(stockType?.expenseAccount || config.expenseAccount)}</ContCheltuiala>`,
              `          <ContStoc>${xmlEscape(stockType?.inventoryAccount || config.inventoryAccount)}</ContStoc>`,
              `          <ProdusFinal>${xmlEscape(line.finishedProduct?.name || "")}</ProdusFinal>`,
              `        </Linie>`,
            ].join("\n")
          }),
          `      </Linii>`,
          `    </BonConsum>`,
        ].join("\n")
      ),
      `  </BonuriConsum>`,
      `</SAGA>`,
    ].join("\n")
  } else if (kind === "production-docs") {
    const documents = await prisma.productionDoc.findMany({
      where: {
        tenantId,
        companyId,
        docDate: { gte: from, lte: to },
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                accountingStockType: true,
                uom: true,
                vatRate: true,
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Productie">`,
      `  <Productie>`,
      ...documents.map((document) =>
        [
          `    <DocumentProductie>`,
          `      <Numar>${xmlEscape(document.docNo)}</Numar>`,
          `      <Data>${xmlEscape(formatDate(document.docDate))}</Data>`,
          `      <Gestiune>${xmlEscape(managementValue(config, document.location))}</Gestiune>`,
          `      <Explicatie>${xmlEscape(document.note || "Nota de productie")}</Explicatie>`,
          `      <Linii>`,
          ...document.items.map((line) => {
            const stockType = pickStockType(line.product, stockTypes, config)
            return [
              `        <Linie>`,
              `          <Cod>${xmlEscape(line.product.accountingItemCode || line.product.sku || slugCode(line.product.name, "ART"))}</Cod>`,
              `          <Denumire>${xmlEscape(line.product.name)}</Denumire>`,
              `          <UM>${xmlEscape(line.product.uom?.code || "BUC")}</UM>`,
              `          <Cantitate>${decimal(line.qty, 3)}</Cantitate>`,
              `          <ContStoc>${xmlEscape(stockType?.inventoryAccount || config.inventoryAccount)}</ContStoc>`,
              `          <ContVenit>${xmlEscape(stockType?.salesAccount || config.salesAccount)}</ContVenit>`,
              `        </Linie>`,
            ].join("\n")
          }),
          `      </Linii>`,
          `    </DocumentProductie>`,
        ].join("\n")
      ),
      `  </Productie>`,
      `</SAGA>`,
    ].join("\n")
  } else {
    return res.status(400).json({ ok: false, error: "Tip de export contabil necunoscut." })
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName(kind, dateFrom, dateTo)}"`)
  return res.status(200).send(xml)
})

export default router
