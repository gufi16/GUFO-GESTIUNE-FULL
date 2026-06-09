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

type ExchangeExportItem = {
  key: ExchangeModuleKey
  fileName: string
  sheetName: string
  rows: Array<Record<string, string | number | boolean | null>>
}

type WorkbookRow = Record<string, unknown>

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

function fileNameForModule(key: ExchangeModuleKey) {
  return `${key}.xlsx`
}

async function buildWorkbookBuffer(sheetName: string, rows: WorkbookRow[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Export")
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key))
      return set
    }, new Set<string>()),
  )

  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 4, 16), 28),
  }))

  rows.forEach((row) => {
    const normalized: Record<string, string | number | boolean | null> = {}
    headers.forEach((header) => {
      normalized[header] = toCellValue(row?.[header])
    })
    worksheet.addRow(normalized)
  })

  worksheet.getRow(1).font = { bold: true }
  worksheet.views = [{ state: "frozen", ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

async function readWorkbookRows(buffer: Buffer | Uint8Array) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const headerRow = worksheet.getRow(1)
  const headerValues = Array.isArray(headerRow.values) ? headerRow.values.slice(1) : []
  const headers = headerValues
    .map((value: unknown) => normalizeText(value))
    .filter(Boolean)

  const rows: WorkbookRow[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: WorkbookRow = {}
    headers.forEach((header: string, index: number) => {
      const cellValue = row.getCell(index + 1).value
      record[header] =
        cellValue && typeof cellValue === "object" && "text" in cellValue
          ? String((cellValue as { text?: unknown }).text || "")
          : cellValue
    })
    const hasContent = Object.values(record).some((value) => normalizeText(value) !== "")
    if (hasContent) rows.push(record)
  })

  return rows
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
      key: "companies",
      fileName: fileNameForModule("companies"),
      sheetName: "Companii",
      rows: companies.map((item) => ({
        code: item.code || "",
        name: item.name,
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
      key: "locations",
      fileName: fileNameForModule("locations"),
      sheetName: "Locatii",
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
      key: "departments",
      fileName: fileNameForModule("departments"),
      sheetName: "Departamente",
      rows: departments.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        name: item.name,
        isActive: item.isActive,
      })),
    },
    {
      key: "categories",
      fileName: fileNameForModule("categories"),
      sheetName: "Categorii",
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
      key: "uoms",
      fileName: fileNameForModule("uoms"),
      sheetName: "UM",
      rows: uoms.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        code: item.code,
        name: item.name,
        standardCode: item.standardCode || "",
        isActive: item.isActive,
      })),
    },
    {
      key: "vatRates",
      fileName: fileNameForModule("vatRates"),
      sheetName: "TVA",
      rows: vatRates.map((item) => ({
        companyCode: item.companyId ? companies.find((company) => company.id === item.companyId)?.code || "" : "",
        name: item.name,
        rate: Number(item.rate),
        fiscalCode: item.fiscalCode || "",
        isActive: item.isActive,
      })),
    },
    {
      key: "customers",
      fileName: fileNameForModule("customers"),
      sheetName: "Clienti",
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
      key: "suppliers",
      fileName: fileNameForModule("suppliers"),
      sheetName: "Furnizori",
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
      key: "products",
      fileName: fileNameForModule("products"),
      sheetName: "Produse",
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
    const buffer = await buildWorkbookBuffer(item.sheetName, item.rows)
    zip.addFile(item.fileName, buffer)
  }

  return {
    buffer: zip.toBuffer(),
    fileName: `gufo-data-export-${tenantId}-${new Date().toISOString().slice(0, 10)}.zip`,
    files: exportItems.map((item) => item.fileName),
  }
}

async function readZipWorkbookMap(buffer: Buffer) {
  const zip = new AdmZip(buffer)
  const workbookMap = new Map<string, WorkbookRow[]>()

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.toLowerCase().endsWith(".xlsx")) continue
    const rows = await readWorkbookRows(Buffer.from(entry.getData()))
    workbookMap.set(path.posix.basename(entry.entryName).toLowerCase(), rows)
  }

  return workbookMap
}

export async function importTenantDataWorkbookZip(tenantId: string, buffer: Buffer) {
  const workbookMap = await readZipWorkbookMap(buffer)
  const result: Record<string, number> = {}

  const companies = await prisma.company.findMany({ where: { tenantId } })
  const companyByCode = new Map(companies.map((item) => [normalizeText(item.code).toLowerCase(), item]))

  const locationsRows = workbookMap.get("locations.xlsx") || []
  const departmentsRows = workbookMap.get("departments.xlsx") || []
  const categoriesRows = workbookMap.get("categories.xlsx") || []
  const uomRows = workbookMap.get("uoms.xlsx") || []
  const vatRateRows = workbookMap.get("vatrates.xlsx") || []
  const customerRows = workbookMap.get("customers.xlsx") || []
  const supplierRows = workbookMap.get("suppliers.xlsx") || []
  const productRows = workbookMap.get("products.xlsx") || []

  let importedCompanies = 0
  for (const row of workbookMap.get("companies.xlsx") || []) {
    const name = normalizeText(row.name)
    if (!name) continue
    const code = normalizeNullableText(row.code)
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
    const company = refreshedCompanyByCode.get(normalizeText(row.companyCode).toLowerCase()) || refreshedCompanies.find((item) => item.isDefault) || refreshedCompanies[0]
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
    const existing = allDepartments.find((item) => item.name.toLowerCase() === name.toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
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
      ? allDepartments.find((item) => item.name.toLowerCase() === departmentName.toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
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

    const department = allDepartments.find((item) => item.name.toLowerCase() === normalizeText(row.departmentName).toLowerCase() && String(item.companyId || "") === String(company?.id || ""))
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
