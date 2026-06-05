import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"
import { prisma } from "./prisma"
import { ensureUploadsRoot } from "./uploads"

type RestorableRecord = Record<string, unknown>
type RestorableModel = {
  createMany(...args: unknown[]): Promise<unknown>
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
  await prisma.externalOrderStatusHistory.deleteMany({ where: { tenantId } })
  await prisma.externalOrderItem.deleteMany({ where: { externalOrder: { tenantId } } })
  await prisma.productBarcode.deleteMany({ where: { tenantId } })
  await prisma.marketplaceProductMapping.deleteMany({ where: { tenantId } })
  await prisma.stockMove.deleteMany({ where: { tenantId } })
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
