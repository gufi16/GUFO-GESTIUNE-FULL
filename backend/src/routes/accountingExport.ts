import { Router } from "express"
import ExcelJS from "exceljs"
import AdmZip from "adm-zip"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildCompanyScopedTenantWhere, requireRequestCompany, requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

type ExportFileFormat = "xml" | "xlsx" | "csv" | "dbf"
type SpreadsheetFileFormat = "xlsx" | "csv"
type ExportRow = Record<string, unknown>
type ExportSheet = { name: string; rows: ExportRow[] }
type ExportSheetRows = ExportRow[] & { __sheets?: ExportSheet[] }
type SplitSpreadsheetFile = { fileName: string; sheetName: string; rows: ExportRow[] }
type SagaPartnerHeader = {
  name?: unknown
  cif?: unknown
  regCom?: unknown
  capital?: unknown
  country?: unknown
  city?: unknown
  county?: unknown
  address?: unknown
  phone?: unknown
  email?: unknown
  bank?: unknown
  iban?: unknown
  info?: unknown
}
type SagaFacturaLinePayload = {
  index: number
  type?: unknown
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
  total?: unknown
  vatRate?: unknown
  vatValue?: unknown
  account?: unknown
  priceSale?: unknown
  activity?: unknown
  deductionType?: unknown
  sagaAliases?: boolean
}
type SagaOperationalLinePayload = {
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
}
type SalesInvoiceHeaderRow = {
  DENUMIRE_C: string
  COD_FISCAL: number
  REGISTRU_C: string
  JUDET: string
  ADRESA: string
  TARA: string
  MONEDA: string
  NUMAR_FACT: string
  DATA: string
  TVA: number
  VALOARE_NE: number
  VALOARE_BR: number
  DISCOUNT: number
}
type SalesInvoiceDetailRow = {
  TIP: string
  GESTIUNE: string
  COD: string
  COD_BARE: string
  DENUMIRE: string
  UM: string
  P_TVA: number
  CANTITATE: number
  PRET: number
  VALOARE: number
  TOTAL: number
  TEXT_SUPL: string
  CONT: string
  ACTIVITATE: string
}
type PurchaseReceiptHeaderRow = {
  tip: string
  nr_nir: string
  nr_intrare: string
  cod: string
  denumire: string
  tvai: number
  data: number | string
  scadent: number | string
  baza_tva: number
  transp_lei: number
  tva: number
  total: number
  neachitat: number
  data_doc: string
  inf_suplm: string
  den_agent: string
  id_solicit: string
}
type PurchaseReceiptDetailRow = {
  den_tip: string
  gestiune: string
  den_gest: string
  GESTIUNE: string
  denumire: string
  cod: string
  um: string
  tva_art: number
  cantitate: number
  pret_unitar: number
  valoare: number
  transp_lei: number
  total: number
  tva_ded: number
  tip_ded: string
  cont: string
  pret_vanz: number
  adaos: number
  adaos_proc: number
  text_supl: string
  categorie: string
  ID_U: string
  ID_INTRARE: string
  PTVA_VANZ: number
  IS_FACTURAT: number
  DISCOUNT: number
  ID_BC: number
  plan: string
  SECTOR: string
  SURSA: string
  CAPITOL: string
  ARTICOL: string
  LOT: string
  COD_TAXA: string
  ID_SGR: number
}
type ConsumptionSpreadsheetRow = {
  NR: string | null | undefined
  DATA: string
  GESTIUNE: string
  DEN_GEST: string
  EXPLICATIE: string
  COD: string
  COD_BARE: string
  DENUMIRE: string
  UM: string
  CANTITATE: number
  PRET?: number
  VALOARE?: number
}
type ReceiptExportLine = AccountingReceiptAggregateLine | AccountingExportLineLike
type AccountingConfigLike = {
  articleCodeSource?: string | null
  managementAnalytic?: string | null
  defaultStockTypeId?: string | null
  salesAccount?: string | null
  expenseAccount?: string | null
  inventoryAccount?: string | null
}
type AccountingStockTypeLike = {
  id?: string | null
  code?: string | null
  name?: string | null
  inventoryAccount?: string | null
  expenseAccount?: string | null
  salesAccount?: string | null
}
type AccountingVatRateLike = {
  rate?: unknown
  fiscalCode?: unknown
  name?: unknown
}
type AccountingUomLike = {
  code?: unknown
  name?: unknown
}
type AccountingBarcodeLike = {
  barcode?: unknown
}
type AccountingLocationLike = {
  code?: string | null
  name?: string | null
}
type AccountingPartnerLike = {
  id?: string
  code?: string | null
  name?: string | null
  cif?: string | null
  regNo?: string | null
  regCom?: string | null
  country?: string | null
  county?: string | null
  city?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}
type AccountingCompanyLike = AccountingPartnerLike & {
  cui?: string | null
  bank?: string | null
  iban?: string | null
}
type AccountingProductLike = {
  id?: string | null
  class?: string | null
  sku?: string | null
  code?: string | null
  accountingItemCode?: string | null
  accountingStockTypeId?: string | null
  name?: string | null
  price?: unknown
  costPrice?: unknown
  purchaseFactor?: unknown
  sgrValue?: unknown
  isSgr?: boolean | null
  vatRate?: AccountingVatRateLike | null
  uom?: AccountingUomLike | null
  barcodes?: AccountingBarcodeLike[] | null
}
type AccountingExportLineLike = {
  id?: string | null
  qty?: unknown
  stockQty?: unknown
  uomCode?: string | null
  product?: AccountingProductLike | null
  productName?: string | null
  productCode?: string | null
  productId?: string | null
  vatRateValue?: unknown
  unitPriceFc?: unknown
  unitCostNetRon?: unknown
  lineNetRon?: unknown
  lineGrossRon?: unknown
  lineVatRon?: unknown
  sgrTotalRon?: unknown
  sgrTotalFc?: unknown
  sgrUnitFc?: unknown
}
type SalesInvoiceLike = {
  id?: string | null
  docNo?: string | null
  docDate?: Date | string | null
  dueDate?: Date | string | null
  currency?: string | null
  customerName?: string | null
  customerCif?: string | null
  customerRegNo?: string | null
  customerCode?: string | null
  customerAddress?: string | null
  customer?: AccountingPartnerLike | null
  location?: AccountingLocationLike | null
  totalNetRon?: unknown
  totalVatRon?: unknown
  totalGrossRon?: unknown
  totalSgrRon?: unknown
  totalWithSgrRon?: unknown
  items: AccountingExportLineLike[]
}
type PurchaseReceiptLike = {
  id?: string | null
  docNo?: string | null
  spvInvoiceNo?: string | null
  docDate?: Date | string | null
  currency?: string | null
  supplierName?: string | null
  supplierCode?: string | null
  supplier?: AccountingPartnerLike | null
  location?: AccountingLocationLike | null
  fxRate?: unknown
  totalNetRon?: unknown
  totalVatRon?: unknown
  totalGrossRon?: unknown
  items: AccountingExportLineLike[]
}
type ConsumptionDocumentLike = {
  id?: string | null
  docNo?: string | null
  docDate?: Date | string | null
  note?: string | null
  location?: AccountingLocationLike | null
  items: Array<{
    ingredientId: string
    qty?: unknown
    note?: string | null
    ingredient: AccountingProductLike & { id?: string | null; costPrice?: unknown }
    finishedProduct?: AccountingProductLike | null
  }>
}
type ProductionDocumentLike = {
  id?: string | null
  docNo?: string | null
  docDate?: Date | string | null
  note?: string | null
  location?: AccountingLocationLike | null
  items: Array<{
    productId: string
    qty?: unknown
    product: AccountingProductLike & { id?: string | null; costPrice?: unknown }
  }>
}
type ProductionSpreadsheetRow = {
  Cod: string
  Denumire: string
  UM: string
  Cantitate: number
  "Pret unitar": number
  Valoare: number
  Gestiune: string
  Data: string
  "Nr. doc": string | null | undefined
  Explicatie: string
  TVA: number
  "Cont stoc": string
  "Cont cheltuiala": string
  "Cont venit": string
  Document: string | null | undefined
  Articol: string
  Pret: number
  ContStoc: string
  ContCheltuiala: string
  ContVenit: string
}
type ArticleSpreadsheetRow = {
  COD: string
  DENUMIRE: string | null | undefined
  UM: unknown
  TIP: string
  P_TVA: number
  PRET: number
  PRET_CUTVA: number
  COD_BARE: unknown
  COD_NC: string
  COD_CPV: string
  TEXT_SUPL: string
}
type CustomerSpreadsheetRow = {
  COD: string
  DENUMIRE: string
  COD_FISCAL: string
  REG_COM: string
  TARA: string
  JUDET: string
  LOCALITATE: string
  ADRESA: string
  CONT_BANCA: string
  BANCA: string
  TEL: string
  EMAIL: string
  DISCOUNT: number
  INFORMATII: string
  GUID_COD: string | undefined
}
type SupplierSpreadsheetRow = {
  COD: string
  DENUMIRE: string
  COD_FISCAL: string
  TARA: string
  JUDET: string
  LOCALITATE: string
  ADRESA: string
  CONT_BANCA: string
  BANCA: string
  TEL: string
  EMAIL: string
  INFORMATII: string
  GUID_COD: string | undefined
}
type AccountingReceiptAggregateLine = {
  code: string
  name: string
  type: string
  vatRateValue: number
  valueRon: number
  vatRon: number
  stockAccount: string
  expenseAccount: string
}
type PreviewItem = {
  id: string
  code: string
  label: string
  partner?: string
  date: string
  status: string
}

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

function formatDate(value: unknown) {
  if (!value) return ""
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
    return ""
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const year = `${date.getFullYear()}`
  return `${day}.${month}.${year}`
}

function formatIsoDate(value: unknown) {
  if (!value) return ""
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
    return ""
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const year = `${date.getFullYear()}`
  return `${year}-${month}-${day}`
}

function decimal(value: unknown, digits = 2) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits)
}

function unitAmount(total: unknown, qty: unknown) {
  const numericTotal = Number(total || 0)
  const quantity = Number(qty || 0)
  if (!Number.isFinite(numericTotal)) return 0
  if (!Number.isFinite(quantity) || quantity === 0) return numericTotal
  return numericTotal / quantity
}

function toFiniteNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
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

function sagaCountryCode(value: unknown, fallback = "RO") {
  const raw = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()

  if (!raw) return fallback
  if (["RO", "ROU", "ROM", "ROMANIA", "ROMANIE"].includes(raw)) return "RO"
  if (/^[A-Z]{2}$/.test(raw)) return raw
  return fallback
}

const SAGA_COUNTY_CODES: Record<string, string> = {
  ALBA: "AB",
  ARAD: "AR",
  ARGES: "AG",
  BACAU: "BC",
  BIHOR: "BH",
  "BISTRITA NASAUD": "BN",
  "BISTRITA-NASAUD": "BN",
  BOTOSANI: "BT",
  BRASOV: "BV",
  BRAILA: "BR",
  BUCURESTI: "B",
  BUCHAREST: "B",
  BUZAU: "BZ",
  "CARAS SEVERIN": "CS",
  "CARAS-SEVERIN": "CS",
  CALARASI: "CL",
  CLUJ: "CJ",
  CONSTANTA: "CT",
  COVASNA: "CV",
  DAMBOVITA: "DB",
  DOLJ: "DJ",
  GALATI: "GL",
  GIURGIU: "GR",
  GORJ: "GJ",
  HARGHITA: "HR",
  HUNEDOARA: "HD",
  IALOMITA: "IL",
  IASI: "IS",
  ILFOV: "IF",
  MARAMURES: "MM",
  MEHEDINTI: "MH",
  MURES: "MS",
  NEAMT: "NT",
  OLT: "OT",
  PRAHOVA: "PH",
  "SATU MARE": "SM",
  SALAJ: "SJ",
  SIBIU: "SB",
  SUCEAVA: "SV",
  TELEORMAN: "TR",
  TIMIS: "TM",
  TULCEA: "TL",
  VASLUI: "VS",
  VALCEA: "VL",
  VRANCEA: "VN",
}

function sagaCountyCode(value: unknown) {
  const raw = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^JUDET(UL)?\s+/, "")
    .replace(/\s+/g, " ")

  if (!raw) return ""
  if (/^SECTOR\s*[1-6]$/.test(raw)) return "B"
  if (/^[A-Z]{1,2}$/.test(raw)) return raw === "BU" ? "B" : raw
  return SAGA_COUNTY_CODES[raw] || ""
}

function parseIdList(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueSagaCode(rawCode: unknown, fallbackPrefix: string, index: number, used: Set<string>) {
  const fallback = `${fallbackPrefix}-${String(index + 1).padStart(6, "0")}`
  const base = String(rawCode || "").trim() || fallback
  let candidate = base
  let suffix = 1
  while (used.has(candidate.toUpperCase())) {
    candidate = `${fallbackPrefix}-${String(index + suffix).padStart(6, "0")}`
    suffix += 1
  }
  used.add(candidate.toUpperCase())
  return candidate
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
    case "AMBALAJ_SGR":
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

function pickStockType(
  product: AccountingProductLike | null | undefined,
  stockTypes: AccountingStockTypeLike[],
  config: AccountingConfigLike | null | undefined
) {
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

function downloadName(
  kind: string,
  from: string,
  to: string,
  options?: { company?: AccountingCompanyLike | null; firstDoc?: PurchaseReceiptLike | SalesInvoiceLike | null }
) {
  if (kind === "purchase-receipts" && options?.company) {
    const firstDoc = options.firstDoc as PurchaseReceiptLike | null | undefined
    const companyCode = String(
      firstDoc?.supplier?.cif || firstDoc?.supplierCode || firstDoc?.supplier?.code || options.company.cui || options.company.code || "FIRMA"
    ).replace(/[^A-Za-z0-9]/g, "")
    const docNumber = extractSagaNumber(firstDoc?.spvInvoiceNo || firstDoc?.docNo || "EXPORT")
    const docDate = compactDateToken(firstDoc?.docDate || from || to || new Date())
    return `F_${companyCode || "FIRMA"}_${docNumber || "EXPORT"}_${docDate}.xml`
  }

  if (kind === "sales-invoices" && options?.company) {
    const firstDoc = options.firstDoc as SalesInvoiceLike | null | undefined
    const companyCode = String(options.company.cui || options.company.code || "FIRMA").replace(/[^A-Za-z0-9]/g, "")
    const docNumber = extractSagaNumber(firstDoc?.docNo || "EXPORT")
    const docDate = compactDateToken(firstDoc?.docDate || from || to || new Date())
    return `F_${companyCode || "FIRMA"}_${docNumber || "EXPORT"}_${docDate}.xml`
  }

  if (kind === "customers") {
    return `CLI_${compactDateToken(to || from || new Date())}.xml`
  }

  if (kind === "suppliers") {
    return `FUR_${compactDateToken(to || from || new Date())}.xml`
  }

  if (kind === "products") {
    return `ART_${compactDateToken(to || from || new Date())}.xml`
  }

  const safeKind = slugCode(kind, "EXPORT")
  const fromChunk = from ? from.replace(/[^0-9]/g, "") : "ALL"
  const toChunk = to ? to.replace(/[^0-9]/g, "") : "ALL"
  return `saga_${safeKind}_${fromChunk}_${toChunk}.xml`
}

function replaceFileExtension(fileName: string, extension: ExportFileFormat) {
  return fileName.replace(/\.[^.]+$/i, `.${extension}`)
}

function zipDownloadName(kind: string, from: string, to: string) {
  const safeKind = slugCode(kind, "EXPORT")
  const fromChunk = from ? from.replace(/[^0-9]/g, "") : "ALL"
  const toChunk = to ? to.replace(/[^0-9]/g, "") : "ALL"
  return `${safeKind}_${fromChunk}_${toChunk}.zip`
}

function excelSerialDate(value: Date | string | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor(utc / 86400000) + 25569
}

function spreadsheetSheets(sheets: ExportSheet[]): ExportSheetRows {
  return Object.assign([] as ExportRow[], { __sheets: sheets })
}

function getExportSheets(rows: ExportSheetRows, sheetName: string): ExportSheet[] {
  return Array.isArray(rows.__sheets)
    ? rows.__sheets
    : [{ name: sheetName, rows }]
}

function getPrimaryExportRows(rows: ExportSheetRows): ExportRow[] {
  return Array.isArray(rows.__sheets?.[0]?.rows)
    ? rows.__sheets[0].rows
    : rows
}

function managementValue(
  config: AccountingConfigLike | null | undefined,
  location: AccountingLocationLike | null | undefined
) {
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

function xmlMeta(
  company: AccountingCompanyLike | null | undefined,
  kind: string,
  dateFrom: string,
  dateTo: string,
  valueType: string
) {
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

function buildVfpXml(rows: ExportRow[]) {
  return [
    `<VFPData>`,
    ...rows.map((row) =>
      [
        `<c_xml>`,
        ...Object.entries(row).map(([key, value]) => {
          const normalizedValue = value ?? ""
          return normalizedValue === "" ? `<${key}/>` : `<${key}>${xmlEscape(normalizedValue)}</${key}>`
        }),
        `</c_xml>`,
      ].join("\n")
    ),
    `</VFPData>`,
  ].join("\n")
}

function buildVfpXmlSections(sections: Array<{ name: string; rows: ExportRow[] }>) {
  return [
    `<VFPData>`,
    ...sections.flatMap((section) =>
      section.rows.map((row) =>
        [
          `<c_xml sectiune="${xmlEscape(section.name)}">`,
          ...Object.entries(row).map(([key, value]) => {
            const normalizedValue = value ?? ""
            return normalizedValue === "" ? `<${key}/>` : `<${key}>${xmlEscape(normalizedValue)}</${key}>`
          }),
          `</c_xml>`,
        ].join("\n")
      )
    ),
    `</VFPData>`,
  ].join("\n")
}

function sagaInvoiceStockTypeName(stockType: AccountingStockTypeLike | null | undefined) {
  const code = String(stockType?.code || "").toUpperCase()
  const name = String(stockType?.name || "").trim().toUpperCase()
  if (code === "MARFA") return "Marfuri"
  if (code === "MATERII") return "Materii prime"
  if (code === "PRODUSE") return "Produse finite"
  if (code === "AMBALAJE") return "Ambalaje"
  if (name === "MARFA" || name === "MARFURI") return "Marfuri"
  if (name.includes("MATERII")) return "Materii prime"
  if (name.includes("PRODUSE")) return "Produse finite"
  if (name.includes("AMBALAJE")) return "Ambalaje"
  return "Marfuri"
}

function isSagaSgrArticle(product: AccountingProductLike | null | undefined) {
  const code = String(product?.accountingItemCode || product?.sku || product?.code || product?.id || "").trim().toUpperCase()
  const name = String(product?.name || "").trim().toUpperCase()
  return product?.class === "AMBALAJ_SGR" || code === "SGR" || code.startsWith("SGR_") || name === "SGR"
}

function serializeAccountingProduct(product: AccountingProductLike | null | undefined) {
  if (!product) return product
  return {
    ...product,
    price: toFiniteNumber(product.price),
    costPrice: toFiniteNumber(product.costPrice),
    purchaseFactor: toFiniteNumber(product.purchaseFactor || 1),
    sgrValue: toFiniteNumber(product.sgrValue),
    vatRate: product.vatRate
      ? {
          ...product.vatRate,
          rate: toFiniteNumber(product.vatRate.rate),
        }
      : product.vatRate,
  }
}

type AccountingProductRow = ReturnType<typeof serializeAccountingProduct>

function sagaProductTypeFromClass(classValue: unknown) {
  switch (String(classValue || "").toUpperCase()) {
    case "MARFA":
      return "Marfuri"
    case "MATERIE_PRIMA":
      return "Materii prime"
    case "CONSUMABILE":
    case "ALTE_MATERIALE":
      return "Alte mat. consumabile"
    case "PRODUS_FIN":
      return "Produse finite"
    case "AMBALAJE":
      return "Ambalaje"
    case "AMBALAJ_SGR":
      return "Ambalaje SGR"
    case "REZIDUALE":
      return "Produse reziduale"
    case "SEMIFABRICATE":
      return "Semifabricate"
    case "SERVICIU_VANDUT":
      return "Servicii vandute"
    case "DISCOUNT_FINANCIAR_IESIRI":
      return "Discount financiar iesiri"
    case "DISCOUNT_COMERCIAL_IESIRI":
      return "Discount comercial iesiri"
    case "TAXA_VERDE":
      return "Taxa verde"
    default:
      return "Marfuri"
  }
}

function sagaInvoiceLineTypeFromProduct(product: AccountingProductLike | null | undefined) {
  if (isSagaSgrArticle(product)) return "Ambalaje SGR"
  return sagaProductTypeFromClass(product?.class)
}

function sagaPurchaseReceiptLineType(
  product: AccountingProductLike | null | undefined,
  _stockTypes: AccountingStockTypeLike[],
  _config: AccountingConfigLike | null | undefined
) {
  if (isSagaSgrArticle(product)) return "Ambalaje SGR"
  return sagaProductTypeFromClass(product?.class)
}

function sgrUnitValue(product: AccountingProductLike | null | undefined) {
  if (!product?.isSgr) return 0
  const value = toFiniteNumber(product?.sgrValue)
  return value > 0 ? value : 0.5
}

function sgrArticleCode(product: AccountingProductLike | null | undefined, fallbackCode?: unknown) {
  const base = product?.accountingItemCode || product?.sku || fallbackCode || product?.name || "SGR"
  return `SGR_${slugCode(String(base), "ART").slice(0, 16)}`
}

function sgrArticleName(_product: AccountingProductLike | null | undefined, _fallbackName?: unknown) {
  return "SGR"
}

function sgrProductShape(
  product: AccountingProductLike | null | undefined,
  fallbackCode?: unknown,
  fallbackName?: unknown
): AccountingProductLike {
  return {
    ...(product || {}),
    id: `${product?.id || fallbackCode || "sgr"}:sgr`,
    sku: sgrArticleCode(product, fallbackCode),
    accountingItemCode: sgrArticleCode(product, fallbackCode),
    name: sgrArticleName(product, fallbackName),
    class: "AMBALAJ_SGR",
    isSgr: false,
    sgrValue: 0,
    price: sgrUnitValue(product),
    vatRate: { rate: 0, fiscalCode: "O", name: "TVA 0%" },
    uom: product?.uom || { code: "BUC", name: "Bucata" },
    barcodes: [],
  }
}

function buildSalesInvoiceSgrLine(
  invoice: SalesInvoiceLike,
  line: AccountingExportLineLike,
  index: number,
  stockTypes: AccountingStockTypeLike[],
  config: AccountingConfigLike
) {
  const sgrTotal = toFiniteNumber(line.sgrTotalRon || line.sgrTotalFc)
  const qty = toFiniteNumber(line.qty)
  const unit = toFiniteNumber(line.sgrUnitFc || line.product?.sgrValue || (qty ? sgrTotal / qty : 0))
  if (!line.product?.isSgr || qty <= 0 || unit <= 0 || sgrTotal <= 0) return null
  const product = sgrProductShape(line.product, line.productCode, line.productName)
  const stockType = pickStockType(product, stockTypes, config)

  return {
    row: {
      TIP: "Ambalaje SGR",
      GESTIUNE: invoice.location?.code || invoice.location?.name || "",
      COD: product.accountingItemCode,
      COD_BARE: "",
      DENUMIRE: product.name,
      UM: line.uomCode || product.uom?.code || "BUC",
      P_TVA: 0,
      CANTITATE: qty,
      PRET: unit,
      VALOARE: unit,
      TOTAL: unit,
      TEXT_SUPL: "SGR",
      CONT: stockType?.salesAccount || config.salesAccount,
      ACTIVITATE: "",
    },
    xml: buildSagaFacturaLine({
      index,
      type: "Ambalaje SGR",
      management: invoice.location?.code || invoice.location?.name || "",
      activity: "",
      description: product.name,
      clientCode: product.accountingItemCode,
      guid: product.accountingItemCode,
      barcode: "",
      uom: line.uomCode || product.uom?.code || "BUC",
      qty: decimal(qty, 3),
      price: decimal(unit),
      value: decimal(sgrTotal),
      total: decimal(sgrTotal),
      vatRate: "0",
      vatValue: "0.00",
      account: stockType?.salesAccount || config.salesAccount,
      deductionType: "",
      sagaAliases: true,
    }),
  }
}

function buildSalesInvoiceHeaderRow(invoice: SalesInvoiceLike): SalesInvoiceHeaderRow {
  return {
    DENUMIRE_C: invoice.customerName || "",
    COD_FISCAL: Number(String(invoice.customerCif || "").replace(/\D/g, "") || 0),
    REGISTRU_C: invoice.customerRegNo || "",
    JUDET: sagaCountyCode(invoice.customer?.county),
    ADRESA: invoice.customerAddress || "",
    TARA: "RO",
    MONEDA: invoice.currency || "RON",
    NUMAR_FACT: invoice.docNo || "",
    DATA: formatDate(invoice.docDate),
    TVA: Number(invoice.totalVatRon || 0),
    VALOARE_NE: Number(invoice.totalNetRon || 0) + Number(invoice.totalSgrRon || 0),
    VALOARE_BR: Number(invoice.totalWithSgrRon || invoice.totalGrossRon || 0),
    DISCOUNT: 0,
  }
}

function buildSalesInvoiceProductRow(
  invoice: SalesInvoiceLike,
  line: AccountingExportLineLike,
  stockType: AccountingStockTypeLike | null | undefined,
  config: AccountingConfigLike
): SalesInvoiceDetailRow {
  return {
    TIP: sagaInvoiceLineTypeFromProduct(line.product),
    GESTIUNE: String(invoice.location?.code || invoice.location?.name || ""),
    COD: String(line.productCode || line.product?.accountingItemCode || line.product?.sku || "").trim(),
    COD_BARE: String(line.product?.barcodes?.[0]?.barcode || ""),
    DENUMIRE: String(line.productName || line.product?.name || ""),
    UM: String(line.uomCode || "BUC"),
    P_TVA: Number(line.vatRateValue || 0),
    CANTITATE: Number(line.qty || 0),
    PRET: Number(line.unitPriceFc || 0),
    VALOARE: unitAmount(line.lineNetRon, line.qty),
    TOTAL: unitAmount(line.lineGrossRon, line.qty),
    TEXT_SUPL: "",
    CONT: String(stockType?.salesAccount || config.salesAccount || ""),
    ACTIVITATE: "",
  }
}

function buildPurchaseReceiptDetailRow(
  receipt: PurchaseReceiptLike,
  line: AccountingExportLineLike,
  stockTypes: AccountingStockTypeLike[],
  stockType: AccountingStockTypeLike | null | undefined,
  config: AccountingConfigLike
): PurchaseReceiptDetailRow {
  const lineManagement = String(receipt.location?.code || receipt.location?.name || "")
  return {
    den_tip: sagaPurchaseReceiptLineType(line.product, stockTypes, config),
    gestiune: lineManagement,
    den_gest: lineManagement,
    GESTIUNE: lineManagement,
    denumire: String(line.product?.name || ""),
    cod: String(sagaArticleCodeForProduct(line.product, config)),
    um: String(line.product?.uom?.code || "BUC"),
    tva_art: Number(line.vatRateValue || 0),
    cantitate: Number(line.stockQty || line.qty || 0),
    pret_unitar: Number(line.unitCostNetRon || 0),
    valoare: unitAmount(line.lineNetRon, line.stockQty || line.qty),
    transp_lei: 0,
    total: unitAmount(line.lineGrossRon, line.stockQty || line.qty),
    tva_ded: unitAmount(line.lineVatRon, line.stockQty || line.qty),
    tip_ded: "N50",
    cont: String(stockType?.inventoryAccount || config.inventoryAccount || ""),
    pret_vanz: Number(line.product?.price || 0),
    adaos: 0,
    adaos_proc: 0,
    text_supl: "",
    categorie: "",
    ID_U: "",
    ID_INTRARE: "",
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
  }
}

function buildPurchaseReceiptHeaderRow(
  receipt: PurchaseReceiptLike,
  sgrTotalRon: number
): PurchaseReceiptHeaderRow {
  return {
    tip: "R",
    nr_nir: extractSagaNumber(receipt.docNo || ""),
    nr_intrare: extractSagaNumber(receipt.spvInvoiceNo || receipt.docNo || ""),
    cod: String(receipt.supplierCode || receipt.supplier?.code || ""),
    denumire: String(receipt.supplierName || receipt.supplier?.name || ""),
    tvai: 0,
    data: excelSerialDate(receipt.docDate),
    scadent: receipt.docDate ? excelSerialDate(receipt.docDate) : "",
    baza_tva: Number(receipt.totalNetRon || 0) + sgrTotalRon,
    transp_lei: 0,
    tva: Number(receipt.totalVatRon || 0),
    total: Number(receipt.totalGrossRon || 0) + sgrTotalRon,
    neachitat: Number(receipt.totalGrossRon || 0) + sgrTotalRon,
    data_doc: "",
    inf_suplm: "",
    den_agent: "",
    id_solicit: "",
  }
}

function buildReceiptExportLines(receipt: PurchaseReceiptLike): AccountingExportLineLike[] {
  return receipt.items.flatMap((line) => {
    const sgr = receiptSgrValues(line, receipt)
    if (!line.product?.isSgr || sgr.qty <= 0 || sgr.unit <= 0) return [line]
    const product = sgrProductShape(line.product)
    return [
      line,
      {
        ...line,
        id: `${line.id}:sgr`,
        product,
        productId: product.id,
        vatRateValue: 0,
        stockQty: sgr.qty,
        qty: sgr.qty,
        unitCostNetRon: sgr.unit,
        lineNetRon: sgr.valueRon,
        lineVatRon: 0,
        lineGrossRon: sgr.valueRon,
      },
    ]
  })
}

function buildReceiptGroupedLines(
  receipt: PurchaseReceiptLike,
  stockTypes: AccountingStockTypeLike[],
  config: AccountingConfigLike,
  valueType: string
): ReceiptExportLine[] {
  const receiptLinesForExport = buildReceiptExportLines(receipt)
  if (valueType !== "GLOBAL_VALORIC") {
    return receiptLinesForExport
  }

  return aggregateByKey(
    receiptLinesForExport,
    (line) => `${line.vatRateValue || 0}|${line.product?.accountingItemCode || line.product?.sku || line.productId}`,
    (line) => ({
      code: line.product?.accountingItemCode || line.product?.sku || slugCode(line.product?.name || "ART", "ART"),
      name: line.product?.name || "",
      type: sagaPurchaseReceiptLineType(line.product, stockTypes, config),
      vatRateValue: Number(line.vatRateValue || 0),
      valueRon: 0,
      vatRon: 0,
      stockAccount: "",
      expenseAccount: "",
    }),
    (target, line) => {
      const stockType = pickStockType(line.product, stockTypes, config)
      target.valueRon += Number(line.lineNetRon || 0)
      target.vatRon += Number(line.lineVatRon || 0)
      target.stockAccount = String(stockType?.inventoryAccount || config.inventoryAccount || "")
      target.expenseAccount = String(stockType?.expenseAccount || config.expenseAccount || "")
    }
  )
}

function buildPurchaseReceiptSupplierHeader(receipt: PurchaseReceiptLike): SagaPartnerHeader {
  return {
    name: receipt.supplierName || receipt.supplier?.name || "",
    cif: receipt.supplier?.cif || "",
    regCom: receipt.supplier?.regCom || "",
    capital: "",
    country: sagaCountryCode(receipt.supplier?.country),
    city: receipt.supplier?.city || "",
    county: receipt.supplier?.county || "",
    address: receipt.supplier?.address || "",
    phone: receipt.supplier?.phone || "",
    email: receipt.supplier?.email || "",
    bank: "",
    iban: "",
    info: "",
  }
}

function buildConsumptionSpreadsheetRow(
  document: ConsumptionDocumentLike,
  line: ConsumptionDocumentLike["items"][number],
  unitCost: number,
  config: AccountingConfigLike
): ConsumptionSpreadsheetRow {
  return {
    NR: document.docNo,
    DATA: formatDate(document.docDate),
    GESTIUNE: managementValue(config, document.location),
    DEN_GEST: String(document.location?.name || document.location?.code || ""),
    EXPLICATIE: String(line.note || document.note || ""),
    COD: String(line.ingredient.accountingItemCode || line.ingredient.sku || slugCode(line.ingredient.name || "", "ART")),
    COD_BARE: "",
    DENUMIRE: String(line.ingredient.name || ""),
    UM: String(line.ingredient.uom?.code || "BUC"),
    CANTITATE: Number(line.qty || 0),
    PRET: unitCost,
    VALOARE: Number(line.qty || 0) * unitCost,
  }
}

function buildConsumptionOperationalLine(
  document: ConsumptionDocumentLike,
  line: ConsumptionDocumentLike["items"][number],
  unitCost: number,
  stockType: AccountingStockTypeLike | null | undefined,
  config: AccountingConfigLike,
  index: number
): SagaOperationalLinePayload {
  return {
    index,
    management: managementValue(config, document.location),
    description: line.ingredient.name,
    code: line.ingredient.accountingItemCode || line.ingredient.sku || slugCode(line.ingredient.name || "", "ART"),
    guid: line.ingredient.id,
    barcode: "",
    info: line.finishedProduct?.name ? `Produs final: ${line.finishedProduct.name}` : line.note || "",
    uom: line.ingredient.uom?.code || "BUC",
    qty: decimal(line.qty, 3),
    price: decimal(unitCost),
    value: decimal(unitCost),
    vatRate: decimal(line.ingredient.vatRate?.rate ?? 0),
    expenseAccount: stockType?.expenseAccount || config.expenseAccount,
    inventoryAccount: stockType?.inventoryAccount || config.inventoryAccount,
    salesAccount: stockType?.salesAccount || config.salesAccount,
  }
}

function buildProductionSpreadsheetRow(
  document: ProductionDocumentLike,
  line: ProductionDocumentLike["items"][number],
  unitCost: number,
  stockType: AccountingStockTypeLike | null | undefined,
  config: AccountingConfigLike
): ProductionSpreadsheetRow {
  return {
    Cod: String(line.product.accountingItemCode || line.product.sku || slugCode(line.product.name || "", "ART")),
    Denumire: String(line.product.name || ""),
    UM: String(line.product.uom?.code || "BUC"),
    Cantitate: Number(line.qty || 0),
    "Pret unitar": unitCost,
    Valoare: unitCost,
    Gestiune: managementValue(config, document.location),
    Data: formatDate(document.docDate),
    "Nr. doc": document.docNo,
    Explicatie: String(document.note || "Nota de productie"),
    TVA: Number(line.product.vatRate?.rate ?? 0),
    "Cont stoc": String(stockType?.inventoryAccount || config.inventoryAccount || ""),
    "Cont cheltuiala": String(stockType?.expenseAccount || config.expenseAccount || ""),
    "Cont venit": String(stockType?.salesAccount || config.salesAccount || ""),
    Document: document.docNo,
    Articol: String(line.product.name || ""),
    Pret: unitCost,
    ContStoc: String(stockType?.inventoryAccount || config.inventoryAccount || ""),
    ContCheltuiala: String(stockType?.expenseAccount || config.expenseAccount || ""),
    ContVenit: String(stockType?.salesAccount || config.salesAccount || ""),
  }
}

function buildProductionOperationalLine(
  document: ProductionDocumentLike,
  line: ProductionDocumentLike["items"][number],
  unitCost: number,
  stockType: AccountingStockTypeLike | null | undefined,
  config: AccountingConfigLike,
  index: number
): SagaOperationalLinePayload {
  return {
    index,
    management: managementValue(config, document.location),
    description: line.product.name,
    code: line.product.accountingItemCode || line.product.sku || slugCode(line.product.name || "", "ART"),
    guid: line.product.id,
    barcode: "",
    info: document.note || "",
    uom: line.product.uom?.code || "BUC",
    qty: decimal(line.qty, 3),
    price: decimal(unitCost),
    value: decimal(Number(line.qty || 0) * unitCost),
    vatRate: decimal(line.product.vatRate?.rate ?? 0),
    expenseAccount: stockType?.expenseAccount || config.expenseAccount,
    inventoryAccount: stockType?.inventoryAccount || config.inventoryAccount,
    salesAccount: stockType?.salesAccount || config.salesAccount,
  }
}

function receiptSgrValues(line: AccountingExportLineLike, receipt: PurchaseReceiptLike) {
  const qty = toFiniteNumber(line.stockQty || line.qty)
  const unit = sgrUnitValue(line.product)
  const valueRon = qty * unit * toFiniteNumber(receipt?.fxRate || 1)
  return { qty, unit, valueRon }
}

function sagaArticleTypeFromProduct(product: AccountingProductLike | null | undefined) {
  if (isSagaSgrArticle(product)) return "Ambalaje SGR"
  return sagaProductTypeFromClass(product?.class)
}

function sagaArticleCodeForProduct(product: AccountingProductLike | null | undefined, config: AccountingConfigLike | null | undefined) {
  const code = config?.articleCodeSource === "SKU" ? product?.sku : product?.accountingItemCode || product?.sku
  return String(code || product?.sku || product?.accountingItemCode || slugCode(product?.name || "ART", "ART")).trim()
}

function buildSagaArticleXmlLine(product: AccountingProductLike, config: AccountingConfigLike | null | undefined) {
  const articleCode = sagaArticleCodeForProduct(product, config)
  return [
    `  <Linie>`,
    `    <Cod>${xmlEscape(articleCode)}</Cod>`,
    `    <Denumire>${xmlEscape(product?.name || "")}</Denumire>`,
    `    <Cod_NC/>`,
    `    <Cod_CPV/>`,
    `    <UM>${xmlEscape(product?.uom?.code || "BUC")}</UM>`,
    `    <Tip>${xmlEscape(sagaArticleTypeFromProduct(product))}</Tip>`,
    `    <TVA>${xmlEscape(sagaNumber(product?.vatRate?.rate ?? 0, 2))}</TVA>`,
    `    <P_TVA>${xmlEscape(sagaNumber(product?.vatRate?.rate ?? 0, 2))}</P_TVA>`,
    `    <Pret>${decimal(product?.price)}</Pret>`,
    `    <Pret_TVA>${decimal(Number(product?.price || 0) * (1 + Number(product?.vatRate?.rate ?? 0) / 100))}</Pret_TVA>`,
    `    <Pret_cuTVA>${decimal(Number(product?.price || 0) * (1 + Number(product?.vatRate?.rate ?? 0) / 100))}</Pret_cuTVA>`,
    `    <Cod_bare>${xmlEscape(product?.barcodes?.[0]?.barcode || "")}</Cod_bare>`,
    `    <Informatii/>`,
    `    <Guid_cod>${xmlEscape(articleCode)}</Guid_cod>`,
    `  </Linie>`,
  ].join("\n")
}

function buildSagaArticlesXml(products: AccountingProductLike[], config: AccountingConfigLike | null | undefined) {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Articole>`,
    ...products.map((product) => buildSagaArticleXmlLine(product, config)),
    `</Articole>`,
  ].join("\n")
}

function buildArticleSpreadsheetRow(
  product: AccountingProductLike,
  config: AccountingConfigLike | null | undefined
): ArticleSpreadsheetRow {
  const articleCode = sagaArticleCodeForProduct(product, config)
  return {
    COD: String(articleCode || "").trim(),
    DENUMIRE: product.name,
    UM: product.uom?.code || "BUC",
    TIP: sagaArticleTypeFromProduct(product),
    P_TVA: Number(product.vatRate?.rate ?? 0),
    PRET: Number(product.price || 0),
    PRET_CUTVA: Number(product.price || 0) * (1 + Number(product.vatRate?.rate ?? 0) / 100),
    COD_BARE: product.barcodes?.[0]?.barcode || "",
    COD_NC: "",
    COD_CPV: "",
    TEXT_SUPL: "",
  }
}

function buildCustomerSpreadsheetRow(
  customer: AccountingPartnerLike,
  code: string
): CustomerSpreadsheetRow {
  return {
    COD: code,
    DENUMIRE: customer.name || "",
    COD_FISCAL: customer.cif || "",
    REG_COM: customer.regNo || "",
    TARA: sagaCountryCode(customer.country),
    JUDET: sagaCountyCode(customer.county),
    LOCALITATE: customer.city || "",
    ADRESA: customer.address || "",
    CONT_BANCA: "",
    BANCA: "",
    TEL: customer.phone || "",
    EMAIL: customer.email || "",
    DISCOUNT: 0,
    INFORMATII: "",
    GUID_COD: customer.id,
  }
}

function buildCustomerXmlLine(customer: AccountingPartnerLike, code: string) {
  return [
    `  <Linie>`,
    `    <Cod>${xmlEscape(code)}</Cod>`,
    `    <Denumire>${xmlEscape(customer.name || "")}</Denumire>`,
    `    <Cod_fiscal>${xmlEscape(customer.cif || "")}</Cod_fiscal>`,
    `    <Reg_com>${xmlEscape(customer.regNo || "")}</Reg_com>`,
    `    <Tara>${xmlEscape(sagaCountryCode(customer.country))}</Tara>`,
    `    <Judet>${xmlEscape(sagaCountyCode(customer.county))}</Judet>`,
    `    <Localitate>${xmlEscape(customer.city || "")}</Localitate>`,
    `    <Adresa>${xmlEscape(customer.address || "")}</Adresa>`,
    `    <Cont_banca/>`,
    `    <Banca/>`,
    `    <Tel>${xmlEscape(customer.phone || "")}</Tel>`,
    `    <Email>${xmlEscape(customer.email || "")}</Email>`,
    `    <Discount>0</Discount>`,
    `    <Informatii/>`,
    `    <Guid_cod>${xmlEscape(customer.id)}</Guid_cod>`,
    `  </Linie>`,
  ].join("\n")
}

function buildSupplierSpreadsheetRow(
  supplier: AccountingPartnerLike,
  code: string
): SupplierSpreadsheetRow {
  return {
    COD: code,
    DENUMIRE: supplier.name || "",
    COD_FISCAL: supplier.cif || "",
    TARA: sagaCountryCode(supplier.country),
    JUDET: sagaCountyCode(supplier.county),
    LOCALITATE: supplier.city || "",
    ADRESA: supplier.address || "",
    CONT_BANCA: "",
    BANCA: "",
    TEL: supplier.phone || "",
    EMAIL: supplier.email || "",
    INFORMATII: "",
    GUID_COD: supplier.id,
  }
}

function buildSupplierXmlLine(supplier: AccountingPartnerLike, code: string) {
  return [
    `  <Linie>`,
    `    <Cod>${xmlEscape(code)}</Cod>`,
    `    <Denumire>${xmlEscape(supplier.name || "")}</Denumire>`,
    `    <Cod_fiscal>${xmlEscape(supplier.cif || "")}</Cod_fiscal>`,
    `    <Tara>${xmlEscape(sagaCountryCode(supplier.country))}</Tara>`,
    `    <Judet>${xmlEscape(sagaCountyCode(supplier.county))}</Judet>`,
    `    <Localitate>${xmlEscape(supplier.city || "")}</Localitate>`,
    `    <Adresa>${xmlEscape(supplier.address || "")}</Adresa>`,
    `    <Cont_banca/>`,
    `    <Banca/>`,
    `    <Tel>${xmlEscape(supplier.phone || "")}</Tel>`,
    `    <Email>${xmlEscape(supplier.email || "")}</Email>`,
    `    <Informatii/>`,
    `    <Guid_cod>${xmlEscape(supplier.id)}</Guid_cod>`,
    `  </Linie>`,
  ].join("\n")
}

function normalizeFileFormat(value: unknown): ExportFileFormat {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "dbf") return "dbf"
  if (normalized === "xlsx") return "xlsx"
  if (normalized === "csv") return "csv"
  return "xml"
}

function isReceiptAggregateLine(
  line: AccountingReceiptAggregateLine | AccountingExportLineLike
): line is AccountingReceiptAggregateLine {
  return "type" in line
}

function requireAccountingTenantId(req: AuthedRequest) {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) {
    throw new Error("Tenantul activ nu este disponibil.")
  }
  return tenantId
}

async function requireAccountingCompanyId(req: AuthedRequest) {
  const companyId = String(await requireRequestCompanyId(req) || "").trim()
  if (!companyId) {
    throw new Error("Firma activa nu este disponibila.")
  }
  return companyId
}

function sanitizeDbfFieldName(name: string, fallback: string) {
  const normalized = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
  return (normalized || fallback).slice(0, 10)
}

function parseDbfDateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const text = String(value).trim()
  if (!text) return null

  const dotMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (dotMatch) {
    const [, day, month, year] = dotMatch
    const date = new Date(`${year}-${month}-${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(`${year}-${month}-${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function detectDbfFieldType(values: unknown[]) {
  const nonEmpty = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
  if (!nonEmpty.length) return { type: "C" as const, length: 40, decimals: 0 }

  if (nonEmpty.every((value) => typeof value === "boolean")) {
    return { type: "L" as const, length: 1, decimals: 0 }
  }

  if (nonEmpty.every((value) => parseDbfDateValue(value))) {
    return { type: "D" as const, length: 8, decimals: 0 }
  }

  if (
    nonEmpty.every((value) => {
      const number = Number(value)
      return Number.isFinite(number)
    })
  ) {
    const decimals = nonEmpty.reduce<number>((max, value) => {
      const text = String(value)
      const fraction = text.includes(".") ? text.split(".")[1] : ""
      return Math.max(max, fraction.length)
    }, 0)

    const length = Math.min(
      18,
      Math.max(
        6,
        ...nonEmpty.map((value) => {
          const number = Number(value)
          const text = decimals > 0 ? number.toFixed(decimals) : `${Math.trunc(number)}`
          return text.replace("-", "").length + (number < 0 ? 1 : 0)
        })
      )
    )

    return { type: "N" as const, length, decimals: Math.min(decimals, 4) }
  }

  const maxLength = Math.min(
    254,
    Math.max(
      1,
      ...nonEmpty.map((value) => Buffer.byteLength(String(value), "ascii"))
    )
  )
  return { type: "C" as const, length: Math.max(12, maxLength), decimals: 0 }
}

function encodeDbfValue(value: unknown, field: { type: "C" | "N" | "D" | "L"; length: number; decimals: number }) {
  if (field.type === "L") {
    const raw = value === true || String(value).trim().toLowerCase() === "true" ? "T" : "F"
    return Buffer.from(raw.padEnd(field.length, " "), "ascii")
  }

  if (field.type === "D") {
    const date = parseDbfDateValue(value)
    const text = date
      ? `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, "0")}${`${date.getDate()}`.padStart(2, "0")}`
      : "".padEnd(field.length, " ")
    return Buffer.from(text.padEnd(field.length, " "), "ascii")
  }

  if (field.type === "N") {
    const number = Number(value)
    const text = Number.isFinite(number)
      ? (field.decimals > 0 ? number.toFixed(field.decimals) : `${Math.trunc(number)}`).slice(0, field.length)
      : ""
    return Buffer.from(text.padStart(field.length, " "), "ascii")
  }

  const text = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .slice(0, field.length)
  return Buffer.from(text.padEnd(field.length, " "), "ascii")
}

async function buildDbfBuffer(rows: ExportSheetRows) {
  const tableRows = getPrimaryExportRows(rows)

  const headers: string[] = Array.from(
    tableRows.reduce((acc: Set<string>, row) => {
      Object.keys(row || {}).forEach((key) => acc.add(key))
      return acc
    }, new Set<string>())
  )

  const fields = headers.map((header, index) => {
    const spec = detectDbfFieldType(tableRows.map((row) => row?.[header]))
    return {
      name: sanitizeDbfFieldName(header, `FIELD${index + 1}`),
      source: header,
      ...spec,
    }
  })

  const headerLength = 32 + fields.length * 32 + 1
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0)
  const totalLength = headerLength + tableRows.length * recordLength + 1
  const buffer = Buffer.alloc(totalLength, 0)
  const now = new Date()

  buffer[0] = 0x03
  buffer[1] = now.getFullYear() - 1900
  buffer[2] = now.getMonth() + 1
  buffer[3] = now.getDate()
  buffer.writeUInt32LE(tableRows.length, 4)
  buffer.writeUInt16LE(headerLength, 8)
  buffer.writeUInt16LE(recordLength, 10)

  fields.forEach((field, index) => {
    const offset = 32 + index * 32
    buffer.write(field.name.padEnd(11, "\0"), offset, "ascii")
    buffer.write(field.type, offset + 11, "ascii")
    buffer.writeUInt8(field.length, offset + 16)
    buffer.writeUInt8(field.decimals, offset + 17)
  })

  buffer[32 + fields.length * 32] = 0x0d

  tableRows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength
    buffer[offset] = 0x20
    offset += 1
    fields.forEach((field) => {
      encodeDbfValue(row?.[field.source], field).copy(buffer, offset)
      offset += field.length
    })
  })

  buffer[totalLength - 1] = 0x1a
  return buffer
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

async function buildSpreadsheetBuffer(sheetName: string, rows: ExportSheetRows, fileFormat: SpreadsheetFileFormat) {
  const workbook = new ExcelJS.Workbook()
  const sheets = getExportSheets(rows, sheetName)

  for (const sheet of sheets) {
    const sheetRows = Array.isArray(sheet?.rows) ? sheet.rows : []
    const worksheet = workbook.addWorksheet(String(sheet?.name || sheetName).slice(0, 31) || "Export")

    const headers: string[] = Array.from(
      sheetRows.reduce((acc: Set<string>, row) => {
        Object.keys(row || {}).forEach((key) => acc.add(key))
        return acc
      }, new Set<string>())
    )

    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.min(Math.max(header.length + 4, 14), 28),
    }))

    sheetRows.forEach((row) => {
      const normalizedRow: ExportRow = {}
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
  supplier: SagaPartnerHeader
  client: SagaPartnerHeader
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
    xmlTag("FurnizorJudet", sagaCountyCode(supplier.county)),
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
    xmlTag("ClientJudet", sagaCountyCode(client.county)),
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

function buildSagaFacturaLine(line: SagaFacturaLinePayload) {
  return [
    `          <Linie>`,
    xmlLineTag("LinieNrCrt", line.index),
    xmlLineTag("Tip", line.type),
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
    ...(line.sagaAliases
      ? [
          xmlLineTag("den_tip", line.type),
          xmlLineTag("gestiune", line.management),
          xmlLineTag("den_gest", line.management),
          xmlLineTag("GESTIUNE", line.management),
          xmlLineTag("denumire", line.description),
          xmlLineTag("cod", line.supplierCode || line.clientCode),
          xmlLineTag("um", line.uom),
          xmlLineTag("tva_art", line.vatRate),
          xmlLineTag("cantitate", line.qty),
          xmlLineTag("pret_unitar", line.price),
          xmlLineTag("valoare", line.value),
          xmlLineTag("total", line.total || line.value),
          xmlLineTag("tva_ded", line.vatValue),
          xmlLineTag("cont", line.account),
          xmlLineTag("tip_ded", line.deductionType),
          xmlLineTag("pret_vanz", line.priceSale),
          xmlLineTag("text_supl", line.info),
        ]
      : []),
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

function buildSagaOperationalLine(line: SagaOperationalLinePayload) {
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

function aggregateByKey<T, TAggregate>(
  items: T[],
  buildKey: (item: T) => string,
  seed: (item: T) => TAggregate,
  merge: (target: TAggregate, item: T) => void
) {
  const map = new Map<string, TAggregate>()
  for (const item of items) {
    const key = buildKey(item)
    if (!map.has(key)) {
      map.set(key, seed(item))
    }
    const current = map.get(key)
    if (current !== undefined) {
      merge(current, item)
    }
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
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
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
  const tenantId = requireAccountingTenantId(req)
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

  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)
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

  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)
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

  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)
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
  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)
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

  return res.json({ ok: true, items: products.map(serializeAccountingProduct) })
})

router.patch("/api/v1/reports/accounting/saga/products/:id", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = ProductAccountingSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() })
  }

  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)

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

  return res.json({ ok: true, item: serializeAccountingProduct(updated) })
})

router.get("/api/v1/reports/accounting/saga/export-preview", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = requireAccountingTenantId(req)
  const companyId = await requireAccountingCompanyId(req)
  const kind = String(req.query.kind || "").trim().toLowerCase()
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const locationId = String(req.query.locationId || "").trim()
  const partnerSearch = String(req.query.partnerSearch || "").trim()
  const selectedIds = parseIdList(req.query.selectedIds)
  const selectedIdWhere = selectedIds.length ? { id: { in: selectedIds } } : {}
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date("2000-01-01T00:00:00")
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date()
  const response = (items: PreviewItem[]) => res.json({ ok: true, items })

  if (kind === "customers") {
    const used = new Set<string>()
    const items = await prisma.customer.findMany({
      where: {
        tenantId,
        companyId,
        isActive: true,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? { AND: [{ OR: [{ name: { contains: partnerSearch, mode: "insensitive" } }, { code: { contains: partnerSearch, mode: "insensitive" } }, { cif: { contains: partnerSearch, mode: "insensitive" } }] }] }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    })
    return response(items.map((item, index) => ({ id: item.id, code: uniqueSagaCode(item.code, "CLI", index, used), label: item.name, partner: item.cif || "", date: formatDate(item.createdAt), status: "Activ" })))
  }

  if (kind === "suppliers") {
    const used = new Set<string>()
    const items = await prisma.supplier.findMany({
      where: {
        tenantId,
        companyId,
        isActive: true,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? { AND: [{ OR: [{ name: { contains: partnerSearch, mode: "insensitive" } }, { code: { contains: partnerSearch, mode: "insensitive" } }, { cif: { contains: partnerSearch, mode: "insensitive" } }] }] }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    })
    return response(items.map((item, index) => ({ id: item.id, code: uniqueSagaCode(item.code, "FUR", index, used), label: item.name, partner: item.cif || "", date: formatDate(item.createdAt), status: "Activ" })))
  }

  if (kind === "products") {
    const items = await prisma.product.findMany({
      where: {
        tenantId,
        companyId,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? { OR: [{ name: { contains: partnerSearch, mode: "insensitive" } }, { sku: { contains: partnerSearch, mode: "insensitive" } }, { accountingItemCode: { contains: partnerSearch, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    })
    return response(items.map((item) => ({ id: item.id, code: item.accountingItemCode || item.sku, label: item.name, date: formatDate(item.createdAt), status: item.isActive ? "Activ" : "Inactiv" })))
  }

  if (kind === "sales-invoices") {
    const items = await prisma.salesInvoice.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "ISSUED",
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? { AND: [{ OR: [{ customerName: { contains: partnerSearch, mode: "insensitive" } }, { customerCode: { contains: partnerSearch, mode: "insensitive" } }, { customerCif: { contains: partnerSearch, mode: "insensitive" } }] }] }
          : {}),
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    })
    return response(items.map((item) => ({ id: item.id, code: item.docNo, label: `Factura ${item.docNo}`, partner: item.customerName, date: formatDate(item.docDate), status: "Emisa", total: Number(item.totalGrossRon || 0) })))
  }

  if (kind === "purchase-receipts") {
    const items = await prisma.purchaseReceipt.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "POSTED",
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? { AND: [{ OR: [{ supplierName: { contains: partnerSearch, mode: "insensitive" } }, { supplierCode: { contains: partnerSearch, mode: "insensitive" } }] }] }
          : {}),
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    })
    return response(items.map((item) => ({ id: item.id, code: item.docNo, label: `NIR ${item.docNo}`, partner: item.supplierName || "", date: formatDate(item.docDate), status: "Finalizat", total: Number(item.totalGrossRon || 0) })))
  }

  if (kind === "consumption-docs") {
    const items = await prisma.consumptionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "VALIDATED",
        aggregateParentId: null,
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    })
    return response(items.map((item) => ({ id: item.id, code: item.docNo, label: `Bon consum ${item.docNo}`, date: formatDate(item.docDate), status: item.status })))
  }

  if (kind === "production-docs") {
    const items = await prisma.productionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    })
    return response(items.map((item) => ({ id: item.id, code: item.docNo, label: `Productie ${item.docNo}`, date: formatDate(item.docDate), status: "Creat" })))
  }

  return res.status(400).json({ ok: false, error: "Tip de export contabil necunoscut." })
})

router.get("/api/v1/reports/accounting/saga/export", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = requireAccountingTenantId(req)
  const company = await requireRequestCompany(req)
  const companyId = company.id
  const kind = String(req.query.kind || "").trim().toLowerCase()
  const fileFormat = normalizeFileFormat(req.query.fileFormat)
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const locationId = String(req.query.locationId || "").trim()
  const partnerSearch = String(req.query.partnerSearch || "").trim()
  const valueType = normalizeValueType(req.query.valueType)
  const splitFiles = String(req.query.splitFiles || "").trim().toLowerCase() === "true"
  const selectedIds = parseIdList(req.query.selectedIds)
  const selectedIdWhere = selectedIds.length ? { id: { in: selectedIds } } : {}
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date("2000-01-01T00:00:00")
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date()

  const { config, stockTypes } = await ensureAccountingConfig(tenantId, companyId)
  let xml = ""
  let sheetName = "Export contabilitate"
  let spreadsheetRows: ExportRow[] = []
  let exportedFileDoc: SalesInvoiceLike | PurchaseReceiptLike | null = null
  let xmlFiles: Array<{ fileName: string; content: string }> = []
  let splitSpreadsheetFiles: SplitSpreadsheetFile[] = []

  if (kind === "products") {
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        companyId,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? {
              OR: [
                { name: { contains: partnerSearch, mode: "insensitive" } },
                { sku: { contains: partnerSearch, mode: "insensitive" } },
                { accountingItemCode: { contains: partnerSearch, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        vatRate: true,
        uom: true,
        accountingStockType: true,
        barcodes: {
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { name: "asc" },
    })

    sheetName = "Articole"
    const articleProducts: AccountingProductLike[] = products.flatMap((product) => {
      const rows: AccountingProductLike[] = [product]
      if (product.isSgr && sgrUnitValue(product) > 0) rows.push(sgrProductShape(product))
      return rows
    })

    spreadsheetRows = articleProducts.map((product) => buildArticleSpreadsheetRow(product, config))

    xmlFiles = articleProducts.map((product) => ({
      fileName: `ART_${slugCode(String(product.accountingItemCode || product.sku || product.name || ""), "ART")}_${compactDateToken(dateTo || new Date())}.xml`,
      content: buildSagaArticlesXml([product], config),
    }))
    splitSpreadsheetFiles = articleProducts.map((product) => {
      return {
        fileName: `ART_${slugCode(String(product.accountingItemCode || product.sku || product.name || ""), "ART")}_${compactDateToken(dateTo || new Date())}`,
        sheetName: "Articole",
        rows: [buildArticleSpreadsheetRow(product, config)],
      }
    })

    xml = buildSagaArticlesXml(articleProducts, config)
  } else if (kind === "customers") {
    const customers = await prisma.customer.findMany({
      where: {
        tenantId,
        companyId,
        isActive: true,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? {
              AND: [
                {
                  OR: [
                    { name: { contains: partnerSearch, mode: "insensitive" } },
                    { code: { contains: partnerSearch, mode: "insensitive" } },
                    { cif: { contains: partnerSearch, mode: "insensitive" } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    })
    const usedCustomerCodes = new Set<string>()
    const customerCodeById = new Map<string, string>(
      customers.map((customer, index) => [customer.id, uniqueSagaCode(customer.code, "CLI", index, usedCustomerCodes)])
    )
    const customerCode = (customer: AccountingPartnerLike) => customerCodeById.get(String(customer.id || "")) || customer.code || slugCode(customer.name || "", "CLI")

    sheetName = "Clienti"
    spreadsheetRows = customers.map((customer) => buildCustomerSpreadsheetRow(customer, customerCode(customer)))

    const buildCustomerXml = (customer: AccountingPartnerLike) =>
      [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<Clienti>`,
        buildCustomerXmlLine(customer, customerCode(customer)),
        `</Clienti>`,
      ].join("\n")

    xmlFiles = customers.map((customer) => ({
      fileName: `CLI_${slugCode(customerCode(customer) || customer.name, "CLIENT")}_${compactDateToken(dateTo || new Date())}.xml`,
      content: buildCustomerXml(customer),
    }))
    splitSpreadsheetFiles = customers.map((customer) => ({
      fileName: `CLI_${slugCode(customerCode(customer) || customer.name, "CLIENT")}_${compactDateToken(dateTo || new Date())}`,
      sheetName: "Clienti",
      rows: [buildCustomerSpreadsheetRow(customer, customerCode(customer))],
    }))

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Clienti>`,
      ...customers.map((customer) => buildCustomerXmlLine(customer, customerCode(customer))),
      `</Clienti>`,
    ].join("\n")
  } else if (kind === "suppliers") {
    const suppliers = await prisma.supplier.findMany({
      where: {
        tenantId,
        companyId,
        isActive: true,
        createdAt: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(partnerSearch
          ? {
              AND: [
                {
                  OR: [
                    { name: { contains: partnerSearch, mode: "insensitive" } },
                    { code: { contains: partnerSearch, mode: "insensitive" } },
                    { cif: { contains: partnerSearch, mode: "insensitive" } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    })
    const usedSupplierCodes = new Set<string>()
    const supplierCodeById = new Map<string, string>(
      suppliers.map((supplier, index) => [supplier.id, uniqueSagaCode(supplier.code, "FUR", index, usedSupplierCodes)])
    )
    const supplierCode = (supplier: AccountingPartnerLike) => supplierCodeById.get(String(supplier.id || "")) || supplier.code || slugCode(supplier.name || "", "FUR")

    sheetName = "Furnizori"
    spreadsheetRows = suppliers.map((supplier) => buildSupplierSpreadsheetRow(supplier, supplierCode(supplier)))

    const buildSupplierXml = (supplier: AccountingPartnerLike) =>
      [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<Furnizori>`,
        buildSupplierXmlLine(supplier, supplierCode(supplier)),
        `</Furnizori>`,
      ].join("\n")

    xmlFiles = suppliers.map((supplier) => ({
      fileName: `FUR_${slugCode(supplierCode(supplier) || supplier.name, "FURNIZOR")}_${compactDateToken(dateTo || new Date())}.xml`,
      content: buildSupplierXml(supplier),
    }))
    splitSpreadsheetFiles = suppliers.map((supplier) => ({
      fileName: `FUR_${slugCode(supplierCode(supplier) || supplier.name, "FURNIZOR")}_${compactDateToken(dateTo || new Date())}`,
      sheetName: "Furnizori",
      rows: [buildSupplierSpreadsheetRow(supplier, supplierCode(supplier))],
    }))

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Furnizori>`,
      ...suppliers.map((supplier) => buildSupplierXmlLine(supplier, supplierCode(supplier))),
      `</Furnizori>`,
    ].join("\n")
  } else if (kind === "sales-invoices") {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "ISSUED",
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? {
              AND: [
                {
                  OR: [
                    { customerName: { contains: partnerSearch, mode: "insensitive" } },
                    { customerCode: { contains: partnerSearch, mode: "insensitive" } },
                    { customerCif: { contains: partnerSearch, mode: "insensitive" } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: {
        location: true,
        customer: true,
        items: {
          include: {
            product: {
              include: {
                accountingStockType: true,
                barcodes: {
                  take: 1,
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })
    exportedFileDoc = invoices[invoices.length - 1] || null

    sheetName = "Facturi iesire"
    const invoiceHeaderRows = invoices.map((invoice) => buildSalesInvoiceHeaderRow(invoice))

    const invoiceDetailRows = invoices.flatMap((invoice) =>
      invoice.items.flatMap((line, lineIndex) => {
        const stockType = pickStockType(line.product, stockTypes, config)
        const productRow = buildSalesInvoiceProductRow(invoice, line, stockType, config)
        const sgrLine = buildSalesInvoiceSgrLine(invoice, line, lineIndex + 1, stockTypes, config)
        return sgrLine ? [productRow, sgrLine.row] : [productRow]
      })
    )

    spreadsheetRows =
      fileFormat === "dbf"
        ? invoiceDetailRows
        : spreadsheetSheets([
            {
              name: "ContinutFactura",
              rows: invoiceDetailRows,
            },
            {
              name: "Facturi",
              rows: invoiceHeaderRows,
            },
          ])

    const buildInvoiceXml = (invoice: SalesInvoiceLike) =>
      [
        `  <Factura>`,
        buildSagaFacturaHeader({
          supplier: {
            name: company.name,
            cif: company.cui,
            regCom: company.regNo,
            capital: "",
            country: sagaCountryCode(company.country),
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
            regCom: invoice.customerRegNo || "",
            country: sagaCountryCode(invoice.customer?.country),
            city: invoice.customer?.city || "",
            county: invoice.customer?.county || "",
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
          info: "",
          code: invoice.customerCode || "",
          reverseCharge: false,
          vatOnCash: false,
          facturaTip: "",
          greutate: "",
          accize: "",
          clientGuid: invoice.customerCode || invoice.customerCif || invoice.customerName || "",
        }),
        `      <Detalii>`,
        `        <Continut>`,
        ...invoice.items.flatMap((line, index: number) => {
          const stockType = pickStockType(line.product, stockTypes, config)
          const productLine = buildSagaFacturaLine({
            index: index * 2 + 1,
            type: sagaInvoiceLineTypeFromProduct(line.product),
            management: invoice.location?.code || invoice.location?.name || "",
            activity: "",
            description: line.productName || line.product?.name,
            clientCode: line.productCode || line.product?.accountingItemCode || line.product?.sku || slugCode(line.productName || "", "ART"),
            guid: line.productId || line.productCode || "",
            barcode: line.product?.barcodes?.[0]?.barcode || "",
            uom: line.uomCode || "BUC",
            qty: decimal(line.qty, 3),
            price: decimal(line.unitPriceFc),
            value: decimal(line.lineNetRon),
            total: decimal(line.lineGrossRon),
            vatRate: sagaNumber(line.vatRateValue, 2),
            vatValue: decimal(line.lineVatRon),
            account: stockType?.salesAccount || config.salesAccount,
            deductionType: "",
            sagaAliases: true,
          })
          const sgrLine = buildSalesInvoiceSgrLine(invoice, line, index * 2 + 2, stockTypes, config)
          return sgrLine ? [productLine, sgrLine.xml] : [productLine]
        }),
        `        </Continut>`,
        `      </Detalii>`,
        `      <FacturaID>${xmlEscape(invoice.id)}</FacturaID>`,
        `  </Factura>`,
      ].join("\n")

    xmlFiles = invoices.map((invoice) => ({
      fileName: downloadName("sales-invoices", dateFrom, dateTo, { company, firstDoc: invoice }),
      content: [`<?xml version="1.0" encoding="utf-8"?>`, `<Facturi>`, buildInvoiceXml(invoice), `</Facturi>`].join("\n"),
    }))
    splitSpreadsheetFiles = invoices.map((invoice) => {
      const invoiceHeaderRow = buildSalesInvoiceHeaderRow(invoice)
      const invoiceDetailRowsForFile = invoice.items.flatMap((line, lineIndex) => {
        const stockType = pickStockType(line.product, stockTypes, config)
        const productRow = buildSalesInvoiceProductRow(invoice, line, stockType, config)
        const sgrLine = buildSalesInvoiceSgrLine(invoice, line, lineIndex + 1, stockTypes, config)
        return sgrLine ? [productRow, sgrLine.row] : [productRow]
      })
      return {
        fileName: downloadName("sales-invoices", dateFrom, dateTo, { company, firstDoc: invoice }).replace(/\.[^.]+$/i, ""),
        sheetName: "Facturi iesire",
        rows:
          fileFormat === "dbf"
            ? invoiceDetailRowsForFile
            : spreadsheetSheets([
                { name: "ContinutFactura", rows: invoiceDetailRowsForFile },
                { name: "Facturi", rows: [invoiceHeaderRow] },
              ]),
      }
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Facturi>`,
      ...invoices.map((invoice) => buildInvoiceXml(invoice)),
      `</Facturi>`,
    ].join("\n")
  } else if (kind === "purchase-receipts") {
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "POSTED",
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
        ...(locationId ? { locationId } : {}),
        ...(partnerSearch
          ? {
              AND: [
                {
                  OR: [
                    { supplierName: { contains: partnerSearch, mode: "insensitive" } },
                    { supplierCode: { contains: partnerSearch, mode: "insensitive" } },
                  ],
                },
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
                uom: true,
                vatRate: true,
                barcodes: {
                  take: 1,
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        },
      },
      orderBy: { docDate: "asc" },
    })
    exportedFileDoc = receipts[receipts.length - 1] || null

    sheetName = "Facturi intrare"
    const receiptSgrTotalRon = (receipt: PurchaseReceiptLike) =>
      receipt.items.reduce((sum: number, line) => sum + receiptSgrValues(line, receipt).valueRon, 0)

    spreadsheetRows = spreadsheetSheets([
      {
        name: "IntrariDetalii",
        rows: receipts.flatMap((receipt) =>
          receipt.items.flatMap((line) => {
            const stockType = pickStockType(line.product, stockTypes, config)
            const productRow = buildPurchaseReceiptDetailRow(receipt, line, stockTypes, stockType, config)
            const sgr = receiptSgrValues(line, receipt)
            if (!line.product?.isSgr || sgr.qty <= 0 || sgr.unit <= 0) return [productRow]
            const sgrProduct = sgrProductShape(line.product)
            const sgrStockType = pickStockType(sgrProduct, stockTypes, config)
            return [
              productRow,
              {
                ...productRow,
                den_tip: "Ambalaje SGR",
                denumire: sgrProduct.name,
                cod: sgrProduct.accountingItemCode,
                tva_art: 0,
                pret_unitar: sgr.unit,
                valoare: sgr.unit,
                total: sgr.unit,
                tva_ded: 0,
                cont: sgrStockType?.inventoryAccount || config.inventoryAccount,
                pret_vanz: sgr.unit,
                text_supl: "SGR",
                ID_SGR: 1,
              },
            ]
          })
        ),
      },
      {
        name: "Intrari",
        rows: receipts.map((receipt) => buildPurchaseReceiptHeaderRow(receipt, receiptSgrTotalRon(receipt))),
      },
    ])

    const buildReceiptXml = (receipt: PurchaseReceiptLike) => {
      const groupedLines = buildReceiptGroupedLines(receipt, stockTypes, config, valueType)

      return [
        `  <Factura>`,
        buildSagaFacturaHeader({
          supplier: buildPurchaseReceiptSupplierHeader(receipt),
          client: {
            name: company.name,
            cif: company.cui,
            regCom: company.regNo,
            country: sagaCountryCode(company.country),
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
          facturaTip: "",
          greutate: "",
          accize: "",
          clientGuid: receipt.supplierCode || receipt.supplier?.code || receipt.supplier?.cif || "",
        }),
        `      <Detalii>`,
        `        <Continut>`,
        ...groupedLines.map((line, index: number) => {
          if (isReceiptAggregateLine(line)) {
            return buildSagaFacturaLine({
              index: index + 1,
              type: line.type || "Marfuri",
              management: receipt.location?.code || receipt.location?.name || "",
              description: line.name,
              supplierCode: line.code,
              guid: line.code,
              value: decimal(line.valueRon),
              total: decimal(Number(line.valueRon || 0) + Number(line.vatRon || 0)),
              vatRate: sagaNumber(line.vatRateValue, 2),
              vatValue: decimal(line.vatRon),
              account: line.stockAccount,
              activity: "",
              deductionType: "",
              sagaAliases: true,
            })
          }

          const receiptLine = line
          const stockType = pickStockType(receiptLine.product, stockTypes, config)
          return buildSagaFacturaLine({
            index: index + 1,
            type: sagaPurchaseReceiptLineType(receiptLine.product, stockTypes, config),
            management: receipt.location?.code || receipt.location?.name || "",
            activity: "",
            description: receiptLine.product?.name || "",
            supplierCode: sagaArticleCodeForProduct(receiptLine.product, config),
            clientCode: sagaArticleCodeForProduct(receiptLine.product, config),
            guid: sagaArticleCodeForProduct(receiptLine.product, config),
            barcode: receiptLine.product?.barcodes?.[0]?.barcode || "",
            uom: receiptLine.product?.uom?.code || "BUC",
            qty: decimal(receiptLine.stockQty || receiptLine.qty, 3),
            price: decimal(receiptLine.unitCostNetRon),
            value: decimal(receiptLine.lineNetRon),
            total: decimal(receiptLine.lineGrossRon),
            vatRate: sagaNumber(receiptLine.vatRateValue, 2),
            vatValue: decimal(receiptLine.lineVatRon),
            account: stockType?.inventoryAccount || config.inventoryAccount,
            deductionType: "",
            priceSale: receiptLine.product?.price ? decimal(receiptLine.product.price) : "",
            sagaAliases: true,
          })
        }),
        `        </Continut>`,
        `      </Detalii>`,
        `      <FacturaID>${xmlEscape(receipt.id)}</FacturaID>`,
        `  </Factura>`,
      ].join("\n")
    }

    xmlFiles = receipts.map((receipt) => {
      const supplierCode = String(receipt.supplier?.cif || receipt.supplierCode || receipt.supplier?.code || "FURNIZOR").replace(/[^A-Za-z0-9]/g, "")
      const docNumber = extractSagaNumber(receipt.spvInvoiceNo || receipt.docNo || "NIR")
      const docDate = compactDateToken(receipt.docDate || dateTo || new Date())
      return {
        fileName: `F_${supplierCode || "FURNIZOR"}_${docNumber || "NIR"}_${docDate}.xml`,
        content: [`<?xml version="1.0" encoding="utf-8"?>`, `<Facturi>`, buildReceiptXml(receipt), `</Facturi>`].join("\n"),
      }
    })
    splitSpreadsheetFiles = receipts.map((receipt) => {
      const receiptSgrForFile = receipt.items.reduce((sum: number, line) => sum + receiptSgrValues(line, receipt).valueRon, 0)
      const detailsRows = receipt.items.flatMap((line) => {
        const stockType = pickStockType(line.product, stockTypes, config)
        const productRow = buildPurchaseReceiptDetailRow(receipt, line, stockTypes, stockType, config)
        const sgr = receiptSgrValues(line, receipt)
        if (!line.product?.isSgr || sgr.qty <= 0 || sgr.unit <= 0) return [productRow]
        const sgrProduct = sgrProductShape(line.product)
        const sgrStockType = pickStockType(sgrProduct, stockTypes, config)
        return [
          productRow,
          {
            ...productRow,
            den_tip: "Ambalaje SGR",
            denumire: sgrProduct.name,
            cod: sgrProduct.accountingItemCode,
            tva_art: 0,
            pret_unitar: sgr.unit,
            valoare: sgr.unit,
            total: sgr.unit,
            tva_ded: 0,
            cont: sgrStockType?.inventoryAccount || config.inventoryAccount,
            pret_vanz: sgr.unit,
            text_supl: "SGR",
            ID_SGR: 1,
          },
        ]
      })
      const headerRows = [buildPurchaseReceiptHeaderRow(receipt, receiptSgrForFile)]
      const supplierCode = String(receipt.supplier?.cif || receipt.supplierCode || receipt.supplier?.code || "FURNIZOR").replace(/[^A-Za-z0-9]/g, "")
      const docNumber = extractSagaNumber(receipt.spvInvoiceNo || receipt.docNo || "NIR")
      const docDate = compactDateToken(receipt.docDate || dateTo || new Date())
      return {
        fileName: `F_${supplierCode || "FURNIZOR"}_${docNumber || "NIR"}_${docDate}`,
        sheetName: "Facturi intrare",
        rows:
          fileFormat === "dbf"
            ? detailsRows
            : spreadsheetSheets([
                { name: "IntrariDetalii", rows: detailsRows },
                { name: "Intrari", rows: headerRows },
              ]),
      }
    })

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<Facturi>`,
      ...receipts.map((receipt) => buildReceiptXml(receipt)),
      `</Facturi>`,
    ].join("\n")
  } else if (kind === "consumption-docs") {
    const documents = await prisma.consumptionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        status: "VALIDATED",
        aggregateParentId: null,
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
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
        const row = buildConsumptionSpreadsheetRow(document, line, unitCost, config)
        return {
          NR: row.NR,
          DATA: row.DATA,
          GESTIUNE: row.GESTIUNE,
          DEN_GEST: row.DEN_GEST,
          EXPLICATIE: row.EXPLICATIE,
          COD: row.COD,
          COD_BARE: row.COD_BARE,
          DENUMIRE: row.DENUMIRE,
          UM: row.UM,
          CANTITATE: row.CANTITATE,
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
            return buildSagaOperationalLine(
              buildConsumptionOperationalLine(document, line, unitCost, stockType, config, index + 1)
            )
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
    splitSpreadsheetFiles = documents.map((document) => ({
      fileName: `BC_${extractSagaNumber(document.docNo || "DOC")}_${compactDateToken(document.docDate || dateTo || new Date())}`,
      sheetName: "Bonuri consum",
      rows: document.items.map((line) => {
        const unitCost = latestCostMap.get(line.ingredientId) ?? Number(line.ingredient?.costPrice || 0)
        return buildConsumptionSpreadsheetRow(document, line, unitCost, config)
      }),
    }))
  } else if (kind === "production-docs") {
    const documents = await prisma.productionDoc.findMany({
      where: {
        ...buildCompanyScopedTenantWhere(tenantId, companyId),
        docDate: { gte: from, lte: to },
        ...selectedIdWhere,
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
        return buildProductionSpreadsheetRow(document, line, unitCost, stockType, config)
      })
    )

    const buildProductionXml = (document: ProductionDocumentLike) =>
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
        ...document.items.map((line, index: number) => {
          const stockType = pickStockType(line.product, stockTypes, config)
          const unitCost = latestCostMap.get(line.productId) ?? Number(line.product.costPrice || 0)
          return buildSagaOperationalLine(
            buildProductionOperationalLine(document, line, unitCost, stockType, config, index + 1)
          )
        }),
        `        </Continut>`,
        `      </Detalii>`,
        `      <DocumentID>${xmlEscape(document.id)}</DocumentID>`,
        `    </DocumentProductie>`,
      ].join("\n")

    xmlFiles = documents.map((document) => ({
      fileName: `PROD_${extractSagaNumber(document.docNo || "DOC")}_${compactDateToken(document.docDate || dateTo || new Date())}.xml`,
      content: [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<SAGA tip="Productie">`,
        xmlMeta(company, kind, dateFrom, dateTo, valueType),
        `  <Productie>`,
        buildProductionXml(document),
        `  </Productie>`,
        `</SAGA>`,
      ].join("\n"),
    }))

    xml = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<SAGA tip="Productie">`,
      xmlMeta(company, kind, dateFrom, dateTo, valueType),
      `  <Productie>`,
      ...documents.map((document) => buildProductionXml(document)),
      `  </Productie>`,
      `</SAGA>`,
    ].join("\n")
    splitSpreadsheetFiles = documents.map((document) => ({
      fileName: `PROD_${extractSagaNumber(document.docNo || "DOC")}_${compactDateToken(document.docDate || dateTo || new Date())}`,
      sheetName: "Productie",
      rows: document.items.map((line) => {
        const stockType = pickStockType(line.product, stockTypes, config)
        const unitCost = latestCostMap.get(line.productId) ?? Number(line.product.costPrice || 0)
        return buildProductionSpreadsheetRow(document, line, unitCost, stockType, config)
      }),
    }))
  } else {
    return res.status(400).json({ ok: false, error: "Tip de export contabil necunoscut." })
  }

  const baseFileName = downloadName(kind, dateFrom, dateTo, { company, firstDoc: exportedFileDoc })

  if (fileFormat === "xml" && splitFiles && xmlFiles.length > 0) {
    const zip = new AdmZip()
    xmlFiles.forEach((file) => {
      zip.addFile(file.fileName, Buffer.from(file.content, "utf8"))
    })
    const zipBuffer = zip.toBuffer()
    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${zipDownloadName(kind, dateFrom, dateTo)}"`)
    return res.status(200).send(zipBuffer)
  }

  if ((fileFormat === "xlsx" || fileFormat === "csv" || fileFormat === "dbf") && splitFiles && splitSpreadsheetFiles.length > 0) {
    const zip = new AdmZip()
    for (const file of splitSpreadsheetFiles) {
      const buffer =
        fileFormat === "dbf"
          ? await buildDbfBuffer(file.rows)
          : await buildSpreadsheetBuffer(file.sheetName, file.rows, fileFormat)
      zip.addFile(`${file.fileName}.${fileFormat}`, buffer)
    }
    const zipBuffer = zip.toBuffer()
    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${zipDownloadName(kind, dateFrom, dateTo)}"`)
    return res.status(200).send(zipBuffer)
  }

  if (fileFormat === "xlsx" || fileFormat === "csv" || fileFormat === "dbf") {
    const buffer =
      fileFormat === "dbf"
        ? await buildDbfBuffer(spreadsheetRows)
        : await buildSpreadsheetBuffer(sheetName, spreadsheetRows, fileFormat)
    res.setHeader(
      "Content-Type",
      fileFormat === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : fileFormat === "csv"
          ? "text/csv; charset=utf-8"
          : "application/x-dbf"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${replaceFileExtension(baseFileName, fileFormat)}"`)
    return res.status(200).send(buffer)
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${replaceFileExtension(baseFileName, "xml")}"`)
  return res.status(200).send(xml)
})

export default router
