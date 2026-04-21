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
  if (!invoice) return invoice
  return {
    ...invoice,
    itemsCount: Array.isArray(invoice.items) ? invoice.items.length : 0,
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
    margin: 36,
    info: {
      Title: filename,
      Author: company?.name || "Gufo ERP",
      Subject: `Factura ${invoice.docNo}`,
    },
  })

  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 36

  const drawHeader = () => drawDocumentHero(doc, fonts, {
    title: "Factur? fiscal?",
    subtitle: "Document comercial emis din ERP",
    companyName: company?.name || "-",
    companyLines: [
      `CUI: ${pdfText(company?.cui)}`,
      `Reg. com.: ${pdfText(company?.regNo)}`,
      `Adres?: ${pdfText(company?.address)}`,
      `Email: ${pdfText(company?.email || company?.contactEmail)}`,
      `Telefon: ${pdfText(company?.phone)}`,
    ],
    rightPairs: [
      { label: 'Num?r', value: pdfText(invoice.docNo) },
      { label: 'Data', value: pdfDate(invoice.docDate) },
      { label: 'Scaden??', value: pdfDate(invoice.dueDate) },
    ],
    margin,
  })

  let y = drawHeader()
  y = drawInfoCards(doc, fonts, {
    margin,
    y,
    cards: [
      {
        title: 'Client',
        pairs: [
          { label: 'Denumire', value: pdfText(invoice.customerName) },
          { label: 'Cod', value: pdfText(invoice.customerCode) },
          { label: 'CIF', value: pdfText(invoice.customerCif) },
          { label: 'Reg. com.', value: pdfText(invoice.customerRegNo) },
        ],
      },
      {
        title: 'Detalii factur?',
        pairs: [
          { label: 'Loca?ie', value: pdfText(invoice.location?.name) },
          { label: 'Moned?', value: pdfText(invoice.currency) },
          { label: 'Curs', value: pdfFmt(invoice.fxRate, 4) },
          { label: 'Status', value: pdfText(invoice.status) },
        ],
      },
    ],
  }) + 18

  if (invoice.note) {
    doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Observa?ii', margin, y)
    y += 14
    const boxHeight = 44
    doc.roundedRect(margin, y, doc.page.width - margin * 2, boxHeight, 12).fillAndStroke('#FFFFFF', '#D7DEEA')
    doc.font(fonts.regular).fontSize(9).fillColor('#334155').text(invoice.note, margin + 12, y + 10, {
      width: doc.page.width - margin * 2 - 24,
    })
    y += boxHeight + 18
  }

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Produse ?i pre?uri', margin, y)
  y += 14

  const columns = [
    { label: '#', width: 28, align: 'center' },
    { label: 'Produs', width: 210, align: 'left' },
    { label: 'Cant.', width: 50, align: 'center' },
    { label: 'Pre?', width: 72, align: 'right' },
    { label: 'Discount', width: 58, align: 'center' },
    { label: 'TVA', width: 46, align: 'center' },
    { label: 'Total', width: 64, align: 'right' },
  ]

  const rows = []
  invoice.items.forEach((item, index) => {
    rows.push([
      String(index + 1),
      pdfText(item.product?.name),
      pdfFmt(item.qty, 2),
      `${pdfFmt(item.unitPriceFc)} ${invoice.currency}`,
      `${pdfFmt(item.discountPercent, 0)}%`,
      `${pdfFmt(item.vatRateValue, 0)}%`,
      `${pdfFmt(item.lineGrossFc)} ${invoice.currency}`,
    ])
    if (pdfNum(item.sgrTotalFc) > 0) {
      rows.push([
        '',
        'SGR automat',
        '',
        '',
        '',
        '',
        `${pdfFmt(item.sgrTotalFc)} ${invoice.currency}`,
      ])
    }
  })

  y = drawSimpleTable(doc, fonts, {
    margin,
    y,
    columns,
    rows,
    rowHeight: 24,
    drawHeader,
  }) + 18

  const totalsLines = [
    { label: 'Total f?r? TVA', value: `${pdfFmt(invoice.totalNetFc)} ${invoice.currency}` },
    { label: 'Total discount', value: `${pdfFmt(invoice.totalDiscountFc)} ${invoice.currency}` },
    { label: 'Total TVA', value: `${pdfFmt(invoice.totalVatFc)} ${invoice.currency}` },
    { label: 'Total SGR', value: `${pdfFmt(invoice.totalSgrFc)} ${invoice.currency}` },
    { label: 'Total factur?', value: `${pdfFmt(invoice.totalWithSgrFc || invoice.totalGrossFc)} ${invoice.currency}` },
  ]

  y = ensurePdfPage(doc, y, 150, margin, drawHeader)
  drawTotalsBox(doc, fonts, {
    x: doc.page.width - margin - 220,
    y,
    width: 220,
    lines: totalsLines,
    highlightLast: true,
  })

  drawSignatureRow(doc, fonts, {
    margin,
    y: y + 112,
    labels: ['?ntocmit', 'Client'],
  })

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

