// @ts-nocheck
import fs from "fs"
import path from "path"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { reserveNextNumber } from "../lib/numbering"
import {
  extractDownloadId,
  extractUploadIndex,
  extractXmlFromAnafDownload,
  getEfacturaBaseUrl,
  normalizeCompanyCui,
  parseIncomingEInvoiceXml,
  readStringField,
} from "../lib/incomingEfactura"

const router = Router()

router.use(requireAuth)

const incomingEfacturaPdfDir = path.join(process.cwd(), "uploads", "incoming-efactura-pdfs")
fs.mkdirSync(incomingEfacturaPdfDir, { recursive: true })

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

function fmtMoney(value: any) {
  return Number(value || 0).toFixed(2)
}

function fmtMoneyRo(value: any) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function fmtQtyRo(value: any) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

function fmtDateRo(value: any) {
  const date = toDateOrNull(value)
  return date ? date.toLocaleDateString("ro-RO") : "-"
}

function joinAddressParts(address: any) {
  if (!address) return "-"
  return [
    address.street,
    address.additionalStreet,
    address.city,
    address.postalCode,
    address.region,
    address.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ")
}

function getIncomingInvoicePdfPath(tenantId: string, invoiceId: string) {
  const tenantDir = path.join(incomingEfacturaPdfDir, tenantId)
  fs.mkdirSync(tenantDir, { recursive: true })
  return path.join(tenantDir, `${invoiceId}.pdf`)
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function toDateOrNull(value: any) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toNumber(value: any) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCurrency(value: any): "RON" | "EUR" | "USD" | "HUF" {
  const current = String(value || "RON").toUpperCase()
  if (current === "EUR" || current === "USD" || current === "HUF") return current
  return "RON"
}

async function matchSupplier(tenantId: string, supplierCif: string, supplierName: string) {
  if (supplierCif) {
    const byCif = await prisma.supplier.findFirst({
      where: {
        tenantId,
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

async function matchProduct(tenantId: string, line: any) {
  const skuCandidates = [line.externalCode, line.productCode, line.barcode]
    .map((value: any) => String(value || "").trim())
    .filter(Boolean)

  for (const candidate of skuCandidates) {
    const bySku = await prisma.product.findFirst({
      where: { tenantId, sku: candidate },
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
  rawMessage: any,
  xmlText: string,
  parsedInvoice: any
) {
  const supplier = await matchSupplier(
    tenantId,
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
      tenantId_spvDownloadId: {
        tenantId,
        spvDownloadId: downloadId,
      },
    },
    update: {
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
      rawPayload: rawMessage || null,
      syncedAt: new Date(),
    },
    create: {
      tenantId,
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
      rawPayload: rawMessage || null,
      status: "SYNCED",
    },
  })

  await prisma.incomingEInvoiceItem.deleteMany({
    where: { invoiceId: baseRecord.id },
  })

  for (const line of parsedInvoice.lines || []) {
    const matchedProduct = await matchProduct(tenantId, line)
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

function isMalformedIncomingInvoice(entry: any) {
  const itemsCount = Array.isArray(entry?.items) ? entry.items.length : 0
  return (
    !String(entry?.invoiceNo || "").trim() ||
    !String(entry?.supplierName || "").trim() ||
    Number(entry?.totalGross || 0) <= 0 ||
    itemsCount === 0
  )
}

async function repairIncomingInvoiceIfNeeded(tenantId: string, entry: any) {
  if (!entry?.xmlText || !isMalformedIncomingInvoice(entry)) return entry
  try {
    const parsedInvoice = parseIncomingEInvoiceXml(String(entry.xmlText))
    const repaired = await upsertIncomingInvoice(
      tenantId,
      entry.rawPayload || {
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

async function generateIncomingInvoicePdfBuffer(item: any) {
  const parsed = item?.xmlText ? parseIncomingEInvoiceXml(String(item.xmlText)) : null
  const currency = parsed?.currency || item.currency || "RON"
  const lines = Array.isArray(parsed?.lines) && parsed.lines.length ? parsed.lines : item.items || []
  const supplierName = parsed?.supplierName || item.supplierName || "-"
  const supplierCif = parsed?.supplierCif || item.supplierCif || "-"
  const customerName = parsed?.customerName || "-"
  const customerCif = parsed?.customerCif || "-"
  const taxBreakdown =
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
  const pageBottom = footerY - 12

  function money(value: any, includeCurrency = false) {
    const amount = fmtMoneyRo(value)
    return includeCurrency ? `${amount} ${currency}` : amount
  }

  function ensureSpace(requiredHeight: number) {
    if (doc.y + requiredHeight <= pageBottom) return
    doc.addPage()
    doc.font(fonts.regular).fontSize(8).fillColor("#111111")
  }

  function drawRule(y: number, color = "#222222", width = 0.8, fromX = startX, toX = pageRight) {
    doc.save()
    doc.lineWidth(width).strokeColor(color).moveTo(fromX, y).lineTo(toX, y).stroke()
    doc.restore()
  }

  function writeCell(label: string, value: string, x: number, y: number, labelWidth: number, valueWidth: number, valueSize = 8) {
    doc.font(fonts.bold).fontSize(8).fillColor("#111111").text(label, x, y, { width: labelWidth })
    doc.font(fonts.regular).fontSize(valueSize).fillColor("#111111").text(value || "-", x + labelWidth + 4, y, { width: valueWidth })
  }

  function drawParty(title: string, rows: Array<[string, string]>, x: number, y: number, width: number) {
    doc.font(fonts.bold).fontSize(10).fillColor("#111111").text(title, x, y, { width })
    let currentY = y + 14
    rows.forEach(([label, value]) => {
      writeCell(label, value || "-", x, currentY, 76, width - 80)
      currentY += 12
    })
    return currentY
  }

  const leftWidth = 252
  const rightWidth = 252
  const centerWidth = pageWidth - leftWidth - rightWidth
  const centerX = startX + leftWidth
  const rightX = centerX + centerWidth
  const invoiceDate = fmtDateRo(parsed?.invoiceDate || item.invoiceDate)
  const dueDate = fmtDateRo(parsed?.dueDate)
  const payableAmount = parsed?.payableAmount || parsed?.totalGross || item.totalGross || 0

  const supplierRows: Array<[string, string]> = [
    ["Nume", supplierName],
    ["Nr. inregistrare", parsed?.supplierIdentifier || "-"],
    ["Informatii juridice", parsed?.supplierIdentifier || "-"],
    ["Identificatorul TVA", supplierCif ? `RO${supplierCif}` : "-"],
    ["Strada", [parsed?.supplierAddress?.street, parsed?.supplierAddress?.additionalStreet].filter(Boolean).join(", ") || "-"],
    ["Oras", parsed?.supplierAddress?.city || "-"],
    ["Cod", parsed?.supplierAddress?.postalCode || "-"],
    ["Regiune", parsed?.supplierAddress?.region || "-"],
    ["Tara", parsed?.supplierAddress?.country || "-"],
  ]

  const customerRows: Array<[string, string]> = [
    ["Nume", customerName],
    ["Nr. inregistrare", parsed?.customerIdentifier || "-"],
    ["Identificator", customerCif ? `RO${customerCif}` : "-"],
    ["Strada", [parsed?.customerAddress?.street, parsed?.customerAddress?.additionalStreet].filter(Boolean).join(", ") || "-"],
    ["Oras", parsed?.customerAddress?.city || "-"],
    ["Cod", parsed?.customerAddress?.postalCode || "-"],
    ["Regiune", parsed?.customerAddress?.region || "-"],
    ["Tara", parsed?.customerAddress?.country || "-"],
    ["E-mail", parsed?.customerContact?.email || "-"],
  ]

  const supplierBottom = drawParty("VANZATOR", supplierRows, startX, topY + 2, leftWidth - 8)
  const customerBottom = drawParty("CUMPARATOR", customerRows, rightX, topY + 2, rightWidth - 8)

  doc.font(fonts.bold).fontSize(22).fillColor("#111111").text("RO eFactura", centerX, topY + 18, {
    width: centerWidth,
    align: "center",
  })

  const metaY = topY + 52
  ;[
    ["Nr. factura", parsed?.invoiceNo || item.invoiceNo || "-"],
    ["Codul tipului", parsed?.invoiceTypeCode || "-"],
    ["Data emiterii", invoiceDate],
    ["Data scadenta", dueDate],
    ["Moneda facturii", currency],
  ].forEach(([label, value], index) => {
    writeCell(String(label), String(value || "-"), centerX + 10, metaY + index * 14, 84, centerWidth - 98)
  })

  doc.y = Math.max(supplierBottom, customerBottom) + 22
  ensureSpace(110)

  const totalCols = [
    { label: "TOTAL NET", width: 110, value: money(parsed?.totalNet || item.totalNet || 0) },
    { label: "VALOARE TOTALA fara TVA", width: 136, value: money(parsed?.taxExclusiveAmount || parsed?.totalNet || item.totalNet || 0) },
    { label: "VALOARE TOTALA cu TVA", width: 136, value: money(parsed?.taxInclusiveAmount || parsed?.totalGross || item.totalGross || 0) },
    { label: "TOTAL DEDUCERI", width: 114, value: money(parsed?.prepaidAmount || 0) },
    { label: "TOTAL TAXE\nSUPLIMENTARE", width: 120, value: "0,00" },
    { label: "SUMA PLATITA", width: 112, value: money(parsed?.prepaidAmount || 0) },
    { label: "VALOARE DE\nROTUNJIRE", width: 122, value: money(parsed?.roundingAmount || 0) },
  ]
  let totalX = startX
  totalCols.forEach((column) => {
    doc.font(fonts.bold).fontSize(8).text(column.label, totalX + 2, doc.y, {
      width: column.width - 4,
      align: "center",
    })
    totalX += column.width
  })
  drawRule(doc.y + 16)
  totalX = startX
  totalCols.forEach((column) => {
    doc.font(fonts.regular).fontSize(9).text(column.value, totalX + 3, doc.y + 18, {
      width: column.width - 6,
      align: "left",
    })
    totalX += column.width
  })
  drawRule(doc.y + 34)

  doc.y += 42
  doc.font(fonts.bold).fontSize(10).text("TOTAL PLATA", startX, doc.y)
  doc.font(fonts.bold).fontSize(10).text(money(payableAmount), startX + 96, doc.y)
  drawRule(doc.y + 15, "#222222", 0.8, startX, startX + 260)

  doc.y += 24
  doc.font(fonts.bold).fontSize(10).text("TOTAL TVA", startX, doc.y)
  doc.font(fonts.regular).fontSize(10).text(money(parsed?.totalVat || item.totalVat || 0, true), startX + 82, doc.y)

  doc.y += 18
  doc.font(fonts.bold).fontSize(9).text("Detalierea TVA", startX, doc.y)
  const taxHeaderY = doc.y + 14
  const taxCols = [
    { label: "Codul\ncategoriei", x: startX, width: 92 },
    { label: "Baza de calcul", x: startX + 94, width: 88 },
    { label: "Valoare TVA", x: startX + 184, width: 74 },
    { label: "Codul", x: startX + 260, width: 48 },
    { label: "motivului", x: startX + 310, width: 48 },
    { label: "Motivul scutirii", x: startX + 360, width: 188 },
  ]
  taxCols.forEach((col) => {
    doc.font(fonts.bold).fontSize(8).text(col.label, col.x, taxHeaderY, { width: col.width })
  })
  let taxY = taxHeaderY + 16
  taxBreakdown.forEach((tax: any) => {
    ensureSpace(18)
    doc.font(fonts.regular).fontSize(8)
    doc.text(String(tax.categoryId || "-"), taxCols[0].x, taxY, { width: taxCols[0].width })
    doc.text(money(tax.taxableAmount || 0), taxCols[1].x, taxY, { width: taxCols[1].width })
    doc.text(money(tax.taxAmount || 0), taxCols[2].x, taxY, { width: taxCols[2].width })
    doc.text(String(tax.taxCode || "-"), taxCols[3].x, taxY, { width: taxCols[3].width })
    doc.text(tax.exemptionReason ? "da" : "-", taxCols[4].x, taxY, { width: taxCols[4].width })
    doc.text(String(tax.exemptionReason || "-"), taxCols[5].x, taxY, { width: taxCols[5].width })
    taxY += 13
  })
  doc.y = taxY + 8

  ensureSpace(64)
  const lineCols = [
    { label: "Linia", width: 38 },
    { label: "Nume articol/Descriere articol", width: 330 },
    { label: "Tara\nprovenient", width: 66 },
    { label: "Pretul net al\narticolului", width: 76 },
    { label: "Moneda", width: 46 },
    { label: "Cantitate de baza", width: 74 },
    { label: "Cantitate\nfacturata", width: 72 },
    { label: "UM", width: 34 },
    { label: "Cota\nTVA", width: 40 },
    { label: "Valoare neta", width: 68 },
  ]
  let lineHeaderX = startX
  lineCols.forEach((col) => {
    doc.font(fonts.bold).fontSize(7.6).text(col.label, lineHeaderX + 2, doc.y, {
      width: col.width - 4,
    })
    lineHeaderX += col.width
  })
  drawRule(doc.y + 14)
  doc.y += 18

  lines.forEach((line: any, index: number) => {
    const description = String(line.description || line.productName || "-")
    const rowHeight = Math.max(18, doc.heightOfString(description, { width: lineCols[1].width - 4 }) + 4)
    ensureSpace(rowHeight + 6)
    let lineX = startX
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
      const width = lineCols[valueIndex].width
      doc.font(fonts.regular).fontSize(8).text(String(value), lineX + 2, doc.y, {
        width: width - 4,
        align: valueIndex === 0 ? "center" : "left",
      })
      lineX += width
    })
    drawRule(doc.y + rowHeight, "#d1d5db", 0.5)
    doc.y += rowHeight + 2
  })

  doc.y += 10
  ensureSpace(82)
  doc.font(fonts.bold).fontSize(9).text("Instructiuni de plata", startX, doc.y)
  let paymentY = doc.y + 14
  ;[
    ["Nota privind instrumentul de plata", parsed?.paymentMeansName || parsed?.paymentMeansCode || "-"],
    ["Explicatii privind instrumentul de plata", parsed?.paymentNote || "-"],
    ["Nr. cont de plata", parsed?.iban || "-"],
    ["Nota", parsed?.bankCode || "-"],
    ["Nr. contract", parsed?.paymentId || "-"],
  ].forEach(([label, value]) => {
    writeCell(String(label), String(value || "-"), startX, paymentY, 152, pageWidth - 156)
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

async function ensureIncomingInvoicePdfSaved(item: any) {
  const pdfPath = getIncomingInvoicePdfPath(item.tenantId, item.id)
  const buffer = await generateIncomingInvoicePdfBuffer(item)
  fs.writeFileSync(pdfPath, buffer)
  return pdfPath
}

router.get("/api/v1/efactura/incoming", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const items = await prisma.incomingEInvoice.findMany({
    where: { tenantId },
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

  const repairedItems = await Promise.all(items.map((entry) => repairIncomingInvoiceIfNeeded(tenantId, entry)))

  return res.json({ ok: true, items: repairedItems })
})

router.get("/api/v1/efactura/incoming/bridge-config", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await prisma.company.findUnique({
    where: { tenantId },
    select: {
      cui: true,
      efacturaEnvironment: true,
      efacturaOauthAccessToken: true,
      efacturaOauthAccessTokenExpiresAt: true,
    },
  })

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
      expiresAt: company.efacturaOauthAccessTokenExpiresAt,
      baseUrl: getEfacturaBaseUrl(company?.efacturaEnvironment),
    },
  })
})

router.get("/api/v1/efactura/incoming/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
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

  const repaired = await repairIncomingInvoiceIfNeeded(tenantId, item)

  return res.json({ ok: true, item: repaired })
})

router.get("/api/v1/efactura/incoming/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
    include: {
      items: {
        orderBy: { lineIndex: "asc" },
      },
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  const parsed = item.xmlText ? parseIncomingEInvoiceXml(String(item.xmlText)) : null
  const filename = `Factura_SPV_${safeFilePart(String(parsed?.invoiceNo || item.invoiceNo || item.spvDownloadId || "document"))}.pdf`
  const pdfPath = await ensureIncomingInvoicePdfSaved(item)
  const buffer = fs.readFileSync(pdfPath)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(buffer)
})

router.get("/api/v1/efactura/incoming/:id/xml", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
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
  const tenantId = req.auth!.tenantId
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
    const item = await upsertIncomingInvoice(tenantId, rawMessage, extracted.xmlText, parsedInvoice)
    await ensureIncomingInvoicePdfSaved(item)
    return res.json({
      ok: true,
      item,
      invoiceNo: parsedInvoice.invoiceNo || null,
      supplierName: parsedInvoice.supplierName || null,
      spvDownloadId: item?.spvDownloadId || extractDownloadId(rawMessage, JSON.stringify(rawMessage || {})) || null,
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut importa factura din bridge-ul SPV.",
    })
  }
})

router.post("/api/v1/efactura/incoming/:id/create-supplier", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const invoice = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
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
      const existingByCif =
        invoice.supplierCif
          ? await tx.supplier.findFirst({
              where: {
                tenantId,
                cif: {
                  contains: invoice.supplierCif,
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
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut crea furnizorul din factura SPV.",
    })
  }
})

export default router
