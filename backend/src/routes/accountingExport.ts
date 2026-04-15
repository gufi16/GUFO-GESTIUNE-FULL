// @ts-nocheck
import { Router } from "express"
import ExcelJS from "exceljs"
import { z } from "zod"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildCompanyScopedTenantWhere, requireRequestCompany, requireRequestCompanyId } from "../lib/companyScope"

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

function sagaNumber(value: unknown, digits = 2) {
  const fixed = decimal(value, digits)
  return fixed.replace(/\.?0+$/, "") || "0"
}

function normalizeValueType(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized === "GLOBAL_VALORIC" ? "GLOBAL_VALORIC" : "CANTITATIV_VALORIC"
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

function compactDateToken(value: Date | string | null | undefined) {
  if (!value) return "00000000"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "00000000"
  return `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, "0")}${`${date.getDate()}`.padStart(2, "0")}`
}

function downloadName(kind: string, from: string, to: string, options?: { company?: any; firstDoc?: any }) {
  if ((kind === "purchase-receipts" || kind === "sales-invoices") && options?.company) {
    const companyCode = String(options.company.cui || options.company.code || "FIRMA").replace(/[^A-Za-z0-9]/g, "")
    const docNumber = extractSagaNumber(options.firstDoc?.spvInvoiceNo || options.firstDoc?.docNo || "EXPORT")
    const docDate = compactDateToken(options.firstDoc?.docDate || from || to || new Date())
    return `F_${companyCode || "FIRMA"}_${docNumber || "EXPORT"}_${docDate}.xml`
  }

  const safeKind = slugCode(kind, "EXPORT")
  const fromChunk = from ? from.replace(/[^0-9]/g, "") : "ALL"
  const toChunk = to ? to.replace(/[^0-9]/g, "") : "ALL"
  return `saga_${safeKind}_${fromChunk}_${toChunk}.xml`
}

function replaceFileExtension(fileName: string, extension: "xml" | "xlsx" | "csv") {
  return fileName.replace(/\.[^.]+$/i, `.${extension}`)
}

function excelSerialDate(value: Date | string | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor(utc / 86400000) + 25569
}

function spreadsheetSheets(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>) {
  return Object.assign([], { __sheets: sheets })
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

function xmlMeta(company: any, kind: string, dateFrom: string, dateTo: string, valueType: string) {
  return [
    `  <Meta>`,
    `    <Firma>${xmlEscape(company?.name || "")}</Firma>`,
    `    <CodFirma>${xmlEscape(company?.code || "")}</CodFirma>`,
    `    <TipExport>${xmlEscape(kind)}</TipExport>`,
    `    <TipValoare>${xmlEscape(valueType)}</TipValoare>`,
    `    <DataStart>${xmlEscape(dateFrom || "")}</DataStart>`,
    `    <DataStop>${xmlEscape(dateTo || "")}</DataStop>`,
    `    <GeneratLa>${xmlEscape(new Date().toISOString())}</GeneratLa>`,
    `  </Meta>`,
  ].join("\n")
}

function xmlTag(name: string, value: unknown) {
  return `      <${name}>${xmlEscape(value ?? "")}</${name}>`
}

function xmlLineTag(name: string, value: unknown) {
  return `            <${name}>${xmlEscape(value ?? "")}</${name}>`
}

function normalizeFileFormat(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "xlsx") return "xlsx"
  if (normalized === "csv") return "csv"
  return "xml"
}

function readablePaymentType(value: unknown) {
  switch (String(value || "").toUpperCase()) {
    case "CASH":
      return "Numerar"
    case "CARD":
      return "Card"
    case "MIXED":
      return "Mixt"
    default:
      return ""
  }
}

async function buildSpreadsheetBuffer(sheetName: string, rows: Record<string, unknown>[], fileFormat: "xlsx" | "csv") {
  const workbook = new ExcelJS.Workbook()
  const sheets = Array.isArray((rows as any)?.__sheets)
    ? (rows as any).__sheets
    : [{ name: sheetName, rows }]

  for (const sheet of sheets) {
    const sheetRows = Array.isArray(sheet?.rows) ? sheet.rows : []
    const worksheet = workbook.addWorksheet(String(sheet?.name || sheetName).slice(0, 31) || "Export")

    const headers = Array.from(
      sheetRows.reduce((acc: Set<string>, row: Record<string, unknown>) => {
        Object.keys(row || {}).forEach((key) => acc.add(key))
        return acc
      }, new Set<string>())
    )

    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.min(Math.max(header.length + 4, 14), 28),
    }))

    sheetRows.forEach((row: Record<string, unknown>) => {
      const normalizedRow: Record<string, unknown> = {}
      headers.forEach((header) => {
        normalizedRow[header] = row?.[header] ?? ""
      })
      worksheet.addRow(normalizedRow)
    })

    worksheet.getRow(1).font = { bold: true }
    worksheet.views = [{ state: "frozen", ySplit: 1 }]

    headers.forEach((header, index) => {
      const normalizedHeader = String(header || "").trim().toUpperCase()
      if (["COD", "COD_BARE", "COD_ARTICOL", "PLU"].includes(normalizedHeader)) {
        worksheet.getColumn(index + 1).numFmt = "@"
      }
    })
  }

  if (fileFormat === "csv") {
    const buffer = await workbook.csv.writeBuffer()
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

function formatSagaImportDate(value: Date | string | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  })

  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ""
  const rawOffset = get("timeZoneName").replace("GMT", "")
  const offset = rawOffset.includes(":")
    ? rawOffset
    : `${rawOffset}:00`

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset || "+00:00"}`
}

function extractSagaNumber(value: unknown) {
  const source = String(value || "").trim()
  if (!source) return ""
  const digits = source.match(/\d+/g)?.join("") || ""
  return digits || source
}

function buildSagaFacturaHeader({
  supplier,
  client,
  number,
  date,
  dueDate,
  currency,
  info,
  code,
  reverseCharge,
  vatOnCash,
  facturaTip,
  greutate,
  accize,
  clientGuid,
}: {
  supplier: Record<string, unknown>
  client: Record<string, unknown>
  number: unknown
  date: unknown
  dueDate?: unknown
  currency?: unknown
  info?: unknown
  code?: unknown
  reverseCharge?: unknown
  vatOnCash?: unknown
  facturaTip?: unknown
  greutate?: unknown
  accize?: unknown
  clientGuid?: unknown
}) {
  return [
    `      <Antet>`,
    xmlTag("FurnizorNume", supplier.name),
    xmlTag("FurnizorCIF", supplier.cif),
    xmlTag("FurnizorNrRegCom", supplier.regCom),
    xmlTag("FurnizorCapital", supplier.capital),
    xmlTag("FurnizorTara", supplier.country),
    xmlTag("FurnizorLocalitate", supplier.city),
    xmlTag("FurnizorJudet", supplier.county),
    xmlTag("FurnizorAdresa", supplier.address),
    xmlTag("FurnizorTelefon", supplier.phone),
    xmlTag("FurnizorMail", supplier.email),
    xmlTag("FurnizorBanca", supplier.bank),
    xmlTag("FurnizorIBAN", supplier.iban),
    xmlTag("FurnizorInformatiiSuplimentare", supplier.info),
    xmlTag("GUID_cod_client", clientGuid),
    xmlTag("ClientNume", client.name),
    xmlTag("ClientInformatiiSuplimentare", client.info),
    xmlTag("ClientCIF", client.cif),
    xmlTag("ClientNrRegCom", client.regCom),
    xmlTag("ClientJudet", client.county),
    xmlTag("ClientTara", client.country),
    xmlTag("ClientLocalitate", client.city),
    xmlTag("ClientAdresa", client.address),
    xmlTag("ClientBanca", client.bank),
    xmlTag("ClientIBAN", client.iban),
    xmlTag("ClientTelefon", client.phone),
    xmlTag("ClientMail", client.email),
    xmlTag("FacturaNumar", number),
    xmlTag("FacturaData", formatDate(date)),
    xmlTag("FacturaScadenta", dueDate ? formatDate(dueDate) : ""),
    xmlTag("FacturaTaxareInversa", reverseCharge ? "Da" : "Nu"),
    xmlTag("FacturaTVAIncasare", vatOnCash ? "Da" : "Nu"),
    xmlTag("FacturaTip", facturaTip || ""),
    xmlTag("FacturaMoneda", currency || "RON"),
    xmlTag("FacturaInformatiiSuplimentare", info),
    xmlTag("FacturaGreutate", greutate || ""),
    xmlTag("FacturaAccize", accize || ""),
    xmlTag("Cod", code),
    `      </Antet>`,
  ].join("\n")
}

function buildSagaFacturaLine(line: {
  index: number
  management?: unknown
  description?: unknown
  supplierCode?: unknown
  clientCode?: unknown
  guid?: unknown
  barcode?: unknown
  info?: unknown
  uom?: unknown
  qty?: unknown
  price?: unknown
  value?: unknown
  vatRate?: unknown
  vatValue?: unknown
  account?: unknown
  priceSale?: unknown
  activity?: unknown
  deductionType?: unknown
}) {
  return [
    `          <Linie>`,
    xmlLineTag("LinieNrCrt", line.index),
    xmlLineTag("Gestiune", line.management),
    xmlLineTag("Activitate", line.activity),
    xmlLineTag("Descriere", line.description),
    xmlLineTag("CodArticolFurnizor", line.supplierCode),
    xmlLineTag("CodArticolClient", line.clientCode),
    xmlLineTag("GUID_cod_articol", line.guid),
    xmlLineTag("CodBare", line.barcode),
    xmlLineTag("InformatiiSuplimentare", line.info),
    xmlLineTag("UM", line.uom),
    xmlLineTag("Cantitate", line.qty),
    xmlLineTag("Pret", line.price),
    xmlLineTag("Valoare", line.value),
    xmlLineTag("ProcTVA", line.vatRate),
    xmlLineTag("TVA", line.vatValue),
    xmlLineTag("Cont", line.account),
    xmlLineTag("TipDeducere", line.deductionType),
    xmlLineTag("PretVanzare", line.priceSale),
    `          </Linie>`,
  ].join("\n")
}

function buildSagaOperationalHeader({
  docNo,
  docDate,
  location,
  explanation,
  mode,
}: {
  docNo: unknown
  docDate: unknown
  location?: { code?: string | null; name?: string | null } | null
  explanation?: unknown
  mode?: unknown
}) {
  return [
    `      <Antet>`,
    xmlTag("Numar", docNo),
    xmlTag("Data", formatDate(docDate)),
    xmlTag("Gestiune", location?.code || location?.name || ""),
    xmlTag("Explicatie", explanation),
    xmlTag("ModExport", mode || "cantitativ-valoric"),
    `      </Antet>`,
  ].join("\n")
}

function buildSagaOperationalLine(line: {
  index: number
  management?: unknown
  description?: unknown
  code?: unknown
  guid?: unknown
  barcode?: unknown
  info?: unknown
  uom?: unknown
  qty?: unknown
  price?: unknown
  value?: unknown
  expenseAccount?: unknown
  inventoryAccount?: unknown
  salesAccount?: unknown
  vatRate?: unknown
}) {
  return [
    `          <Linie>`,
    xmlLineTag("LinieNrCrt", line.index),
    xmlLineTag("Gestiune", line.management),
    xmlLineTag("Descriere", line.description),
    xmlLineTag("CodArticol", line.code),
    xmlLineTag("GUID_cod_articol", line.guid),
    xmlLineTag("CodBare", line.barcode),
    xmlLineTag("InformatiiSuplimentare", line.info),
    xmlLineTag("UM", line.uom),
    xmlLineTag("Cantitate", line.qty),
    xmlLineTag("Pret", line.price),
    xmlLineTag("Valoare", line.value),
    xmlLineTag("ProcTVA", line.vatRate),
    xmlLineTag("ContCheltuiala", line.expenseAccount),
    xmlLineTag("ContStoc", line.inventoryAccount),
    xmlLineTag("ContVenit", line.salesAccount),
    `          </Linie>`,
  ].join("\n")
}

function aggregateByKey<T>(items: T[], buildKey: (item: T) => string, seed: (item: T) => any, merge: (target: any, item: T) => void) {
  const map = new Map<string, any>()
  for (const item of items) {
    const key = buildKey(item)
    if (!map.has(key)) {
      map.set(key, seed(item))
    }
    merge(map.get(key), item)
  }
  return Array.from(map.values())
}

async function buildLatestPurchaseCostMap(
  tenantId: string,
  companyId: string,
  productIds: string[],
  options?: {
    locationId?: string
    dateTo?: Date
  }
) {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)))
  if (!uniqueIds.length) return new Map<string, number>()

  const receiptItems = await prisma.purchaseReceiptItem.findMany({
    where: {
      productId: { in: uniqueIds },
      receipt: {
        tenantId,
        OR: [{ companyId }, { companyId: null }],
        status: "POSTED",
        ...(options?.locationId ? { locationId: options.locationId } : {}),
        ...(options?.dateTo ? { docDate: { lte: options.dateTo } } : {}),
      },
    },
    include: {
      receipt: {
        select: {
          docDate: true,
          createdAt: true,
        },
      },
    },
    orderBy: [
      { receipt: { docDate: "desc" } },
      { receipt: { createdAt: "desc" } },
      { createdAt: "desc" },
    ],
  })

  const costMap = new Map<string, number>()
  for (const item of receiptItems) {
    if (costMap.has(item.productId)) continue
    const unitCost = Number(item.unitCostNetRon || 0)
    if (Number.isFinite(unitCost) && unitCost > 0) {
      costMap.set(item.productId, unitCost)
    }
  }

  return costMap
}

router.get("/api/v1/reports/accounting/saga/config", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const company = await requireRequestCompany(req)
  const companyId = company.id
  const { config, stockTypes } = await ensureAccountingConfig(tenantId, companyId)

  const [locations, vatRates] = await Promise.all([
    prisma.location.findMany({
      where: buildCompanyScopedTenantWhere(tenantId, companyId, { isActive: true }),
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.vatRate.findMany({
      where: buildCompanyScopedTenantWhere(tenantId, companyId, { isActive: true }),
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
        { code: "products", label: "Articole", description: "Nomenclatorul de articole si codurile de import.", partnerLabel: "Articol" },
        { code: "customers", label: "Clienti", description: "Lista de clienti pentru importul initial.", partnerLabel: "Client" },
        { code: "suppliers", label: "Furnizori", description: "Lista de furnizori folosita la intrari.", partnerLabel: "Furnizor" },
        { code: "sales-invoices", label: "Facturi iesire", description: "Facturile emise catre clienti pe interval.", partnerLabel: "Client" },
        { code: "purchase-receipts", label: "NIR / intrari", description: "Intrarile de marfa si notele de receptie.", partnerLabel: "Furnizor" },
        { code: "consumption-docs", label: "Bonuri de consum", description: "Consumurile de materii prime din gestiune.", partnerLabel: "Produs final" },
        { code: "production-docs", label: "Productie", description: "Notele de productie si produsele finite obtinute.", partnerLabel: "Produs" },
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
  const fileFormat = normalizeFileFormat(req.query.fileFormat)
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const locationId = String(req.query.locationId || "").trim()
  const partnerSearch = String(req.query.partnerSearch || "").trim()
  const valueType = normalizeValueType(req.query.valueType)
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date("2000-01-01T00:00:00")
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date()

  const { config, stockTypes } = await ensureAccountingConfig(tenantId, companyId)
  let xml = ""
  let sheetName = "Export contabilitate"
  let spreadsheetRows: Record<string, unknown>[] = []

  if (kind === "products") {
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId,
      },
      include: {
        vatRate: true,
        uom: true,
        accountingStockType: true,
      },
      orderBy: { name: "asc" },
    })

    sheetName = "Articole"
    spreadsheetRows = products.map((product) => {
      const stockType = pickStockType(product, stockTypes, config)
      const articleCode =
        config.articleCodeSource === "SKU"
          ? product.sku
          : product.accountingItemCode || product.sku

      return {
        COD: String(articleCode || ""),
        DENUMIRE: product.name,
        UM: product.uom?.code || "BUC",
        P_TVA: Number(product.vatRate?.rate ?? 0),
        GRUPA:
          stockType?.code === "MATERII"
            ? "C"
            : stockType?.code === "MARFA"
              ? "A"
              : "",
        TIP: stockType?.name || "",
        CONT_STOC: stockType?.inventoryAccount || config.inventoryAccount,
        CONT_CHELTUIALA: stockType?.expenseAccount || config.expenseAccount,
        PRET: Number(product.price || 0),
      }
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Articole">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
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
      where: {
        tenantId,
        OR: [{ companyId }, { companyId: null }],
        isActive: true,
        ...(partnerSearch
          ? {
              OR: [
                { name: { contains: partnerSearch, mode: "insensitive" } },
                { code: { contains: partnerSearch, mode: "insensitive" } },
                { cif: { contains: partnerSearch, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    })

    sheetName = "Clienti"
    spreadsheetRows = customers.map((customer) => ({
      "Denumire client": customer.name,
      "Cod fiscal": customer.cif || "",
      "Registru Comert": customer.regNo || "",
      Judet: customer.county || "",
      Adresa: customer.address || "",
      Tara: customer.country || "",
      Telefon: customer.phone || "",
      Email: customer.email || "",
      Cont: config.customerAccount,
    }))

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Clienti">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
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
      where: {
        tenantId,
        OR: [{ companyId }, { companyId: null }],
        isActive: true,
        ...(partnerSearch
          ? {
              OR: [
                { name: { contains: partnerSearch, mode: "insensitive" } },
                { code: { contains: partnerSearch, mode: "insensitive" } },
                { cif: { contains: partnerSearch, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    })

    sheetName = "Furnizori"
    spreadsheetRows = suppliers.map((supplier) => ({
      "Denumire furnizor": supplier.name,
      "Cod fiscal": supplier.cif || "",
      "Registru Comert": supplier.regCom || "",
      Judet: supplier.county || "",
      Adresa: supplier.address || "",
      Tara: supplier.country || "",
      Telefon: supplier.phone || "",
      Email: supplier.email || "",
      Cont: config.supplierAccount,
    }))

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Furnizori">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
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
        OR: [{ companyId }, { companyId: null }],
        status: "ISSUED",
        docDate: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? {
              OR: [
                { customerName: { contains: partnerSearch, mode: "insensitive" } },
                { customerCode: { contains: partnerSearch, mode: "insensitive" } },
                { customerCif: { contains: partnerSearch, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        location: true,
        items: true,
      },
      orderBy: { docDate: "asc" },
    })

    sheetName = "Facturi iesire"
    spreadsheetRows = spreadsheetSheets([
      {
        name: "Facturi",
        rows: invoices.map((invoice) => ({
          "Denumire client": invoice.customerName || "",
          "Cod fiscal": invoice.customerCif || "",
          "Registru Comert": invoice.customerRegNo || "",
          Judet: "",
          Adresa: invoice.customerAddress || "",
          Tara: "RO",
          Moneda: invoice.currency || "RON",
          "Numar factura": invoice.docNo,
          Data: formatDate(invoice.docDate),
          TVA: Number(invoice.totalVatRon || 0),
          "Valoare neta": Number(invoice.totalNetRon || 0),
          "Valoare bruta": Number(invoice.totalGrossRon || 0),
          Discount: 0,
        })),
      },
      {
        name: "Continut factura",
        rows: invoices.flatMap((invoice) =>
          invoice.items.map((line) => ({
            Tip: "Marfa",
            "Denumire articol/serviciu": line.productName || "",
            "Cont factura": config.salesAccount,
            "Incasare numerar": readablePaymentType(invoice.paymentType || ""),
            "Cont numerar": invoice.paymentType === "CASH" ? config.cashAccount : "",
            "Plata automata": invoice.paymentType === "CARD" ? "Da" : "",
            "Cont plata": invoice.paymentType === "CARD" ? config.cardAccount : "",
            "Tip document": "Factura iesire",
            Gestiune: invoice.location?.code || invoice.location?.name || "",
            Grupa: "",
            Agent: "",
            Cod: line.productCode || "",
            UM: line.uomCode || "BUC",
            "TVA %": Number(line.vatRateValue || 0),
            Cantitate: Number(line.qty || 0),
            "Pret unitar": Number(line.unitPriceFc || 0),
            Valoare: Number(line.lineNetRon || 0),
            Total: Number(line.lineGrossRon || 0),
            TVA: Number(line.lineVatRon || 0),
            Ned: "N",
          }))
        ),
      },
    ])

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Facturi>`,
      ...invoices.map((invoice) =>
        (() => {
          const groupedLines =
            valueType === "GLOBAL_VALORIC"
              ? aggregateByKey(
                  invoice.items,
                  (line) => `${line.vatRateValue || 0}|${line.productCode || ""}`,
                  (line) => ({
                    code: line.productCode || slugCode(line.productName, "ART"),
                    name: line.productName,
                    vatRateValue: Number(line.vatRateValue || 0),
                    valueRon: 0,
                  }),
                  (target, line) => {
                    target.valueRon += Number(line.lineNetRon || 0)
                  }
                )
              : invoice.items

          return [
          `  <Factura>`,
          buildSagaFacturaHeader({
            supplier: {
              name: company.name,
              cif: company.cui,
              regCom: company.regNo,
              capital: "",
              country: company.country,
              city: company.city,
              county: company.county,
              address: company.address,
              phone: company.phone,
              email: company.email,
              bank: company.bank,
              iban: company.iban,
              info: "",
            },
            client: {
              name: invoice.customerName,
              cif: invoice.customerCif,
              regCom: "",
              country: "RO",
              city: "",
              county: "",
              address: invoice.customerAddress,
              bank: "",
              iban: "",
              phone: "",
              email: "",
              info: "",
            },
            number: invoice.docNo,
            date: invoice.docDate,
            dueDate: invoice.dueDate || invoice.docDate,
            currency: invoice.currency || "RON",
            info: valueType === "GLOBAL_VALORIC" ? "Export global valoric" : "Export cantitativ valoric",
            code: invoice.customerCode || "",
            reverseCharge: false,
            vatOnCash: false,
            facturaTip: "Iesire",
            greutate: "",
            accize: "",
            clientGuid: invoice.customerCode || invoice.customerCif || invoice.customerName || "",
          }),
          `      <Detalii>`,
          `        <Continut>`,
          ...groupedLines.map((line) =>
            valueType === "GLOBAL_VALORIC"
              ? buildSagaFacturaLine({
                  index: groupedLines.indexOf(line) + 1,
                  management: invoice.location?.code || invoice.location?.name || "",
                  description: line.name,
                  clientCode: line.code,
                  guid: line.code,
                  uom: "",
                  qty: "",
                  price: "",
                  value: decimal(line.valueRon),
                  vatRate: decimal(line.vatRateValue),
                  vatValue: "",
                  account: config.salesAccount,
                  activity: "",
                  deductionType: "",
                })
              : buildSagaFacturaLine({
                  index: groupedLines.indexOf(line) + 1,
                  management: invoice.location?.code || invoice.location?.name || "",
                  activity: "",
                  description: line.productName,
                  clientCode: line.productCode || slugCode(line.productName, "ART"),
                  guid: line.productId || line.productCode || "",
                  barcode: line.barcode || "",
                  uom: line.uomCode || "BUC",
                  qty: decimal(line.qty, 3),
                  price: decimal(line.unitPriceFc),
                  value: decimal(line.lineNetRon),
                  vatRate: decimal(line.vatRateValue),
                  vatValue: decimal(line.lineVatRon),
                  account: config.salesAccount,
                  deductionType: "",
                })
          ),
          `        </Continut>`,
          `      </Detalii>`,
          `      <FacturaID>${xmlEscape(invoice.id)}</FacturaID>`,
          `  </Factura>`,
        ].join("\n")
        })()
      ),
      `</Facturi>`,
    ].join("\n")
  } else if (kind === "purchase-receipts") {
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        tenantId,
        OR: [{ companyId }, { companyId: null }],
        status: "POSTED",
        docDate: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? {
              OR: [
                { supplierName: { contains: partnerSearch, mode: "insensitive" } },
                { supplierCode: { contains: partnerSearch, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        location: true,
        supplier: true,
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

    sheetName = "Facturi intrare"
    spreadsheetRows = spreadsheetSheets([
      {
        name: "IntrariDetalii",
        rows: receipts.flatMap((receipt) =>
          receipt.items.map((line) => ({
            den_tip: "Nedefinit",
            den_gest: receipt.location?.code || receipt.location?.name || "",
            denumire: line.product?.name || "",
            cod: line.product?.accountingItemCode || line.product?.sku || "",
            um: line.product?.uom?.code || "BUC",
            tva_art: Number(line.vatRateValue || 0),
            cantitate: Number(line.stockQty || line.qty || 0),
            pret_unitar: Number(line.unitCostNetRon || 0),
            valoare: Number(line.lineNetRon || 0),
            transp_lei: 0,
            total: Number(line.lineGrossRon || 0),
            tva_ded: Number(line.lineVatRon || 0),
            tip_ded: "N50",
            cont: pickStockType(line.product, stockTypes, config)?.inventoryAccount || config.inventoryAccount,
            pret_vanz: Number(line.product?.price || 0),
            adaos: 0,
            adaos_proc: 0,
            text_supl: "",
            categorie: "",
            ID_U: "",
            ID_INTRARE: "",
            GESTIUNE: receipt.location?.code || receipt.location?.name || "",
            PTVA_VANZ: 0,
            IS_FACTURAT: 0,
            DISCOUNT: 0,
            ID_BC: 0,
            plan: "",
            SECTOR: "",
            SURSA: "",
            CAPITOL: "",
            ARTICOL: "",
            LOT: "",
            COD_TAXA: "",
            ID_SGR: 0,
          }))
        ),
      },
      {
        name: "Intrari",
        rows: receipts.map((receipt) => ({
          tip: "R",
          nr_nir: extractSagaNumber(receipt.docNo || ""),
          nr_intrare: extractSagaNumber(receipt.spvInvoiceNo || receipt.docNo || ""),
          cod: receipt.supplierCode || receipt.supplier?.code || "",
          denumire: receipt.supplierName || receipt.supplier?.name || "",
          tvai: 0,
          data: excelSerialDate(receipt.docDate),
          scadent: receipt.docDate ? excelSerialDate(receipt.docDate) : "",
          baza_tva: Number(receipt.totalNetRon || 0),
          transp_lei: 0,
          tva: Number(receipt.totalVatRon || 0),
          total: Number(receipt.totalGrossRon || 0),
          neachitat: Number(receipt.totalGrossRon || 0),
          data_doc: "",
          inf_suplm: "",
          den_agent: "",
          id_solicit: "",
        })),
      },
    ])

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Facturi>`,
      ...receipts.map((receipt) =>
        (() => {
          const groupedLines =
            valueType === "GLOBAL_VALORIC"
              ? aggregateByKey(
                  receipt.items,
                  (line) => `${line.vatRateValue || 0}|${line.product?.accountingItemCode || line.product?.sku || line.productId}`,
                  (line) => ({
                    code: line.product?.accountingItemCode || line.product?.sku || slugCode(line.product?.name || "ART", "ART"),
                    name: line.product?.name || "",
                    vatRateValue: Number(line.vatRateValue || 0),
                    valueRon: 0,
                    stockAccount: "",
                    expenseAccount: "",
                  }),
                  (target, line) => {
                    const stockType = pickStockType(line.product, stockTypes, config)
                    target.valueRon += Number(line.lineNetRon || 0)
                    target.stockAccount = stockType?.inventoryAccount || config.inventoryAccount
                    target.expenseAccount = stockType?.expenseAccount || config.expenseAccount
                  }
                )
              : receipt.items

          return [
            `  <Factura>`,
            buildSagaFacturaHeader({
              supplier: {
                name: receipt.supplierName || receipt.supplier?.name || "",
                cif: receipt.supplier?.cif || "",
                regCom: receipt.supplier?.regCom || "",
                capital: "",
                country: receipt.supplier?.country || "",
                city: receipt.supplier?.city || "",
                county: receipt.supplier?.county || "",
                address: receipt.supplier?.address || "",
                phone: receipt.supplier?.phone || "",
                email: receipt.supplier?.email || "",
                bank: "",
                iban: "",
                info: "",
              },
              client: {
                name: company.name,
                cif: company.cui,
                regCom: company.regNo,
                country: company.country,
                city: company.city,
                county: company.county,
                address: company.address,
                bank: company.bank,
                iban: company.iban,
                phone: company.phone,
                email: company.email,
                info: "",
              },
              number: receipt.spvInvoiceNo || receipt.docNo,
              date: receipt.docDate,
              dueDate: receipt.docDate,
              currency: receipt.currency || "RON",
              info: valueType === "GLOBAL_VALORIC" ? "Export global valoric" : "Export cantitativ valoric",
              code: receipt.supplierCode || receipt.supplier?.code || "",
              reverseCharge: false,
              vatOnCash: false,
              facturaTip: "Intrare",
              greutate: "",
              accize: "",
              clientGuid: receipt.supplierCode || receipt.supplier?.code || receipt.supplier?.cif || "",
            }),
            `      <Detalii>`,
            `        <Continut>`,
            ...groupedLines.map((line) => {
              if (valueType === "GLOBAL_VALORIC") {
                return buildSagaFacturaLine({
                  index: groupedLines.indexOf(line) + 1,
                  management: receipt.location?.code || receipt.location?.name || "",
                  description: line.name,
                  supplierCode: line.code,
                  guid: line.code,
                  value: decimal(line.valueRon),
                  vatRate: decimal(line.vatRateValue),
                  account: line.stockAccount,
                  activity: "",
                  deductionType: "Integral",
                })
              }

              const stockType = pickStockType(line.product, stockTypes, config)
              return buildSagaFacturaLine({
                index: groupedLines.indexOf(line) + 1,
                management: receipt.location?.code || receipt.location?.name || "",
                activity: "",
                description: line.product?.name || "",
                supplierCode: line.product?.accountingItemCode || line.product?.sku || slugCode(line.product?.name || "ART", "ART"),
                guid: line.product?.id || "",
                barcode: "",
                uom: line.product?.uom?.code || "BUC",
                qty: decimal(line.stockQty || line.qty, 3),
                price: decimal(line.unitCostNetRon),
                value: decimal(line.lineNetRon),
                vatRate: decimal(line.vatRateValue),
                vatValue: decimal(line.lineVatRon),
                account: stockType?.inventoryAccount || config.inventoryAccount,
                deductionType: "Integral",
                priceSale: "",
              })
            }),
            `        </Continut>`,
            `      </Detalii>`,
            `      <FacturaID>${xmlEscape(receipt.id)}</FacturaID>`,
            `  </Factura>`,
          ].join("\n")
        })()
      ),
      `</Facturi>`,
    ].join("\n")
  } else if (kind === "consumption-docs") {
    const documents = await prisma.consumptionDoc.findMany({
      where: {
        tenantId,
        OR: [{ companyId }, { companyId: null }],
        docDate: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
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
                uom: true,
                vatRate: true,
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })

    const latestCostMap = await buildLatestPurchaseCostMap(
      tenantId,
      companyId,
      documents.flatMap((document) => document.items.map((line) => line.ingredientId)),
      {
        locationId: locationId || undefined,
        dateTo: to,
      }
    )

    sheetName = "Bonuri consum"
    spreadsheetRows = documents.flatMap((document) =>
      document.items.map((line) => {
        const unitCost = latestCostMap.get(line.ingredientId) ?? Number(line.ingredient?.costPrice || 0)
        return {
          NR: document.docNo,
          DATA: formatDate(document.docDate),
          GESTIUNE: managementValue(config, document.location),
          DEN_GEST: document.location?.name || document.location?.code || "",
          EXPLICATIE: line.note || document.note || "",
          COD: String(line.ingredient.accountingItemCode || line.ingredient.sku || slugCode(line.ingredient.name, "ART")),
          COD_BARE: "",
          DENUMIRE: line.ingredient.name,
          UM: line.ingredient.uom?.code || "BUC",
          CANTITATE: Number(line.qty || 0),
        }
      })
    )

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="BonuriConsum">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
      `  <BonuriConsum>`,
      ...documents.map((document) =>
        [
          `    <BonConsum>`,
          buildSagaOperationalHeader({
            docNo: document.docNo,
            docDate: document.docDate,
            location: document.location,
            explanation: document.note || "Bon de consum",
            mode: "cantitativ-valoric",
          }),
          `      <Detalii>`,
          `        <Continut>`,
          ...document.items.map((line, index) => {
            const stockType = pickStockType(line.ingredient, stockTypes, config)
            const unitCost = latestCostMap.get(line.ingredientId) ?? Number(line.ingredient?.costPrice || 0)
            return buildSagaOperationalLine({
              index: index + 1,
              management: managementValue(config, document.location),
              description: line.ingredient.name,
              code: line.ingredient.accountingItemCode || line.ingredient.sku || slugCode(line.ingredient.name, "ART"),
              guid: line.ingredient.id,
              barcode: "",
              info: line.finishedProduct?.name ? `Produs final: ${line.finishedProduct.name}` : line.note || "",
              uom: line.ingredient.uom?.code || "BUC",
              qty: decimal(line.qty, 3),
              price: decimal(unitCost),
              value: decimal(unitCost * Number(line.qty || 0)),
              vatRate: decimal(line.ingredient.vatRate?.rate ?? 0),
              expenseAccount: stockType?.expenseAccount || config.expenseAccount,
              inventoryAccount: stockType?.inventoryAccount || config.inventoryAccount,
              salesAccount: stockType?.salesAccount || config.salesAccount,
            })
          }),
          `        </Continut>`,
          `      </Detalii>`,
          `      <DocumentID>${xmlEscape(document.id)}</DocumentID>`,
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
        OR: [{ companyId }, { companyId: null }],
        docDate: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
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

    const latestCostMap = await buildLatestPurchaseCostMap(
      tenantId,
      companyId,
      documents.flatMap((document) => document.items.map((line) => line.productId)),
      {
        locationId: locationId || undefined,
        dateTo: to,
      }
    )

    sheetName = "Productie"
    spreadsheetRows = documents.flatMap((document) =>
      document.items.map((line) => {
        const stockType = pickStockType(line.product, stockTypes, config)
        const unitCost = latestCostMap.get(line.productId) ?? Number(line.product.costPrice || 0)
        return {
          Cod: line.product.accountingItemCode || line.product.sku || slugCode(line.product.name, "ART"),
          Denumire: line.product.name,
          UM: line.product.uom?.code || "BUC",
          Cantitate: Number(line.qty || 0),
          "Pret unitar": unitCost,
          Valoare: unitCost * Number(line.qty || 0),
          Gestiune: managementValue(config, document.location),
          Data: formatDate(document.docDate),
          "Nr. doc": document.docNo,
          Explicatie: document.note || "Nota de productie",
          TVA: Number(line.product.vatRate?.rate ?? 0),
          "Cont stoc": stockType?.inventoryAccount || config.inventoryAccount,
          "Cont cheltuiala": stockType?.expenseAccount || config.expenseAccount,
          "Cont venit": stockType?.salesAccount || config.salesAccount,
          Document: document.docNo,
          Articol: line.product.name,
          Pret: unitCost,
          ContStoc: stockType?.inventoryAccount || config.inventoryAccount,
          ContCheltuiala: stockType?.expenseAccount || config.expenseAccount,
          ContVenit: stockType?.salesAccount || config.salesAccount,
        }
      })
    )

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Productie">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
      `  <Productie>`,
      ...documents.map((document) =>
        [
          `    <DocumentProductie>`,
          buildSagaOperationalHeader({
            docNo: document.docNo,
            docDate: document.docDate,
            location: document.location,
            explanation: document.note || "Nota de productie",
            mode: "cantitativ-valoric",
          }),
          `      <Detalii>`,
          `        <Continut>`,
          ...document.items.map((line, index) => {
            const stockType = pickStockType(line.product, stockTypes, config)
            const unitCost = latestCostMap.get(line.productId) ?? Number(line.product.costPrice || 0)
            return buildSagaOperationalLine({
              index: index + 1,
              management: managementValue(config, document.location),
              description: line.product.name,
              code: line.product.accountingItemCode || line.product.sku || slugCode(line.product.name, "ART"),
              guid: line.product.id,
              barcode: "",
              info: document.note || "",
              uom: line.product.uom?.code || "BUC",
              qty: decimal(line.qty, 3),
              price: decimal(unitCost),
              value: decimal(unitCost * Number(line.qty || 0)),
              vatRate: decimal(line.product.vatRate?.rate ?? 0),
              expenseAccount: stockType?.expenseAccount || config.expenseAccount,
              inventoryAccount: stockType?.inventoryAccount || config.inventoryAccount,
              salesAccount: stockType?.salesAccount || config.salesAccount,
            })
          }),
          `        </Continut>`,
          `      </Detalii>`,
          `      <DocumentID>${xmlEscape(document.id)}</DocumentID>`,
          `    </DocumentProductie>`,
        ].join("\n")
      ),
      `  </Productie>`,
      `</SAGA>`,
    ].join("\n")
  } else {
    return res.status(400).json({ ok: false, error: "Tip de export contabil necunoscut." })
  }

  const firstDoc =
    kind === "purchase-receipts"
      ? await prisma.purchaseReceipt.findFirst({
          where: {
            tenantId,
            OR: [{ companyId }, { companyId: null }],
            status: "POSTED",
            docDate: { gte: from, lte: to },
            ...(locationId ? { locationId } : {}),
          },
          orderBy: { docDate: "asc" },
        })
      : kind === "sales-invoices"
        ? await prisma.salesInvoice.findFirst({
            where: {
              tenantId,
              OR: [{ companyId }, { companyId: null }],
              status: "ISSUED",
              docDate: { gte: from, lte: to },
              ...(locationId ? { locationId } : {}),
            },
            orderBy: { docDate: "asc" },
          })
        : null

  const baseFileName = downloadName(kind, dateFrom, dateTo, { company, firstDoc })

  if (fileFormat === "xlsx" || fileFormat === "csv") {
    const buffer = await buildSpreadsheetBuffer(sheetName, spreadsheetRows, fileFormat)
    res.setHeader(
      "Content-Type",
      fileFormat === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${replaceFileExtension(baseFileName, fileFormat)}"`)
    return res.status(200).send(buffer)
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${replaceFileExtension(baseFileName, "xml")}"`)
  return res.status(200).send(xml)
})

export default router
