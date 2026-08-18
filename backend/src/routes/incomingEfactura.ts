import { execFile } from "child_process"
import fs from "fs"
import path from "path"
import { Prisma } from "@prisma/client"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { promisify } from "util"
import { prisma } from "../lib/prisma"
import { anafDownloadById, anafListMessages, loadAnafCompanyContext } from "../lib/anafClient"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { reserveNextNumber } from "../lib/numbering"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"
import {
  incomingEfacturaDateRo,
  incomingEfacturaMoney,
  incomingEfacturaMoneyRo,
  incomingEfacturaNumber,
  incomingEfacturaQtyRo,
  joinIncomingEfacturaAddressParts,
  normalizeIncomingEfacturaCurrency,
  safeIncomingEfacturaFilePart,
  toIncomingEfacturaDateOrNull,
} from "../lib/incomingEfacturaRouteSupport"
import { ensureUploadSubdir } from "../lib/uploads"
import {
  extractDownloadId,
  extractPdfFromAnafDownload,
  extractUploadIndex,
  extractXmlFromAnafDownload,
  getEfacturaBaseUrl,
  normalizeCompanyCui,
  parseIncomingEInvoiceXml,
  readStringField,
} from "../lib/incomingEfactura"

const router = Router()
const execFileAsync = promisify(execFile)

router.use(requireAuth)

const incomingEfacturaPdfDir = ensureUploadSubdir("incoming-efactura-pdfs")

type IncomingEfacturaMessage = Record<string, unknown>
type ParsedIncomingInvoice = ReturnType<typeof parseIncomingEInvoiceXml>
type ParsedIncomingInvoiceLine = ParsedIncomingInvoice["lines"][number]
type ParsedIncomingInvoiceTax = ParsedIncomingInvoice["taxBreakdown"][number]
type CurrencyLike = "RON" | "EUR" | "USD" | "HUF"
type IncomingInvoiceItemLike = {
  lineIndex?: unknown
  productName?: string | null
  productCode?: string | null
  externalCode?: string | null
  barcode?: string | null
  uomCode?: string | null
  uomRawCode?: string | null
  description?: string | null
  qty?: unknown
  unitPrice?: unknown
  vatRate?: unknown
  lineNet?: unknown
  lineVat?: unknown
  lineGross?: unknown
}
type IncomingInvoiceEntryLike = {
  id: string
  tenantId: string
  companyId?: string | null
  supplierName?: string | null
  supplierCif?: string | null
  customerName?: string | null
  customerCif?: string | null
  invoiceNo?: string | null
  invoiceDate?: unknown
  currency?: string | null
  totalNet?: unknown
  totalVat?: unknown
  totalGross?: unknown
  spvDownloadId?: string | null
  spvUploadIndex?: string | null
  spvMessageId?: string | null
  spvCommunicationDate?: unknown
  syncedAt?: unknown
  xmlText?: string | null
  rawPayload?: unknown
  items?: IncomingInvoiceItemLike[] | null
}
type PdfTaxBreakdownEntry = {
  categoryId: string
  taxableAmount: unknown
  taxAmount: unknown
  taxCode: string
  exemptionReason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function registerFonts(doc: PDFKit.PDFDocument) {
  const regularCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ]

  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ]

  const regularPath = regularCandidates.find((path) => fs.existsSync(path))
  const boldPath = boldCandidates.find((path) => fs.existsSync(path))

  if (regularPath) doc.registerFont("IncomingEfacturaRegular", regularPath)
  if (boldPath) doc.registerFont("IncomingEfacturaBold", boldPath)

  return {
    regular: regularPath ? "IncomingEfacturaRegular" : "Helvetica",
    bold: boldPath ? "IncomingEfacturaBold" : "Helvetica-Bold",
  }
}

function fmtMoney(value: unknown) {
  return incomingEfacturaMoney(value)
}

function fmtMoneyRo(value: unknown) {
  return incomingEfacturaMoneyRo(value)
}

function fmtQtyRo(value: unknown) {
  return incomingEfacturaQtyRo(value)
}

function fmtDateRo(value: unknown) {
  return incomingEfacturaDateRo(value)
}

function joinAddressParts(address: Parameters<typeof joinIncomingEfacturaAddressParts>[0]) {
  return joinIncomingEfacturaAddressParts(address)
}

function getIncomingInvoicePdfPath(tenantId: string, invoiceId: string) {
  const tenantDir = path.join(incomingEfacturaPdfDir, tenantId)
  fs.mkdirSync(tenantDir, { recursive: true })
  return path.join(tenantDir, `${invoiceId}.pdf`)
}

function safeFilePart(value: string) {
  return safeIncomingEfacturaFilePart(value)
}

function toDateOrNull(value: unknown) {
  return toIncomingEfacturaDateOrNull(value)
}

function toNumber(value: unknown) {
  return incomingEfacturaNumber(value)
}

function normalizeCurrency(value: unknown): CurrencyLike {
  return normalizeIncomingEfacturaCurrency(value)
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function matchSupplier(tenantId: string, companyId: string, supplierCif: string, supplierName: string) {
  if (supplierCif) {
    const byCif = await prisma.supplier.findFirst({
      where: {
        tenantId,
        companyId,
        cif: {
          contains: supplierCif,
          mode: "insensitive",
        },
      },
      select: { id: true, code: true, name: true },
    })
    if (byCif) return byCif
  }

  if (supplierName) {
    const byName = await prisma.supplier.findFirst({
      where: {
        tenantId,
        companyId,
        name: {
          equals: supplierName,
          mode: "insensitive",
        },
      },
      select: { id: true, code: true, name: true },
    })
    if (byName) return byName
  }

  return null
}

async function matchProduct(tenantId: string, companyId: string, line: IncomingInvoiceItemLike | ParsedIncomingInvoiceLine) {
  const skuCandidates = [line.externalCode, line.productCode, line.barcode]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  for (const candidate of skuCandidates) {
    const bySku = await prisma.product.findFirst({
      where: { tenantId, companyId, sku: candidate },
      select: {
        id: true,
        name: true,
        sku: true,
        purchaseFactor: true,
        costPrice: true,
        purchaseUom: { select: { id: true, code: true } },
        uom: { select: { id: true, code: true } },
        vatRate: { select: { rate: true } },
      },
    })
    if (bySku) return bySku
  }

  if (line.productName) {
    const byName = await prisma.product.findFirst({
      where: {
        tenantId,
        companyId,
        name: {
          equals: String(line.productName).trim(),
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        purchaseFactor: true,
        costPrice: true,
        purchaseUom: { select: { id: true, code: true } },
        uom: { select: { id: true, code: true } },
        vatRate: { select: { rate: true } },
      },
    })
    if (byName) return byName
  }

  return null
}

async function upsertIncomingInvoice(
  tenantId: string,
  companyId: string,
  rawMessage: IncomingEfacturaMessage,
  xmlText: string,
  parsedInvoice: ParsedIncomingInvoice
) {
  const supplier = await matchSupplier(
    tenantId,
    companyId,
    parsedInvoice.supplierCif || "",
    parsedInvoice.supplierName || ""
  )

  const downloadId =
    extractDownloadId(rawMessage, JSON.stringify(rawMessage || {})) ||
    readStringField(rawMessage, ["downloadId", "id"])

  const uploadIndex =
    extractUploadIndex(rawMessage, JSON.stringify(rawMessage || {})) ||
    readStringField(rawMessage, ["uploadIndex", "index_incarcare"])

  if (!downloadId) {
    throw new Error("Factura primita nu are ID de descarcare.")
  }

  const baseRecord = await prisma.incomingEInvoice.upsert({
    where: {
      tenantId_companyId_spvDownloadId: {
        tenantId,
        companyId,
        spvDownloadId: downloadId,
      },
    },
    update: {
      companyId,
      supplierId: supplier?.id || null,
      supplierName: parsedInvoice.supplierName || null,
      supplierCode: supplier?.code || null,
      supplierCif: parsedInvoice.supplierCif || null,
      customerName: parsedInvoice.customerName || null,
      customerCif: parsedInvoice.customerCif || null,
      invoiceNo: parsedInvoice.invoiceNo || null,
      invoiceDate: toDateOrNull(parsedInvoice.invoiceDate),
      currency: normalizeCurrency(parsedInvoice.currency),
      totalNet: toNumber(parsedInvoice.totalNet),
      totalVat: toNumber(parsedInvoice.totalVat),
      totalGross: toNumber(parsedInvoice.totalGross),
      spvUploadIndex: uploadIndex || null,
      spvMessageId: readStringField(rawMessage, ["id", "messageId", "mesajId"]) || null,
      spvCommunicationDate: toDateOrNull(
        readStringField(rawMessage, ["data_creare", "date", "createdAt", "communicationDate"])
      ),
      xmlText,
      rawPayload: rawMessage as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
    create: {
      tenantId,
      companyId,
      supplierId: supplier?.id || null,
      supplierName: parsedInvoice.supplierName || null,
      supplierCode: supplier?.code || null,
      supplierCif: parsedInvoice.supplierCif || null,
      customerName: parsedInvoice.customerName || null,
      customerCif: parsedInvoice.customerCif || null,
      invoiceNo: parsedInvoice.invoiceNo || null,
      invoiceDate: toDateOrNull(parsedInvoice.invoiceDate),
      currency: normalizeCurrency(parsedInvoice.currency),
      totalNet: toNumber(parsedInvoice.totalNet),
      totalVat: toNumber(parsedInvoice.totalVat),
      totalGross: toNumber(parsedInvoice.totalGross),
      spvDownloadId: downloadId,
      spvUploadIndex: uploadIndex || null,
      spvMessageId: readStringField(rawMessage, ["id", "messageId", "mesajId"]) || null,
      spvCommunicationDate: toDateOrNull(
        readStringField(rawMessage, ["data_creare", "date", "createdAt", "communicationDate"])
      ),
      xmlText,
      rawPayload: rawMessage as Prisma.InputJsonValue,
      status: "SYNCED",
    },
  })

  await prisma.incomingEInvoiceItem.deleteMany({
    where: { invoiceId: baseRecord.id },
  })

  for (const line of parsedInvoice.lines || []) {
    const matchedProduct = await matchProduct(tenantId, companyId, line)
    await prisma.incomingEInvoiceItem.create({
      data: {
        invoiceId: baseRecord.id,
        matchedProductId: matchedProduct?.id || null,
        lineIndex: Number(line.lineIndex || 0),
        productName: String(line.productName || "").trim() || "Produs",
        productCode: line.productCode ? String(line.productCode).trim() : null,
        externalCode: line.externalCode ? String(line.externalCode).trim() : null,
        barcode: line.barcode ? String(line.barcode).trim() : null,
        uomCode: line.uomCode ? String(line.uomCode).trim() : null,
        qty: toNumber(line.qty),
        unitPrice: toNumber(line.unitPrice),
        vatRate: toNumber(line.vatRate),
        lineNet: toNumber(line.lineNet),
        lineVat: toNumber(line.lineVat),
        lineGross: toNumber(line.lineGross),
      },
    })
  }

  return prisma.incomingEInvoice.findUnique({
    where: { id: baseRecord.id },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: {
            include: {
              purchaseUom: true,
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { lineIndex: "asc" },
      },
    },
  })
}

function isMalformedIncomingInvoice(entry: IncomingInvoiceEntryLike | null | undefined) {
  const itemsCount = Array.isArray(entry?.items) ? entry.items.length : 0
  const totalGross = Number(entry?.totalGross)
  const totalNet = Number(entry?.totalNet)
  const totalVat = Number(entry?.totalVat)
  const hasBrokenItemNumbers = Array.isArray(entry?.items)
    ? entry.items.some(
        (line) =>
          !Number.isFinite(Number(line?.qty)) ||
          !Number.isFinite(Number(line?.unitPrice)) ||
          !Number.isFinite(Number(line?.vatRate)) ||
          !Number.isFinite(Number(line?.lineNet)) ||
          !Number.isFinite(Number(line?.lineVat)) ||
          !Number.isFinite(Number(line?.lineGross))
      )
    : false
  return (
    !String(entry?.invoiceNo || "").trim() ||
    !String(entry?.supplierName || "").trim() ||
    !Number.isFinite(totalGross) ||
    !Number.isFinite(totalNet) ||
    !Number.isFinite(totalVat) ||
    totalGross <= 0 ||
    itemsCount === 0 ||
    hasBrokenItemNumbers
  )
}

function serializeIncomingInvoice(entry: IncomingInvoiceEntryLike | null | undefined) {
  if (!entry) return null
  const itemLines = Array.isArray(entry.items) ? entry.items : []
  const computedNet = itemLines.reduce((sum, line) => sum + toNumber(line?.lineNet), 0)
  const computedVat = itemLines.reduce((sum, line) => sum + toNumber(line?.lineVat), 0)
  const computedGross = itemLines.reduce((sum, line) => sum + toNumber(line?.lineGross), 0)
  let parsedTotals: { totalNet?: number; totalVat?: number; totalGross?: number } | null = null
  if (String(entry.xmlText || "").trim()) {
    try {
      const parsed = parseIncomingEInvoiceXml(String(entry.xmlText))
      parsedTotals = {
        totalNet: toNumber(parsed.totalNet),
        totalVat: toNumber(parsed.totalVat),
        totalGross: toNumber(parsed.totalGross),
      }
    } catch {
      parsedTotals = null
    }
  }
  const totalNet = toNumber(entry.totalNet)
  const totalVat = toNumber(entry.totalVat)
  const totalGross = toNumber(entry.totalGross)
  return {
    ...entry,
    totalNet: totalNet > 0 ? totalNet : (parsedTotals?.totalNet || computedNet),
    totalVat: totalVat > 0 ? totalVat : (parsedTotals?.totalVat || computedVat),
    totalGross: totalGross > 0 ? totalGross : (parsedTotals?.totalGross || computedGross),
    items: itemLines
      ? itemLines.map((line) => ({
          ...line,
          qty: toNumber(line?.qty),
          unitPrice: toNumber(line?.unitPrice),
          vatRate: toNumber(line?.vatRate),
          lineNet: toNumber(line?.lineNet),
          lineVat: toNumber(line?.lineVat),
          lineGross: toNumber(line?.lineGross),
        }))
      : [],
  }
}

function isInvoiceEfacturaMessage(entry: IncomingEfacturaMessage) {
  const tip = String(entry?.tip || "").trim().toUpperCase()
  const raw = JSON.stringify(entry || {}).toLowerCase()
  const downloadId = String(
    extractDownloadId(entry, JSON.stringify(entry || {})) || readStringField(entry, ["id", "downloadId"])
  ).trim()
  if (tip.includes("RECIPISA")) return false
  return Boolean(downloadId) && (tip.includes("FACTURA") || raw.includes("id_descarcare") || raw.includes("download"))
}

function normalizedCui(value: unknown) {
  return normalizeCompanyCui(String(value || ""))
}

function getRequestedCredentialId(req: AuthedRequest) {
  const bodyValue = String(req.body?.credentialId || "").trim()
  if (bodyValue) return bodyValue
  const queryValue = String(req.query?.credentialId || "").trim()
  if (queryValue) return queryValue
  return null
}

function invoiceBelongsToIncomingSide(
  entry: Pick<IncomingInvoiceEntryLike, "supplierCif" | "customerCif">,
  companyCui: string
) {
  const supplierCif = normalizedCui(entry?.supplierCif)
  const customerCif = normalizedCui(entry?.customerCif)
  if (!companyCui) return true
  if (customerCif && customerCif === companyCui) return true
  if (supplierCif && supplierCif === companyCui) return false
  return true
}

function invoiceBelongsToOutgoingSide(
  entry: Pick<IncomingInvoiceEntryLike, "supplierCif">,
  companyCui: string
) {
  const supplierCif = normalizedCui(entry?.supplierCif)
  if (!companyCui) return false
  return Boolean(supplierCif && supplierCif === companyCui)
}

async function loadCompanyCui(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { tenantId, id: companyId },
    select: { cui: true },
  })
  return normalizedCui(company?.cui)
}

function serializeOutgoingInvoice(entry: IncomingInvoiceEntryLike) {
  const serialized = serializeIncomingInvoice(entry)
  if (!serialized) return null
  return {
    id: serialized.id,
    invoiceNo: serialized.invoiceNo,
    invoiceDate: serialized.invoiceDate,
    spvCommunicationDate: serialized.spvCommunicationDate,
    customerName: serialized.customerName,
    customerCif: serialized.customerCif,
    supplierName: serialized.supplierName,
    supplierCif: serialized.supplierCif,
    currency: serialized.currency,
    totalNet: serialized.totalNet,
    totalVat: serialized.totalVat,
    totalGross: serialized.totalGross,
    spvDownloadId: serialized.spvDownloadId,
    spvUploadIndex: serialized.spvUploadIndex,
    spvMessageId: serialized.spvMessageId,
    syncedAt: serialized.syncedAt,
  }
}

function mapIncomingSyncError(error: unknown, _company?: {
  efacturaCertFilename?: string | null
  efacturaCertPasswordEnc?: string | null
}) {
  const raw = isRecord(error) ? String(error.message || "").trim() : ""

  if (/handshake failure|sslv3 alert handshake failure|EPROTO|tls/i.test(raw)) {
    return "Conexiunea TLS cu ANAF a fost respinsa. Verifica daca backend-ul foloseste endpointul OAuth nou ANAF si reincearca sincronizarea."
  }

  if (/Command failed:\s*curl/i.test(raw)) {
    return "ANAF a respins cererea de sincronizare. Verifica tokenul ANAF si endpointul folosit pentru SPV."
  }

  return raw || "Nu am putut sincroniza facturile primite direct din ANAF."
}

async function repairIncomingInvoiceIfNeeded(tenantId: string, companyId: string, entry: IncomingInvoiceEntryLike) {
  if (!entry?.xmlText || !isMalformedIncomingInvoice(entry)) return entry
  try {
    const parsedInvoice = parseIncomingEInvoiceXml(String(entry.xmlText))
    const rawPayload = isRecord(entry.rawPayload) ? entry.rawPayload : null
    const repaired = await upsertIncomingInvoice(
      tenantId,
      companyId,
      rawPayload ?? {
        id: entry.spvMessageId || entry.spvDownloadId,
        downloadId: entry.spvDownloadId,
        uploadIndex: entry.spvUploadIndex,
        data_creare: entry.spvCommunicationDate,
      },
      String(entry.xmlText),
      parsedInvoice
    )
    if (repaired) {
      await ensureIncomingInvoicePdfSaved(repaired)
    }
    return repaired || entry
  } catch {
    return entry
  }
}

async function generateIncomingInvoicePdfBuffer(item: IncomingInvoiceEntryLike) {
  const parsed = item?.xmlText ? parseIncomingEInvoiceXml(String(item.xmlText)) : null
  const currency = parsed?.currency || item.currency || "RON"
  const lines = Array.isArray(parsed?.lines) && parsed.lines.length ? parsed.lines : item.items || []
  const supplierName = parsed?.supplierName || item.supplierName || "-"
  const supplierCif = parsed?.supplierCif || item.supplierCif || "-"
  const customerName = parsed?.customerName || "-"
  const customerCif = parsed?.customerCif || "-"
  const taxBreakdown: PdfTaxBreakdownEntry[] =
    Array.isArray(parsed?.taxBreakdown) && parsed.taxBreakdown.length
      ? parsed.taxBreakdown
      : [{ categoryId: "-", taxableAmount: item.totalNet || 0, taxAmount: item.totalVat || 0, taxCode: "VAT", exemptionReason: "" }]

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 24,
    bufferPages: true,
    autoFirstPage: true,
  })
  const fonts = registerFonts(doc)
  const chunks: Buffer[] = []

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const startX = doc.page.margins.left
  const pageRight = startX + pageWidth
  const topY = doc.page.margins.top
  const footerY = doc.page.height - 30
  const pageBottom = footerY - 14

  function money(value: unknown, includeCurrency = false) {
    const amount = fmtMoneyRo(value)
    return includeCurrency ? `${amount} ${currency}` : amount
  }

  function writePair(label: string, value: string, x: number, y: number, labelWidth: number, valueWidth: number) {
    doc.font(fonts.bold).fontSize(8).fillColor("#111111").text(label, x, y, { width: labelWidth })
    doc.font(fonts.regular).fontSize(8).fillColor("#111111").text(value || "-", x + labelWidth + 4, y, { width: valueWidth })
  }

  function drawLine(y: number, x1 = startX, x2 = pageRight, width = 0.9, color = "#222222") {
    doc.save()
    doc.lineWidth(width).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke()
    doc.restore()
  }

  function ensureSpace(requiredHeight: number) {
    if (doc.y + requiredHeight <= pageBottom) return
    doc.addPage()
    doc.font(fonts.regular).fontSize(8).fillColor("#111111")
  }

  function drawPartyBlock(title: string, rows: Array<[string, string]>, x: number, y: number, width: number) {
    doc.font(fonts.bold).fontSize(10).text(title, x, y, { width })
    let cursorY = y + 14
    rows.forEach(([label, value]) => {
      writePair(label, value || "-", x, cursorY, 76, width - 80)
      cursorY += 12
    })
    return cursorY
  }

  const leftWidth = 245
  const rightWidth = 245
  const centerWidth = pageWidth - leftWidth - rightWidth
  const centerX = startX + leftWidth
  const rightX = centerX + centerWidth

  const supplierBottom = drawPartyBlock(
    "VANZATOR",
    [
      ["Nume", supplierName],
      ["Nr. inregistrare", parsed?.supplierIdentifier || "-"],
      ["Informatii juridice", parsed?.supplierIdentifier || "-"],
      ["Identificatorul TVA", supplierCif ? `RO${supplierCif}` : "-"],
      ["Strada", [parsed?.supplierAddress?.street, parsed?.supplierAddress?.additionalStreet].filter(Boolean).join(", ") || "-"],
      ["Oras", parsed?.supplierAddress?.city || "-"],
      ["Cod", parsed?.supplierAddress?.postalCode || "-"],
      ["Regiune", parsed?.supplierAddress?.region || "-"],
      ["Tara", parsed?.supplierAddress?.country || "-"],
    ],
    startX,
    topY + 2,
    leftWidth - 8
  )

  const customerBottom = drawPartyBlock(
    "CUMPARATOR",
    [
      ["Nume", customerName],
      ["Nr. inregistrare", parsed?.customerIdentifier || "-"],
      ["Identificator", customerCif ? `RO${customerCif}` : "-"],
      ["Strada", [parsed?.customerAddress?.street, parsed?.customerAddress?.additionalStreet].filter(Boolean).join(", ") || "-"],
      ["Oras", parsed?.customerAddress?.city || "-"],
      ["Cod", parsed?.customerAddress?.postalCode || "-"],
      ["Regiune", parsed?.customerAddress?.region || "-"],
      ["Tara", parsed?.customerAddress?.country || "-"],
      ["E-mail", parsed?.customerContact?.email || "-"],
    ],
    rightX,
    topY + 2,
    rightWidth - 8
  )

  doc.font(fonts.bold).fontSize(22).text("RO eFactura", centerX, topY + 18, {
    width: centerWidth,
    align: "center",
  })

  const metaX = centerX + 12
  const metaY = topY + 52
  ;[
    ["Nr. factura", parsed?.invoiceNo || item.invoiceNo || "-"],
    ["Codul tipului", parsed?.invoiceTypeCode || "-"],
    ["Data emiterii", fmtDateRo(parsed?.invoiceDate || item.invoiceDate)],
    ["Data scadenta", fmtDateRo(parsed?.dueDate)],
    ["Moneda facturii", currency],
  ].forEach(([label, value], index) => {
    writePair(String(label), String(value || "-"), metaX, metaY + index * 14, 82, centerWidth - 98)
  })

  doc.y = Math.max(supplierBottom, customerBottom) + 20
  ensureSpace(120)

  const totalColumns = [
    { label: "TOTAL NET", width: 126, value: money(parsed?.totalNet || item.totalNet || 0) },
    { label: "VALOARE TOTALA fara TVA", width: 132, value: money(parsed?.taxExclusiveAmount || parsed?.totalNet || item.totalNet || 0) },
    { label: "VALOARE TOTALA cu TVA", width: 132, value: money(parsed?.taxInclusiveAmount || parsed?.totalGross || item.totalGross || 0) },
    { label: "TOTAL DEDUCERI", width: 118, value: money(parsed?.prepaidAmount || 0) },
    { label: "TOTAL TAXE\nSUPLIMENTARE", width: 120, value: "0,00" },
    { label: "SUMA PLATITA", width: 120, value: money(parsed?.prepaidAmount || 0) },
    { label: "VALOARE DE\nROTUNJIRE", width: 110, value: money(parsed?.roundingAmount || 0) },
  ]
  let currentX = startX
  totalColumns.forEach((column) => {
    doc.font(fonts.bold).fontSize(8).text(column.label, currentX + 2, doc.y, {
      width: column.width - 4,
      align: "center",
    })
    currentX += column.width
  })
  drawLine(doc.y + 16)
  currentX = startX
  totalColumns.forEach((column) => {
    doc.font(fonts.regular).fontSize(9).text(column.value, currentX + 3, doc.y + 19, {
      width: column.width - 6,
    })
    currentX += column.width
  })
  drawLine(doc.y + 35)

  doc.y += 42
  doc.font(fonts.bold).fontSize(10).text("TOTAL PLATA", startX, doc.y)
  doc.font(fonts.bold).fontSize(10).text(money(parsed?.payableAmount || parsed?.totalGross || item.totalGross || 0), startX + 96, doc.y)
  drawLine(doc.y + 15, startX, startX + 260)

  doc.y += 24
  doc.font(fonts.bold).fontSize(10).text("TOTAL TVA", startX, doc.y)
  doc.font(fonts.regular).fontSize(10).text(money(parsed?.totalVat || item.totalVat || 0, true), startX + 84, doc.y)

  doc.y += 18
  doc.font(fonts.bold).fontSize(9).text("Detalierea TVA", startX, doc.y)
  const taxHeadY = doc.y + 14
  const taxCols = [
    { x: startX, width: 86, label: "Codul\ncategoriei" },
    { x: startX + 88, width: 86, label: "Baza de calcul" },
    { x: startX + 176, width: 78, label: "Valoare TVA" },
    { x: startX + 256, width: 56, label: "Codul" },
    { x: startX + 314, width: 72, label: "motivului" },
    { x: startX + 388, width: 210, label: "Motivul scutirii" },
  ]
  taxCols.forEach((col) => {
    doc.font(fonts.bold).fontSize(8).text(col.label, col.x, taxHeadY, { width: col.width })
  })
  let taxY = taxHeadY + 16
  taxBreakdown.forEach((tax) => {
    ensureSpace(16)
    doc.font(fonts.regular).fontSize(8)
    doc.text(String(tax.categoryId || "-"), taxCols[0].x, taxY, { width: taxCols[0].width })
    doc.text(money(tax.taxableAmount || 0), taxCols[1].x, taxY, { width: taxCols[1].width })
    doc.text(money(tax.taxAmount || 0), taxCols[2].x, taxY, { width: taxCols[2].width })
    doc.text(String(tax.taxCode || "-"), taxCols[3].x, taxY, { width: taxCols[3].width })
    doc.text(tax.exemptionReason ? "da" : "-", taxCols[4].x, taxY, { width: taxCols[4].width })
    doc.text(String(tax.exemptionReason || "-"), taxCols[5].x, taxY, { width: taxCols[5].width })
    taxY += 12
  })
  doc.y = taxY + 10

  const lineColumns = [
    { width: 38, label: "Linia" },
    { width: 322, label: "Nume articol/Descriere articol" },
    { width: 62, label: "Tara\nprovenient" },
    { width: 80, label: "Pretul net al\narticolului" },
    { width: 44, label: "Moneda" },
    { width: 78, label: "Cantitate de baza" },
    { width: 72, label: "Cantitate\nfacturata" },
    { width: 34, label: "UM" },
    { width: 40, label: "Cota\nTVA" },
    { width: 70, label: "Valoare neta" },
  ]

  function drawLineHeader() {
    let x = startX
    lineColumns.forEach((column) => {
      doc.font(fonts.bold).fontSize(7.5).text(column.label, x + 2, doc.y, { width: column.width - 4 })
      x += column.width
    })
    drawLine(doc.y + 14)
    doc.y += 18
  }

  ensureSpace(56)
  drawLineHeader()

  lines.forEach((line: ParsedIncomingInvoiceLine | IncomingInvoiceItemLike, index: number) => {
    const description = String(line.description || line.productName || "-")
    const rowHeight = Math.max(18, doc.heightOfString(description, { width: lineColumns[1].width - 4 }) + 4)
    ensureSpace(rowHeight + 10)
    if (doc.y + rowHeight > pageBottom) {
      doc.addPage()
      doc.font(fonts.regular).fontSize(8).fillColor("#111111")
      doc.y = topY
      drawLineHeader()
    }
    let x = startX
    const values = [
      String(line.lineIndex || index + 1),
      description,
      "-",
      money(line.unitPrice || 0),
      currency,
      fmtQtyRo(line.qty || 0),
      fmtQtyRo(line.qty || 0),
      String(line.uomCode || line.uomRawCode || "-"),
      fmtQtyRo(line.vatRate || 0),
      money(line.lineNet || 0),
    ]
    values.forEach((value, valueIndex) => {
      const width = lineColumns[valueIndex].width
      doc.font(fonts.regular).fontSize(8).text(String(value), x + 2, doc.y, {
        width: width - 4,
        align: valueIndex === 0 ? "center" : "left",
      })
      x += width
    })
    drawLine(doc.y + rowHeight, startX, pageRight, 0.5, "#c7c7c7")
    doc.y += rowHeight + 2
  })

  doc.y += 10
  ensureSpace(80)
  doc.font(fonts.bold).fontSize(9).text("Instructiuni de plata", startX, doc.y)
  let paymentY = doc.y + 14
  ;[
    ["Nota privind instrumentul de plata", parsed?.paymentMeansName || parsed?.paymentMeansCode || "-"],
    ["Explicatii privind instrumentul de plata", parsed?.paymentNote || "-"],
    ["Nr. cont de plata", parsed?.iban || "-"],
    ["Nota", parsed?.bankCode || "-"],
    ["Nr. contract", parsed?.paymentId || "-"],
  ].forEach(([label, value]) => {
    writePair(String(label), String(value || "-"), startX, paymentY, 152, pageWidth - 156)
    paymentY += 12
  })
  doc.y = paymentY

  const pages = doc.bufferedPageRange()
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i)
    doc.font(fonts.regular).fontSize(10).fillColor("#111111")
    doc.text("Pagina", startX + pageWidth / 2 - 54, footerY, { width: 48, align: "center" })
    doc.text(String(i + 1), startX + pageWidth / 2 - 2, footerY, { width: 18, align: "center" })
    doc.text("din", startX + pageWidth / 2 + 22, footerY, { width: 18, align: "center" })
    doc.text(String(pages.count), startX + pageWidth / 2 + 44, footerY, { width: 18, align: "center" })
  }

  doc.end()
  return done
}

async function generateIncomingInvoiceOfficialPdfBuffer(item: Pick<IncomingInvoiceEntryLike, "xmlText">) {
  const xmlText = String(item?.xmlText || "").trim()
  if (!xmlText) {
    throw new Error("Factura nu are XML disponibil pentru conversia ANAF.")
  }

  const parsed = parseIncomingEInvoiceXml(xmlText)
  const uploadXmlUrl = "https://www.anaf.ro/uploadxml/"
  const downloadPdfUrl = "https://www.anaf.ro/uploadxml/download"
  const docKind =
    String(parsed?.invoiceTypeCode || "").trim() === "381" || xmlText.includes("<CreditNote")
      ? "FCN"
      : "FACT1"

  const tempDir = fs.mkdtempSync(path.join(incomingEfacturaPdfDir, "anaf-uploadxml-"))
  const xmlPath = path.join(tempDir, "invoice.xml")
  const postPath = path.join(tempDir, "post.html")
  const cookiePath = path.join(tempDir, "cookies.txt")
  const pdfPath = path.join(tempDir, "invoice.pdf")

  try {
    fs.writeFileSync(xmlPath, xmlText, "utf8")

    await execFileAsync("curl", [
      "-sS",
      "-L",
      "-c",
      cookiePath,
      "-b",
      cookiePath,
      "-F",
      `fisier=@${xmlPath};type=text/xml`,
      "-F",
      "select=",
      "-F",
      `select2=${docKind}`,
      uploadXmlUrl,
      "-o",
      postPath,
    ])

    await execFileAsync("curl", [
      "-sS",
      "-L",
      "-c",
      cookiePath,
      "-b",
      cookiePath,
      downloadPdfUrl,
      "-o",
      pdfPath,
    ])

    if (!fs.existsSync(pdfPath)) {
      throw new Error("ANAF nu a returnat fisierul PDF.")
    }

    const buffer = fs.readFileSync(pdfPath)
    if (buffer.length < 1000 || buffer.subarray(0, 4).toString("utf8") !== "%PDF") {
      throw new Error("Fisierul intors de ANAF nu pare a fi PDF valid.")
    }

    return buffer
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

async function ensureIncomingInvoicePdfSaved(item: Pick<IncomingInvoiceEntryLike, "tenantId" | "id" | "xmlText" | "currency" | "totalNet" | "totalVat" | "totalGross" | "items" | "invoiceNo" | "spvDownloadId" | "supplierName" | "supplierCif" | "customerName" | "customerCif">) {
  const pdfPath = getIncomingInvoicePdfPath(item.tenantId, item.id)
  if (fs.existsSync(pdfPath)) {
    return pdfPath
  }
  let buffer: Buffer
  try {
    buffer = await generateIncomingInvoiceOfficialPdfBuffer(item)
  } catch {
    buffer = await generateIncomingInvoicePdfBuffer(item)
  }
  fs.writeFileSync(pdfPath, buffer)
  return pdfPath
}

router.get("/api/v1/efactura/incoming", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const items = await prisma.incomingEInvoice.findMany({
    where: { tenantId, companyId },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: true,
        },
        orderBy: { lineIndex: "asc" },
      },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  })

  const companyCui = await loadCompanyCui(tenantId, companyId)
  const repairedItems = await Promise.all(items.map((entry) => repairIncomingInvoiceIfNeeded(tenantId, companyId, entry)))
  const serializedItems = repairedItems
    .filter((entry) => invoiceBelongsToIncomingSide(entry, companyCui))
    .map((entry) => serializeIncomingInvoice(entry))

  return res.json({ ok: true, items: serializedItems })
})

router.get("/api/v1/efactura/outgoing", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const companyCui = await loadCompanyCui(tenantId, companyId)
  const items = await prisma.incomingEInvoice.findMany({
    where: { tenantId, companyId },
    include: {
      items: {
        orderBy: { lineIndex: "asc" },
      },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  })

  const repairedItems = await Promise.all(items.map((entry) => repairIncomingInvoiceIfNeeded(tenantId, companyId, entry)))
  const outgoingItems = repairedItems
    .filter((entry) => invoiceBelongsToOutgoingSide(entry, companyCui))
    .map((entry) => serializeOutgoingInvoice(entry))

  return res.json({ ok: true, items: outgoingItems })
})

router.get("/api/v1/efactura/incoming/bridge-config", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  const auth = req.auth
  if (!tenantId || !auth) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await loadAnafCompanyContext(auth)

  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    return res.status(400).json({ ok: false, error: "Firma nu are CUI valid pentru facturile primite e-Factura." })
  }
  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF activ pentru firma." })
  }

  return res.json({
    ok: true,
    bridgeConfig: {
      cif,
      environment: String(company?.efacturaEnvironment || "test").toLowerCase() === "prod" ? "prod" : "test",
      accessToken: String(company.efacturaOauthAccessToken),
      expiresAt: company?.efacturaOauthAccessTokenExpiresAt,
      baseUrl: getEfacturaBaseUrl(company?.efacturaEnvironment),
    },
  })
})

router.post("/api/v1/efactura/incoming/sync", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const credentialId = getRequestedCredentialId(req)
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await loadAnafCompanyContext(tenantId, companyId, credentialId)

  if (!company) {
    return res.status(404).json({ ok: false, error: "Compania activa nu a fost gasita." })
  }

  const requestedDays = Number(req.body?.days || 30)
  const days = Math.max(1, Math.min(365, Number.isFinite(requestedDays) ? requestedDays : 30))

  try {
    const listResult = await anafListMessages(company, { days })
    const rawMessages = Array.isArray(listResult.items) ? listResult.items : []
    const invoiceMessages = rawMessages.filter((entry): entry is IncomingEfacturaMessage => isRecord(entry) && isInvoiceEfacturaMessage(entry))
    const downloadIds = invoiceMessages
      .map((entry) => extractDownloadId(entry, JSON.stringify(entry || {})) || readStringField(entry, ["id", "downloadId"]))
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)

    const existingInvoices = downloadIds.length
      ? await prisma.incomingEInvoice.findMany({
          where: {
            tenantId,
            companyId,
            spvDownloadId: { in: downloadIds },
          },
          select: {
            id: true,
            spvDownloadId: true,
          },
        })
      : []

    const existingDownloadIds = new Set(
      existingInvoices.map((entry) => String(entry.spvDownloadId || "").trim()).filter(Boolean)
    )

    let imported = 0
    let importedIncoming = 0
    let importedOutgoing = 0
    let skipped = 0
    let downloaded = 0
    const errors: string[] = []
    const companyCui = normalizedCui(company?.cui)

    for (const message of invoiceMessages) {
      const downloadId =
        extractDownloadId(message, JSON.stringify(message || {})) ||
        readStringField(message, ["id", "downloadId"])

      if (!downloadId) {
        skipped += 1
        if (errors.length < 3) {
          errors.push("Un mesaj ANAF nu are ID de descarcare.")
        }
        continue
      }

      if (existingDownloadIds.has(String(downloadId).trim())) {
        skipped += 1
        continue
      }

      try {
        const downloadResult = await anafDownloadById(company, String(downloadId))
        downloaded += 1
        const extracted = extractXmlFromAnafDownload(downloadResult.response.buffer)
        const parsedInvoice = parseIncomingEInvoiceXml(extracted.xmlText)
        const extractedPdf = extractPdfFromAnafDownload(downloadResult.response.buffer)
        const enrichedMessage = {
          ...(message as Record<string, unknown>),
          spvPdfBase64: extractedPdf?.pdfBuffer?.toString("base64") || null,
          spvPdfFileName: extractedPdf?.fileName || null,
        }
        const item = await upsertIncomingInvoice(tenantId, companyId, enrichedMessage, extracted.xmlText, parsedInvoice)
        if (!item) {
          throw new Error(`Factura ${String(downloadId)} nu a putut fi reincarcata dupa import.`)
        }
        await ensureIncomingInvoicePdfSaved(item)
        imported += 1
        if (invoiceBelongsToOutgoingSide(parsedInvoice, companyCui)) {
          importedOutgoing += 1
        } else {
          importedIncoming += 1
        }
      } catch (error: unknown) {
        skipped += 1
        if (errors.length < 3) {
          errors.push(
            `Mesaj ${String(downloadId)}: ${errorMessage(error, "Nu am putut importa factura din ANAF.")}`
          )
        }
      }
    }

    return res.json({
      ok: true,
      message:
        imported > 0
          ? `Sincronizare e-Factura finalizata. Facturi importate: ${imported}.`
          : `Sincronizare e-Factura finalizata fara facturi noi pentru import.`,
      stats: {
        companyId,
        credentialId: company?.anafCredentialId || credentialId || null,
        days,
        totalMessages: rawMessages.length,
        invoiceMessages: invoiceMessages.length,
        downloaded,
        imported,
        importedIncoming,
        importedOutgoing,
        skipped,
        errors,
      },
      summary: listResult.summary,
    })
  } catch (error: unknown) {
    return res.status(400).json({
      ok: false,
      error: mapIncomingSyncError(error, company),
    })
  }
})

router.get("/api/v1/efactura/outgoing/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    include: {
      items: {
        orderBy: { lineIndex: "asc" },
      },
    },
  })

  const companyCui = await loadCompanyCui(tenantId, companyId)
  if (!item || !invoiceBelongsToOutgoingSide(item, companyCui)) {
    return res.status(404).json({ ok: false, error: "Factura trimisa SPV nu a fost gasita." })
  }

  const parsed = item.xmlText ? parseIncomingEInvoiceXml(String(item.xmlText)) : null
  const filename = `Factura_trimisa_SPV_${safeFilePart(String(parsed?.invoiceNo || item.invoiceNo || item.spvDownloadId || "document"))}.pdf`
  const pdfPath = await ensureIncomingInvoicePdfSaved(item)
  const buffer = fs.readFileSync(pdfPath)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(buffer)
})

router.get("/api/v1/efactura/outgoing/:id/xml", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    select: {
      invoiceNo: true,
      spvDownloadId: true,
      supplierCif: true,
      xmlText: true,
    },
  })

  const companyCui = await loadCompanyCui(tenantId, companyId)
  if (!item || !invoiceBelongsToOutgoingSide(item, companyCui)) {
    return res.status(404).json({ ok: false, error: "Factura trimisa SPV nu a fost gasita." })
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `inline; filename=\"factura-trimisa-spv-${String(item.invoiceNo || item.spvDownloadId || "document").replace(/[^a-zA-Z0-9._-]/g, "-")}.xml\"`
  )
  return res.send(item.xmlText)
})

router.get("/api/v1/efactura/incoming/:id", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: {
            include: {
              purchaseUom: true,
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { lineIndex: "asc" },
      },
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  const repaired = await repairIncomingInvoiceIfNeeded(tenantId, companyId, item)

  return res.json({ ok: true, item: serializeIncomingInvoice(repaired) })
})

router.get("/api/v1/efactura/incoming/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    include: {
      items: {
        orderBy: { lineIndex: "asc" },
      },
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  const rawPayload = item.rawPayload && typeof item.rawPayload === "object" ? (item.rawPayload as Record<string, unknown>) : null
  let originalPdfBase64 = String(rawPayload?.spvPdfBase64 || "").trim()

  if (!originalPdfBase64 && String(item.spvDownloadId || "").trim()) {
    try {
      const company = await loadAnafCompanyContext(tenantId, companyId)
      if (company) {
        const downloadResult = await anafDownloadById(company, String(item.spvDownloadId))
        const extractedPdf = extractPdfFromAnafDownload(downloadResult.response.buffer)
        if (extractedPdf?.pdfBuffer) {
          originalPdfBase64 = extractedPdf.pdfBuffer.toString("base64")
          await prisma.incomingEInvoice.update({
            where: { id: item.id },
            data: {
              rawPayload: {
                ...(rawPayload || {}),
                spvPdfBase64: originalPdfBase64,
                spvPdfFileName: extractedPdf.fileName || null,
              } as Prisma.InputJsonValue,
            },
          })
        }
      }
    } catch {
      // fallback below to generated PDF from XML
    }
  }

  const parsed = item.xmlText ? parseIncomingEInvoiceXml(String(item.xmlText)) : null
  const filename = `Factura_SPV_${safeFilePart(String(parsed?.invoiceNo || item.invoiceNo || item.spvDownloadId || "document"))}.pdf`
  const buffer = originalPdfBase64
    ? Buffer.from(originalPdfBase64, "base64")
    : fs.readFileSync(await ensureIncomingInvoicePdfSaved(item))
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(buffer)
})

router.get("/api/v1/efactura/incoming/:id/xml", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    select: {
      invoiceNo: true,
      spvDownloadId: true,
      xmlText: true,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `inline; filename=\"factura-spv-${String(item.invoiceNo || item.spvDownloadId || "document").replace(/[^a-zA-Z0-9._-]/g, "-")}.xml\"`
  )
  return res.send(item.xmlText)
})

router.post("/api/v1/efactura/incoming/import-from-spv-bridge", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const rawMessage = req.body?.message || null
  const downloadBase64 = String(req.body?.downloadBase64 || "").trim()

  if (!rawMessage || typeof rawMessage !== "object") {
    return res.status(400).json({ ok: false, error: "Mesajul SPV lipseste." })
  }

  if (!downloadBase64) {
    return res.status(400).json({ ok: false, error: "Continutul descarcat din SPV lipseste." })
  }

  try {
    const buffer = Buffer.from(downloadBase64, "base64")
    const extracted = extractXmlFromAnafDownload(buffer)
    const parsedInvoice = parseIncomingEInvoiceXml(extracted.xmlText)
    const extractedPdf = extractPdfFromAnafDownload(buffer)
    const enrichedMessage = {
      ...(rawMessage as Record<string, unknown>),
      spvPdfBase64: extractedPdf?.pdfBuffer?.toString("base64") || null,
      spvPdfFileName: extractedPdf?.fileName || null,
    }
    const item = await upsertIncomingInvoice(tenantId, companyId, enrichedMessage, extracted.xmlText, parsedInvoice)
    if (!item) {
      throw new Error("Factura importata nu a putut fi reincarcata dupa salvare.")
    }
    await ensureIncomingInvoicePdfSaved(item)
    return res.json({
      ok: true,
      item: serializeIncomingInvoice(item),
      invoiceNo: parsedInvoice.invoiceNo || null,
      supplierName: parsedInvoice.supplierName || null,
      spvDownloadId: item?.spvDownloadId || extractDownloadId(rawMessage, JSON.stringify(rawMessage || {})) || null,
    })
  } catch (error: unknown) {
    return res.status(400).json({
      ok: false,
      error: errorMessage(error, "Nu am putut importa factura din bridge-ul SPV."),
    })
  }
})

router.post("/api/v1/efactura/incoming/:id/create-supplier", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa lipseste." })
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const invoice = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, companyId, id: req.params.id },
    select: {
      id: true,
      supplierId: true,
      supplierName: true,
      supplierCif: true,
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  if (invoice.supplierId) {
    const existing = await prisma.supplier.findFirst({
      where: { tenantId, id: invoice.supplierId },
    })
    return res.json({ ok: true, supplier: existing })
  }

  if (!String(invoice.supplierName || "").trim()) {
    return res.status(400).json({ ok: false, error: "Factura nu are furnizor suficient pentru creare automata." })
  }

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const supplierCif = String(invoice.supplierCif || "").trim()
      const existingByCif =
        supplierCif
          ? await tx.supplier.findFirst({
              where: {
                tenantId,
                companyId,
                cif: {
                  contains: supplierCif,
                  mode: "insensitive",
                },
              },
            })
          : null

      if (existingByCif) {
        await tx.incomingEInvoice.update({
          where: { id: invoice.id },
          data: {
            supplierId: existingByCif.id,
            supplierCode: existingByCif.code || null,
          },
        })
        return existingByCif
      }

      const code = await reserveNextNumber(tx, tenantId, "supplier")
        const created = await tx.supplier.create({
          data: {
            tenantId,
            companyId,
            name: String(invoice.supplierName || "").trim(),
          code,
          cif: invoice.supplierCif ? String(invoice.supplierCif).trim() : null,
          isActive: true,
        },
      })

      await tx.incomingEInvoice.update({
        where: { id: invoice.id },
        data: {
          supplierId: created.id,
          supplierCode: created.code || null,
        },
      })

      return created
    })

    return res.json({ ok: true, supplier })
  } catch (error: unknown) {
    return res.status(400).json({
      ok: false,
      error: errorMessage(error, "Nu am putut crea furnizorul din factura SPV."),
    })
  }
})

export default router
