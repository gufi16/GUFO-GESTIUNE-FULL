// @ts-nocheck
import fs from "fs"
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
    return repaired || entry
  } catch {
    return entry
  }
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
  const currency = parsed?.currency || item.currency || "RON"
  const lines = Array.isArray(parsed?.lines) && parsed.lines.length ? parsed.lines : item.items
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
    margin: 28,
    bufferPages: true,
    autoFirstPage: true,
  })
  const fonts = registerFonts(doc)

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  doc.pipe(res)

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const startX = doc.page.margins.left
  const pageRight = startX + pageWidth

  function ensureSpace(requiredHeight: number) {
    if (doc.y + requiredHeight <= doc.page.height - doc.page.margins.bottom - 30) return
    doc.addPage()
    doc.font(fonts.regular).fontSize(10).fillColor("#111111")
  }

  function row(label: string, value: string, x: number, y: number, labelWidth: number, valueWidth: number) {
    doc.font(fonts.bold).fontSize(8).fillColor("#111111").text(label, x, y, { width: labelWidth })
    doc.font(fonts.regular).fontSize(8).fillColor("#111111").text(value || "-", x + labelWidth + 4, y, { width: valueWidth })
  }

  function drawParty(title: string, party: any, x: number, y: number, width: number) {
    doc.font(fonts.bold).fontSize(11).fillColor("#111111").text(title, x, y, { width })
    const rows = [
      ["Nume", party?.name || "-"],
      ["Nr. inregistrare", party?.registration || "-"],
      ["Identificatorul TVA", party?.vat || "-"],
      ["Strada", [party?.street, party?.additionalStreet].filter(Boolean).join(", ") || "-"],
      ["Oras", party?.city || "-"],
      ["Cod", party?.postalCode || "-"],
      ["Regiune", party?.region || "-"],
      ["Tara", party?.country || "-"],
      ["Telefon", party?.phone || "-"],
      ["E-mail", party?.email || "-"],
    ]
    let currentY = y + 16
    rows.forEach(([label, value]) => {
      row(String(label), String(value || "-"), x, currentY, 76, width - 80)
      currentY += 15
    })
    return currentY
  }

  const topY = doc.y
  const leftWidth = 238
  const rightWidth = 238
  const centerWidth = pageWidth - leftWidth - rightWidth
  const centerX = startX + leftWidth
  const rightX = centerX + centerWidth

  const supplierBottom = drawParty("VANZATOR", {
    name: supplierName,
    registration: parsed?.supplierIdentifier || supplierCif,
    vat: supplierCif ? `RO${supplierCif}` : "-",
    street: parsed?.supplierAddress?.street,
    additionalStreet: parsed?.supplierAddress?.additionalStreet,
    city: parsed?.supplierAddress?.city,
    postalCode: parsed?.supplierAddress?.postalCode,
    region: parsed?.supplierAddress?.region,
    country: parsed?.supplierAddress?.country,
    phone: parsed?.supplierContact?.phone,
    email: parsed?.supplierContact?.email,
  }, startX, topY, leftWidth - 6)

  const customerBottom = drawParty("CUMPARATOR", {
    name: customerName,
    registration: parsed?.customerIdentifier || customerCif,
    vat: customerCif ? `RO${customerCif}` : "-",
    street: parsed?.customerAddress?.street,
    additionalStreet: parsed?.customerAddress?.additionalStreet,
    city: parsed?.customerAddress?.city,
    postalCode: parsed?.customerAddress?.postalCode,
    region: parsed?.customerAddress?.region,
    country: parsed?.customerAddress?.country,
    phone: parsed?.customerContact?.phone,
    email: parsed?.customerContact?.email,
  }, rightX, topY, rightWidth - 6)

  doc.font(fonts.bold).fontSize(22).fillColor("#111111").text("RO eFactura", centerX, topY + 18, {
    width: centerWidth,
    align: "center",
  })
  const metaY = topY + 54
  ;[
    ["Nr. factura", parsed?.invoiceNo || item.invoiceNo || "-"],
    ["Codul tipului", parsed?.invoiceTypeCode || "-"],
    ["Data emiterii", fmtDateRo(parsed?.invoiceDate || item.invoiceDate)],
    ["Data scadenta", fmtDateRo(parsed?.dueDate)],
    ["Moneda facturii", currency],
  ].forEach(([label, value], index) => {
    row(String(label), String(value || "-"), centerX + 10, metaY + index * 16, 80, centerWidth - 94)
  })

  doc.y = Math.max(supplierBottom, customerBottom) + 18
  ensureSpace(110)

  const totalLabels = [
    ["TOTAL NET", 86],
    ["VALOARE TOTALA fara TVA", 124],
    ["VALOARE TOTALA cu TVA", 124],
    ["TOTAL DEDUCERI", 96],
    ["TOTAL TAXE SUPLIMENTARE", 110],
    ["SUMA PLATITA", 98],
    ["VALOARE DE ROTUNJIRE", 110],
  ] as const
  const totalValues = [
    fmtMoneyRo(parsed?.totalNet || item.totalNet || 0),
    fmtMoneyRo(parsed?.taxExclusiveAmount || parsed?.totalNet || item.totalNet || 0),
    fmtMoneyRo(parsed?.taxInclusiveAmount || parsed?.totalGross || item.totalGross || 0),
    fmtMoneyRo(parsed?.prepaidAmount || 0),
    "0,00",
    fmtMoneyRo(parsed?.prepaidAmount || 0),
    fmtMoneyRo(parsed?.roundingAmount || 0),
  ]
  let x = startX
  totalLabels.forEach(([label, width]) => {
    doc.font(fonts.bold).fontSize(8).text(label, x, doc.y, { width, align: "center" })
    x += width
  })
  doc.moveTo(startX, doc.y + 12).lineTo(pageRight, doc.y + 12).stroke("#333333")
  x = startX
  totalValues.forEach((value, index) => {
    const width = totalLabels[index][1]
    doc.font(fonts.regular).fontSize(9).text(value, x + 4, doc.y + 16, { width: width - 8 })
    x += width
  })
  doc.moveTo(startX, doc.y + 32).lineTo(pageRight, doc.y + 32).stroke("#333333")

  doc.y += 38
  doc.font(fonts.bold).fontSize(11).text("TOTAL PLATA", startX, doc.y)
  doc.text(`${fmtMoneyRo(parsed?.payableAmount || parsed?.totalGross || item.totalGross || 0)} ${currency}`, startX + 112, doc.y)
  doc.moveTo(startX, doc.y + 14).lineTo(startX + 190, doc.y + 14).stroke("#333333")

  doc.y += 24
  doc.font(fonts.bold).fontSize(11).text("TOTAL TVA", startX, doc.y)
  doc.font(fonts.regular).fontSize(10).text(`${fmtMoneyRo(parsed?.totalVat || item.totalVat || 0)} ${currency}`, startX + 95, doc.y)

  doc.y += 18
  doc.font(fonts.bold).fontSize(9).text("Detalierea TVA", startX, doc.y)
  const taxHeaderY = doc.y + 14
  ;[
    ["Codul categoriei", startX, 90],
    ["Baza de calcul", startX + 92, 84],
    ["Valoare TVA", startX + 180, 72],
    ["Codul", startX + 256, 52],
    ["motivului", startX + 312, 72],
    ["Motivul scutirii", startX + 388, 160],
  ].forEach(([label, posX, width]) => {
    doc.font(fonts.bold).fontSize(8).text(String(label), Number(posX), taxHeaderY, { width: Number(width) })
  })
  let taxY = taxHeaderY + 14
  taxBreakdown.forEach((tax: any) => {
    ensureSpace(16)
    doc.font(fonts.regular).fontSize(8)
    doc.text(String(tax.categoryId || "-"), startX, taxY, { width: 90 })
    doc.text(fmtMoneyRo(tax.taxableAmount || 0), startX + 92, taxY, { width: 84 })
    doc.text(fmtMoneyRo(tax.taxAmount || 0), startX + 180, taxY, { width: 72 })
    doc.text(String(tax.taxCode || "-"), startX + 256, taxY, { width: 52 })
    doc.text(tax.exemptionReason ? "da" : "-", startX + 312, taxY, { width: 72 })
    doc.text(String(tax.exemptionReason || "-"), startX + 388, taxY, { width: 160 })
    taxY += 14
  })
  doc.y = taxY + 8

  ensureSpace(44)
  const lineCols = [
    ["Linia", 38],
    ["Nume articol/Descriere articol", 250],
    ["Tara provenient", 58],
    ["Pretul net al articolului", 76],
    ["Moneda", 44],
    ["Cantitate de baza", 62],
    ["Cantitate facturata", 64],
    ["UM", 34],
    ["Cota TVA", 40],
    ["Valoare neta", 60],
  ] as const
  let lineHeaderX = startX
  lineCols.forEach(([label, width]) => {
    doc.font(fonts.bold).fontSize(8).text(label, lineHeaderX + 2, doc.y, { width: width - 4 })
    lineHeaderX += width
  })
  doc.moveTo(startX, doc.y + 12).lineTo(pageRight, doc.y + 12).stroke("#333333")
  doc.y += 16

  lines.forEach((line: any, index: number) => {
    const description = String(line.description || line.productName || "-")
    const rowHeight = Math.max(18, doc.heightOfString(description, { width: 246 }) + 4)
    ensureSpace(rowHeight + 4)
    let lineX = startX
    const values = [
      String(line.lineIndex || index + 1),
      description,
      "-",
      fmtMoneyRo(line.unitPrice || 0),
      currency,
      fmtQtyRo(line.qty || 0),
      fmtQtyRo(line.qty || 0),
      String(line.uomCode || line.uomRawCode || "-"),
      fmtQtyRo(line.vatRate || 0),
      fmtMoneyRo(line.lineNet || 0),
    ]
    values.forEach((value, valueIndex) => {
      const width = lineCols[valueIndex][1]
      doc.font(fonts.regular).fontSize(8).text(String(value), lineX + 2, doc.y, {
        width: width - 4,
        align: valueIndex === 0 ? "center" : "left",
      })
      lineX += width
    })
    doc.moveTo(startX, doc.y + rowHeight).lineTo(pageRight, doc.y + rowHeight).stroke("#c7c7c7")
    doc.y += rowHeight + 2
  })

  doc.y += 10
  ensureSpace(80)
  doc.font(fonts.bold).fontSize(9).text("Instructiuni de plata", startX, doc.y)
  doc.moveDown(0.35)
  ;[
    ["Nota privind instrumentul de plata", parsed?.paymentMeansName || parsed?.paymentMeansCode || "-"],
    ["Nr. cont de plata", parsed?.iban || "-"],
    ["Explicatii privind instrumentul de plata", parsed?.paymentNote || "-"],
    ["Banca", parsed?.bankCode || "-"],
    ["Nr. contract", parsed?.paymentId || "-"],
  ].forEach(([label, value]) => {
    const currentY = doc.y
    doc.font(fonts.bold).fontSize(8).text(String(label), startX, currentY, { width: 156 })
    doc.font(fonts.regular).fontSize(8).text(String(value || "-"), startX + 160, currentY, { width: pageWidth - 160 })
    doc.moveDown(0.5)
  })

  const pages = doc.bufferedPageRange()
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i)
    doc.font(fonts.regular).fontSize(10).fillColor("#111111")
    doc.text("Pagina", startX + pageWidth / 2 - 48, doc.page.height - 34, { width: 46, align: "center" })
    doc.text(String(i + 1), startX + pageWidth / 2, doc.page.height - 34, { width: 18, align: "center" })
    doc.text("din", startX + pageWidth / 2 + 24, doc.page.height - 34, { width: 18, align: "center" })
    doc.text(String(pages.count), startX + pageWidth / 2 + 46, doc.page.height - 34, { width: 20, align: "center" })
  }

  doc.end()
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
