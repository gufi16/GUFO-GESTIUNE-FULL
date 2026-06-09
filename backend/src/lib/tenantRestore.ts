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
    key: "catalog",
    label: "Produse si retete",
    description: "Produse, coduri de bare, retete si mapari marketplace.",
    payloadKeys: ["products", "productBarcodes", "recipes", "marketplaceMappings"],
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
    key: "files",
    label: "Fisiere si atasamente",
    description: "Fisiere din uploads si alte atasamente salvate in arhiva.",
    payloadKeys: [],
  },
] as const

export type TenantBackupModuleKey = (typeof TENANT_BACKUP_MODULE_DEFINITIONS)[number]["key"]
type TenantBackupModuleDefinition = (typeof TENANT_BACKUP_MODULE_DEFINITIONS)[number]
type RestoreMode = "merge" | "sync_missing"

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
  const saleDrafts = asArray<RestorableRecord>((payload as RestorableRecord).saleDrafts).map((item) => normalizeRecord(item))
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

  const saleDrafts = asArray<RestorableRecord>(payload.saleDrafts).map((item) => normalizeRecord(item))

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

async function syncCompanyModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.company, data.companies)
  await createManySkipDuplicatesIfAny(prisma.location, data.locations)
  await createManySkipDuplicatesIfAny(prisma.terminal, data.terminals)
  await createManySkipDuplicatesIfAny(prisma.vatRate, data.vatRates)
  await createManySkipDuplicatesIfAny(prisma.uom, data.uoms)
  await createManySkipDuplicatesIfAny(prisma.department, data.departments)
  await createManySkipDuplicatesIfAny(prisma.category, data.categories)
  await createManySkipDuplicatesIfAny(prisma.accountingStockType, data.accountingStockTypes)
  await createManySkipDuplicatesIfAny(prisma.accountingExportConfig, data.accountingExportConfigs)
  await createManySkipDuplicatesIfAny(prisma.tenantModule, data.tenantModules)
  await createManySkipDuplicatesIfAny(prisma.externalIntegration, data.externalIntegrations)

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
  await createManySkipDuplicatesIfAny(prisma.user, data.users)
  await createManySkipDuplicatesIfAny(prisma.userCompanyAccess, data.userCompanyAccesses)
  return {
    users: data.users.length,
    userCompanyAccesses: data.userCompanyAccesses.length,
  }
}

async function restoreCustomersModule(data: SelectiveRestoreData) {
  for (const item of data.customers) {
    await prisma.customer.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { customers: data.customers.length }
}

async function syncCustomersModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.customer, data.customers)
  return { customers: data.customers.length }
}

async function restoreSuppliersModule(data: SelectiveRestoreData) {
  for (const item of data.suppliers) {
    await prisma.supplier.upsert({ where: { id: String(item.id) }, update: item as never, create: item as never })
  }
  return { suppliers: data.suppliers.length }
}

async function syncSuppliersModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.supplier, data.suppliers)
  return { suppliers: data.suppliers.length }
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
  await createManySkipDuplicatesIfAny(prisma.product, data.products)
  await createManySkipDuplicatesIfAny(prisma.productBarcode, data.productBarcodes)
  await createManySkipDuplicatesIfAny(prisma.recipe, data.recipes)
  await createManySkipDuplicatesIfAny(prisma.recipeItem, data.recipeItems)
  await createManySkipDuplicatesIfAny(prisma.marketplaceProductMapping, data.marketplaceMappings)
  return {
    products: data.products.length,
    productBarcodes: data.productBarcodes.length,
    recipes: data.recipes.length,
    recipeItems: data.recipeItems.length,
    marketplaceMappings: data.marketplaceMappings.length,
  }
}

async function restoreDocumentsModule(data: SelectiveRestoreData) {
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoice, data.incomingEInvoices)
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoiceItem, data.incomingEInvoiceItems)
  await createManySkipDuplicatesIfAny(prisma.purchaseReceipt, data.purchaseReceipts)
  await createManySkipDuplicatesIfAny(prisma.purchaseReceiptItem, data.purchaseReceiptItems)
  await createManySkipDuplicatesIfAny(prisma.transferDoc, data.transferDocs)
  await createManySkipDuplicatesIfAny(prisma.transferDocItem, data.transferDocItems)
  await createManySkipDuplicatesIfAny(prisma.inventoryDoc, data.inventoryDocs)
  await createManySkipDuplicatesIfAny(prisma.inventoryDocItem, data.inventoryDocItems)
  await createManySkipDuplicatesIfAny(prisma.minutesDoc, data.minutesDocs)
  await createManySkipDuplicatesIfAny(prisma.minutesDocItem, data.minutesDocItems)
  await createManySkipDuplicatesIfAny(prisma.productionDoc, data.productionDocs)
  await createManySkipDuplicatesIfAny(prisma.productionDocItem, data.productionDocItems)
  await createManySkipDuplicatesIfAny(prisma.sale, data.sales)
  await createManySkipDuplicatesIfAny(prisma.saleItem, data.saleItems)
  await createManySkipDuplicatesIfAny(prisma.consumptionDoc, data.consumptionDocs)
  await createManySkipDuplicatesIfAny(prisma.consumptionDocItem, data.consumptionDocItems)
  await createManySkipDuplicatesIfAny(prisma.externalOrder, data.externalOrders)
  await createManySkipDuplicatesIfAny(prisma.externalOrderItem, data.externalOrderItems)
  await createManySkipDuplicatesIfAny(prisma.externalOrderStatusHistory, data.externalOrderStatusHistory)
  await createManySkipDuplicatesIfAny(prisma.saleDraft, data.saleDrafts)
  await createManySkipDuplicatesIfAny(prisma.kitchenTicket, data.kitchenTickets)
  await createManySkipDuplicatesIfAny(prisma.kitchenTicketItem, data.kitchenTicketItems)
  await createManySkipDuplicatesIfAny(prisma.salesInvoice, data.salesInvoices)
  await createManySkipDuplicatesIfAny(prisma.salesInvoiceItem, data.salesInvoiceItems)
  await createManySkipDuplicatesIfAny(prisma.eFacturaLog, data.efacturaLogs)
  await createManySkipDuplicatesIfAny(prisma.stockBalance, data.stockBalances)
  await createManySkipDuplicatesIfAny(prisma.stockMove, data.stockMoves)

  return {
    incomingEInvoices: data.incomingEInvoices.length,
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
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoice, data.incomingEInvoices)
  await createManySkipDuplicatesIfAny(prisma.incomingEInvoiceItem, data.incomingEInvoiceItems)
  await createManySkipDuplicatesIfAny(prisma.purchaseReceipt, data.purchaseReceipts)
  await createManySkipDuplicatesIfAny(prisma.purchaseReceiptItem, data.purchaseReceiptItems)
  await createManySkipDuplicatesIfAny(prisma.transferDoc, data.transferDocs)
  await createManySkipDuplicatesIfAny(prisma.transferDocItem, data.transferDocItems)
  await createManySkipDuplicatesIfAny(prisma.inventoryDoc, data.inventoryDocs)
  await createManySkipDuplicatesIfAny(prisma.inventoryDocItem, data.inventoryDocItems)
  await createManySkipDuplicatesIfAny(prisma.minutesDoc, data.minutesDocs)
  await createManySkipDuplicatesIfAny(prisma.minutesDocItem, data.minutesDocItems)
  await createManySkipDuplicatesIfAny(prisma.productionDoc, data.productionDocs)
  await createManySkipDuplicatesIfAny(prisma.productionDocItem, data.productionDocItems)
  await createManySkipDuplicatesIfAny(prisma.sale, data.sales)
  await createManySkipDuplicatesIfAny(prisma.saleItem, data.saleItems)
  await createManySkipDuplicatesIfAny(prisma.consumptionDoc, data.consumptionDocs)
  await createManySkipDuplicatesIfAny(prisma.consumptionDocItem, data.consumptionDocItems)
  await createManySkipDuplicatesIfAny(prisma.externalOrder, data.externalOrders)
  await createManySkipDuplicatesIfAny(prisma.externalOrderItem, data.externalOrderItems)
  await createManySkipDuplicatesIfAny(prisma.externalOrderStatusHistory, data.externalOrderStatusHistory)
  await createManySkipDuplicatesIfAny(prisma.saleDraft, data.saleDrafts)
  await createManySkipDuplicatesIfAny(prisma.kitchenTicket, data.kitchenTickets)
  await createManySkipDuplicatesIfAny(prisma.kitchenTicketItem, data.kitchenTicketItems)
  await createManySkipDuplicatesIfAny(prisma.salesInvoice, data.salesInvoices)
  await createManySkipDuplicatesIfAny(prisma.salesInvoiceItem, data.salesInvoiceItems)
  await createManySkipDuplicatesIfAny(prisma.eFacturaLog, data.efacturaLogs)
  await createManySkipDuplicatesIfAny(prisma.stockBalance, data.stockBalances)
  await createManySkipDuplicatesIfAny(prisma.stockMove, data.stockMoves)

  return {
    incomingEInvoices: data.incomingEInvoices.length,
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
      asArray<string>(moduleKeys).filter((item): item is TenantBackupModuleKey =>
        TENANT_BACKUP_MODULE_DEFINITIONS.some((definition) => definition.key === item),
      ),
    ),
  )

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
    if (key === "catalog") {
      result.catalog = mode === "sync_missing" ? await syncCatalogModule(data) : await restoreCatalogModule(data)
      continue
    }
    if (key === "documents") {
      result.documents = mode === "sync_missing" ? await syncDocumentsModule(data) : await restoreDocumentsModule(data)
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
