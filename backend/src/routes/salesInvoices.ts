// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { getNextNumberPreview, reserveNextNumber } from "../lib/numbering"
import { generateInvoiceEFacturaXml, validateInvoiceForEFactura } from "../lib/efactura"
import { requireTenantModule } from "../lib/tenantModules"
import { readAnafHeader } from "../lib/anafHttp"
import { resolveTenantCompany } from "../lib/companyResolver"
import { drawDocumentHero, drawInfoCards, drawSimpleTable, drawSignatureRow, drawTotalsBox, ensurePdfPage, pdfDate, pdfFmt, pdfNum, pdfText, registerPdfFonts } from "../lib/professionalPdf"
import { buildCompanyScopedTenantWhere, requireRequestCompanyId } from "../lib/companyScope"
import {
  anafCheckUploadStatus,
  anafDownloadById,
  anafListMessages,
  anafUploadXml,
  loadAnafCompanyContext,
  logAnafRouteError,
} from "../lib/anafClient"
import {
  extractDownloadId,
  extractUploadIndex,
  normalizeCompanyCui,
  parseAnafPayload,
  summarizeAnafResponse,
} from "../lib/incomingEfactura"

const router = Router()

router.use(requireAuth)

function getTenantId(req: AuthedRequest) {
  return req.auth?.tenantId ?? undefined
}

function toNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeCurrency(value: any): "RON" | "EUR" | "USD" | "HUF" {
  const c = String(value || "RON").toUpperCase()
  if (c === "EUR" || c === "USD" || c === "HUF") return c
  return "RON"
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function sanitizeInvoicePdfNote(value: any) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[POS-"))
    .filter((line) => !/^Factura emisa dupa bon fiscal/i.test(line))
    .filter((line) => !/^Data bon:/i.test(line))
    .join("\n")
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

  const regularPath = regularCandidates.find((p) => fs.existsSync(p))
  const boldPath = boldCandidates.find((p) => fs.existsSync(p))

  if (regularPath) doc.registerFont("AppRegular", regularPath)
  if (boldPath) doc.registerFont("AppBold", boldPath)

  return {
    regular: regularPath ? "AppRegular" : "Helvetica",
    bold: boldPath ? "AppBold" : "Helvetica-Bold",
  }
}

async function recalcInvoice(invoiceId: string) {
  const items = await prisma.salesInvoiceItem.findMany({
    where: { invoiceId },
  })

  const totalNetFc = items.reduce((sum, item) => sum + toNumber(item.lineNetFc), 0)
  const totalDiscountFc = items.reduce((sum, item) => sum + toNumber(item.discountAmountFc), 0)
  const totalVatFc = items.reduce((sum, item) => sum + toNumber(item.lineVatFc), 0)
  const totalGrossFc = items.reduce((sum, item) => sum + toNumber(item.lineGrossFc), 0)
  const totalSgrFc = items.reduce((sum, item) => sum + toNumber(item.sgrTotalFc), 0)
  const totalNetRon = items.reduce((sum, item) => sum + toNumber(item.lineNetRon), 0)
  const totalDiscountRon = items.reduce((sum, item) => sum + toNumber(item.discountAmountRon), 0)
  const totalVatRon = items.reduce((sum, item) => sum + toNumber(item.lineVatRon), 0)
  const totalGrossRon = items.reduce((sum, item) => sum + toNumber(item.lineGrossRon), 0)
  const totalSgrRon = items.reduce((sum, item) => sum + toNumber(item.sgrTotalRon), 0)

  return prisma.salesInvoice.update({
    where: { id: invoiceId },
    data: {
      totalNetFc,
      totalDiscountFc,
      totalVatFc,
      totalGrossFc,
      totalSgrFc,
      totalWithSgrFc: totalGrossFc + totalSgrFc,
      totalNetRon,
      totalDiscountRon,
      totalVatRon,
      totalGrossRon,
      totalSgrRon,
      totalWithSgrRon: totalGrossRon + totalSgrRon,
    },
  })
}

async function replaceInvoiceItems(
  tenantId: string,
  companyId: string,
  invoiceId: string,
  fxRate: number,
  items: any[]
) {
  await prisma.salesInvoiceItem.deleteMany({
    where: { invoiceId },
  })

  for (const raw of items) {
    const productId = String(raw.productId || "")
    const qty = toNumber(raw.qty)
    const unitPriceFc = toNumber(raw.unitPriceFc)
    const vatRateValue = toNumber(raw.vatRateValue)
    const discountPercent = Math.min(100, Math.max(0, toNumber(raw.discountPercent)))

    if (!productId) throw new Error("Fiecare linie trebuie sa aiba produs.")
    if (qty <= 0) throw new Error("Cantitatea trebuie sa fie mai mare decat 0.")
    if (unitPriceFc < 0) throw new Error("Pretul trebuie sa fie mai mare sau egal cu 0.")

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        companyId,
      },
      include: {
        uom: true,
        vatRate: true,
      },
    })

    if (!product) {
      throw new Error("Produs inexistent intr-una dintre linii.")
    }

    const vat = vatRateValue || toNumber(product.vatRate?.rate)
    const lineBaseFc = qty * unitPriceFc
    const discountAmountFc = (lineBaseFc * discountPercent) / 100
    const lineNetFc = lineBaseFc - discountAmountFc
    const lineVatFc = (lineNetFc * vat) / 100
    const lineGrossFc = lineNetFc + lineVatFc
    const sgrUnitFc = product.isSgr ? toNumber(product.sgrValue) : 0
    const sgrTotalFc = qty * sgrUnitFc
    const vatCategoryCode = vat > 0 ? "S" : "Z"

    await prisma.salesInvoiceItem.create({
      data: {
        invoiceId,
        productId,
        productName: String(product.name || ""),
        productCode: String(product.sku || "").trim() || null,
        uomCode: String(product.uom?.code || "").trim() || null,
        uomStandardCode: String(product.uom?.standardCode || "").trim() || null,
        vatCategoryCode,
        qty,
        unitPriceFc,
        vatRateValue: vat,
        discountPercent,
        discountAmountFc,
        lineNetFc,
        lineVatFc,
        lineGrossFc,
        sgrUnitFc,
        sgrTotalFc,
        discountAmountRon: discountAmountFc * fxRate,
        lineNetRon: lineNetFc * fxRate,
        lineVatRon: lineVatFc * fxRate,
        lineGrossRon: lineGrossFc * fxRate,
        sgrTotalRon: sgrTotalFc * fxRate,
      },
    })
  }

  await recalcInvoice(invoiceId)
}

function enrichInvoice(invoice: any) {
  invoice = serializeInvoice(invoice)
  if (!invoice) return invoice
  return {
    ...invoice,
    itemsCount: Array.isArray(invoice.items) ? invoice.items.length : 0,
  }
}

function serializeInvoice(invoice: any) {
  if (!invoice) return invoice

  const serializeProduct = (product: any) => {
    if (!product) return product
    return {
      ...product,
      price: toNumber(product.price),
      costPrice: toNumber(product.costPrice),
      purchaseFactor: toNumber(product.purchaseFactor || 1),
      sgrValue: toNumber(product.sgrValue),
      vatRate: product.vatRate
        ? {
            ...product.vatRate,
            rate: toNumber(product.vatRate.rate),
          }
        : product.vatRate,
    }
  }

  const items = Array.isArray(invoice.items)
    ? invoice.items.map((item: any) => ({
        ...item,
        qty: toNumber(item.qty),
        unitPriceFc: toNumber(item.unitPriceFc),
        vatRateValue: toNumber(item.vatRateValue),
        discountPercent: toNumber(item.discountPercent),
        discountAmountFc: toNumber(item.discountAmountFc),
        lineNetFc: toNumber(item.lineNetFc),
        lineVatFc: toNumber(item.lineVatFc),
        lineGrossFc: toNumber(item.lineGrossFc),
        sgrUnitFc: toNumber(item.sgrUnitFc),
        sgrTotalFc: toNumber(item.sgrTotalFc),
        discountAmountRon: toNumber(item.discountAmountRon),
        lineNetRon: toNumber(item.lineNetRon),
        lineVatRon: toNumber(item.lineVatRon),
        lineGrossRon: toNumber(item.lineGrossRon),
        sgrTotalRon: toNumber(item.sgrTotalRon),
        product: serializeProduct(item.product),
      }))
    : invoice.items

  return {
    ...invoice,
    fxRate: toNumber(invoice.fxRate || 1),
    totalNetFc: toNumber(invoice.totalNetFc),
    totalDiscountFc: toNumber(invoice.totalDiscountFc),
    totalVatFc: toNumber(invoice.totalVatFc),
    totalGrossFc: toNumber(invoice.totalGrossFc),
    totalSgrFc: toNumber(invoice.totalSgrFc),
    totalWithSgrFc: toNumber(invoice.totalWithSgrFc),
    totalNetRon: toNumber(invoice.totalNetRon),
    totalDiscountRon: toNumber(invoice.totalDiscountRon),
    totalVatRon: toNumber(invoice.totalVatRon),
    totalGrossRon: toNumber(invoice.totalGrossRon),
    totalSgrRon: toNumber(invoice.totalSgrRon),
    totalWithSgrRon: toNumber(invoice.totalWithSgrRon),
    items,
  }
}

function classifyEfacturaStatus(payload: any, rawText: string) {
  const text = `${JSON.stringify(payload || {})} ${rawText}`.toLowerCase()
  if (/(nok|respins|rejected|eroare|error|invalid)/i.test(text)) return "REJECTED"
  if (/(ok|acceptat|accepted|validat|disponibil|descarcare)/i.test(text)) return "ACCEPTED"
  return "SENT"
}

async function resolveReceiptDownloadId(company: any, invoice: any) {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif || !company?.efacturaOauthAccessToken || !invoice?.efacturaUploadIndex) {
    return ""
  }

  const listResult = await anafListMessages(company, { days: 60, cif })
  const matched = listResult.items.find((item: any) => {
    const blob = JSON.stringify(item || {}).toLowerCase()
    return blob.includes(String(invoice.efacturaUploadIndex).toLowerCase())
  })

  return (
    extractDownloadId(matched, JSON.stringify(matched || {})) ||
    extractDownloadId(listResult.payload, listResult.rawText)
  )
}

router.get("/api/v1/sales-invoices", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
  })

  res.json({
    ok: true,
    invoices: invoices.map(enrichInvoice),
  })
})

router.get("/api/v1/sales-invoices/:id", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const id = req.params.id

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  return res.json({
    ok: true,
    invoice: enrichInvoice(invoice),
  })
})

router.post("/api/v1/sales-invoices/full", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const { id, header, items, issueNow } = req.body || {}

  try {
    if (!header?.locationId) {
      return res.status(400).json({ ok: false, error: "locationId este obligatoriu." })
    }

    if (!header?.docDate) {
      return res.status(400).json({ ok: false, error: "docDate este obligatoriu." })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Factura trebuie sa aiba cel putin o pozitie." })
    }

  const location = await prisma.location.findFirst({
    where: {
      id: String(header.locationId),
      tenantId,
      OR: [{ companyId }, { companyId: null }],
    },
  })

    if (!location) {
      return res.status(404).json({ ok: false, error: "Locatia nu a fost gasita." })
    }

    const customerId = header?.customerId ? String(header.customerId) : null
    let customer: any = null

    if (customerId) {
      customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          ...buildCompanyScopedTenantWhere(tenantId, companyId),
        },
      })

      if (!customer) {
        return res.status(404).json({ ok: false, error: "Clientul nu a fost gasit." })
      }
    }

    const customerName = String(customer?.name || header?.customerName || "").trim()
    if (!customerName) {
      return res.status(400).json({ ok: false, error: "Numele clientului este obligatoriu." })
    }

    const currency = normalizeCurrency(header?.currency)
    const fxRate = currency === "RON" ? 1 : toNumber(header?.fxRate)
    if (currency !== "RON" && fxRate <= 0) {
      return res.status(400).json({ ok: false, error: "Cursul valutar este obligatoriu." })
    }

    const rawDocNo = String(header?.docNo || "").trim()
    let invoiceId = id ? String(id) : ""
    let autoDocNo = ""

    if (!invoiceId) {
      const preview = await getNextNumberPreview(tenantId, "invoice")
      if (!rawDocNo || rawDocNo === preview.value) {
        autoDocNo = await prisma.$transaction((tx) => reserveNextNumber(tx, tenantId, "invoice"))
      }
    }

    const docNo = rawDocNo || autoDocNo

    if (!invoiceId) {
      const duplicate = await prisma.salesInvoice.findFirst({
        where: {
          tenantId,
          companyId,
          docNo,
        },
        select: { id: true },
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja o factura cu acest numar." })
      }

      const created = await prisma.salesInvoice.create({
        data: {
          tenantId,
          companyId,
          locationId: location.id,
          customerId: customer?.id || null,
          docNo,
          docDate: new Date(header.docDate),
          dueDate: header?.dueDate ? new Date(header.dueDate) : null,
          customerName,
          customerCode: customer?.code || (header?.customerCode ? String(header.customerCode).trim() : null),
          customerCif: customer?.cif || (header?.customerCif ? String(header.customerCif).trim() : null),
          customerRegNo: customer?.regNo || (header?.customerRegNo ? String(header.customerRegNo).trim() : null),
          customerAddress: customer?.address || (header?.customerAddress ? String(header.customerAddress).trim() : null),
          customerEmail: customer?.email || (header?.customerEmail ? String(header.customerEmail).trim() : null),
          customerPhone: customer?.phone || (header?.customerPhone ? String(header.customerPhone).trim() : null),
          currency,
          fxRate,
          efacturaStatus: "NOT_READY",
          efacturaXmlText: null,
          efacturaErrorText: null,
          efacturaPreparedAt: null,
          efacturaValidatedAt: null,
          efacturaLastCheckAt: null,
          note: header?.note ? String(header.note).trim() : null,
          status: issueNow ? "ISSUED" : "DRAFT",
        },
      })

      invoiceId = created.id
    } else {
      const existing = await prisma.salesInvoice.findFirst({
        where: {
          id: invoiceId,
          tenantId,
          companyId,
        },
      })

      if (!existing) {
        return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
      }

      if (existing.status === "CANCELLED") {
        return res.status(400).json({ ok: false, error: "Factura anulata nu mai poate fi modificata." })
      }

      const duplicate = await prisma.salesInvoice.findFirst({
        where: {
          tenantId,
          companyId,
          docNo,
          NOT: { id: invoiceId },
        },
        select: { id: true },
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja o factura cu acest numar." })
      }

      await prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          locationId: location.id,
          customerId: customer?.id || null,
          docNo,
          docDate: new Date(header.docDate),
          dueDate: header?.dueDate ? new Date(header.dueDate) : null,
          customerName,
          customerCode: customer?.code || (header?.customerCode ? String(header.customerCode).trim() : null),
          customerCif: customer?.cif || (header?.customerCif ? String(header.customerCif).trim() : null),
          customerRegNo: customer?.regNo || (header?.customerRegNo ? String(header.customerRegNo).trim() : null),
          customerAddress: customer?.address || (header?.customerAddress ? String(header.customerAddress).trim() : null),
          customerEmail: customer?.email || (header?.customerEmail ? String(header.customerEmail).trim() : null),
          customerPhone: customer?.phone || (header?.customerPhone ? String(header.customerPhone).trim() : null),
          currency,
          fxRate,
          efacturaStatus: "NOT_READY",
          efacturaXmlText: null,
          efacturaErrorText: null,
          efacturaPreparedAt: null,
          efacturaValidatedAt: null,
          efacturaLastCheckAt: new Date(),
          note: header?.note ? String(header.note).trim() : null,
          status: issueNow ? "ISSUED" : existing.status,
        },
      })
    }

    await replaceInvoiceItems(tenantId, companyId, invoiceId, fxRate, items)

    const invoice = await prisma.salesInvoice.findFirst({
      where: { id: invoiceId, tenantId, companyId },
      include: {
        location: true,
        customer: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    if (!invoice) {
      return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
    }

    return res.json({
      ok: true,
      invoice: enrichInvoice(invoice),
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut salva factura.",
    })
  }
})

router.get("/api/v1/sales-invoices/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)
  const id = req.params.id

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)
  const filename = `Factura_${safeFilePart(invoice.docNo)}_${safeFilePart(invoice.customerName)}.pdf`
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({
    size: "A4",
    margin: 34,
    info: {
      Title: filename,
      Author: company?.name || "Gufo ERP",
      Subject: `Factura ${invoice.docNo}`,
    },
  })

  const fonts = registerPdfFonts(doc)
  doc.pipe(res)

  const margin = 34
  const pageWidth = doc.page.width
  const contentWidth = pageWidth - margin * 2
  const dark = '#151515'
  const muted = '#667085'
  const line = '#c8d0d8'
  const panel = '#f8fafc'

  const drawFieldBlock = (title: string, lines: string[], x: number, top: number, width: number) => {
    doc.font(fonts.bold).fontSize(11).fillColor(dark).text(title, x, top, { width })
    let yy = top + 18
    lines.filter(Boolean).forEach((entry) => {
      const h = doc.heightOfString(entry, { width, align: 'left' })
      doc.font(fonts.regular).fontSize(9.5).fillColor(dark).text(entry, x, yy, { width, align: 'left' })
      yy += h + 4
    })
    return yy
  }

  let y = margin
  doc.font(fonts.bold).fontSize(28).fillColor(dark).text('FACTURA', margin, y, { width: contentWidth })
  y += 36

  doc.save()
  doc.roundedRect(margin, y, contentWidth, 34, 10).fillAndStroke(panel, line)
  doc.restore()
  doc.font(fonts.bold).fontSize(9.5).fillColor(dark).text(`Seria / Numar: ${pdfText(invoice.docNo)}`, margin + 12, y + 10)
  doc.font(fonts.regular).fontSize(9.5).text(`Data: ${pdfDate(invoice.docDate)}`, margin + 188, y + 10)
  doc.text(`Scadenta: ${pdfDate(invoice.dueDate || invoice.docDate)}`, margin + 332, y + 10)
  doc.text(`Moneda: ${pdfText(invoice.currency || 'RON')}`, pageWidth - margin - 132, y + 10, { width: 120, align: 'right' })
  y += 50

  const colGap = 24
  const blockWidth = (contentWidth - colGap) / 2
  const supplierLines = [
    pdfText(company?.name),
    `CIF: ${pdfText(company?.cui)}`,
    `Reg. com.: ${pdfText(company?.regNo)}`,
    `Adresa: ${pdfText(company?.address)}`,
    `Judet: ${pdfText(company?.county)}`,
    `Banca: ${pdfText(company?.bank)}`,
    `IBAN: ${pdfText(company?.iban)}`,
    `Telefon: ${pdfText(company?.phone)}`,
    `Email: ${pdfText(company?.email || company?.contactEmail)}`,
  ]
  const clientLines = [
    pdfText(invoice.customerName),
    `CIF: ${pdfText(invoice.customerCif)}`,
    `Reg. com.: ${pdfText(invoice.customerRegNo)}`,
    `Adresa: ${pdfText(invoice.customerAddress)}`,
    `Judet: ${pdfText(invoice.customerCounty)}`,
    `Tara: ${pdfText(invoice.customerCountry || 'RO')}`,
    `Email: ${pdfText(invoice.customerEmail)}`,
  ]

  const supplierEndY = drawFieldBlock('FURNIZOR', supplierLines, margin, y, blockWidth)
  const clientEndY = drawFieldBlock('CLIENT', clientLines, margin + blockWidth + colGap, y, blockWidth)
  y = Math.max(supplierEndY, clientEndY) + 16

  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(line).lineWidth(1).stroke()
  y += 16

  const cols = [22, 202, 40, 46, 78, 64, 75]
  const headers = ['#', 'Denumire', 'U.M.', 'Cant.', 'Pret fara TVA', 'Valoare', 'Valoare TVA']
  let x = margin
  headers.forEach((header, index) => {
    const align = index === 1 ? 'left' : index === 0 ? 'center' : 'right'
    doc.font(fonts.bold).fontSize(9).fillColor(dark).text(header, x + 3, y, { width: cols[index] - 6, align })
    x += cols[index]
  })
  y += 16
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(line).lineWidth(1.1).stroke()
  y += 8

  invoice.items.forEach((item, index) => {
    const productTitle = pdfText(item.productName || item.product?.name)
    const subline = [
      item.productName === "SGR" ? null : item.product?.serialNo ? `Serie: ${pdfText(item.product.serialNo)}` : null,
      item.productName === "SGR" ? null : item.product?.ncCode ? `Cod NC: ${pdfText(item.product.ncCode)}` : null,
    ].filter(Boolean).join('   ')
    const titleHeight = doc.heightOfString(productTitle, { width: cols[1] - 8 })
    const subHeight = subline ? doc.heightOfString(subline, { width: cols[1] - 8 }) + 3 : 0
    const rowHeight = Math.max(22, titleHeight + subHeight + 4)
    let xx = margin

    doc.font(fonts.regular).fontSize(9).fillColor(dark).text(String(index + 1), xx + 2, y, { width: cols[0] - 4, align: 'center' })
    xx += cols[0]

    doc.font(fonts.regular).fontSize(9).fillColor(dark).text(productTitle, xx + 2, y, { width: cols[1] - 4, align: 'left' })
    if (subline) {
      doc.font(fonts.regular).fontSize(7.6).fillColor(muted).text(subline, xx + 2, y + titleHeight + 2, { width: cols[1] - 4, align: 'left' })
    }
    xx += cols[1]

    doc.font(fonts.regular).fontSize(9).fillColor(dark).text(pdfText(item.uomCode || item.product?.uom?.code || 'BUC').toUpperCase(), xx + 2, y, { width: cols[2] - 4, align: 'center' })
    xx += cols[2]
    doc.text(pdfFmt(item.qty, 0), xx + 2, y, { width: cols[3] - 4, align: 'right' })
    xx += cols[3]
    doc.text(pdfFmt(item.unitPriceFc), xx + 2, y, { width: cols[4] - 4, align: 'right' })
    xx += cols[4]
    doc.text(pdfFmt(item.lineNetFc), xx + 2, y, { width: cols[5] - 4, align: 'right' })
    xx += cols[5]
    doc.text(pdfFmt(item.lineVatFc), xx + 2, y, { width: cols[6] - 4, align: 'right' })

    y += rowHeight
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(line).lineWidth(0.7).stroke()
    y += 7
  })

  const totalsBoxW = 214
  const totalsX = pageWidth - margin - totalsBoxW
  const noteW = contentWidth - totalsBoxW - 16
  const observations = sanitizeInvoicePdfNote(invoice.note)

  if (observations) {
    doc.font(fonts.bold).fontSize(9.5).fillColor(dark).text('Observatii', margin, y + 2, { width: noteW })
    doc.font(fonts.regular).fontSize(9).fillColor(dark).text(pdfText(observations), margin, y + 18, { width: noteW })
  }

  doc.save()
  doc.roundedRect(totalsX, y, totalsBoxW, 80, 10).fillAndStroke('#ffffff', line)
  doc.restore()
  doc.font(fonts.regular).fontSize(9.5).fillColor(dark).text('Total fara TVA', totalsX + 12, y + 12, { width: 110 })
  doc.text(pdfFmt(invoice.totalNetFc), totalsX + 120, y + 12, { width: 82, align: 'right' })
  doc.text('TVA', totalsX + 12, y + 30, { width: 110 })
  doc.text(pdfFmt(invoice.totalVatFc), totalsX + 120, y + 30, { width: 82, align: 'right' })
  doc.font(fonts.bold).fontSize(10.5).text('Total factura', totalsX + 12, y + 52, { width: 110 })
  doc.font(fonts.bold).fontSize(15).fillColor(dark).text(pdfFmt(invoice.totalWithSgrFc || invoice.totalGrossFc), totalsX + 120, y + 48, { width: 82, align: 'right' })
  y += 106

  doc.end()
})

router.post("/api/v1/sales-invoices/:id/efactura/prepare", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)

  const validation = validateInvoiceForEFactura(invoice, company)
  const now = new Date()

  if (!validation.ok) {
    const errorText = validation.errors.map((issue) => issue.message).join(" ")

    const updated = await prisma.salesInvoice.update({
      where: { id },
      data: {
        efacturaStatus: "NOT_READY",
        efacturaXmlText: null,
        efacturaErrorText: errorText || null,
        efacturaValidatedAt: now,
        efacturaLastCheckAt: now,
      },
      include: {
        location: true,
        customer: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "PREPARE",
        success: false,
        message: errorText || "Factura nu a trecut validarea locala.",
        payload: validation,
      },
    })

    return res.status(400).json({
      ok: false,
      error: errorText || "Factura nu a trecut validarea locala pentru e-Factura.",
      validation,
      invoice: enrichInvoice(updated),
    })
  }

  const xml = generateInvoiceEFacturaXml(invoice, company)

  const updated = await prisma.salesInvoice.update({
    where: { id },
    data: {
      efacturaStatus: "PREPARED",
      efacturaXmlText: xml,
      efacturaErrorText: validation.warnings.map((issue) => issue.message).join(" ") || null,
      efacturaPreparedAt: now,
      efacturaValidatedAt: now,
      efacturaLastCheckAt: now,
    },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  await prisma.eFacturaLog.create({
    data: {
      tenantId,
      invoiceId: id,
      stage: "PREPARE",
      success: true,
      message: "Factura a fost validata local si XML-ul a fost generat.",
      payload: { warnings: validation.warnings },
    },
  })

  return res.json({
    ok: true,
    validation,
    invoice: enrichInvoice(updated),
  })
})

router.get("/api/v1/sales-invoices/:id/efactura/xml", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    select: {
      docNo: true,
      customerName: true,
      efacturaXmlText: true,
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  if (!invoice.efacturaXmlText) {
    return res.status(404).json({ ok: false, error: "Factura nu are inca XML e-Factura pregatit." })
  }

  const filename = `eFactura_${safeFilePart(invoice.docNo)}_${safeFilePart(invoice.customerName)}.xml`
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  return res.send(invoice.efacturaXmlText)
})

router.get("/api/v1/sales-invoices/:id/efactura/logs", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id
  const logs = await prisma.eFacturaLog.findMany({
    where: { tenantId, invoiceId: id, invoice: { companyId } },
    orderBy: { createdAt: "desc" },
  })

  return res.json({
    ok: true,
    logs,
  })
})

router.post("/api/v1/sales-invoices/:id/efactura/send", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  if (invoice.status !== "ISSUED") {
    return res.status(400).json({ ok: false, error: "Factura trebuie emisa in ERP inainte de trimiterea la ANAF." })
  }

  if (!invoice.efacturaXmlText) {
    return res.status(400).json({ ok: false, error: "Factura nu are inca XML e-Factura pregatit. Ruleaza mai intai Pregateste e-Factura." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)

  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    return res.status(400).json({ ok: false, error: "Firma nu are CUI valid pentru transmiterea la ANAF." })
  }

  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul ANAF." })
  }

  try {
    const uploadResult = await anafUploadXml(company, invoice.efacturaXmlText)
    const uploadIndex = uploadResult.uploadIndex
    const summary = uploadResult.summary

    if (!uploadResult.response.ok || !uploadIndex) {
      await prisma.eFacturaLog.create({
        data: {
          tenantId,
          invoiceId: id,
          stage: "SEND",
          success: false,
          message: summary || "ANAF a respins upload-ul e-Factura.",
          payload: uploadResult.payload || { rawText: uploadResult.rawText, url: uploadResult.url },
        },
      })

      await prisma.salesInvoice.update({
        where: { id },
        data: {
          efacturaStatus: "ERROR",
          efacturaErrorText: summary || "ANAF a respins upload-ul e-Factura.",
          efacturaLastCheckAt: new Date(),
        },
      })

      return res.status(400).json({
        ok: false,
        error: summary || "ANAF a respins upload-ul e-Factura.",
      })
    }

    const updated = await prisma.salesInvoice.update({
      where: { id },
      data: {
        efacturaStatus: "SENT",
        efacturaUploadIndex: uploadIndex,
        efacturaSentAt: new Date(),
        efacturaLastCheckAt: new Date(),
        efacturaErrorText: summary || null,
      },
      include: {
        location: true,
        customer: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "SEND",
        success: true,
        message: summary || "Factura a fost transmisa la ANAF.",
        payload: uploadResult.payload || { rawText: uploadResult.rawText, uploadIndex, url: uploadResult.url },
      },
    })

    return res.json({
      ok: true,
      message: summary || "Factura a fost transmisa la ANAF.",
      uploadIndex,
      invoice: enrichInvoice(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la trimiterea facturii catre ANAF."
    logAnafRouteError("SALES EFACTURA SEND ERROR", {
      tenantId,
      invoiceId: id,
      uploadIndex: null,
      message,
      stack: error?.stack || null,
    })
    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "SEND",
        success: false,
        message,
        payload: { error: message },
      },
    })

    await prisma.salesInvoice.update({
      where: { id },
      data: {
        efacturaStatus: "ERROR",
        efacturaErrorText: message,
        efacturaLastCheckAt: new Date(),
      },
    })

    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/sales-invoices/:id/efactura/status", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    include: {
      location: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  if (!invoice.efacturaUploadIndex) {
    return res.status(400).json({ ok: false, error: "Factura nu a fost transmisa inca la ANAF." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)

  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  try {
    const statusResult = await anafCheckUploadStatus(company, invoice.efacturaUploadIndex)
    const summary = statusResult.summary
    const nextStatus = classifyEfacturaStatus(statusResult.payload, statusResult.rawText)
    const downloadId = statusResult.downloadId || invoice.efacturaDownloadId || null

    if (!statusResult.response.ok) {
      await prisma.eFacturaLog.create({
        data: {
          tenantId,
          invoiceId: id,
          stage: "STATUS",
          success: false,
          message: summary || "Nu am putut verifica starea la ANAF.",
          payload: statusResult.payload || { rawText: statusResult.rawText, url: statusResult.url },
        },
      })

      return res.status(400).json({
        ok: false,
        error: summary || "Nu am putut verifica starea la ANAF.",
      })
    }

    const updated = await prisma.salesInvoice.update({
      where: { id },
      data: {
        efacturaStatus: nextStatus as any,
        efacturaDownloadId: downloadId,
        efacturaLastCheckAt: new Date(),
        efacturaErrorText: summary || null,
      },
      include: {
        location: true,
        customer: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                vatRate: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "STATUS",
        success: true,
        message: summary || "Starea facturii a fost verificata la ANAF.",
        payload: statusResult.payload || { rawText: statusResult.rawText, downloadId, url: statusResult.url },
      },
    })

    return res.json({
      ok: true,
      status: nextStatus,
      downloadId,
      message: summary || "Starea facturii a fost verificata la ANAF.",
      invoice: enrichInvoice(updated),
    })
  } catch (error: any) {
    const message = error?.message || "Eroare la verificarea starii in ANAF."
    logAnafRouteError("SALES EFACTURA STATUS ERROR", {
      tenantId,
      invoiceId: id,
      uploadIndex: invoice.efacturaUploadIndex || null,
      message,
      stack: error?.stack || null,
    })
    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "STATUS",
        success: false,
        message,
        payload: { error: message },
      },
    })

    return res.status(500).json({ ok: false, error: message })
  }
})

router.get("/api/v1/sales-invoices/:id/efactura/receipt", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const id = req.params.id
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
    select: {
      id: true,
      docNo: true,
      customerName: true,
      efacturaUploadIndex: true,
      efacturaDownloadId: true,
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  const company = await loadAnafCompanyContext(tenantId, req.auth?.activeCompanyId)

  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({ ok: false, error: "Nu exista token ANAF salvat pentru aceasta firma." })
  }

  let downloadId = invoice.efacturaDownloadId || ""
  if (!downloadId) {
    downloadId = await resolveReceiptDownloadId(company, invoice)
  }

  if (!downloadId) {
    return res.status(400).json({ ok: false, error: "Recipisa nu este inca disponibila pentru aceasta factura." })
  }

  try {
    const receiptResult = await anafDownloadById(company, downloadId)
    const buffer = receiptResult.response.buffer
    const rawText = buffer.toString("utf8")
    const payload = parseAnafPayload(rawText)
    const summary = receiptResult.response.ok ? "Recipisa ANAF a fost descarcata." : summarizeAnafResponse(payload, rawText)

    if (!receiptResult.response.ok) {
      await prisma.eFacturaLog.create({
        data: {
          tenantId,
          invoiceId: id,
          stage: "DOWNLOAD",
          success: false,
          message: summary || "Nu am putut descarca recipisa ANAF.",
          payload: payload || { rawText, url: receiptResult.url },
        },
      })

      return res.status(400).json({
        ok: false,
        error: summary || "Nu am putut descarca recipisa ANAF.",
      })
    }

    await prisma.salesInvoice.update({
      where: { id },
      data: {
        efacturaDownloadId: downloadId,
        efacturaDownloadedAt: new Date(),
        efacturaLastCheckAt: new Date(),
      },
    })

    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "DOWNLOAD",
        success: true,
        message: "Recipisa ANAF a fost descarcata.",
        payload: { downloadId, url: receiptResult.url },
      },
    })

    const fileNameBase = `Recipisa_eFactura_${safeFilePart(invoice.docNo)}_${safeFilePart(invoice.customerName)}`
    const contentType = readAnafHeader(receiptResult.response.headers, "content-type") || "application/octet-stream"
    const extension =
      contentType.includes("zip") ? "zip" :
      contentType.includes("pdf") ? "pdf" :
      contentType.includes("xml") ? "xml" :
      "bin"

    res.setHeader("Content-Type", contentType)
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameBase}.${extension}"`)
    return res.send(buffer)
  } catch (error: any) {
    const message = error?.message || "Eroare la descarcarea recipisei ANAF."
    logAnafRouteError("SALES EFACTURA RECEIPT ERROR", {
      tenantId,
      invoiceId: id,
      downloadId: downloadId || null,
      message,
      stack: error?.stack || null,
    })
    await prisma.eFacturaLog.create({
      data: {
        tenantId,
        invoiceId: id,
        stage: "DOWNLOAD",
        success: false,
        message,
        payload: { error: message },
      },
    })

    return res.status(500).json({ ok: false, error: message })
  }
})

router.post("/api/v1/sales-invoices/:id/cancel", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const id = req.params.id

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenantId, companyId },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura nu a fost gasita." })
  }

  const cancelled = await prisma.salesInvoice.update({
    where: { id },
    data: {
      status: "CANCELLED",
    },
  })

  return res.json({
    ok: true,
    invoice: cancelled,
  })
})

export default router

