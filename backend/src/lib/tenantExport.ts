// @ts-nocheck
import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"
import { prisma } from "./prisma"

const uploadsDir = path.join(process.cwd(), "uploads")
const backupsDir = path.join(uploadsDir, "tenant-backups")

function sanitizeSegment(value: string) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function safeJson(value: any) {
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
  if (!text || !text.startsWith("/uploads/")) return null
  return text.replace(/^\/+/, "")
}

function addFileIfExists(zip: AdmZip, absolutePath: string, zipPath: string) {
  if (!fs.existsSync(absolutePath)) return false
  const stat = fs.statSync(absolutePath)
  if (!stat.isFile()) return false
  zip.addLocalFile(absolutePath, path.posix.dirname(zipPath), path.posix.basename(zipPath))
  return true
}

export async function buildTenantExportZip(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      companies: true,
      users: true,
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
    auditLogs: tenant.auditLogs,
    externalIntegrations,
    externalOrders,
    kitchenTickets,
    saleDrafts,
    sales,
    recipes,
    marketplaceMappings,
  }

  const zip = new AdmZip()
  zip.addFile("data/tenant.json", Buffer.from(safeJson(payload), "utf8"))

  const manifest = {
    uploadsIncluded: [],
    generatedXmlIncluded: [],
  }

  const uploadPaths = new Set<string>()
  for (const category of tenant.categories || []) {
    const relative = normalizeUploadRelativePath(category?.imageUrl)
    if (relative) uploadPaths.add(relative)
  }
  for (const product of tenant.products || []) {
    const relative = normalizeUploadRelativePath(product?.imageUrl)
    if (relative) uploadPaths.add(relative)
  }

  for (const relative of uploadPaths) {
    const absolute = path.join(process.cwd(), relative)
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
      sanitizeSegment(invoice.invoiceNumber || invoice.spvDownloadId || invoice.id || "incoming-invoice")
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

export function buildTenantBackupStats(payload: any) {
  const stats: Record<string, number> = {}
  if (!payload || typeof payload !== "object") return stats
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      stats[key] = value.length
    }
  }
  return stats
}
