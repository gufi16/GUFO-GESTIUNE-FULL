import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"
import { prisma } from "./prisma"
import { ensureUploadsRoot } from "./uploads"

type RestorableRecord = Record<string, unknown>
type RestorableModel = {
  createMany(...args: unknown[]): Promise<unknown>
}

export const TENANT_BACKUP_MODULE_DEFINITIONS = [
  {
    key: "company",
    label: "Setari companie",
    description: "Companii, locatii, terminale, TVA, UM, categorii si configurari de baza.",
    payloadKeys: [
      "companies",
      "locations",
      "terminals",
      "vatRates",
      "uoms",
      "departments",
      "categories",
      "accountingStockTypes",
      "accountingExportConfigs",
      "tenantModules",
      "externalIntegrations",
    ],
  },
  {
    key: "users",
    label: "Utilizatori",
    description: "Utilizatori ERP, roluri, PIN POS si acces pe companii.",
    payloadKeys: ["users"],
  },
  {
    key: "customers",
    label: "Clienti",
    description: "Lista de clienti din ERP.",
    payloadKeys: ["customers"],
  },
  {
    key: "suppliers",
    label: "Furnizori",
    description: "Lista de furnizori din ERP.",
    payloadKeys: ["suppliers"],
  },
  {
    key: "locations",
    label: "Locatii si terminale",
    description: "Locatii, puncte de lucru si terminale POS/KDS.",
    payloadKeys: ["locations", "terminals"],
  },
  {
    key: "departments",
    label: "Departamente",
    description: "Departamente folosite in ERP si productie.",
    payloadKeys: ["departments"],
  },
  {
    key: "categories",
    label: "Categorii",
    description: "Categorii vizibile in ERP si POS.",
    payloadKeys: ["categories"],
  },
  {
    key: "uoms",
    label: "Unitati de masura",
    description: "Unitati de masura pentru produse si documente.",
    payloadKeys: ["uoms"],
  },
  {
    key: "vat_rates",
    label: "TVA",
    description: "Cote TVA si codurile lor fiscale.",
    payloadKeys: ["vatRates"],
  },
  {
    key: "catalog",
    label: "Produse si retete",
    description: "Produse, coduri de bare, retete si mapari marketplace.",
    payloadKeys: ["products", "productBarcodes", "recipes", "marketplaceMappings"],
  },
  {
    key: "products",
    label: "Produse",
    description: "Produse, coduri de bare si mapari marketplace.",
    payloadKeys: ["products", "productBarcodes", "marketplaceMappings"],
  },
  {
    key: "recipes",
    label: "Retete",
    description: "Retete si componentele lor.",
    payloadKeys: ["recipes"],
  },
  {
    key: "documents",
    label: "Documente operationale",
    description: "NIR-uri, transferuri, inventare, productie, consum, vanzari si facturi.",
    payloadKeys: [
      "incomingEInvoices",
      "purchaseReceipts",
      "transferDocs",
      "inventoryDocs",
      "minutesDocs",
      "productionDocs",
      "sales",
      "consumptionDocs",
      "salesInvoices",
      "externalOrders",
      "saleDrafts",
      "kitchenTickets",
      "stockBalances",
      "stockMoves",
    ],
  },
  {
    key: "documents_purchase_receipts",
    label: "Documente: NIR",
    description: "Receptii/NIR si liniile lor.",
    payloadKeys: ["purchaseReceipts"],
  },
  {
    key: "documents_transfers",
    label: "Documente: transfer",
    description: "Transferuri intre gestiuni.",
    payloadKeys: ["transferDocs"],
  },
  {
    key: "documents_inventory",
    label: "Documente: inventar",
    description: "Documente de inventar si pozitii.",
    payloadKeys: ["inventoryDocs"],
  },
  {
    key: "documents_minutes",
    label: "Documente: procese verbale",
    description: "Procese verbale si minute docs.",
    payloadKeys: ["minutesDocs"],
  },
  {
    key: "documents_production",
    label: "Documente: productie",
    description: "Documente de productie si pozitii.",
    payloadKeys: ["productionDocs"],
  },
  {
    key: "documents_sales",
    label: "Documente: vanzari POS",
    description: "Bonuri, vanzari si liniile lor.",
    payloadKeys: ["sales"],
  },
  {
    key: "documents_consumption",
    label: "Documente: consum",
    description: "Bonuri de consum si pozitii.",
    payloadKeys: ["consumptionDocs"],
  },
  {
    key: "documents_sales_invoices",
    label: "Documente: facturi",
    description: "Facturi de vanzare si liniile lor.",
    payloadKeys: ["salesInvoices"],
  },
  {
    key: "documents_external_orders",
    label: "Documente: comenzi externe",
    description: "Comenzi marketplace si istoricul lor.",
    payloadKeys: ["externalOrders"],
  },
  {
    key: "documents_sale_drafts",
    label: "Documente: drafturi vanzare",
    description: "Drafturi de vanzare si sesiuni in curs.",
    payloadKeys: ["saleDrafts"],
  },
  {
    key: "documents_kitchen_tickets",
    label: "Documente: bonuri bucatarie",
    description: "Kitchen tickets si liniile lor.",
    payloadKeys: ["kitchenTickets"],
  },
  {
    key: "documents_stock",
    label: "Documente: miscari stoc",
    description: "Balante si miscari de stoc.",
    payloadKeys: ["stockBalances", "stockMoves"],
  },
  {
    key: "files",
    label: "Fisiere si atasamente",
    description: "Fisiere din uploads si alte atasamente salvate in arhiva.",
    payloadKeys: [],
  },
] as const

export type TenantBackupModuleKey = (typeof TENANT_BACKUP_MODULE_DEFINITIONS)[number]["key"]
type TenantBackupModuleDefinition = (typeof TENANT_BACKUP_MODULE_DEFINITIONS)[number]
type RestoreMode = "merge" | "sync_missing"

const COMPANY_CHILD_MODULE_KEYS: TenantBackupModuleKey[] = ["locations", "departments", "categories", "uoms", "vat_rates"]
const CATALOG_CHILD_MODULE_KEYS: TenantBackupModuleKey[] = ["products", "recipes"]
const DOCUMENT_CHILD_MODULE_KEYS: TenantBackupModuleKey[] = [
  "documents_purchase_receipts",
  "documents_transfers",
  "documents_inventory",
  "documents_minutes",
  "documents_production",
  "documents_sales",
  "documents_consumption",
  "documents_sales_invoices",
  "documents_external_orders",
  "documents_sale_drafts",
  "documents_kitchen_tickets",
  "documents_stock",
]

const MODULE_EXECUTION_PRIORITY: Record<TenantBackupModuleKey, number> = {
  company: 10,
  users: 20,
  customers: 30,
  suppliers: 40,
  locations: 50,
  departments: 60,
  categories: 70,
  uoms: 80,
  vat_rates: 90,
  catalog: 100,
  products: 110,
  recipes: 120,
  documents: 200,
  documents_purchase_receipts: 210,
  documents_transfers: 220,
  documents_inventory: 230,
  documents_minutes: 240,
  documents_production: 250,
  documents_external_orders: 260,
  documents_sale_drafts: 270,
  documents_kitchen_tickets: 280,
  documents_consumption: 290,
  documents_sales: 300,
  documents_sales_invoices: 310,
  documents_stock: 320,
  files: 400,
}

function expandRequestedModuleKey(key: TenantBackupModuleKey): TenantBackupModuleKey[] {
  if (key === "company") return COMPANY_CHILD_MODULE_KEYS
  if (key === "catalog") return CATALOG_CHILD_MODULE_KEYS
  if (key === "documents") return DOCUMENT_CHILD_MODULE_KEYS
  return [key]
}

function toDateIfPossible(value: unknown) {
  if (typeof value !== "string") return value
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date
}

function normalizeRecord(record: unknown): RestorableRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {}
  const normalized: RestorableRecord = {}
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) continue
    if (value && typeof value === "object" && !(value instanceof Date)) continue
    normalized[key] = toDateIfPossible(value)
  }
  return normalized
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asRecord(value: unknown): RestorableRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as RestorableRecord
}

function getNestedArray<T = unknown>(value: unknown, key: string): T[] {
  const record = asRecord(value)
  return record ? asArray<T>(record[key]) : []
}

function pickFields(record: unknown, fields: string[]) {
  const normalized = normalizeRecord(record)
  const next: RestorableRecord = {}
  for (const field of fields) {
    if (normalized && typeof normalized === "object" && Object.prototype.hasOwnProperty.call(normalized, field)) {
      next[field] = (normalized as RestorableRecord)[field]
    }
  }
  return next
}

function readTenantPayloadFromZip(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Fisierul backup nu mai exista pe server.")
  }
  const zip = new AdmZip(filePath)
  const entry = zip.getEntry("data/tenant.json")
  if (!entry) {
    throw new Error("Backup-ul nu contine data/tenant.json.")
  }
  return JSON.parse(zip.readAsText(entry))
}

function readTenantZip(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Fisierul backup nu mai exista pe server.")
  }
  return new AdmZip(filePath)
}

function restoreUploadFilesFromZip(
  zip: InstanceType<typeof AdmZip>,
  options?: {
    overwriteExisting?: boolean
  },
) {
  const uploadsRoot = ensureUploadsRoot()
  let restoredFiles = 0
  let skippedExistingFiles = 0

  const overwriteExisting = options?.overwriteExisting !== false

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.startsWith("files/uploads/")) continue

    const relativePath = entry.entryName.replace(/^files\//, "")
    const absolutePath = path.resolve(process.cwd(), ...relativePath.split("/"))
    if (!absolutePath.startsWith(uploadsRoot)) {
      continue
    }

    if (!overwriteExisting && fs.existsSync(absolutePath)) {
      skippedExistingFiles += 1
      continue
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, entry.getData())
    restoredFiles += 1
  }

  return {
    restoredFiles,
    skippedExistingFiles,
  }
}

async function createManyIfAny(model: RestorableModel, data: unknown[]) {
  if (!Array.isArray(data) || !data.length) return
  await model.createMany({ data })
}

async function createManySkipDuplicatesIfAny(model: RestorableModel, data: unknown[]) {
  if (!Array.isArray(data) || !data.length) return
  await model.createMany({ data, skipDuplicates: true })
}

function asText(value: unknown) {
  return String(value ?? "").trim()
}

function lowerText(value: unknown) {
  return asText(value).toLowerCase()
}

function scopeKey(...parts: unknown[]) {
  return parts.map((part) => lowerText(part)).join("::")
}

function hasAnyRequestedModule(requested: TenantBackupModuleKey[], keys: TenantBackupModuleKey[]) {
  return keys.some((key) => requested.includes(key))
}

function normalizeSaleDraftRecord(item: RestorableRecord) {
  const next = normalizeRecord(item)
  if (!("cartJson" in next) || next.cartJson == null) {
    next.cartJson = item.cartJson ?? item.cart ?? { items: [] }
  }
  return next
}

type IdLookupModel = {
  findMany(args: { where: { id: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>>
}

type IdConstraint = {
  field: string
  allowed: Set<string>
}

async function fetchExistingIds(model: IdLookupModel, values: Iterable<unknown>) {
  const ids = Array.from(new Set(Array.from(values).map(asText).filter(Boolean)))
  if (!ids.length) return new Set<string>()
  const rows = await model.findMany({ where: { id: { in: ids } }, select: { id: true } })
  return new Set(rows.map((row) => asText(row.id)).filter(Boolean))
}

function prepareRecords(
  records: RestorableRecord[],
  options?: {
    required?: IdConstraint[]
    optional?: IdConstraint[]
  },
) {
  const required = options?.required ?? []
  const optional = options?.optional ?? []
  const prepared: RestorableRecord[] = []

  for (const record of records) {
    const next: RestorableRecord = { ...record }

    for (const constraint of optional) {
      const value = asText(next[constraint.field])
      if (value && !constraint.allowed.has(value)) {
        next[constraint.field] = null
      }
    }

    const valid = required.every((constraint) => {
      const value = asText(next[constraint.field])
      return Boolean(value) && constraint.allowed.has(value)
    })

    if (valid) {
      prepared.push(next)
    }
  }

  return prepared
}

async function relinkDocumentReferences(data: SelectiveRestoreData) {
  const consumptionDocIds = await fetchExistingIds(prisma.consumptionDoc as unknown as IdLookupModel, [
    ...data.sales.map((item) => item.consumptionBatchDocId),
    ...data.consumptionDocs.map((item) => item.id),
    ...data.consumptionDocs.map((item) => item.aggregateParentId),
  ])
  const saleIds = await fetchExistingIds(prisma.sale as unknown as IdLookupModel, [
    ...data.sales.map((item) => item.id),
    ...data.consumptionDocs.map((item) => item.saleId),
  ])

  for (const sale of data.sales) {
    const saleId = asText(sale.id)
    const consumptionBatchDocId = asText(sale.consumptionBatchDocId)
    if (!saleId || !consumptionBatchDocId) continue
    if (!saleIds.has(saleId) || !consumptionDocIds.has(consumptionBatchDocId)) continue
    await prisma.sale.updateMany({
      where: { id: saleId },
      data: { consumptionBatchDocId },
    })
  }

  for (const doc of data.consumptionDocs) {
    const docId = asText(doc.id)
    if (!docId || !consumptionDocIds.has(docId)) continue

    const nextSaleId = asText(doc.saleId)
    const nextAggregateParentId = asText(doc.aggregateParentId)

    await prisma.consumptionDoc.updateMany({
      where: { id: docId },
      data: {
        saleId: nextSaleId && saleIds.has(nextSaleId) ? nextSaleId : null,
        aggregateParentId:
          nextAggregateParentId && consumptionDocIds.has(nextAggregateParentId) ? nextAggregateParentId : null,
      },
    })
  }
}

function ensureBackupBelongsToTenant(tenantId: string, payload: unknown) {
  if (String((payload as RestorableRecord | null)?.tenantId || "") !== String(tenantId)) {
    throw new Error("Backup-ul nu apartine acestui client.")
  }
}

function countPayloadEntries(payload: unknown, keys: readonly string[]) {
  return keys.reduce((sum, key) => sum + asArray(payload && typeof payload === "object" ? (payload as RestorableRecord)[key] : []).length, 0)
}

export function describeTenantBackupModulesFromFile(tenantId: string, filePath: string) {
  const payload = readTenantPayloadFromZip(filePath)
  ensureBackupBelongsToTenant(tenantId, payload)

  return TENANT_BACKUP_MODULE_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: definition.description,
    recordCount: definition.key === "files" ? 0 : countPayloadEntries(payload, definition.payloadKeys),
    breakdown: definition.payloadKeys.map((key) => ({
      key,
      count: asArray(payload && typeof payload === "object" ? (payload as RestorableRecord)[key] : []).length,
    })),
  }))
}

type SelectiveRestoreData = {
  companies: RestorableRecord[]
  users: RestorableRecord[]
  userCompanyAccesses: RestorableRecord[]
  locations: RestorableRecord[]
  terminals: RestorableRecord[]
  vatRates: RestorableRecord[]
  uoms: RestorableRecord[]
  departments: RestorableRecord[]
  categories: RestorableRecord[]
  accountingStockTypes: RestorableRecord[]
  accountingExportConfigs: RestorableRecord[]
  suppliers: RestorableRecord[]
  customers: RestorableRecord[]
  tenantModules: RestorableRecord[]
  externalIntegrations: RestorableRecord[]
  products: RestorableRecord[]
  productBarcodes: RestorableRecord[]
  stockBalances: RestorableRecord[]
  stockMoves: RestorableRecord[]
  recipes: RestorableRecord[]
  recipeItems: RestorableRecord[]
  incomingEInvoices: RestorableRecord[]
  incomingEInvoiceItems: RestorableRecord[]
  purchaseReceipts: RestorableRecord[]
  purchaseReceiptItems: RestorableRecord[]
  transferDocs: RestorableRecord[]
  transferDocItems: RestorableRecord[]
  inventoryDocs: RestorableRecord[]
  inventoryDocItems: RestorableRecord[]
  minutesDocs: RestorableRecord[]
  minutesDocItems: RestorableRecord[]
  productionDocs: RestorableRecord[]
  productionDocItems: RestorableRecord[]
  sales: RestorableRecord[]
  saleItems: RestorableRecord[]
  consumptionDocs: RestorableRecord[]
  consumptionDocItems: RestorableRecord[]
  externalOrders: RestorableRecord[]
  externalOrderItems: RestorableRecord[]
  externalOrderStatusHistory: RestorableRecord[]
  saleDrafts: RestorableRecord[]
  kitchenTickets: RestorableRecord[]
  kitchenTicketItems: RestorableRecord[]
  marketplaceMappings: RestorableRecord[]
  salesInvoices: RestorableRecord[]
  salesInvoiceItems: RestorableRecord[]
  efacturaLogs: RestorableRecord[]
}

function buildSelectiveRestoreData(payload: unknown): SelectiveRestoreData {
  const companies = asArray<RestorableRecord>((payload as RestorableRecord).companies).map((item) =>
    pickFields(item, [
      "id", "tenantId", "name", "code", "isDefault", "cui", "regNo", "address", "city", "county", "country",
      "postalCode", "bank", "iban", "email", "phone", "contactEmail", "isVatPayer", "posSyncInterval",
      "efacturaEnabled", "efacturaEnvironment", "efacturaSellerCountryCode", "efacturaSellerCity",
      "efacturaSellerCounty", "efacturaSellerPostalCode", "efacturaContactEmail", "efacturaCertSerial",
      "efacturaCertPasswordEnc", "efacturaCertFilename", "efacturaCertUploadedAt", "efacturaOauthClientId",
      "efacturaOauthClientSecret", "efacturaOauthRedirectUri", "efacturaOauthAccessToken", "efacturaOauthRefreshToken",
      "efacturaOauthAccessTokenExpiresAt", "efacturaOauthRefreshTokenExpiresAt", "efacturaOauthConnectedAt",
      "efacturaOauthLastError", "invoiceSeries", "purchaseSeries", "transferSeries", "inventorySeries",
      "consumptionSeries", "productionSeries", "deteriorationSeries", "priceChangeSeries", "customerCodePrefix",
      "supplierCodePrefix", "createdAt", "updatedAt",
    ]),
  )

  const users = asArray<RestorableRecord>((payload as RestorableRecord).users).map((item) =>
    pickFields(item, ["id", "tenantId", "email", "name", "passwordHash", "posPinHash", "role", "isActive", "createdAt", "updatedAt"]),
  )

  const userCompanyAccesses = asArray<RestorableRecord>((payload as RestorableRecord).users).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "companyAccesses").map((entry) => ({
      userId: item.id,
      companyId: entry.companyId,
      createdAt: toDateIfPossible(entry.createdAt),
    })),
  )

  const locations = asArray<RestorableRecord>((payload as RestorableRecord).locations).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "isActive", "createdAt", "updatedAt"]),
  )
  const terminals = asArray<RestorableRecord>((payload as RestorableRecord).terminals).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "locationId", "deviceId", "label", "isLockedToLocation", "createdAt", "updatedAt"]),
  )
  const vatRates = asArray<RestorableRecord>((payload as RestorableRecord).vatRates).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "rate", "fiscalCode", "isActive", "createdAt"]),
  )
  const uoms = asArray<RestorableRecord>((payload as RestorableRecord).uoms).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "code", "name", "isActive", "createdAt"]),
  )
  const departments = asArray<RestorableRecord>((payload as RestorableRecord).departments).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "isActive", "createdAt"]),
  )
  const categories = asArray<RestorableRecord>((payload as RestorableRecord).categories).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "departmentId", "name", "imageUrl", "isActive", "isVisibleInPos", "createdAt"]),
  )
  const accountingStockTypes = asArray<RestorableRecord>((payload as RestorableRecord).accountingStockTypes).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "code", "name", "inventoryAccount", "expenseAccount", "salesAccount", "analyticMode", "isDefault", "createdAt", "updatedAt"]),
  )
  const accountingExportConfigs = asArray<RestorableRecord>((payload as RestorableRecord).accountingExportConfigs).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "exportTarget", "articleCodeSource", "managementAnalytic", "customerAccount", "supplierAccount", "salesAccount", "expenseAccount", "inventoryAccount", "vatCollectedAccount", "vatDeductibleAccount", "cashAccount", "cardAccount", "defaultStockTypeId", "createdAt", "updatedAt"]),
  )
  const suppliers = asArray<RestorableRecord>((payload as RestorableRecord).suppliers).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "cif", "regCom", "address", "city", "county", "country", "postalCode", "phone", "email", "vatPayer", "isActive", "createdAt", "updatedAt"]),
  )
  const customers = asArray<RestorableRecord>((payload as RestorableRecord).customers).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "cif", "regNo", "address", "city", "county", "country", "postalCode", "phone", "email", "vatPayer", "isActive", "createdAt", "updatedAt"]),
  )
  const tenantModules = asArray<RestorableRecord>((payload as RestorableRecord).tenantModules).map((item) =>
    pickFields(item, ["id", "tenantId", "moduleId", "enabled", "limitValue", "source", "createdAt", "updatedAt"]),
  )
  const externalIntegrations = asArray<RestorableRecord>((payload as RestorableRecord).externalIntegrations).map((item) =>
    pickFields(item, ["id", "tenantId", "locationId", "platform", "status", "authType", "accessToken", "refreshToken", "tokenExpiresAt", "merchantId", "storeId", "webhookSecret", "settingsJson", "createdAt", "updatedAt"]),
  )
  const products = asArray<RestorableRecord>((payload as RestorableRecord).products).map((item) =>
    pickFields(item, [
      "id", "tenantId", "companyId", "sku", "name", "imageUrl", "class", "vatRateId", "uomId", "purchaseUomId",
      "purchaseFactor", "departmentId", "categoryId", "accountingStockTypeId", "accountingItemCode", "price",
      "costPrice", "isActive", "isVisibleInPos", "isSgr", "sgrValue", "productionMode", "createdAt", "updatedAt",
    ]),
  )
  const productBarcodes = asArray<RestorableRecord>((payload as RestorableRecord).productBarcodes).map((item) =>
    pickFields(item, ["id", "tenantId", "productId", "barcode", "createdAt"]),
  )
  const stockBalances = asArray<RestorableRecord>((payload as RestorableRecord).stockBalances).map((item) => normalizeRecord(item))
  const stockMoves = asArray<RestorableRecord>((payload as RestorableRecord).stockMoves).map((item) => normalizeRecord(item))
  const recipes = asArray<RestorableRecord>((payload as RestorableRecord).recipes).map((item) => normalizeRecord(item))
  const recipeItems = asArray<RestorableRecord>((payload as RestorableRecord).recipes).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const incomingEInvoices = asArray<RestorableRecord>((payload as RestorableRecord).incomingEInvoices).map((item) => {
    const next = normalizeRecord(item)
    delete next.linkedReceiptId
    return next
  })
  const incomingEInvoiceItems = asArray<RestorableRecord>((payload as RestorableRecord).incomingEInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const purchaseReceipts = asArray<RestorableRecord>((payload as RestorableRecord).purchaseReceipts).map((item) => normalizeRecord(item))
  const purchaseReceiptItems = asArray<RestorableRecord>((payload as RestorableRecord).purchaseReceipts).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const transferDocs = asArray<RestorableRecord>((payload as RestorableRecord).transferDocs).map((item) => normalizeRecord(item))
  const transferDocItems = asArray<RestorableRecord>((payload as RestorableRecord).transferDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const inventoryDocs = asArray<RestorableRecord>((payload as RestorableRecord).inventoryDocs).map((item) => normalizeRecord(item))
  const inventoryDocItems = asArray<RestorableRecord>((payload as RestorableRecord).inventoryDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const minutesDocs = asArray<RestorableRecord>((payload as RestorableRecord).minutesDocs).map((item) => normalizeRecord(item))
  const minutesDocItems = asArray<RestorableRecord>((payload as RestorableRecord).minutesDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const productionDocs = asArray<RestorableRecord>((payload as RestorableRecord).productionDocs).map((item) => normalizeRecord(item))
  const productionDocItems = asArray<RestorableRecord>((payload as RestorableRecord).productionDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const sales = asArray<RestorableRecord>((payload as RestorableRecord).sales).map((item) => normalizeRecord(item))
  const saleItems = asArray<RestorableRecord>((payload as RestorableRecord).sales).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const consumptionDocs = asArray<RestorableRecord>((payload as RestorableRecord).consumptionDocs).map((item) => normalizeRecord(item))
  const consumptionDocItems = asArray<RestorableRecord>((payload as RestorableRecord).consumptionDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const externalOrders = asArray<RestorableRecord>((payload as RestorableRecord).externalOrders).map((item) => normalizeRecord(item))
  const externalOrderItems = asArray<RestorableRecord>((payload as RestorableRecord).externalOrders).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const externalOrderStatusHistory = asArray<RestorableRecord>((payload as RestorableRecord).externalOrders).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "statusHistory").map((entry) => normalizeRecord(entry)),
  )
  const saleDrafts = asArray<RestorableRecord>((payload as RestorableRecord).saleDrafts).map((item) => normalizeSaleDraftRecord(item))
  const kitchenTickets = asArray<RestorableRecord>((payload as RestorableRecord).kitchenTickets).map((item) => normalizeRecord(item))
  const kitchenTicketItems = asArray<RestorableRecord>((payload as RestorableRecord).kitchenTickets).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const marketplaceMappings = asArray<RestorableRecord>((payload as RestorableRecord).marketplaceMappings).map((item) => normalizeRecord(item))
  const salesInvoices = asArray<RestorableRecord>((payload as RestorableRecord).salesInvoices).map((item) => normalizeRecord(item))
  const salesInvoiceItems = asArray<RestorableRecord>((payload as RestorableRecord).salesInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const efacturaLogs = asArray<RestorableRecord>((payload as RestorableRecord).salesInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "efacturaLogs").map((entry) => normalizeRecord(entry)),
  )

  return {
    companies,
    users,
    userCompanyAccesses,
    locations,
    terminals,
    vatRates,
    uoms,
    departments,
    categories,
    accountingStockTypes,
    accountingExportConfigs,
    suppliers,
    customers,
    tenantModules,
    externalIntegrations,
    products,
    productBarcodes,
    stockBalances,
    stockMoves,
    recipes,
    recipeItems,
    incomingEInvoices,
    incomingEInvoiceItems,
    purchaseReceipts,
    purchaseReceiptItems,
    transferDocs,
    transferDocItems,
    inventoryDocs,
    inventoryDocItems,
    minutesDocs,
    minutesDocItems,
    productionDocs,
    productionDocItems,
    sales,
    saleItems,
    consumptionDocs,
    consumptionDocItems,
    externalOrders,
    externalOrderItems,
    externalOrderStatusHistory,
    saleDrafts,
    kitchenTickets,
    kitchenTicketItems,
    marketplaceMappings,
    salesInvoices,
    salesInvoiceItems,
    efacturaLogs,
  }
}

export async function restoreTenantBackupFromFile(tenantId: string, filePath: string) {
  const zip = readTenantZip(filePath)
  const payload = readTenantPayloadFromZip(filePath)

  if (String(payload?.tenantId || "") !== String(tenantId)) {
    throw new Error("Backup-ul nu apartine acestui client.")
  }

  const companies = asArray<RestorableRecord>(payload.companies).map((item) =>
    pickFields(item, [
      "id", "tenantId", "name", "code", "isDefault", "cui", "regNo", "address", "city", "county", "country",
      "postalCode", "bank", "iban", "email", "phone", "contactEmail", "isVatPayer", "posSyncInterval",
      "efacturaEnabled", "efacturaEnvironment", "efacturaSellerCountryCode", "efacturaSellerCity",
      "efacturaSellerCounty", "efacturaSellerPostalCode", "efacturaContactEmail", "efacturaCertSerial",
      "efacturaCertPasswordEnc", "efacturaCertFilename", "efacturaCertUploadedAt", "efacturaOauthClientId",
      "efacturaOauthClientSecret", "efacturaOauthRedirectUri", "efacturaOauthAccessToken", "efacturaOauthRefreshToken",
      "efacturaOauthAccessTokenExpiresAt", "efacturaOauthRefreshTokenExpiresAt", "efacturaOauthConnectedAt",
      "efacturaOauthLastError", "invoiceSeries", "purchaseSeries", "transferSeries", "inventorySeries",
      "consumptionSeries",
      "productionSeries", "deteriorationSeries", "priceChangeSeries", "customerCodePrefix", "supplierCodePrefix",
      "createdAt", "updatedAt",
    ]),
  )

  const users = asArray<RestorableRecord>(payload.users).map((item) =>
    pickFields(item, ["id", "tenantId", "email", "name", "passwordHash", "posPinHash", "role", "isActive", "createdAt", "updatedAt"]),
  )

  const userCompanyAccesses = asArray<RestorableRecord>(payload.users).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "companyAccesses").map((entry) => ({
      userId: item.id,
      companyId: entry.companyId,
      createdAt: toDateIfPossible(entry.createdAt),
    })),
  )

  const locations = asArray<RestorableRecord>(payload.locations).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "isActive", "createdAt", "updatedAt"]),
  )

  const terminals = asArray<RestorableRecord>(payload.terminals).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "locationId", "deviceId", "label", "isLockedToLocation", "createdAt", "updatedAt"]),
  )

  const vatRates = asArray<RestorableRecord>(payload.vatRates).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "rate", "fiscalCode", "isActive", "createdAt"]),
  )

  const uoms = asArray<RestorableRecord>(payload.uoms).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "code", "name", "isActive", "createdAt"]),
  )

  const departments = asArray<RestorableRecord>(payload.departments).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "isActive", "createdAt"]),
  )

  const categories = asArray<RestorableRecord>(payload.categories).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "departmentId", "name", "imageUrl", "isActive", "isVisibleInPos", "createdAt"]),
  )

  const accountingStockTypes = asArray<RestorableRecord>(payload.accountingStockTypes).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "code", "name", "inventoryAccount", "expenseAccount", "salesAccount", "analyticMode", "isDefault", "createdAt", "updatedAt"]),
  )

  const accountingExportConfigs = asArray<RestorableRecord>(payload.accountingExportConfigs).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "exportTarget", "articleCodeSource", "managementAnalytic", "customerAccount", "supplierAccount", "salesAccount", "expenseAccount", "inventoryAccount", "vatCollectedAccount", "vatDeductibleAccount", "cashAccount", "cardAccount", "defaultStockTypeId", "createdAt", "updatedAt"]),
  )

  const suppliers = asArray<RestorableRecord>(payload.suppliers).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "cif", "regCom", "address", "city", "county", "country", "postalCode", "phone", "email", "vatPayer", "isActive", "createdAt", "updatedAt"]),
  )

  const customers = asArray<RestorableRecord>(payload.customers).map((item) =>
    pickFields(item, ["id", "tenantId", "companyId", "name", "code", "cif", "regNo", "address", "city", "county", "country", "postalCode", "phone", "email", "vatPayer", "isActive", "createdAt", "updatedAt"]),
  )

  const tenantModules = asArray<RestorableRecord>(payload.tenantModules).map((item) =>
    pickFields(item, ["id", "tenantId", "moduleId", "enabled", "limitValue", "source", "createdAt", "updatedAt"]),
  )

  const externalIntegrations = asArray<RestorableRecord>(payload.externalIntegrations).map((item) =>
    pickFields(item, ["id", "tenantId", "locationId", "platform", "status", "authType", "accessToken", "refreshToken", "tokenExpiresAt", "merchantId", "storeId", "webhookSecret", "settingsJson", "createdAt", "updatedAt"]),
  )

  const products = asArray<RestorableRecord>(payload.products).map((item) =>
    pickFields(item, [
      "id", "tenantId", "companyId", "sku", "name", "imageUrl", "class", "vatRateId", "uomId", "purchaseUomId",
      "purchaseFactor", "departmentId", "categoryId", "accountingStockTypeId", "accountingItemCode", "price",
      "costPrice", "isActive", "isVisibleInPos", "isSgr", "sgrValue", "productionMode", "createdAt", "updatedAt",
    ]),
  )

  const productBarcodes = asArray<RestorableRecord>(payload.productBarcodes).map((item) =>
    pickFields(item, ["id", "tenantId", "productId", "barcode", "createdAt"]),
  )

  const stockBalances = asArray<RestorableRecord>(payload.stockBalances).map((item) => normalizeRecord(item))
  const stockLots = asArray<RestorableRecord>(payload.stockLots).map((item) => normalizeRecord(item))
  const stockMoves = asArray<RestorableRecord>(payload.stockMoves).map((item) => normalizeRecord(item))

  const recipes = asArray<RestorableRecord>(payload.recipes).map((item) => normalizeRecord(item))
  const recipeItems = asArray<RestorableRecord>(payload.recipes).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const incomingEInvoices = asArray<RestorableRecord>(payload.incomingEInvoices).map((item) => {
    const next = normalizeRecord(item)
    delete next.linkedReceiptId
    return next
  })
  const incomingEInvoiceItems = asArray<RestorableRecord>(payload.incomingEInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const purchaseReceipts = asArray<RestorableRecord>(payload.purchaseReceipts).map((item) => normalizeRecord(item))
  const purchaseReceiptItems = asArray<RestorableRecord>(payload.purchaseReceipts).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const transferDocs = asArray<RestorableRecord>(payload.transferDocs).map((item) => normalizeRecord(item))
  const transferDocItems = asArray<RestorableRecord>(payload.transferDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const inventoryDocs = asArray<RestorableRecord>(payload.inventoryDocs).map((item) => normalizeRecord(item))
  const inventoryDocItems = asArray<RestorableRecord>(payload.inventoryDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const minutesDocs = asArray<RestorableRecord>(payload.minutesDocs).map((item) => normalizeRecord(item))
  const minutesDocItems = asArray<RestorableRecord>(payload.minutesDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const productionDocs = asArray<RestorableRecord>(payload.productionDocs).map((item) => normalizeRecord(item))
  const productionDocItems = asArray<RestorableRecord>(payload.productionDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const sales = asArray<RestorableRecord>(payload.sales).map((item) => normalizeRecord(item))
  const saleItems = asArray<RestorableRecord>(payload.sales).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const consumptionDocs = asArray<RestorableRecord>(payload.consumptionDocs).map((item) => normalizeRecord(item))
  const consumptionDocItems = asArray<RestorableRecord>(payload.consumptionDocs).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const externalOrders = asArray<RestorableRecord>(payload.externalOrders).map((item) => normalizeRecord(item))
  const externalOrderItems = asArray<RestorableRecord>(payload.externalOrders).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const externalOrderStatusHistory = asArray<RestorableRecord>(payload.externalOrders).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "statusHistory").map((entry) => normalizeRecord(entry)),
  )

  const saleDrafts = asArray<RestorableRecord>(payload.saleDrafts).map((item) => normalizeSaleDraftRecord(item))

  const kitchenTickets = asArray<RestorableRecord>(payload.kitchenTickets).map((item) => normalizeRecord(item))
  const kitchenTicketItems = asArray<RestorableRecord>(payload.kitchenTickets).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )

  const marketplaceMappings = asArray<RestorableRecord>(payload.marketplaceMappings).map((item) => normalizeRecord(item))

  const salesInvoices = asArray<RestorableRecord>(payload.salesInvoices).map((item) => normalizeRecord(item))
  const salesInvoiceItems = asArray<RestorableRecord>(payload.salesInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "items").map((entry) => normalizeRecord(entry)),
  )
  const efacturaLogs = asArray<RestorableRecord>(payload.salesInvoices).flatMap((item) =>
    getNestedArray<RestorableRecord>(item, "efacturaLogs").map((entry) => normalizeRecord(entry)),
  )

  await prisma.userCompanyAccess.deleteMany({
    where: { user: { tenantId } },
  })
  await prisma.passwordResetToken.deleteMany({ where: { tenantId } })
  await prisma.eFacturaLog.deleteMany({ where: { tenantId } })
  await prisma.salesInvoiceItem.deleteMany({ where: { invoice: { tenantId } } })
  await prisma.salesInvoice.deleteMany({ where: { tenantId } })
  await prisma.incomingEInvoiceItem.deleteMany({ where: { invoice: { tenantId } } })
  await prisma.purchaseReceiptItem.deleteMany({ where: { receipt: { tenantId } } })
  await prisma.transferDocItem.deleteMany({ where: { transfer: { tenantId } } })
  await prisma.inventoryDocItem.deleteMany({ where: { inventoryDoc: { tenantId } } })
  await prisma.minutesDocItem.deleteMany({ where: { minutesDoc: { tenantId } } })
  await prisma.productionDocItem.deleteMany({ where: { productionDoc: { tenantId } } })
  await prisma.consumptionDocItem.deleteMany({ where: { consumptionDoc: { tenantId } } })
  await prisma.saleItem.deleteMany({ where: { sale: { tenantId } } })
  await prisma.recipeItem.deleteMany({ where: { recipe: { tenantId } } })
  await prisma.kitchenTicketItem.deleteMany({ where: { kitchenTicket: { tenantId } } })
  await prisma.transferDocItemLot.deleteMany({ where: { transferDocItem: { transfer: { tenantId } } } })
  await prisma.consumptionDocItemLot.deleteMany({ where: { consumptionDocItem: { consumptionDoc: { tenantId } } } })
  await prisma.externalOrderStatusHistory.deleteMany({ where: { tenantId } })
  await prisma.externalOrderItem.deleteMany({ where: { externalOrder: { tenantId } } })
  await prisma.productBarcode.deleteMany({ where: { tenantId } })
  await prisma.marketplaceProductMapping.deleteMany({ where: { tenantId } })
  await prisma.stockMove.deleteMany({ where: { tenantId } })
  await prisma.stockLot.deleteMany({ where: { tenantId } })
  await prisma.stockBalance.deleteMany({ where: { tenantId } })
  await prisma.saleDraft.deleteMany({ where: { tenantId } })
  await prisma.kitchenTicket.deleteMany({ where: { tenantId } })
  await prisma.consumptionDoc.deleteMany({ where: { tenantId } })
  await prisma.productionDoc.deleteMany({ where: { tenantId } })
  await prisma.minutesDoc.deleteMany({ where: { tenantId } })
  await prisma.inventoryDoc.deleteMany({ where: { tenantId } })
  await prisma.transferDoc.deleteMany({ where: { tenantId } })
  await prisma.purchaseReceipt.deleteMany({ where: { tenantId } })
  await prisma.incomingEInvoice.deleteMany({ where: { tenantId } })
  await prisma.sale.deleteMany({ where: { tenantId } })
  await prisma.recipe.deleteMany({ where: { tenantId } })
  await prisma.externalOrder.deleteMany({ where: { tenantId } })
  await prisma.externalIntegration.deleteMany({ where: { tenantId } })
  await prisma.tenantModule.deleteMany({ where: { tenantId } })
  await prisma.customer.deleteMany({ where: { tenantId } })
  await prisma.supplier.deleteMany({ where: { tenantId } })
  await prisma.accountingExportConfig.deleteMany({ where: { tenantId } })
  await prisma.accountingStockType.deleteMany({ where: { tenantId } })
  await prisma.product.deleteMany({ where: { tenantId } })
  await prisma.category.deleteMany({ where: { tenantId } })
  await prisma.department.deleteMany({ where: { tenantId } })
  await prisma.uom.deleteMany({ where: { tenantId } })
  await prisma.vatRate.deleteMany({ where: { tenantId } })
  await prisma.terminal.deleteMany({ where: { tenantId } })
  await prisma.location.deleteMany({ where: { tenantId } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.company.deleteMany({ where: { tenantId } })

  await createManyIfAny(prisma.company, companies)
  await createManyIfAny(prisma.user, users)
  await createManyIfAny(prisma.userCompanyAccess, userCompanyAccesses)
  await createManyIfAny(prisma.location, locations)
  await createManyIfAny(prisma.terminal, terminals)
  await createManyIfAny(prisma.vatRate, vatRates)
  await createManyIfAny(prisma.uom, uoms)
  await createManyIfAny(prisma.department, departments)
  await createManyIfAny(prisma.category, categories)
  await createManyIfAny(prisma.accountingStockType, accountingStockTypes)
  await createManyIfAny(prisma.accountingExportConfig, accountingExportConfigs)
  await createManyIfAny(prisma.supplier, suppliers)
  await createManyIfAny(prisma.customer, customers)
  await createManyIfAny(prisma.tenantModule, tenantModules)
  await createManyIfAny(prisma.externalIntegration, externalIntegrations)
  await createManyIfAny(prisma.product, products)
  await createManyIfAny(prisma.productBarcode, productBarcodes)
  await createManyIfAny(prisma.recipe, recipes)
  await createManyIfAny(prisma.recipeItem, recipeItems)
  await createManyIfAny(prisma.incomingEInvoice, incomingEInvoices)
  await createManyIfAny(prisma.incomingEInvoiceItem, incomingEInvoiceItems)
  await createManyIfAny(prisma.purchaseReceipt, purchaseReceipts)
  await createManyIfAny(prisma.purchaseReceiptItem, purchaseReceiptItems)
  await createManyIfAny(prisma.transferDoc, transferDocs)
  await createManyIfAny(prisma.transferDocItem, transferDocItems)
  await createManyIfAny(prisma.inventoryDoc, inventoryDocs)
  await createManyIfAny(prisma.inventoryDocItem, inventoryDocItems)
  await createManyIfAny(prisma.minutesDoc, minutesDocs)
  await createManyIfAny(prisma.minutesDocItem, minutesDocItems)
  await createManyIfAny(prisma.productionDoc, productionDocs)
  await createManyIfAny(prisma.productionDocItem, productionDocItems)
  await createManyIfAny(prisma.externalOrder, externalOrders)
  await createManyIfAny(prisma.externalOrderItem, externalOrderItems)
  await createManyIfAny(prisma.externalOrderStatusHistory, externalOrderStatusHistory)
  await createManyIfAny(prisma.sale, sales)
  await createManyIfAny(prisma.saleItem, saleItems)
  await createManyIfAny(prisma.consumptionDoc, consumptionDocs)
  await createManyIfAny(prisma.consumptionDocItem, consumptionDocItems)
  await createManyIfAny(prisma.saleDraft, saleDrafts)
  await createManyIfAny(prisma.kitchenTicket, kitchenTickets)
  await createManyIfAny(prisma.kitchenTicketItem, kitchenTicketItems)
  await createManyIfAny(prisma.marketplaceProductMapping, marketplaceMappings)
  await createManyIfAny(prisma.salesInvoice, salesInvoices)
  await createManyIfAny(prisma.salesInvoiceItem, salesInvoiceItems)
  await createManyIfAny(prisma.eFacturaLog, efacturaLogs)
  await createManyIfAny(prisma.stockBalance, stockBalances)
  await createManyIfAny(prisma.stockLot, stockLots)
  await createManyIfAny(prisma.stockMove, stockMoves)
  await createManyIfAny(prisma.userCompanyAccess, userCompanyAccesses)

  const uploadRestore = restoreUploadFilesFromZip(zip, { overwriteExisting: true })

  return {
    companies: companies.length,
    users: users.length,
    locations: locations.length,
    terminals: terminals.length,
    vatRates: vatRates.length,
    uoms: uoms.length,
    departments: departments.length,
    categories: categories.length,
    accountingStockTypes: accountingStockTypes.length,
    accountingExportConfigs: accountingExportConfigs.length,
    suppliers: suppliers.length,
    customers: customers.length,
    tenantModules: tenantModules.length,
    externalIntegrations: externalIntegrations.length,
    products: products.length,
    productBarcodes: productBarcodes.length,
    stockBalances: stockBalances.length,
    stockLots: stockLots.length,
    stockMoves: stockMoves.length,
    recipes: recipes.length,
    incomingEInvoices: incomingEInvoices.length,
    purchaseReceipts: purchaseReceipts.length,
    transferDocs: transferDocs.length,
    inventoryDocs: inventoryDocs.length,
    minutesDocs: minutesDocs.length,
    productionDocs: productionDocs.length,
    sales: sales.length,
    consumptionDocs: consumptionDocs.length,
    externalOrders: externalOrders.length,
    saleDrafts: saleDrafts.length,
    kitchenTickets: kitchenTickets.length,
    marketplaceMappings: marketplaceMappings.length,
    salesInvoices: salesInvoices.length,
    restoredUploadFiles: uploadRestore.restoredFiles,
    skippedExistingUploadFiles: uploadRestore.skippedExistingFiles,
  }
}

async function replaceUserCompanyAccesses(userIds: string[], entries: RestorableRecord[]) {
  if (!userIds.length) return
  await prisma.userCompanyAccess.deleteMany({
    where: {
      userId: { in: userIds },
    },
  })
  await createManySkipDuplicatesIfAny(prisma.userCompanyAccess, entries)
}

async function restoreCompanyModule(data: SelectiveRestoreData) {
  for (const item of data.companies) {
    await prisma.company.upsert({
      where: { id: String(item.id) },
      update: item as never,
      create: item as never,
    })
  }
  for (const item of data.locations) {
    await prisma.location.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.terminals) {
    await prisma.terminal.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.vatRates) {
    await prisma.vatRate.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.uoms) {
    await prisma.uom.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.departments) {
    await prisma.department.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.categories) {
    await prisma.category.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.accountingStockTypes) {
    await prisma.accountingStockType.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.accountingExportConfigs) {
    await prisma.accountingExportConfig.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.tenantModules) {
    await prisma.tenantModule.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.externalIntegrations) {
    await prisma.externalIntegration.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }

  return {
    companies: data.companies.length,
    locations: data.locations.length,
    terminals: data.terminals.length,
    vatRates: data.vatRates.length,
    uoms: data.uoms.length,
    departments: data.departments.length,
    categories: data.categories.length,
    accountingStockTypes: data.accountingStockTypes.length,
    accountingExportConfigs: data.accountingExportConfigs.length,
    tenantModules: data.tenantModules.length,
    externalIntegrations: data.externalIntegrations.length,
  }
}

async function syncCompaniesOnly(data: SelectiveRestoreData) {
  const existing = await prisma.company.findMany({
    where: { tenantId: asText(data.companies[0]?.tenantId) || undefined },
    select: { id: true, name: true, code: true, cui: true },
  })
  const keys = new Set<string>()
  existing.forEach((item) => {
    keys.add(scopeKey("name", item.name))
    keys.add(scopeKey("code", item.code))
    keys.add(scopeKey("cui", item.cui))
  })

  let created = 0
  for (const item of data.companies) {
    const nameKey = scopeKey("name", item.name)
    const codeKey = scopeKey("code", item.code)
    const cuiKey = scopeKey("cui", item.cui)
    if (keys.has(nameKey) || (asText(item.code) && keys.has(codeKey)) || (asText(item.cui) && keys.has(cuiKey))) continue
    await prisma.company.create({ data: item as never })
    keys.add(nameKey)
    if (asText(item.code)) keys.add(codeKey)
    if (asText(item.cui)) keys.add(cuiKey)
    created += 1
  }

  return { companies: created, scannedCompanies: data.companies.length }
}

async function syncAccountingStockTypesOnly(data: SelectiveRestoreData) {
  const existing = await prisma.accountingStockType.findMany({
    where: { tenantId: asText(data.accountingStockTypes[0]?.tenantId) || undefined },
    select: { companyId: true, code: true },
  })
  const keys = new Set(existing.map((item) => scopeKey(item.companyId, item.code)))
  let created = 0

  for (const item of data.accountingStockTypes) {
    const key = scopeKey(item.companyId, item.code)
    if (keys.has(key)) continue
    await prisma.accountingStockType.create({ data: item as never })
    keys.add(key)
    created += 1
  }

  return { accountingStockTypes: created, scannedAccountingStockTypes: data.accountingStockTypes.length }
}

async function syncAccountingExportConfigsOnly(data: SelectiveRestoreData) {
  const existing = await prisma.accountingExportConfig.findMany({
    where: { tenantId: asText(data.accountingExportConfigs[0]?.tenantId) || undefined },
    select: { companyId: true },
  })
  const companyIds = new Set(existing.map((item) => asText(item.companyId)).filter(Boolean))
  let created = 0

  for (const item of data.accountingExportConfigs) {
    const companyId = asText(item.companyId)
    if (!companyId || companyIds.has(companyId)) continue
    await prisma.accountingExportConfig.create({ data: item as never })
    companyIds.add(companyId)
    created += 1
  }

  return { accountingExportConfigs: created, scannedAccountingExportConfigs: data.accountingExportConfigs.length }
}

async function syncTenantModulesOnly(data: SelectiveRestoreData) {
  const existing = await prisma.tenantModule.findMany({
    where: { tenantId: asText(data.tenantModules[0]?.tenantId) || undefined },
    select: { moduleId: true },
  })
  const keys = new Set(existing.map((item) => asText(item.moduleId)).filter(Boolean))
  let created = 0

  for (const item of data.tenantModules) {
    const key = asText(item.moduleId)
    if (!key || keys.has(key)) continue
    await prisma.tenantModule.create({ data: item as never })
    keys.add(key)
    created += 1
  }

  return { tenantModules: created, scannedTenantModules: data.tenantModules.length }
}

async function syncExternalIntegrationsOnly(data: SelectiveRestoreData) {
  const existing = await prisma.externalIntegration.findMany({
    where: { tenantId: asText(data.externalIntegrations[0]?.tenantId) || undefined },
    select: { platform: true, locationId: true, merchantId: true, storeId: true },
  })
  const keys = new Set(
    existing.map((item) => scopeKey(item.platform, item.locationId, item.merchantId, item.storeId)).filter(Boolean),
  )
  let created = 0

  for (const item of data.externalIntegrations) {
    const key = scopeKey(item.platform, item.locationId, item.merchantId, item.storeId)
    if (keys.has(key)) continue
    await prisma.externalIntegration.create({ data: item as never })
    keys.add(key)
    created += 1
  }

  return { externalIntegrations: created, scannedExternalIntegrations: data.externalIntegrations.length }
}

async function syncCompanyModule(data: SelectiveRestoreData) {
  const companies = await syncCompaniesOnly(data)
  const locations = await syncLocationsModule(data)
  const vatRates = await syncVatRatesModule(data)
  const uoms = await syncUomsModule(data)
  const departments = await syncDepartmentsModule(data)
  const categories = await syncCategoriesModule(data)
  const accountingStockTypes = await syncAccountingStockTypesOnly(data)
  const accountingExportConfigs = await syncAccountingExportConfigsOnly(data)
  const tenantModules = await syncTenantModulesOnly(data)
  const externalIntegrations = await syncExternalIntegrationsOnly(data)

  return {
    ...companies,
    ...locations,
    ...vatRates,
    ...uoms,
    ...departments,
    ...categories,
    ...accountingStockTypes,
    ...accountingExportConfigs,
    ...tenantModules,
    ...externalIntegrations,
  }
}

async function restoreUsersModule(data: SelectiveRestoreData, tenantId: string) {
  await prisma.passwordResetToken.deleteMany({ where: { tenantId } })
  for (const item of data.users) {
    await prisma.user.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  await replaceUserCompanyAccesses(
    data.users.map((item) => String(item.id)),
    data.userCompanyAccesses,
  )
  return {
    users: data.users.length,
    userCompanyAccesses: data.userCompanyAccesses.length,
  }
}

async function syncUsersModule(data: SelectiveRestoreData) {
  const existingUsers = await prisma.user.findMany({
    where: { tenantId: asText(data.users[0]?.tenantId) || undefined },
    select: { id: true, email: true },
  })
  const userIdsByEmail = new Map(existingUsers.map((item) => [lowerText(item.email), item.id]))
  let createdUsers = 0

  for (const item of data.users) {
    const emailKey = lowerText(item.email)
    if (!emailKey || userIdsByEmail.has(emailKey)) continue
    const created = await prisma.user.create({ data: item as never })
    userIdsByEmail.set(emailKey, created.id)
    createdUsers += 1
  }

  const existingAccesses = await prisma.userCompanyAccess.findMany({
    where: { userId: { in: Array.from(userIdsByEmail.values()) } },
    select: { userId: true, companyId: true },
  })
  const accessKeys = new Set(existingAccesses.map((item) => scopeKey(item.userId, item.companyId)))
  let createdAccesses = 0

  for (const item of data.userCompanyAccesses) {
    const backupUser = data.users.find((entry) => asText(entry.id) === asText(item.userId))
    const resolvedUserId = backupUser ? userIdsByEmail.get(lowerText(backupUser.email)) : asText(item.userId)
    const companyId = asText(item.companyId)
    if (!resolvedUserId || !companyId) continue
    const key = scopeKey(resolvedUserId, companyId)
    if (accessKeys.has(key)) continue
    await prisma.userCompanyAccess.create({
      data: {
        ...(item as Record<string, unknown>),
        userId: resolvedUserId,
      } as never,
    })
    accessKeys.add(key)
    createdAccesses += 1
  }

  return {
    users: createdUsers,
    userCompanyAccesses: createdAccesses,
    scannedUsers: data.users.length,
    scannedUserCompanyAccesses: data.userCompanyAccesses.length,
  }
}

async function restoreCustomersModule(data: SelectiveRestoreData) {
  for (const item of data.customers) {
    await prisma.customer.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { customers: data.customers.length }
}

async function syncCustomersModule(data: SelectiveRestoreData) {
  const existing = await prisma.customer.findMany({
    where: { tenantId: asText(data.customers[0]?.tenantId) || undefined },
    select: { id: true, companyId: true, code: true, cif: true, name: true },
  })
  const keys = new Set<string>()
  existing.forEach((item) => {
    keys.add(scopeKey(item.companyId, "code", item.code))
    keys.add(scopeKey(item.companyId, "cif", item.cif))
    keys.add(scopeKey(item.companyId, "name", item.name))
  })

  let created = 0
  for (const item of data.customers) {
    const companyId = asText(item.companyId) || null
    const codeKey = scopeKey(companyId, "code", item.code)
    const cifKey = scopeKey(companyId, "cif", item.cif)
    const nameKey = scopeKey(companyId, "name", item.name)
    if (keys.has(codeKey) || keys.has(cifKey) || keys.has(nameKey)) continue
    await prisma.customer.create({ data: item as never })
    keys.add(codeKey)
    keys.add(cifKey)
    keys.add(nameKey)
    created += 1
  }
  return { customers: created, scanned: data.customers.length }
}

async function restoreSuppliersModule(data: SelectiveRestoreData) {
  for (const item of data.suppliers) {
    await prisma.supplier.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { suppliers: data.suppliers.length }
}

async function syncSuppliersModule(data: SelectiveRestoreData) {
  const existing = await prisma.supplier.findMany({
    where: { tenantId: asText(data.suppliers[0]?.tenantId) || undefined },
    select: { id: true, companyId: true, code: true, cif: true, name: true },
  })
  const keys = new Set<string>()
  existing.forEach((item) => {
    keys.add(scopeKey(item.companyId, "code", item.code))
    keys.add(scopeKey(item.companyId, "cif", item.cif))
    keys.add(scopeKey(item.companyId, "name", item.name))
  })

  let created = 0
  for (const item of data.suppliers) {
    const companyId = asText(item.companyId) || null
    const codeKey = scopeKey(companyId, "code", item.code)
    const cifKey = scopeKey(companyId, "cif", item.cif)
    const nameKey = scopeKey(companyId, "name", item.name)
    if (keys.has(codeKey) || keys.has(cifKey) || keys.has(nameKey)) continue
    await prisma.supplier.create({ data: item as never })
    keys.add(codeKey)
    keys.add(cifKey)
    keys.add(nameKey)
    created += 1
  }
  return { suppliers: created, scanned: data.suppliers.length }
}

async function restoreLocationsModule(data: SelectiveRestoreData) {
  for (const item of data.locations) {
    await prisma.location.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.terminals) {
    await prisma.terminal.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { locations: data.locations.length, terminals: data.terminals.length }
}

async function syncLocationsModule(data: SelectiveRestoreData) {
  const existingLocations = await prisma.location.findMany({
    where: { tenantId: asText(data.locations[0]?.tenantId) || undefined },
    select: { id: true, companyId: true, code: true },
  })
  const locationKeyToId = new Map(existingLocations.map((item) => [scopeKey(item.companyId, item.code), item.id]))
  const locationIdMap = new Map<string, string>()
  let createdLocations = 0

  for (const item of data.locations) {
    const key = scopeKey(item.companyId, item.code)
    const existingId = locationKeyToId.get(key)
    if (existingId) {
      locationIdMap.set(asText(item.id), existingId)
      continue
    }
    const created = await prisma.location.create({ data: item as never })
    locationKeyToId.set(key, created.id)
    locationIdMap.set(asText(item.id), created.id)
    createdLocations += 1
  }

  const existingTerminals = await prisma.terminal.findMany({
    where: { tenantId: asText(data.terminals[0]?.tenantId) || undefined },
    select: { id: true, companyId: true, deviceId: true },
  })
  const terminalKeys = new Set(existingTerminals.map((item) => scopeKey(item.companyId, item.deviceId)))
  let createdTerminals = 0
  for (const item of data.terminals) {
    const key = scopeKey(item.companyId, item.deviceId)
    if (terminalKeys.has(key)) continue
    const next = { ...item, locationId: locationIdMap.get(asText(item.locationId)) || item.locationId }
    await prisma.terminal.create({ data: next as never })
    terminalKeys.add(key)
    createdTerminals += 1
  }

  return { locations: createdLocations, terminals: createdTerminals, scannedLocations: data.locations.length, scannedTerminals: data.terminals.length }
}

async function restoreDepartmentsModule(data: SelectiveRestoreData) {
  for (const item of data.departments) {
    await prisma.department.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { departments: data.departments.length }
}

async function syncDepartmentsModule(data: SelectiveRestoreData) {
  const existing = await prisma.department.findMany({
    where: { tenantId: asText(data.departments[0]?.tenantId) || undefined },
    select: { name: true },
  })
  const keys = new Set(existing.map((item) => lowerText(item.name)).filter(Boolean))
  let created = 0
  for (const item of data.departments) {
    const key = lowerText(item.name)
    if (keys.has(key)) continue
    await prisma.department.create({ data: item as never })
    keys.add(key)
    created += 1
  }
  return { departments: created, scanned: data.departments.length }
}

async function restoreCategoriesModule(data: SelectiveRestoreData) {
  for (const item of data.categories) {
    await prisma.category.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { categories: data.categories.length }
}

async function syncCategoriesModule(data: SelectiveRestoreData) {
  const existingDepartments = await prisma.department.findMany({
    where: { tenantId: asText(data.categories[0]?.tenantId) || undefined },
    select: { id: true, companyId: true, name: true },
  })
  const departmentByKey = new Map(existingDepartments.map((item) => [scopeKey(item.companyId, item.name), item.id]))
  const backupDepartmentById = new Map(data.departments.map((item) => [asText(item.id), item]))

  const existing = await prisma.category.findMany({
    where: { tenantId: asText(data.categories[0]?.tenantId) || undefined },
    select: { companyId: true, name: true },
  })
  const keys = new Set(existing.map((item) => scopeKey(item.companyId, item.name)))
  let created = 0
  for (const item of data.categories) {
    const key = scopeKey(item.companyId, item.name)
    if (keys.has(key)) continue
    const backupDepartment = backupDepartmentById.get(asText(item.departmentId))
    const resolvedDepartmentId = backupDepartment ? departmentByKey.get(scopeKey(backupDepartment.companyId, backupDepartment.name)) || null : null
    await prisma.category.create({ data: { ...item, departmentId: resolvedDepartmentId } as never })
    keys.add(key)
    created += 1
  }
  return { categories: created, scanned: data.categories.length }
}

async function restoreUomsModule(data: SelectiveRestoreData) {
  for (const item of data.uoms) {
    await prisma.uom.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { uoms: data.uoms.length }
}

async function syncUomsModule(data: SelectiveRestoreData) {
  const existing = await prisma.uom.findMany({
    where: { tenantId: asText(data.uoms[0]?.tenantId) || undefined },
    select: { companyId: true, code: true },
  })
  const keys = new Set(existing.map((item) => scopeKey(item.companyId, item.code)))
  let created = 0
  for (const item of data.uoms) {
    const key = scopeKey(item.companyId, item.code)
    if (keys.has(key)) continue
    await prisma.uom.create({ data: item as never })
    keys.add(key)
    created += 1
  }
  return { uoms: created, scanned: data.uoms.length }
}

async function restoreVatRatesModule(data: SelectiveRestoreData) {
  for (const item of data.vatRates) {
    await prisma.vatRate.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { vatRates: data.vatRates.length }
}

async function syncVatRatesModule(data: SelectiveRestoreData) {
  const existing = await prisma.vatRate.findMany({
    where: { tenantId: asText(data.vatRates[0]?.tenantId) || undefined },
    select: { companyId: true, rate: true },
  })
  const keys = new Set(existing.map((item) => scopeKey(item.companyId, item.rate)))
  let created = 0
  for (const item of data.vatRates) {
    const key = scopeKey(item.companyId, item.rate)
    if (keys.has(key)) continue
    await prisma.vatRate.create({ data: item as never })
    keys.add(key)
    created += 1
  }
  return { vatRates: created, scanned: data.vatRates.length }
}

async function restoreCatalogModule(data: SelectiveRestoreData) {
  for (const item of data.products) {
    await prisma.product.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.productBarcodes) {
    await prisma.productBarcode.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.recipes) {
    await prisma.recipe.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  if (data.recipes.length) {
    await prisma.recipeItem.deleteMany({
      where: {
        recipeId: { in: data.recipes.map((item) => String(item.id)) },
      },
    })
  }
  await createManySkipDuplicatesIfAny(prisma.recipeItem, data.recipeItems)
  for (const item of data.marketplaceMappings) {
    await prisma.marketplaceProductMapping.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return {
    products: data.products.length,
    productBarcodes: data.productBarcodes.length,
    recipes: data.recipes.length,
    recipeItems: data.recipeItems.length,
    marketplaceMappings: data.marketplaceMappings.length,
  }
}

async function syncCatalogModule(data: SelectiveRestoreData) {
  const products = await syncProductsModule(data)
  const recipes = await syncRecipesModule(data)
  return {
    ...products,
    ...recipes,
  }
}

async function restoreProductsModule(data: SelectiveRestoreData) {
  for (const item of data.products) {
    await prisma.product.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.productBarcodes) {
    await prisma.productBarcode.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  for (const item of data.marketplaceMappings) {
    await prisma.marketplaceProductMapping.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return {
    products: data.products.length,
    productBarcodes: data.productBarcodes.length,
    marketplaceMappings: data.marketplaceMappings.length,
  }
}

async function syncProductsModule(data: SelectiveRestoreData) {
  const tenantId = asText(data.products[0]?.tenantId || data.productBarcodes[0]?.tenantId)
  const [existingProducts, existingBarcodes, existingDepartments, existingCategories, existingUoms, existingVatRates, existingStockTypes, existingMappings] =
    await Promise.all([
      prisma.product.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, sku: true },
      }),
      prisma.productBarcode.findMany({
        where: { tenantId },
        select: { barcode: true },
      }),
      prisma.department.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, name: true },
      }),
      prisma.category.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, name: true },
      }),
      prisma.uom.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, code: true },
      }),
      prisma.vatRate.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, rate: true },
      }),
      prisma.accountingStockType.findMany({
        where: { tenantId },
        select: { id: true, companyId: true, code: true },
      }),
      prisma.marketplaceProductMapping.findMany({
        where: { tenantId },
        select: { integrationId: true, externalProductId: true },
      }),
    ])

  const productByKey = new Map(existingProducts.map((item) => [scopeKey(item.companyId, item.sku), item.id]))
  const barcodeKeys = new Set(existingBarcodes.map((item) => lowerText(item.barcode)))
  const mappingKeys = new Set(existingMappings.map((item) => scopeKey(item.integrationId, item.externalProductId)))
  const departmentByKey = new Map(existingDepartments.map((item) => [scopeKey(item.companyId, item.name), item.id]))
  const categoryByKey = new Map(existingCategories.map((item) => [scopeKey(item.companyId, item.name), item.id]))
  const uomByKey = new Map(existingUoms.map((item) => [scopeKey(item.companyId, item.code), item.id]))
  const vatRateByKey = new Map(existingVatRates.map((item) => [scopeKey(item.companyId, item.rate), item.id]))
  const stockTypeByKey = new Map(existingStockTypes.map((item) => [scopeKey(item.companyId, item.code), item.id]))

  const backupDepartmentById = new Map(data.departments.map((item) => [asText(item.id), item]))
  const backupCategoryById = new Map(data.categories.map((item) => [asText(item.id), item]))
  const backupUomById = new Map(data.uoms.map((item) => [asText(item.id), item]))
  const backupVatById = new Map(data.vatRates.map((item) => [asText(item.id), item]))
  const backupStockTypeById = new Map(data.accountingStockTypes.map((item) => [asText(item.id), item]))

  const resolvedProductIdByBackupId = new Map<string, string>()
  let createdProducts = 0
  for (const item of data.products) {
    const key = scopeKey(item.companyId, item.sku)
    const existingId = productByKey.get(key)
    if (existingId) {
      resolvedProductIdByBackupId.set(asText(item.id), existingId)
      continue
    }

    const backupDepartment = backupDepartmentById.get(asText(item.departmentId))
    const backupCategory = backupCategoryById.get(asText(item.categoryId))
    const backupUom = backupUomById.get(asText(item.uomId))
    const backupPurchaseUom = backupUomById.get(asText(item.purchaseUomId))
    const backupVat = backupVatById.get(asText(item.vatRateId))
    const backupStockType = backupStockTypeById.get(asText(item.accountingStockTypeId))

    const created = await prisma.product.create({
      data: {
        ...(item as Record<string, unknown>),
        departmentId: backupDepartment ? departmentByKey.get(scopeKey(backupDepartment.companyId, backupDepartment.name)) || undefined : undefined,
        categoryId: backupCategory ? categoryByKey.get(scopeKey(backupCategory.companyId, backupCategory.name)) || undefined : undefined,
        uomId: backupUom ? uomByKey.get(scopeKey(backupUom.companyId, backupUom.code)) || asText(item.uomId) : asText(item.uomId),
        purchaseUomId: backupPurchaseUom ? uomByKey.get(scopeKey(backupPurchaseUom.companyId, backupPurchaseUom.code)) || undefined : undefined,
        vatRateId: backupVat ? vatRateByKey.get(scopeKey(backupVat.companyId, backupVat.rate)) || asText(item.vatRateId) : asText(item.vatRateId),
        accountingStockTypeId: backupStockType ? stockTypeByKey.get(scopeKey(backupStockType.companyId, backupStockType.code)) || undefined : undefined,
      } as never,
    })

    productByKey.set(key, created.id)
    resolvedProductIdByBackupId.set(asText(item.id), created.id)
    createdProducts += 1
  }

  let createdBarcodes = 0
  for (const item of data.productBarcodes) {
    const barcodeKey = lowerText(item.barcode)
    if (!barcodeKey || barcodeKeys.has(barcodeKey)) continue
    const resolvedProductId = resolvedProductIdByBackupId.get(asText(item.productId))
    if (!resolvedProductId) continue
    await prisma.productBarcode.create({
      data: {
        ...(item as Record<string, unknown>),
        productId: resolvedProductId,
      } as never,
    })
    barcodeKeys.add(barcodeKey)
    createdBarcodes += 1
  }

  let createdMappings = 0
  for (const item of data.marketplaceMappings) {
    const mappingKey = scopeKey(item.integrationId, item.externalProductId)
    if (mappingKeys.has(mappingKey)) continue
    const resolvedProductId = resolvedProductIdByBackupId.get(asText(item.erpProductId))
    await prisma.marketplaceProductMapping.create({
      data: {
        ...(item as Record<string, unknown>),
        erpProductId: resolvedProductId || null,
      } as never,
    })
    mappingKeys.add(mappingKey)
    createdMappings += 1
  }

  return {
    products: createdProducts,
    productBarcodes: createdBarcodes,
    marketplaceMappings: createdMappings,
    scannedProducts: data.products.length,
  }
}

async function restoreRecipesModule(data: SelectiveRestoreData) {
  for (const item of data.recipes) {
    await prisma.recipe.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  if (data.recipes.length) {
    await prisma.recipeItem.deleteMany({
      where: {
        recipeId: { in: data.recipes.map((item) => String(item.id)) },
      },
    })
  }
  await createManySkipDuplicatesIfAny(prisma.recipeItem, data.recipeItems)
  return {
    recipes: data.recipes.length,
    recipeItems: data.recipeItems.length,
  }
}

async function syncRecipesModule(data: SelectiveRestoreData) {
  const tenantId = asText(data.recipes[0]?.tenantId)
  const existingProducts = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, companyId: true, sku: true },
  })
  const existingRecipes = await prisma.recipe.findMany({
    where: { tenantId },
    select: { id: true, productId: true },
  })

  const productByKey = new Map(existingProducts.map((item) => [scopeKey(item.companyId, item.sku), item.id]))
  const backupProductById = new Map(data.products.map((item) => [asText(item.id), item]))
  const existingRecipeProductIds = new Set(existingRecipes.map((item) => item.productId))
  const createdRecipeIdByBackupId = new Map<string, string>()

  let createdRecipes = 0
  for (const item of data.recipes) {
    const backupProduct = backupProductById.get(asText(item.productId))
    const resolvedProductId = backupProduct ? productByKey.get(scopeKey(backupProduct.companyId, backupProduct.sku)) : null
    if (!resolvedProductId || existingRecipeProductIds.has(resolvedProductId)) continue
    const created = await prisma.recipe.create({
      data: {
        ...(item as Record<string, unknown>),
        productId: resolvedProductId,
      } as never,
    })
    existingRecipeProductIds.add(resolvedProductId)
    createdRecipeIdByBackupId.set(asText(item.id), created.id)
    createdRecipes += 1
  }

  let createdRecipeItems = 0
  for (const item of data.recipeItems) {
    const resolvedRecipeId = createdRecipeIdByBackupId.get(asText(item.recipeId))
    const backupIngredient = backupProductById.get(asText(item.ingredientId))
    const resolvedIngredientId = backupIngredient ? productByKey.get(scopeKey(backupIngredient.companyId, backupIngredient.sku)) : null
    if (!resolvedRecipeId || !resolvedIngredientId) continue
    await prisma.recipeItem.create({
      data: {
        ...(item as Record<string, unknown>),
        recipeId: resolvedRecipeId,
        ingredientId: resolvedIngredientId,
      } as never,
    })
    createdRecipeItems += 1
  }

  return {
    recipes: createdRecipes,
    recipeItems: createdRecipeItems,
    scannedRecipes: data.recipes.length,
  }
}

async function restoreDocumentsModule(data: SelectiveRestoreData) {
  await restorePurchaseReceiptsModule(data)
  await restoreTransferDocsModule(data)
  await restoreInventoryDocsModule(data)
  await restoreMinutesDocsModule(data)
  await restoreProductionDocsModule(data)
  await restoreExternalOrdersModule(data)
  await restoreSaleDraftsModule(data)
  await restoreKitchenTicketsModule(data)
  await restoreSalesModule(data)
  await restoreConsumptionDocsModule(data)
  await restoreSalesInvoicesModule(data)
  await restoreStockModule(data)
  await relinkDocumentReferences(data)

  return {
    purchaseReceipts: data.purchaseReceipts.length,
    transferDocs: data.transferDocs.length,
    inventoryDocs: data.inventoryDocs.length,
    minutesDocs: data.minutesDocs.length,
    productionDocs: data.productionDocs.length,
    sales: data.sales.length,
    consumptionDocs: data.consumptionDocs.length,
    externalOrders: data.externalOrders.length,
    saleDrafts: data.saleDrafts.length,
    kitchenTickets: data.kitchenTickets.length,
    salesInvoices: data.salesInvoices.length,
    stockBalances: data.stockBalances.length,
    stockMoves: data.stockMoves.length,
  }
}

async function syncDocumentsModule(data: SelectiveRestoreData) {
  await syncPurchaseReceiptsModule(data)
  await syncTransferDocsModule(data)
  await syncInventoryDocsModule(data)
  await syncMinutesDocsModule(data)
  await syncProductionDocsModule(data)
  await syncExternalOrdersModule(data)
  await syncSaleDraftsModule(data)
  await syncKitchenTicketsModule(data)
  await syncSalesModule(data)
  await syncConsumptionDocsModule(data)
  await syncSalesInvoicesModule(data)
  await syncStockModule(data)
  await relinkDocumentReferences(data)

  return {
    purchaseReceipts: data.purchaseReceipts.length,
    transferDocs: data.transferDocs.length,
    inventoryDocs: data.inventoryDocs.length,
    minutesDocs: data.minutesDocs.length,
    productionDocs: data.productionDocs.length,
    sales: data.sales.length,
    consumptionDocs: data.consumptionDocs.length,
    externalOrders: data.externalOrders.length,
    saleDrafts: data.saleDrafts.length,
    kitchenTickets: data.kitchenTickets.length,
    salesInvoices: data.salesInvoices.length,
    stockBalances: data.stockBalances.length,
    stockMoves: data.stockMoves.length,
  }
}

async function restoreIncomingEInvoicesModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoice, data.incomingEInvoices)
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoiceItem, data.incomingEInvoiceItems)
  return { incomingEInvoices: data.incomingEInvoices.length }
}

async function syncIncomingEInvoicesModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoice, data.incomingEInvoices)
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoiceItem, data.incomingEInvoiceItems)
  return { incomingEInvoices: data.incomingEInvoices.length }
}

async function restorePurchaseReceiptsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.purchaseReceipts.map((item) => item.locationId))
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, data.purchaseReceipts.map((item) => item.warehouseId))
  const supplierIds = await fetchExistingIds(prisma.supplier as unknown as IdLookupModel, data.purchaseReceipts.map((item) => item.supplierId))
  const receipts = prepareRecords(data.purchaseReceipts, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [
      { field: "warehouseId", allowed: warehouseIds },
      { field: "supplierId", allowed: supplierIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.purchaseReceipt, receipts)

  const receiptIds = await fetchExistingIds(prisma.purchaseReceipt as unknown as IdLookupModel, data.purchaseReceiptItems.map((item) => item.receiptId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.purchaseReceiptItems.map((item) => item.productId))
  const uomIds = await fetchExistingIds(prisma.uom as unknown as IdLookupModel, data.purchaseReceiptItems.map((item) => item.uomId))
  const vatRateIds = await fetchExistingIds(prisma.vatRate as unknown as IdLookupModel, data.purchaseReceiptItems.map((item) => item.vatRateId))
  const items = prepareRecords(data.purchaseReceiptItems, {
    required: [
      { field: "receiptId", allowed: receiptIds },
      { field: "productId", allowed: productIds },
      { field: "uomId", allowed: uomIds },
    ],
    optional: [{ field: "vatRateId", allowed: vatRateIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.purchaseReceiptItem, items)
  return { purchaseReceipts: data.purchaseReceipts.length }
}

async function syncPurchaseReceiptsModule(data: SelectiveRestoreData) {
  await restorePurchaseReceiptsModule(data)
  return { purchaseReceipts: data.purchaseReceipts.length }
}

async function restoreTransferDocsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, [
    ...data.transferDocs.map((item) => item.fromLocationId),
    ...data.transferDocs.map((item) => item.toLocationId),
  ])
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, [
    ...data.transferDocs.map((item) => item.fromWarehouseId),
    ...data.transferDocs.map((item) => item.toWarehouseId),
  ])
  const docs = prepareRecords(data.transferDocs, {
    required: [
      { field: "fromLocationId", allowed: locationIds },
      { field: "toLocationId", allowed: locationIds },
    ],
    optional: [
      { field: "fromWarehouseId", allowed: warehouseIds },
      { field: "toWarehouseId", allowed: warehouseIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.transferDoc, docs)

  const transferIds = await fetchExistingIds(prisma.transferDoc as unknown as IdLookupModel, data.transferDocItems.map((item) => item.transferId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.transferDocItems.map((item) => item.productId))
  const uomIds = await fetchExistingIds(prisma.uom as unknown as IdLookupModel, data.transferDocItems.map((item) => item.uomId))
  const vatRateIds = await fetchExistingIds(prisma.vatRate as unknown as IdLookupModel, data.transferDocItems.map((item) => item.vatRateId))
  const items = prepareRecords(data.transferDocItems, {
    required: [
      { field: "transferId", allowed: transferIds },
      { field: "productId", allowed: productIds },
      { field: "uomId", allowed: uomIds },
    ],
    optional: [{ field: "vatRateId", allowed: vatRateIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.transferDocItem, items)
  return { transferDocs: data.transferDocs.length }
}

async function syncTransferDocsModule(data: SelectiveRestoreData) {
  await restoreTransferDocsModule(data)
  return { transferDocs: data.transferDocs.length }
}

async function restoreInventoryDocsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.inventoryDocs.map((item) => item.locationId))
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, data.inventoryDocs.map((item) => item.warehouseId))
  const docs = prepareRecords(data.inventoryDocs, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "warehouseId", allowed: warehouseIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.inventoryDoc, docs)

  const inventoryDocIds = await fetchExistingIds(prisma.inventoryDoc as unknown as IdLookupModel, data.inventoryDocItems.map((item) => item.inventoryDocId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.inventoryDocItems.map((item) => item.productId))
  const items = prepareRecords(data.inventoryDocItems, {
    required: [
      { field: "inventoryDocId", allowed: inventoryDocIds },
      { field: "productId", allowed: productIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.inventoryDocItem, items)
  return { inventoryDocs: data.inventoryDocs.length }
}

async function syncInventoryDocsModule(data: SelectiveRestoreData) {
  await restoreInventoryDocsModule(data)
  return { inventoryDocs: data.inventoryDocs.length }
}

async function restoreMinutesDocsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.minutesDocs.map((item) => item.locationId))
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, data.minutesDocs.map((item) => item.warehouseId))
  const docs = prepareRecords(data.minutesDocs, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "warehouseId", allowed: warehouseIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.minutesDoc, docs)

  const minutesDocIds = await fetchExistingIds(prisma.minutesDoc as unknown as IdLookupModel, data.minutesDocItems.map((item) => item.minutesDocId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.minutesDocItems.map((item) => item.productId))
  const items = prepareRecords(data.minutesDocItems, {
    required: [
      { field: "minutesDocId", allowed: minutesDocIds },
      { field: "productId", allowed: productIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.minutesDocItem, items)
  return { minutesDocs: data.minutesDocs.length }
}

async function syncMinutesDocsModule(data: SelectiveRestoreData) {
  await restoreMinutesDocsModule(data)
  return { minutesDocs: data.minutesDocs.length }
}

async function restoreProductionDocsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.productionDocs.map((item) => item.locationId))
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, data.productionDocs.map((item) => item.warehouseId))
  const docs = prepareRecords(data.productionDocs, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "warehouseId", allowed: warehouseIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.productionDoc, docs)

  const productionDocIds = await fetchExistingIds(prisma.productionDoc as unknown as IdLookupModel, data.productionDocItems.map((item) => item.productionDocId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.productionDocItems.map((item) => item.productId))
  const items = prepareRecords(data.productionDocItems, {
    required: [
      { field: "productionDocId", allowed: productionDocIds },
      { field: "productId", allowed: productIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.productionDocItem, items)
  return { productionDocs: data.productionDocs.length }
}

async function syncProductionDocsModule(data: SelectiveRestoreData) {
  await restoreProductionDocsModule(data)
  return { productionDocs: data.productionDocs.length }
}

async function restoreSalesModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.sales.map((item) => item.locationId))
  const terminalIds = await fetchExistingIds(prisma.terminal as unknown as IdLookupModel, data.sales.map((item) => item.terminalId))
  const externalOrderIds = await fetchExistingIds(prisma.externalOrder as unknown as IdLookupModel, data.sales.map((item) => item.externalOrderId))
  const consumptionDocIds = await fetchExistingIds(prisma.consumptionDoc as unknown as IdLookupModel, data.sales.map((item) => item.consumptionBatchDocId))
  const sales = prepareRecords(data.sales, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [
      { field: "terminalId", allowed: terminalIds },
      { field: "externalOrderId", allowed: externalOrderIds },
      { field: "consumptionBatchDocId", allowed: consumptionDocIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.sale, sales)

  const saleIds = await fetchExistingIds(prisma.sale as unknown as IdLookupModel, data.saleItems.map((item) => item.saleId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.saleItems.map((item) => item.productId))
  const items = prepareRecords(data.saleItems, {
    required: [
      { field: "saleId", allowed: saleIds },
      { field: "productId", allowed: productIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.saleItem, items)
  return { sales: data.sales.length }
}

async function syncSalesModule(data: SelectiveRestoreData) {
  await restoreSalesModule(data)
  return { sales: data.sales.length }
}

async function restoreConsumptionDocsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.consumptionDocs.map((item) => item.locationId))
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, data.consumptionDocs.map((item) => item.warehouseId))
  const saleIds = await fetchExistingIds(prisma.sale as unknown as IdLookupModel, data.consumptionDocs.map((item) => item.saleId))
  const parentConsumptionIds = await fetchExistingIds(prisma.consumptionDoc as unknown as IdLookupModel, data.consumptionDocs.map((item) => item.aggregateParentId))
  const docs = prepareRecords(data.consumptionDocs, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [
      { field: "warehouseId", allowed: warehouseIds },
      { field: "saleId", allowed: saleIds },
      { field: "aggregateParentId", allowed: parentConsumptionIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.consumptionDoc, docs)

  const consumptionDocIds = await fetchExistingIds(prisma.consumptionDoc as unknown as IdLookupModel, data.consumptionDocItems.map((item) => item.consumptionDocId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, [
    ...data.consumptionDocItems.map((item) => item.finishedProductId),
    ...data.consumptionDocItems.map((item) => item.ingredientId),
  ])
  const items = prepareRecords(data.consumptionDocItems, {
    required: [
      { field: "consumptionDocId", allowed: consumptionDocIds },
      { field: "ingredientId", allowed: productIds },
    ],
    optional: [{ field: "finishedProductId", allowed: productIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.consumptionDocItem, items)
  return { consumptionDocs: data.consumptionDocs.length }
}

async function syncConsumptionDocsModule(data: SelectiveRestoreData) {
  await restoreConsumptionDocsModule(data)
  return { consumptionDocs: data.consumptionDocs.length }
}

async function restoreSalesInvoicesModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.salesInvoices.map((item) => item.locationId))
  const customerIds = await fetchExistingIds(prisma.customer as unknown as IdLookupModel, data.salesInvoices.map((item) => item.customerId))
  const invoices = prepareRecords(data.salesInvoices, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "customerId", allowed: customerIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.salesInvoice, invoices)

  const invoiceIds = await fetchExistingIds(prisma.salesInvoice as unknown as IdLookupModel, [
    ...data.salesInvoiceItems.map((item) => item.invoiceId),
    ...data.efacturaLogs.map((item) => item.invoiceId),
  ])
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.salesInvoiceItems.map((item) => item.productId))
  const items = prepareRecords(data.salesInvoiceItems, {
    required: [
      { field: "invoiceId", allowed: invoiceIds },
      { field: "productId", allowed: productIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.salesInvoiceItem, items)

  const logs = prepareRecords(data.efacturaLogs, {
    required: [{ field: "invoiceId", allowed: invoiceIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.eFacturaLog, logs)
  return { salesInvoices: data.salesInvoices.length }
}

async function syncSalesInvoicesModule(data: SelectiveRestoreData) {
  await restoreSalesInvoicesModule(data)
  return { salesInvoices: data.salesInvoices.length }
}

async function restoreExternalOrdersModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.externalOrders.map((item) => item.locationId))
  const integrationIds = await fetchExistingIds(prisma.externalIntegration as unknown as IdLookupModel, data.externalOrders.map((item) => item.integrationId))
  const orders = prepareRecords(data.externalOrders, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "integrationId", allowed: integrationIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.externalOrder, orders)

  const externalOrderIds = await fetchExistingIds(prisma.externalOrder as unknown as IdLookupModel, [
    ...data.externalOrderItems.map((item) => item.externalOrderId),
    ...data.externalOrderStatusHistory.map((item) => item.externalOrderId),
  ])
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.externalOrderItems.map((item) => item.erpProductId))
  const items = prepareRecords(data.externalOrderItems, {
    required: [{ field: "externalOrderId", allowed: externalOrderIds }],
    optional: [{ field: "erpProductId", allowed: productIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.externalOrderItem, items)

  const history = prepareRecords(data.externalOrderStatusHistory, {
    required: [{ field: "externalOrderId", allowed: externalOrderIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.externalOrderStatusHistory, history)
  return { externalOrders: data.externalOrders.length }
}

async function syncExternalOrdersModule(data: SelectiveRestoreData) {
  await restoreExternalOrdersModule(data)
  return { externalOrders: data.externalOrders.length }
}

async function restoreSaleDraftsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.saleDrafts.map((item) => item.locationId))
  const externalOrderIds = await fetchExistingIds(prisma.externalOrder as unknown as IdLookupModel, data.saleDrafts.map((item) => item.externalOrderId))
  const drafts = prepareRecords(data.saleDrafts, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "externalOrderId", allowed: externalOrderIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.saleDraft, drafts)
  return { saleDrafts: data.saleDrafts.length }
}

async function syncSaleDraftsModule(data: SelectiveRestoreData) {
  await restoreSaleDraftsModule(data)
  return { saleDrafts: data.saleDrafts.length }
}

async function restoreKitchenTicketsModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, data.kitchenTickets.map((item) => item.locationId))
  const externalOrderIds = await fetchExistingIds(prisma.externalOrder as unknown as IdLookupModel, data.kitchenTickets.map((item) => item.externalOrderId))
  const tickets = prepareRecords(data.kitchenTickets, {
    required: [{ field: "locationId", allowed: locationIds }],
    optional: [{ field: "externalOrderId", allowed: externalOrderIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.kitchenTicket, tickets)

  const kitchenTicketIds = await fetchExistingIds(prisma.kitchenTicket as unknown as IdLookupModel, data.kitchenTicketItems.map((item) => item.kitchenTicketId))
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, data.kitchenTicketItems.map((item) => item.productId))
  const departmentIds = await fetchExistingIds(prisma.department as unknown as IdLookupModel, data.kitchenTicketItems.map((item) => item.departmentId))
  const items = prepareRecords(data.kitchenTicketItems, {
    required: [{ field: "kitchenTicketId", allowed: kitchenTicketIds }],
    optional: [
      { field: "productId", allowed: productIds },
      { field: "departmentId", allowed: departmentIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.kitchenTicketItem, items)
  return { kitchenTickets: data.kitchenTickets.length }
}

async function syncKitchenTicketsModule(data: SelectiveRestoreData) {
  await restoreKitchenTicketsModule(data)
  return { kitchenTickets: data.kitchenTickets.length }
}

async function restoreStockModule(data: SelectiveRestoreData) {
  const locationIds = await fetchExistingIds(prisma.location as unknown as IdLookupModel, [
    ...data.stockBalances.map((item) => item.locationId),
    ...data.stockMoves.map((item) => item.locationId),
  ])
  const warehouseIds = await fetchExistingIds(prisma.warehouse as unknown as IdLookupModel, [
    ...data.stockBalances.map((item) => item.warehouseId),
    ...data.stockMoves.map((item) => item.warehouseId),
  ])
  const productIds = await fetchExistingIds(prisma.product as unknown as IdLookupModel, [
    ...data.stockBalances.map((item) => item.productId),
    ...data.stockMoves.map((item) => item.productId),
  ])
  const lotIds = await fetchExistingIds(prisma.stockLot as unknown as IdLookupModel, data.stockMoves.map((item) => item.lotId))
  const balances = prepareRecords(data.stockBalances, {
    required: [
      { field: "locationId", allowed: locationIds },
      { field: "productId", allowed: productIds },
    ],
    optional: [{ field: "warehouseId", allowed: warehouseIds }],
  })
  await createManySkipDuplicatesIfAny(prisma.stockBalance, balances)

  const moves = prepareRecords(data.stockMoves, {
    required: [
      { field: "locationId", allowed: locationIds },
      { field: "productId", allowed: productIds },
    ],
    optional: [
      { field: "warehouseId", allowed: warehouseIds },
      { field: "lotId", allowed: lotIds },
    ],
  })
  await createManySkipDuplicatesIfAny(prisma.stockMove, moves)
  return { stockBalances: data.stockBalances.length, stockMoves: data.stockMoves.length }
}

async function syncStockModule(data: SelectiveRestoreData) {
  await restoreStockModule(data)
  return { stockBalances: data.stockBalances.length, stockMoves: data.stockMoves.length }
}

export async function restoreTenantBackupSelectionFromFile(
  tenantId: string,
  filePath: string,
  moduleKeys: string[],
  mode: RestoreMode = "merge",
) {
  const zip = readTenantZip(filePath)
  const payload = readTenantPayloadFromZip(filePath)
  ensureBackupBelongsToTenant(tenantId, payload)

  const requested = Array.from(
    new Set(
      asArray<string>(moduleKeys)
        .filter((item): item is TenantBackupModuleKey =>
          TENANT_BACKUP_MODULE_DEFINITIONS.some((definition) => definition.key === item),
        )
        .flatMap((item) => expandRequestedModuleKey(item)),
    ),
  ).sort((left, right) => (MODULE_EXECUTION_PRIORITY[left] || 9999) - (MODULE_EXECUTION_PRIORITY[right] || 9999))

  if (!requested.length) {
    throw new Error("Nu ai selectat niciun modul pentru restore.")
  }

  const data = buildSelectiveRestoreData(payload)
  const result: Record<string, unknown> = {
    mode: mode === "sync_missing" ? "sync-missing" : "selective-merge",
    modules: requested,
  }

  for (const key of requested) {
    if (key === "company") {
      result.company = mode === "sync_missing" ? await syncCompanyModule(data) : await restoreCompanyModule(data)
      continue
    }
    if (key === "users") {
      result.users = mode === "sync_missing" ? await syncUsersModule(data) : await restoreUsersModule(data, tenantId)
      continue
    }
    if (key === "customers") {
      result.customers = mode === "sync_missing" ? await syncCustomersModule(data) : await restoreCustomersModule(data)
      continue
    }
    if (key === "suppliers") {
      result.suppliers = mode === "sync_missing" ? await syncSuppliersModule(data) : await restoreSuppliersModule(data)
      continue
    }
    if (key === "locations") {
      result.locations = mode === "sync_missing" ? await syncLocationsModule(data) : await restoreLocationsModule(data)
      continue
    }
    if (key === "departments") {
      result.departments = mode === "sync_missing" ? await syncDepartmentsModule(data) : await restoreDepartmentsModule(data)
      continue
    }
    if (key === "categories") {
      result.categories = mode === "sync_missing" ? await syncCategoriesModule(data) : await restoreCategoriesModule(data)
      continue
    }
    if (key === "uoms") {
      result.uoms = mode === "sync_missing" ? await syncUomsModule(data) : await restoreUomsModule(data)
      continue
    }
    if (key === "vat_rates") {
      result.vatRates = mode === "sync_missing" ? await syncVatRatesModule(data) : await restoreVatRatesModule(data)
      continue
    }
    if (key === "catalog") {
      result.catalog = mode === "sync_missing" ? await syncCatalogModule(data) : await restoreCatalogModule(data)
      continue
    }
    if (key === "products") {
      result.products = mode === "sync_missing" ? await syncProductsModule(data) : await restoreProductsModule(data)
      continue
    }
    if (key === "recipes") {
      result.recipes = mode === "sync_missing" ? await syncRecipesModule(data) : await restoreRecipesModule(data)
      continue
    }
    if (key === "documents") {
      result.documents = mode === "sync_missing" ? await syncDocumentsModule(data) : await restoreDocumentsModule(data)
      continue
    }
    if (key === "documents_purchase_receipts") {
      result.documentsPurchaseReceipts = mode === "sync_missing" ? await syncPurchaseReceiptsModule(data) : await restorePurchaseReceiptsModule(data)
      continue
    }
    if (key === "documents_transfers") {
      result.documentsTransfers = mode === "sync_missing" ? await syncTransferDocsModule(data) : await restoreTransferDocsModule(data)
      continue
    }
    if (key === "documents_inventory") {
      result.documentsInventory = mode === "sync_missing" ? await syncInventoryDocsModule(data) : await restoreInventoryDocsModule(data)
      continue
    }
    if (key === "documents_minutes") {
      result.documentsMinutes = mode === "sync_missing" ? await syncMinutesDocsModule(data) : await restoreMinutesDocsModule(data)
      continue
    }
    if (key === "documents_production") {
      result.documentsProduction = mode === "sync_missing" ? await syncProductionDocsModule(data) : await restoreProductionDocsModule(data)
      continue
    }
    if (key === "documents_sales") {
      result.documentsSales = mode === "sync_missing" ? await syncSalesModule(data) : await restoreSalesModule(data)
      continue
    }
    if (key === "documents_consumption") {
      result.documentsConsumption = mode === "sync_missing" ? await syncConsumptionDocsModule(data) : await restoreConsumptionDocsModule(data)
      continue
    }
    if (key === "documents_sales_invoices") {
      result.documentsSalesInvoices = mode === "sync_missing" ? await syncSalesInvoicesModule(data) : await restoreSalesInvoicesModule(data)
      continue
    }
    if (key === "documents_external_orders") {
      result.documentsExternalOrders = mode === "sync_missing" ? await syncExternalOrdersModule(data) : await restoreExternalOrdersModule(data)
      continue
    }
    if (key === "documents_sale_drafts") {
      result.documentsSaleDrafts = mode === "sync_missing" ? await syncSaleDraftsModule(data) : await restoreSaleDraftsModule(data)
      continue
    }
    if (key === "documents_kitchen_tickets") {
      result.documentsKitchenTickets = mode === "sync_missing" ? await syncKitchenTicketsModule(data) : await restoreKitchenTicketsModule(data)
      continue
    }
    if (key === "documents_stock") {
      result.documentsStock = mode === "sync_missing" ? await syncStockModule(data) : await restoreStockModule(data)
      continue
    }
    if (key === "files") {
      const uploadRestore = restoreUploadFilesFromZip(zip, { overwriteExisting: mode !== "sync_missing" })
      result.files = {
        restoredUploadFiles: uploadRestore.restoredFiles,
        skippedExistingUploadFiles: uploadRestore.skippedExistingFiles,
      }
    }
  }

  if (
    hasAnyRequestedModule(requested, [
      "documents",
      "documents_purchase_receipts",
      "documents_transfers",
      "documents_inventory",
      "documents_minutes",
      "documents_production",
      "documents_external_orders",
      "documents_sale_drafts",
      "documents_kitchen_tickets",
      "documents_consumption",
      "documents_sales",
      "documents_sales_invoices",
      "documents_stock",
    ])
  ) {
    await relinkDocumentReferences(data)
  }

  return result
}

export async function restoreMissingTenantFilesFromBackupFile(tenantId: string, filePath: string) {
  const zip = readTenantZip(filePath)
  const payload = readTenantPayloadFromZip(filePath)

  if (String(payload?.tenantId || "") !== String(tenantId)) {
    throw new Error("Backup-ul nu apartine acestui client.")
  }

  const uploadRestore = restoreUploadFilesFromZip(zip, { overwriteExisting: false })

  return {
    restoredUploadFiles: uploadRestore.restoredFiles,
    skippedExistingUploadFiles: uploadRestore.skippedExistingFiles,
  }
}
