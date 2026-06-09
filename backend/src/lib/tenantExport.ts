import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"
import { prisma } from "./prisma"
import { getEfacturaCertPath } from "./efacturaCertificate"
import { getUploadsRoot } from "./uploads"

const uploadsDir = getUploadsRoot()
const backupsDir = path.join(uploadsDir, "tenant-backups")

type JsonLike = Record<string, unknown> | unknown[] | string | number | boolean | null
type TenantBackupPayload = Record<string, unknown>
type TenantExportManifest = {
  uploadsIncluded: string[]
  generatedXmlIncluded: string[]
}

function sanitizeSegment(value: string) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function safeJson(value: JsonLike | Record<string, unknown>) {
  return JSON.stringify(
    value,
    (_key, current) => {
      if (typeof current === "bigint") return current.toString()
      if (current instanceof Date) return current.toISOString()
      if (current && typeof current === "object" && typeof current.toJSON === "function") {
        return current.toJSON()
      }
      return current
    },
    2,
  )
}

function normalizeUploadRelativePath(value?: string | null) {
  const text = String(value || "").trim()
  if (!text) return null

  if (text.startsWith("/uploads/")) {
    return text.replace(/^\/+/, "")
  }

  const uploadsIndex = text.indexOf("/uploads/")
  if (uploadsIndex >= 0) {
    return text.slice(uploadsIndex + 1)
  }

  return null
}

function addFileIfExists(zip: InstanceType<typeof AdmZip>, absolutePath: string, zipPath: string) {
  if (!fs.existsSync(absolutePath)) return false
  const stat = fs.statSync(absolutePath)
  if (!stat.isFile()) return false
  zip.addLocalFile(absolutePath, path.posix.dirname(zipPath), path.posix.basename(zipPath))
  return true
}

function collectFilesRecursively(rootDir: string, currentDir = rootDir) {
  const files: string[] = []
  if (!fs.existsSync(currentDir)) return files

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name)
    const relativeToRoot = path.relative(rootDir, absolutePath).replace(/\\/g, "/")

    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(rootDir, absolutePath))
      continue
    }

    if (entry.isFile()) {
      files.push(relativeToRoot)
    }
  }

  return files
}

function addUploadRelativePathIfExists(target: Set<string>, relativePath?: string | null) {
  const normalized = String(relativePath || "").trim().replace(/^\/+/, "").replace(/\\/g, "/")
  if (!normalized) return
  if (normalized === "tenant-backups" || normalized.startsWith("tenant-backups/")) return
  const absolutePath = path.join(uploadsDir, normalized.replace(/^uploads\//, ""))
  if (!fs.existsSync(absolutePath)) return
  if (!fs.statSync(absolutePath).isFile()) return
  target.add(`uploads/${normalized.replace(/^uploads\//, "")}`)
}

function addUploadSubdirRecursively(target: Set<string>, uploadSubdir: string) {
  const normalizedSubdir = String(uploadSubdir || "").trim().replace(/^\/+/, "").replace(/\\/g, "/")
  if (!normalizedSubdir) return
  const absoluteDir = path.join(uploadsDir, normalizedSubdir)
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) return
  for (const relative of collectFilesRecursively(absoluteDir)) {
    target.add(path.posix.join("uploads", normalizedSubdir, relative))
  }
}

export async function buildTenantExportZip(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      companies: true,
      anafCredentials: true,
      users: {
        include: {
          companyAccesses: true,
        },
      },
      licenses: true,
      locations: true,
      terminals: true,
      vatRates: true,
      uoms: true,
      departments: true,
      categories: true,
      products: true,
      suppliers: true,
      customers: true,
      stockBalances: true,
      stockLots: true,
      stockMoves: true,
      purchaseReceipts: {
        include: {
          items: true,
        },
      },
      transferDocs: {
        include: {
          items: true,
        },
      },
      consumptionDocs: {
        include: {
          items: true,
        },
      },
      productionDocs: {
        include: {
          items: true,
        },
      },
      inventoryDocs: {
        include: {
          items: true,
        },
      },
      minutesDocs: {
        include: {
          items: true,
        },
      },
      salesInvoices: {
        include: {
          items: true,
          efacturaLogs: true,
        },
      },
      incomingEInvoices: {
        include: {
          items: true,
        },
      },
      subscriptions: true,
      invoices: true,
      tenantModules: {
        include: {
          module: true,
        },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 5000,
      },
    },
  })

  if (!tenant) {
    throw new Error("Client inexistent")
  }

  const productBarcodes = await prisma.productBarcode.findMany({
    where: { tenantId },
  })

  const externalIntegrations = await prisma.externalIntegration.findMany({
    where: { tenantId },
  })

  const externalOrders = await prisma.externalOrder.findMany({
    where: { tenantId },
    include: {
      items: true,
      statusHistory: true,
    },
  })

  const kitchenTickets = await prisma.kitchenTicket.findMany({
    where: { tenantId },
    include: {
      items: true,
    },
  })

  const saleDrafts = await prisma.saleDraft.findMany({
    where: { tenantId },
  })

  const sales = await prisma.sale.findMany({
    where: { tenantId },
    include: {
      items: true,
    },
  })

  const recipes = await prisma.recipe.findMany({
    where: { tenantId },
    include: {
      items: true,
    },
  })

  const marketplaceMappings = await prisma.marketplaceProductMapping.findMany({
    where: { tenantId },
  })

  const accountingStockTypes = await prisma.accountingStockType.findMany({
    where: { tenantId },
  })

  const accountingExportConfigs = await prisma.accountingExportConfig.findMany({
    where: { tenantId },
  })

  const payload = {
    exportedAt: new Date().toISOString(),
    tenantId,
    tenantName: tenant.name,
    companies: tenant.companies,
    users: tenant.users,
    licenses: tenant.licenses,
    locations: tenant.locations,
    terminals: tenant.terminals,
    vatRates: tenant.vatRates,
    uoms: tenant.uoms,
    departments: tenant.departments,
    categories: tenant.categories,
    products: tenant.products,
    productBarcodes,
    suppliers: tenant.suppliers,
    customers: tenant.customers,
    stockBalances: tenant.stockBalances,
    stockLots: tenant.stockLots,
    stockMoves: tenant.stockMoves,
    purchaseReceipts: tenant.purchaseReceipts,
    transferDocs: tenant.transferDocs,
    consumptionDocs: tenant.consumptionDocs,
    productionDocs: tenant.productionDocs,
    inventoryDocs: tenant.inventoryDocs,
    minutesDocs: tenant.minutesDocs,
    salesInvoices: tenant.salesInvoices,
    incomingEInvoices: tenant.incomingEInvoices,
    subscriptions: tenant.subscriptions,
    invoices: tenant.invoices,
    tenantModules: tenant.tenantModules,
    accountingStockTypes,
    accountingExportConfigs,
    auditLogs: tenant.auditLogs,
    externalIntegrations,
    externalOrders,
    kitchenTickets,
    saleDrafts,
    sales,
    recipes,
    marketplaceMappings,
    anafCredentials: tenant.anafCredentials,
  }

  const zip = new AdmZip()
  zip.addFile("data/tenant.json", Buffer.from(safeJson(payload), "utf8"))

  const manifest: TenantExportManifest = {
    uploadsIncluded: [],
    generatedXmlIncluded: [],
  }

  const uploadPaths = new Set<string>()
  for (const category of tenant.categories || []) {
    const relative = normalizeUploadRelativePath(category?.imageUrl)
    addUploadRelativePathIfExists(uploadPaths, relative)
  }
  for (const product of tenant.products || []) {
    const relative = normalizeUploadRelativePath(product?.imageUrl)
    addUploadRelativePathIfExists(uploadPaths, relative)
  }
  for (const user of tenant.users || []) {
    const relative = normalizeUploadRelativePath(user?.imageUrl)
    addUploadRelativePathIfExists(uploadPaths, relative)
  }
  for (const company of tenant.companies || []) {
    if (!company?.efacturaCertFilename) continue
    const certAbsolute = getEfacturaCertPath(tenantId, company.id, company.efacturaCertFilename)
    const certRelative = path.relative(uploadsDir, certAbsolute).replace(/\\/g, "/")
    addUploadRelativePathIfExists(uploadPaths, certRelative)
  }
  for (const credential of tenant.anafCredentials || []) {
    if (!credential?.certFilename) continue
    const certAbsolute = getEfacturaCertPath(tenantId, credential.companyId, credential.certFilename, credential.id)
    const certRelative = path.relative(uploadsDir, certAbsolute).replace(/\\/g, "/")
    addUploadRelativePathIfExists(uploadPaths, certRelative)
  }
  addUploadSubdirRecursively(uploadPaths, path.posix.join("incoming-efactura-pdfs", tenantId))

  for (const relative of uploadPaths) {
    const absolute = path.join(uploadsDir, relative.replace(/^uploads\//, ""))
    const zipPath = path.posix.join("files", relative.replace(/^uploads\//, "uploads/"))
    if (addFileIfExists(zip, absolute, zipPath)) {
      manifest.uploadsIncluded.push(zipPath)
    }
  }

  for (const invoice of tenant.salesInvoices || []) {
    if (!invoice?.efacturaXmlText) continue
    const name = sanitizeSegment(invoice.docNo || invoice.id || "invoice")
    const zipPath = path.posix.join("files", "efactura-outgoing", `${name}.xml`)
    zip.addFile(zipPath, Buffer.from(String(invoice.efacturaXmlText), "utf8"))
    manifest.generatedXmlIncluded.push(zipPath)
  }

  for (const invoice of tenant.incomingEInvoices || []) {
    if (!invoice?.xmlText) continue
    const base =
      sanitizeSegment(invoice.invoiceNo || invoice.spvDownloadId || invoice.id || "incoming-invoice")
    const zipPath = path.posix.join("files", "efactura-incoming", `${base}.xml`)
    zip.addFile(zipPath, Buffer.from(String(invoice.xmlText), "utf8"))
    manifest.generatedXmlIncluded.push(zipPath)
  }

  zip.addFile("data/manifest.json", Buffer.from(safeJson(manifest), "utf8"))

  return {
    zip,
    filename: `tenant-export-${sanitizeSegment(tenant.name || tenantId) || tenantId}-${new Date()
      .toISOString()
      .slice(0, 10)}.zip`,
  }
}

export function ensureTenantBackupDir(tenantId: string) {
  const dir = path.join(backupsDir, sanitizeSegment(tenantId) || tenantId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function buildTenantBackupStats(payload: TenantBackupPayload | null | undefined) {
  const stats: Record<string, number> = {}
  if (!payload || typeof payload !== "object") return stats
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      stats[key] = value.length
    }
  }
  return stats
}
