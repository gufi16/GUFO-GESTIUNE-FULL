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

  return res.json({ ok: true, items })
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

  return res.json({ ok: true, item })
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

  const filename = `Factura_SPV_${safeFilePart(String(item.invoiceNo || item.spvDownloadId || "document"))}.pdf`
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    bufferPages: true,
    autoFirstPage: true,
  })
  const fonts = registerFonts(doc)

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  doc.pipe(res)

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const startX = doc.page.margins.left
  const colWidths = [24, 144, 36, 42, 58, 58, 38, 50, 54]
  const colX = colWidths.reduce<number[]>((acc, width, index) => {
    if (index === 0) return [startX]
    acc.push(acc[index - 1] + colWidths[index - 1])
    return acc
  }, [])

  function ensureSpace(requiredHeight: number) {
    if (doc.y + requiredHeight <= doc.page.height - doc.page.margins.bottom) return
    doc.addPage()
    doc.font(fonts.regular).fontSize(10)
  }

  doc.font(fonts.bold).fontSize(20).fillColor("#0f172a").text("Factura primita e-Factura", startX, doc.y)
  doc.moveDown(0.4)

  const topY = doc.y
  const leftBoxWidth = pageWidth * 0.48
  const rightBoxX = startX + leftBoxWidth + 16
  const rightBoxWidth = pageWidth - leftBoxWidth - 16

  doc.roundedRect(startX, topY, leftBoxWidth, 102, 10).stroke("#cbd5e1")
  doc.roundedRect(rightBoxX, topY, rightBoxWidth, 102, 10).stroke("#cbd5e1")

  doc.font(fonts.bold).fontSize(11).text("Furnizor", startX + 12, topY + 10)
  doc.font(fonts.regular).fontSize(10)
  doc.text(String(item.supplierName || "-"), startX + 12, topY + 30, { width: leftBoxWidth - 24 })
  doc.text(`CIF: ${String(item.supplierCif || "-")}`, startX + 12, topY + 47, { width: leftBoxWidth - 24 })
  doc.text(`Cod furnizor: ${String(item.supplierCode || "-")}`, startX + 12, topY + 64, { width: leftBoxWidth - 24 })

  doc.font(fonts.bold).fontSize(11).text("Factura", rightBoxX + 12, topY + 10)
  doc.font(fonts.regular).fontSize(10)
  doc.text(`Numar: ${String(item.invoiceNo || "-")}`, rightBoxX + 12, topY + 30, { width: rightBoxWidth - 24 })
  doc.text(`Data: ${toDateOrNull(item.invoiceDate)?.toLocaleDateString("ro-RO") || "-"}`, rightBoxX + 12, topY + 47, { width: rightBoxWidth - 24 })
  doc.text(`Moneda: ${String(item.currency || "RON")}`, rightBoxX + 12, topY + 64, { width: rightBoxWidth - 24 })
  doc.text(`SPV: ${String(item.spvDownloadId || "-")}`, rightBoxX + 12, topY + 81, { width: rightBoxWidth - 24 })

  doc.y = topY + 118
  doc.font(fonts.bold).fontSize(11).text("Sumar", startX, doc.y)
  doc.moveDown(0.35)
  doc.font(fonts.regular).fontSize(10)
  doc.text(`Total fara TVA: ${fmtMoney(item.totalNet)} ${item.currency}`)
  doc.text(`Total TVA: ${fmtMoney(item.totalVat)} ${item.currency}`)
  doc.text(`Total cu TVA: ${fmtMoney(item.totalGross)} ${item.currency}`)

  doc.moveDown(0.8)
  ensureSpace(36)
  const headerY = doc.y
  doc.save()
  doc.rect(startX, headerY, pageWidth, 24).fill("#f8fafc")
  doc.restore()
  doc.font(fonts.bold).fontSize(8).fillColor("#475569")
  ;["#", "Produs", "UM", "Cant.", "Pret fara TVA", "Pret cu TVA", "TVA%", "TVA", "Total"].forEach((label, index) => {
    doc.text(label, colX[index] + 4, headerY + 8, {
      width: colWidths[index] - 8,
      align: index === 0 ? "center" : "left",
    })
  })
  doc.y = headerY + 26

  doc.font(fonts.regular).fontSize(9).fillColor("#111827")
  for (const line of item.items) {
    const cells = [
      String(line.lineIndex || "-"),
      String(line.productName || "-"),
      String(line.uomCode || "-"),
      String(toNumber(line.qty).toFixed(2)),
      `${fmtMoney(line.unitPrice)} ${item.currency}`,
      `${fmtMoney(toNumber(line.unitPrice) * (1 + toNumber(line.vatRate) / 100))} ${item.currency}`,
      fmtMoney(line.vatRate),
      `${fmtMoney(line.lineVat)} ${item.currency}`,
      `${fmtMoney(line.lineGross)} ${item.currency}`,
    ]
    const rowHeight =
      Math.max(
        22,
        doc.heightOfString(cells[1], { width: colWidths[1] - 8, align: "left" }) + 10
      )
    ensureSpace(rowHeight + 2)
    const rowY = doc.y
    doc.save()
    doc.rect(startX, rowY, pageWidth, rowHeight).stroke("#e2e8f0")
    doc.restore()
    cells.forEach((cell, index) => {
      doc.text(cell, colX[index] + 4, rowY + 5, {
        width: colWidths[index] - 8,
        align: index === 0 ? "center" : "left",
      })
    })
    doc.y = rowY + rowHeight
  }

  if (!item.items.length) {
    ensureSpace(30)
    doc.font(fonts.regular).fontSize(10).fillColor("#64748b").text("Factura nu are pozitii importate.", startX, doc.y)
    doc.moveDown(1)
  }

  const pages = doc.bufferedPageRange()
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i)
    doc.font(fonts.regular).fontSize(8).fillColor("#64748b")
    doc.text(
      `Factura ${String(item.invoiceNo || item.spvDownloadId || "-")} • Pagina ${i + 1} / ${pages.count}`,
      startX,
      doc.page.height - 24,
      { width: pageWidth, align: "right" }
    )
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
