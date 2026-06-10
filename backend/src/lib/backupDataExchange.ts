import path from "path"
import AdmZip from "adm-zip"
import ExcelJS from "exceljs"
import { prisma } from "./prisma"

type ExchangeModuleKey =
  | "companies"
  | "locations"
  | "departments"
  | "categories"
  | "uoms"
  | "vatRates"
  | "customers"
  | "suppliers"
  | "products"

type WorkbookRow = Record<string, unknown>

type TemplateColumn = {
  key: string
  label: string
  width?: number
  aliases?: string[]
}

type ExportModuleDefinition = {
  key: ExchangeModuleKey
  fileName: string
  sheetName: string
  columns: TemplateColumn[]
}

type ExchangeExportItem = ExportModuleDefinition & {
  rows: Array<Record<string, string | number | boolean | null>>
}

const EXPORT_DATE_TOKEN = new Date().toISOString().slice(0, 10)

const MODULE_DEFINITIONS: Record<ExchangeModuleKey, ExportModuleDefinition> = {
  companies: {
    key: "companies",
    fileName: "01-Firme.xlsx",
    sheetName: "Firme",
    columns: [
      { key: "companyCode", label: "Cod firma", aliases: ["code"] },
      { key: "companyName", label: "Denumire firma", aliases: ["name"] },
      { key: "cui", label: "CUI" },
      { key: "regNo", label: "Nr. Reg. Com." },
      { key: "address", label: "Adresa" },
      { key: "city", label: "Oras" },
      { key: "county", label: "Judet" },
      { key: "country", label: "Tara" },
      { key: "postalCode", label: "Cod postal" },
      { key: "bank", label: "Banca" },
      { key: "iban", label: "IBAN" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Telefon" },
      { key: "contactEmail", label: "Email contact" },
      { key: "isDefault", label: "Firma implicita (Da/Nu)", aliases: ["implicit"] },
      { key: "isVatPayer", label: "Platitor TVA (Da/Nu)" },
    ],
  },
  locations: {
    key: "locations",
    fileName: "02-Locatii.xlsx",
    sheetName: "Locatii",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "code", label: "Cod locatie" },
      { key: "name", label: "Denumire locatie" },
      { key: "address", label: "Adresa" },
      { key: "city", label: "Oras" },
      { key: "county", label: "Judet" },
      { key: "country", label: "Tara" },
      { key: "postalCode", label: "Cod postal" },
      { key: "isActive", label: "Activa (Da/Nu)" },
    ],
  },
  departments: {
    key: "departments",
    fileName: "03-Departamente.xlsx",
    sheetName: "Departamente",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "name", label: "Denumire departament" },
      { key: "isActive", label: "Activ (Da/Nu)" },
    ],
  },
  categories: {
    key: "categories",
    fileName: "04-Categorii.xlsx",
    sheetName: "Categorii",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "departmentName", label: "Departament" },
      { key: "name", label: "Denumire categorie" },
      { key: "imageUrl", label: "Link imagine" },
      { key: "isActive", label: "Activa (Da/Nu)" },
      { key: "isVisibleInPos", label: "Vizibila in POS (Da/Nu)" },
    ],
  },
  uoms: {
    key: "uoms",
    fileName: "05-Unitati-de-masura.xlsx",
    sheetName: "Unitati de masura",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "code", label: "Cod UM" },
      { key: "name", label: "Denumire UM" },
      { key: "standardCode", label: "Cod standard" },
      { key: "isActive", label: "Activa (Da/Nu)" },
    ],
  },
  vatRates: {
    key: "vatRates",
    fileName: "06-Cote-TVA.xlsx",
    sheetName: "Cote TVA",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "name", label: "Denumire TVA" },
      { key: "rate", label: "Cota TVA" },
      { key: "fiscalCode", label: "Cod fiscal" },
      { key: "isActive", label: "Activa (Da/Nu)" },
    ],
  },
  customers: {
    key: "customers",
    fileName: "07-Clienti.xlsx",
    sheetName: "Clienti",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "code", label: "Cod client" },
      { key: "name", label: "Denumire client" },
      { key: "cif", label: "CIF/CUI" },
      { key: "regNo", label: "Nr. Reg. Com." },
      { key: "address", label: "Adresa" },
      { key: "city", label: "Oras" },
      { key: "county", label: "Judet" },
      { key: "country", label: "Tara" },
      { key: "postalCode", label: "Cod postal" },
      { key: "phone", label: "Telefon" },
      { key: "email", label: "Email" },
      { key: "vatPayer", label: "Platitor TVA (Da/Nu)" },
      { key: "isActive", label: "Activ (Da/Nu)" },
    ],
  },
  suppliers: {
    key: "suppliers",
    fileName: "08-Furnizori.xlsx",
    sheetName: "Furnizori",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "code", label: "Cod furnizor" },
      { key: "name", label: "Denumire furnizor" },
      { key: "cif", label: "CIF/CUI" },
      { key: "regCom", label: "Nr. Reg. Com." },
      { key: "address", label: "Adresa" },
      { key: "city", label: "Oras" },
      { key: "county", label: "Judet" },
      { key: "country", label: "Tara" },
      { key: "postalCode", label: "Cod postal" },
      { key: "phone", label: "Telefon" },
      { key: "email", label: "Email" },
      { key: "vatPayer", label: "Platitor TVA (Da/Nu)" },
      { key: "isActive", label: "Activ (Da/Nu)" },
    ],
  },
  products: {
    key: "products",
    fileName: "09-Produse.xlsx",
    sheetName: "Produse",
    columns: [
      { key: "companyCode", label: "Cod firma" },
      { key: "sku", label: "SKU produs" },
      { key: "name", label: "Denumire produs" },
      { key: "class", label: "Clasa produs" },
      { key: "departmentName", label: "Departament" },
      { key: "categoryName", label: "Categorie" },
      { key: "vatRate", label: "Cota TVA" },
      { key: "stockUom", label: "UM stoc" },
      { key: "purchaseUom", label: "UM achizitie" },
      { key: "purchaseFactor", label: "Factor conversie" },
      { key: "price", label: "Pret vanzare" },
      { key: "costPrice", label: "Pret achizitie" },
      { key: "productionMode", label: "Mod productie" },
      { key: "imageUrl", label: "Link imagine" },
      { key: "isActive", label: "Activ (Da/Nu)" },
      { key: "isVisibleInPos", label: "Vizibil in POS (Da/Nu)" },
      { key: "isSgr", label: "Produs cu SGR (Da/Nu)" },
      { key: "sgrValue", label: "Valoare SGR" },
      { key: "accountingItemCode", label: "Cod articol contabil" },
    ],
  },
}

const MODULE_ORDER: ExchangeModuleKey[] = [
  "companies",
  "locations",
  "departments",
  "categories",
  "uoms",
  "vatRates",
  "customers",
  "suppliers",
  "products",
]

function toCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "bigint") return value.toString()
  return String(value)
}

function normalizeText(value: unknown) {
  return String(value || "").trim()
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value)
  return text || null
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  const text = String(value || "").trim().toLowerCase()
  if (!text) return fallback
  return ["1", "true", "da", "yes", "y"].includes(text)
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = String(value || "").trim().replace(",", ".")
  if (!text) return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : fallback
}

function simplifyText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

function getColumnWidth(label: string, width?: number) {
  if (typeof width === "number" && Number.isFinite(width)) return width
  return Math.min(Math.max(label.length + 4, 18), 32)
}

async function buildWorkbookBuffer(definition: ExportModuleDefinition, rows: WorkbookRow[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(definition.sheetName.slice(0, 31) || "Export")

  worksheet.columns = definition.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: getColumnWidth(column.label, column.width),
  }))

  rows.forEach((row) => {
    const normalized: Record<string, string | number | boolean | null> = {}
    definition.columns.forEach((column) => {
      normalized[column.key] = toCellValue(row?.[column.key])
    })
    worksheet.addRow(normalized)
  })

  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "17324D" },
  }
  worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" }
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: definition.columns.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

function findColumnByHeader(definition: ExportModuleDefinition, header: string) {
  const target = simplifyText(header)
  return definition.columns.find((column) => {
    if (simplifyText(column.label) === target) return true
    if (simplifyText(column.key) === target) return true
    return (column.aliases || []).some((alias) => simplifyText(alias) === target)
  })
}

async function readWorkbookRows(definition: ExportModuleDefinition, buffer: Buffer | Uint8Array) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const headerRow = worksheet.getRow(1)
  const headerValues = Array.isArray(headerRow.values) ? headerRow.values.slice(1) : []
  const columnKeys = headerValues.map((value: unknown) => findColumnByHeader(definition, normalizeText(value))?.key || "")

  const rows: WorkbookRow[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: WorkbookRow = {}
    columnKeys.forEach((columnKey, index) => {
      if (!columnKey) return
      const cellValue = row.getCell(index + 1).value
      record[columnKey] =
        cellValue && typeof cellValue === "object" && "text" in cellValue
          ? String((cellValue as { text?: unknown }).text || "")
          : cellValue
    })
    const hasContent = Object.values(record).some((value) => normalizeText(value) !== "")
    if (hasContent) rows.push(record)
  })

  return rows
}

function normalizedFileNamesForModule(definition: ExportModuleDefinition) {
  const normalized = new Set<string>()
  normalized.add(definition.fileName.toLowerCase())
  normalized.add(`${definition.key}.xlsx`.toLowerCase())
  if (definition.key === "vatRates") normalized.add("vatrates.xlsx")
  return normalized
}

async function readZipWorkbookMap(buffer: Buffer) {
  const zip = new AdmZip(buffer)
  const workbookMap = new Map<ExchangeModuleKey, WorkbookRow[]>()

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.toLowerCase().endsWith(".xlsx")) continue
    const basename = path.posix.basename(entry.entryName).toLowerCase()
    const moduleDefinition = MODULE_ORDER.map((key) => MODULE_DEFINITIONS[key]).find((definition) =>
      normalizedFileNamesForModule(definition).has(basename),
    )
    if (!moduleDefinition) continue
    const rows = await readWorkbookRows(moduleDefinition, Buffer.from(entry.getData()))
    workbookMap.set(moduleDefinition.key, rows)
  }

  return workbookMap
}

function emptyRowFromDefinition(definition: ExportModuleDefinition) {
  return definition.columns.reduce<Record<string, string>>((acc, column) => {
    acc[column.key] = ""
    return acc
  }, {})
}

export async function exportTenantDataWorkbookZip(tenantId: string) {
  const [companies, locations, departments, categories, uoms, vatRates, customers, suppliers, products] = await Promise.all([
    prisma.company.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.category.findMany({
      where: { tenantId },
      include: { department: true, company: true },
      orderBy: { name: "asc" },
    }),
    prisma.uom.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
    prisma.vatRate.findMany({ where: { tenantId }, orderBy: { rate: "asc" } }),
    prisma.customer.findMany({ where: { tenantId }, include: { company: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { tenantId }, include: { company: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { tenantId },
      include: {
        company: true,
        department: true,
        category: true,
        vatRate: true,
        uom: true,
        purchaseUom: true,
      },
      orderBy: { name: "asc" },
    }),
  ])

  const exportItems: ExchangeExportItem[] = [
    {
      ...MODULE_DEFINITIONS.companies,
      rows: companies.map((item) => ({
        companyCode: item.code || "",
        companyName: item.name,
        cui: item.cui || "",
        regNo: item.regNo || "",
        address: item.address || "",
        city: item.city || "",
        county: item.county || "",
        country: item.country || "",
        postalCode: item.postalCode || "",
        bank: item.bank || "",
        iban: item.iban || "",
        email: item.email || "",
        phone: item.phone || "",
        contactEmail: item.contactEmail || "",
        isDefault: item.isDefault,
        isVatPayer: item.isVatPayer,
      })),
    },
    {
      ...MODULE_DEFINITIONS.locations,
      rows: locations.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        code: item.code,
        name: item.name,
        address: item.address || "",
        city: item.city || "",
        county: item.county || "",
        country: item.country || "",
        postalCode: item.postalCode || "",
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.departments,
      rows: departments.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        name: item.name,
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.categories,
      rows: categories.map((item) => ({
        companyCode: item.company?.code || "",
        departmentName: item.department?.name || "",
        name: item.name,
        imageUrl: item.imageUrl || "",
        isActive: item.isActive,
        isVisibleInPos: item.isVisibleInPos,
      })),
    },
    {
      ...MODULE_DEFINITIONS.uoms,
      rows: uoms.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        code: item.code,
        name: item.name,
        standardCode: item.standardCode || "",
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.vatRates,
      rows: vatRates.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        name: item.name,
        rate: Number(item.rate),
        fiscalCode: item.fiscalCode || "",
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.customers,
      rows: customers.map((item) => ({
        companyCode: item.company?.code || "",
        code: item.code || "",
        name: item.name,
        cif: item.cif || "",
        regNo: item.regNo || "",
        address: item.address || "",
        city: item.city || "",
        county: item.county || "",
        country: item.country || "",
        postalCode: item.postalCode || "",
        phone: item.phone || "",
        email: item.email || "",
        vatPayer: item.vatPayer ?? "",
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.suppliers,
      rows: suppliers.map((item) => ({
        companyCode: item.company?.code || "",
        code: item.code || "",
        name: item.name,
        cif: item.cif || "",
        regCom: item.regCom || "",
        address: item.address || "",
        city: item.city || "",
        county: item.county || "",
        country: item.country || "",
        postalCode: item.postalCode || "",
        phone: item.phone || "",
        email: item.email || "",
        vatPayer: item.vatPayer ?? "",
        isActive: item.isActive,
      })),
    },
    {
      ...MODULE_DEFINITIONS.products,
      rows: products.map((item) => ({
        companyCode: item.company?.code || "",
        sku: item.sku,
        name: item.name,
        class: item.class,
        departmentName: item.department?.name || "",
        categoryName: item.category?.name || "",
        vatRate: item.vatRate?.rate ?? "",
        stockUom: item.uom?.code || "",
        purchaseUom: item.purchaseUom?.code || "",
        purchaseFactor: Number(item.purchaseFactor),
        price: Number(item.price),
        costPrice: Number(item.costPrice),
        productionMode: item.productionMode,
        imageUrl: item.imageUrl || "",
        isActive: item.isActive,
        isVisibleInPos: item.isVisibleInPos,
        isSgr: item.isSgr,
        sgrValue: Number(item.sgrValue),
        accountingItemCode: item.accountingItemCode || "",
      })),
    },
  ]

  const zip = new AdmZip()
  for (const item of exportItems) {
    const rows = item.rows.length ? item.rows : [emptyRowFromDefinition(item)]
    const buffer = await buildWorkbookBuffer(item, rows)
    zip.addFile(item.fileName, buffer)
  }

  return {
    buffer: zip.toBuffer(),
    fileName: `Export-date-ERP-${tenantId}-${EXPORT_DATE_TOKEN}.zip`,
    files: exportItems.map((item) => item.fileName),
  }
}

export async function importTenantDataWorkbookZip(tenantId: string, buffer: Buffer) {
  const workbookMap = await readZipWorkbookMap(buffer)
  const result: Record<string, number> = {}

  const companies = await prisma.company.findMany({ where: { tenantId } })
  const companyByCode = new Map(companies.map((item) => [normalizeText(item.code).toLowerCase(), item]))

  const locationsRows = workbookMap.get("locations") || []
  const departmentsRows = workbookMap.get("departments") || []
  const categoriesRows = workbookMap.get("categories") || []
  const uomRows = workbookMap.get("uoms") || []
  const vatRateRows = workbookMap.get("vatRates") || []
  const customerRows = workbookMap.get("customers") || []
  const supplierRows = workbookMap.get("suppliers") || []
  const productRows = workbookMap.get("products") || []

  let importedCompanies = 0
  for (const row of workbookMap.get("companies") || []) {
    const name = normalizeText(row.companyName)
    if (!name) continue
    const code = normalizeNullableText(row.companyCode)
    const existing =
      (code ? companyByCode.get(code.toLowerCase()) : null) ||
      (await prisma.company.findFirst({ where: { tenantId, name } }))

    if (existing) continue

    const created = await prisma.company.create({
      data: {
        tenantId,
        code,
        name,
        cui: normalizeNullableText(row.cui),
        regNo: normalizeNullableText(row.regNo),
        address: normalizeNullableText(row.address),
        city: normalizeNullableText(row.city),
        county: normalizeNullableText(row.county),
        country: normalizeNullableText(row.country) || "RO",
        postalCode: normalizeNullableText(row.postalCode),
        bank: normalizeNullableText(row.bank),
        iban: normalizeNullableText(row.iban),
        email: normalizeNullableText(row.email),
        phone: normalizeNullableText(row.phone),
        contactEmail: normalizeNullableText(row.contactEmail),
        isDefault: normalizeBoolean(row.isDefault),
        isVatPayer: normalizeBoolean(row.isVatPayer, true),
      },
    })
    if (code) companyByCode.set(code.toLowerCase(), created)
    importedCompanies += 1
  }
  result.companies = importedCompanies

  const refreshedCompanies = await prisma.company.findMany({ where: { tenantId } })
  const refreshedCompanyByCode = new Map(refreshedCompanies.map((item) => [normalizeText(item.code).toLowerCase(), item]))

  let importedLocations = 0
  for (const row of locationsRows) {
    const code = normalizeText(row.code)
    const name = normalizeText(row.name)
    if (!code || !name) continue
    const company =
      refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) ||
      refreshedCompanies.find((item) => item.isDefault) ||
      refreshedCompanies[0]
    const existing = await prisma.location.findFirst({ where: { tenantId, companyId: company?.id || null, code } })
    if (existing) continue
    await prisma.location.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        code,
        name,
        address: normalizeNullableText(row.address),
        city: normalizeNullableText(row.city),
        county: normalizeNullableText(row.county),
        country: normalizeNullableText(row.country) || "RO",
        postalCode: normalizeNullableText(row.postalCode),
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    importedLocations += 1
  }
  result.locations = importedLocations

  const allDepartments = await prisma.department.findMany({ where: { tenantId } })
  let importedDepartments = 0
  for (const row of departmentsRows) {
    const name = normalizeText(row.name)
    if (!name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const existing = allDepartments.find((item) => simplifyText(item.name) === simplifyText(name))
    if (existing) continue
    const created = await prisma.department.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        name,
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    allDepartments.push(created)
    importedDepartments += 1
  }
  result.departments = importedDepartments

  const allUoms = await prisma.uom.findMany({ where: { tenantId } })
  let importedUoms = 0
  for (const row of uomRows) {
    const code = normalizeText(row.code)
    const name = normalizeText(row.name)
    if (!code || !name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const existing = allUoms.find((item) => item.code.toLowerCase() === code.toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
    if (existing) continue
    const created = await prisma.uom.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        code,
        name,
        standardCode: normalizeNullableText(row.standardCode),
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    allUoms.push(created)
    importedUoms += 1
  }
  result.uoms = importedUoms

  const allVatRates = await prisma.vatRate.findMany({ where: { tenantId } })
  let importedVatRates = 0
  for (const row of vatRateRows) {
    const rate = normalizeNumber(row.rate, NaN)
    const name = normalizeText(row.name)
    if (!Number.isFinite(rate) || !name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const existing = allVatRates.find((item) => Number(item.rate) === rate && String(item.companyId || "") === String(company?.id || ""))
    if (existing) continue
    const created = await prisma.vatRate.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        name,
        rate,
        fiscalCode: normalizeNullableText(row.fiscalCode),
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    allVatRates.push(created)
    importedVatRates += 1
  }
  result.vatRates = importedVatRates

  const allCategories = await prisma.category.findMany({ where: { tenantId }, include: { department: true } })
  let importedCategories = 0
  for (const row of categoriesRows) {
    const name = normalizeText(row.name)
    if (!name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const departmentName = normalizeText(row.departmentName)
    const department = departmentName
      ? allDepartments.find((item) => simplifyText(item.name) === simplifyText(departmentName))
      : null
    const existing = allCategories.find((item) => item.name.toLowerCase() === name.toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
    if (existing) continue
    const created = await prisma.category.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        departmentId: department?.id || null,
        name,
        imageUrl: normalizeNullableText(row.imageUrl),
        isActive: normalizeBoolean(row.isActive, true),
        isVisibleInPos: normalizeBoolean(row.isVisibleInPos, true),
      },
    })
    allCategories.push({ ...created, department: department || null })
    importedCategories += 1
  }
  result.categories = importedCategories

  let importedCustomers = 0
  for (const row of customerRows) {
    const name = normalizeText(row.name)
    if (!name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const code = normalizeNullableText(row.code)
    const existing = await prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          ...(code ? [{ companyId: company?.id || null, code }] : []),
          { companyId: company?.id || null, name },
        ],
      },
    })
    if (existing) continue
    await prisma.customer.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        code,
        name,
        cif: normalizeNullableText(row.cif),
        regNo: normalizeNullableText(row.regNo),
        address: normalizeNullableText(row.address),
        city: normalizeNullableText(row.city),
        county: normalizeNullableText(row.county),
        country: normalizeNullableText(row.country),
        postalCode: normalizeNullableText(row.postalCode),
        phone: normalizeNullableText(row.phone),
        email: normalizeNullableText(row.email),
        vatPayer: normalizeText(row.vatPayer) === "" ? null : normalizeBoolean(row.vatPayer),
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    importedCustomers += 1
  }
  result.customers = importedCustomers

  let importedSuppliers = 0
  for (const row of supplierRows) {
    const name = normalizeText(row.name)
    if (!name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const code = normalizeNullableText(row.code)
    const existing = await prisma.supplier.findFirst({
      where: {
        tenantId,
        OR: [
          ...(code ? [{ companyId: company?.id || null, code }] : []),
          { companyId: company?.id || null, name },
        ],
      },
    })
    if (existing) continue
    await prisma.supplier.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        code,
        name,
        cif: normalizeNullableText(row.cif),
        regCom: normalizeNullableText(row.regCom),
        address: normalizeNullableText(row.address),
        city: normalizeNullableText(row.city),
        county: normalizeNullableText(row.county),
        country: normalizeNullableText(row.country),
        postalCode: normalizeNullableText(row.postalCode),
        phone: normalizeNullableText(row.phone),
        email: normalizeNullableText(row.email),
        vatPayer: normalizeText(row.vatPayer) === "" ? null : normalizeBoolean(row.vatPayer),
        isActive: normalizeBoolean(row.isActive, true),
      },
    })
    importedSuppliers += 1
  }
  result.suppliers = importedSuppliers

  const freshProducts = await prisma.product.findMany({ where: { tenantId } })
  let importedProducts = 0
  for (const row of productRows) {
    const sku = normalizeText(row.sku)
    const name = normalizeText(row.name)
    if (!sku || !name) continue
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || null
    const existing = freshProducts.find((item) => item.sku.toLowerCase() === sku.toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
    if (existing) continue

    const department = allDepartments.find((item) => simplifyText(item.name) === simplifyText(normalizeText(row.departmentName)))
    const category = allCategories.find((item) => item.name.toLowerCase() === normalizeText(row.categoryName).toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
    const vatRate =
      allVatRates.find((item) => Number(item.rate) === normalizeNumber(row.vatRate, NaN) && String(item.companyId || "") === String(company?.id || "")) ||
      allVatRates.find((item) => String(item.companyId || "") === String(company?.id || "")) ||
      allVatRates[0]
    const stockUom =
      allUoms.find((item) => item.code.toLowerCase() === normalizeText(row.stockUom).toLowerCase() && String(item.companyId || "") === String(company?.id || "")) ||
      allUoms.find((item) => String(item.companyId || "") === String(company?.id || "")) ||
      allUoms[0]
    const purchaseUom =
      allUoms.find((item) => item.code.toLowerCase() === normalizeText(row.purchaseUom).toLowerCase() && String(item.companyId || "") === String(company?.id || "")) ||
      stockUom

    if (!vatRate || !stockUom) continue

    const created = await prisma.product.create({
      data: {
        tenantId,
        companyId: company?.id || null,
        sku,
        name,
        class: normalizeText(row.class) as never,
        departmentId: department?.id || null,
        categoryId: category?.id || null,
        vatRateId: vatRate.id,
        uomId: stockUom.id,
        purchaseUomId: purchaseUom?.id || undefined,
        purchaseFactor: normalizeNumber(row.purchaseFactor, 1),
        price: normalizeNumber(row.price, 0),
        costPrice: normalizeNumber(row.costPrice, 0),
        productionMode: normalizeText(row.productionMode) as never,
        imageUrl: normalizeNullableText(row.imageUrl),
        isActive: normalizeBoolean(row.isActive, true),
        isVisibleInPos: normalizeBoolean(row.isVisibleInPos, true),
        isSgr: normalizeBoolean(row.isSgr, false),
        sgrValue: normalizeNumber(row.sgrValue, 0),
        accountingItemCode: normalizeNullableText(row.accountingItemCode) || undefined,
      },
    })
    freshProducts.push(created)
    importedProducts += 1
  }
  result.products = importedProducts

  return result
}
