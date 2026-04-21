// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"
import { drawDocumentHero, drawInfoCards, drawSimpleTable, drawSignatureRow, drawTotalsBox, ensurePdfPage, pdfDate, pdfFmt, pdfNum, pdfText, registerPdfFonts } from "../lib/professionalPdf"

const router = Router()

router.use(requireAuth)

function num(v: any) {
  return Number(v || 0)
}

function fmt(v: any, d = 2) {
  return num(v).toFixed(d)
}

function fmtDate(v: any) {
  if (!v) return "-"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function text(v: any) {
  const t = String(v || "").trim()
  return t || "-"
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
    "C:\\Windows\\Fonts\\arial.ttf"
  ]

  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf"
  ]

  const regularPath = regularCandidates.find((p) => fs.existsSync(p))
  const boldPath = boldCandidates.find((p) => fs.existsSync(p))

  if (regularPath) doc.registerFont("AppRegular", regularPath)
  if (boldPath) doc.registerFont("AppBold", boldPath)

  return {
    regular: regularPath ? "AppRegular" : "Helvetica",
    bold: boldPath ? "AppBold" : "Helvetica-Bold"
  }
}

function drawBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  doc.save()
  doc.lineWidth(0.8)
  doc.rect(x, y, w, h).stroke("#111111")
  doc.restore()
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  fonts: { regular: string; bold: string },
  options?: {
    bold?: boolean
    align?: "left" | "center" | "right" | "justify"
    fontSize?: number
    fillColor?: string | null
    paddingX?: number
    paddingY?: number
  }
) {
  const paddingX = options?.paddingX ?? 4
  const paddingY = options?.paddingY ?? 5

  if (options?.fillColor) {
    doc.save()
    doc.rect(x, y, w, h).fill(options.fillColor)
    doc.restore()
  }

  drawBox(doc, x, y, w, h)

  doc
    .font(options?.bold ? fonts.bold : fonts.regular)
    .fontSize(options?.fontSize ?? 9)
    .fillColor("#111111")
    .text(value || "", x + paddingX, y + paddingY, {
      width: w - paddingX * 2,
      height: h - paddingY * 2,
      align: options?.align ?? "left"
    })
}

router.get("/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id } = req.params

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: { id, tenantId, companyId },
    include: {
      items: {
        include: {
          product: {
            include: { uom: true, purchaseUom: true }
          },
          uom: true
        },
        orderBy: { createdAt: "asc" }
      },
      supplier: true,
      location: true
    }
  })

  if (!receipt) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
  }

  const purchaseReceipt = receipt
  const company = await resolveTenantCompany(prisma, tenantId, companyId)
  const supplier = purchaseReceipt.supplier?.name || receipt.supplierName || "Furnizor"
  const filename = `NIR_${safeFilePart(purchaseReceipt.docNo)}_${safeFilePart(supplier)}.pdf`

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 28
  const isRon = purchaseReceipt.currency === 'RON'

  const drawHeader = () => drawDocumentHero(doc, fonts, {
    title: 'Not? de recep?ie',
    subtitle: 'NIR / intrare marf?',
    companyName: company?.name || '-',
    companyLines: [
      `CUI: ${pdfText(company?.cui)}`,
      `Reg. com.: ${pdfText(company?.regNo)}`,
      `Adres?: ${pdfText(company?.address)}`,
      `Email: ${pdfText(company?.contactEmail || company?.email)}`,
      `Telefon: ${pdfText(company?.phone)}`,
    ],
    rightPairs: [
      { label: 'Document', value: pdfText(purchaseReceipt.docNo) },
      { label: 'Data', value: pdfDate(purchaseReceipt.docDate) },
      { label: 'Moned?', value: pdfText(purchaseReceipt.currency) },
    ],
    margin,
  })

  let y = drawHeader()
  y = drawInfoCards(doc, fonts, {
    margin,
    y,
    cards: [
      {
        title: 'Furnizor',
        pairs: [
          { label: 'Denumire', value: pdfText(supplier) },
          { label: 'Cod furnizor', value: pdfText(purchaseReceipt.supplier?.code || purchaseReceipt.supplierCode) },
          { label: 'Loca?ie', value: pdfText(purchaseReceipt.location?.name) },
          { label: 'Status', value: pdfText(purchaseReceipt.status) },
        ],
      },
      {
        title: 'Surs? ?i trasabilitate',
        pairs: [
          { label: 'Curs', value: isRon ? '1,0000' : pdfFmt(purchaseReceipt.fxRate, 4) },
          { label: 'Tip surs?', value: (purchaseReceipt.sourceIncomingEInvoiceId || purchaseReceipt.spvDownloadId || purchaseReceipt.spvUploadIndex || purchaseReceipt.spvInvoiceNo) ? 'RO e-Factura' : 'Intern' },
          { label: 'ID desc?rcare', value: pdfText(purchaseReceipt.spvDownloadId) },
          { label: 'Index ?nc?rcare', value: pdfText(purchaseReceipt.spvUploadIndex) },
        ],
      },
    ],
    height: 128,
  }) + 18

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Produse recep?ionate', margin, y)
  y += 14

  const columns = isRon
    ? [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 250, align: 'left' },
        { label: 'UM', width: 40, align: 'center' },
        { label: 'Cant.', width: 58, align: 'right' },
        { label: 'Pre? unitar', width: 72, align: 'right' },
        { label: 'TVA', width: 46, align: 'center' },
        { label: 'F?r? TVA', width: 82, align: 'right' },
        { label: 'TVA', width: 62, align: 'right' },
        { label: 'Cu TVA', width: 82, align: 'right' },
      ]
    : [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 228, align: 'left' },
        { label: 'UM', width: 38, align: 'center' },
        { label: 'Cant.', width: 54, align: 'right' },
        { label: 'Pre?', width: 62, align: 'right' },
        { label: 'TVA', width: 42, align: 'center' },
        { label: `${purchaseReceipt.currency} f?r? TVA`, width: 78, align: 'right' },
        { label: `${purchaseReceipt.currency} TVA`, width: 72, align: 'right' },
        { label: `${purchaseReceipt.currency} cu TVA`, width: 78, align: 'right' },
        { label: 'RON', width: 68, align: 'right' },
      ]

  const rows = []
  let runningNo = 1
  receipt.items.forEach((item) => {
    rows.push(isRon ? [
      String(runningNo++),
      pdfText(item.product?.name),
      pdfText(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code),
      pdfFmt(item.qty, 3),
      pdfFmt(item.unitCostNetFc),
      pdfFmt(item.vatRateValue, 0),
      pdfFmt(item.lineNetFc),
      pdfFmt(item.lineVatFc),
      pdfFmt(item.lineGrossFc),
    ] : [
      String(runningNo++),
      pdfText(item.product?.name),
      pdfText(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code),
      pdfFmt(item.qty, 3),
      pdfFmt(item.unitCostNetFc),
      pdfFmt(item.vatRateValue, 0),
      pdfFmt(item.lineNetFc),
      pdfFmt(item.lineVatFc),
      pdfFmt(item.lineGrossFc),
      pdfFmt(item.lineGrossRon),
    ])

    const isSgr = Boolean(item.product?.isSgr)
    const sgrUnit = isSgr ? pdfNum(item.product?.sgrValue || 0.5) : 0
    const sgrNetFc = pdfNum(item.qty) * sgrUnit
    if (isSgr && sgrNetFc > 0) {
      rows.push(isRon ? [
        String(runningNo++), 'SGR', '', pdfFmt(item.qty, 3), pdfFmt(sgrUnit), '0', pdfFmt(sgrNetFc), '0,00', pdfFmt(sgrNetFc)
      ] : [
        String(runningNo++), 'SGR', '', pdfFmt(item.qty, 3), pdfFmt(sgrUnit), '0', pdfFmt(sgrNetFc), '0,00', pdfFmt(sgrNetFc), pdfFmt(sgrNetFc * pdfNum(purchaseReceipt.fxRate || 1))
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

  const totalSgrFc = rows.filter((row) => row[1] === 'SGR').reduce((sum, row) => sum + pdfNum(isRon ? row[8] : row[8]), 0)
  const totalWithSgrFc = pdfNum(receipt.totalGrossFc) + totalSgrFc
  const totalWithSgrRon = pdfNum(receipt.totalGrossRon) + (isRon ? totalSgrFc : rows.filter((row) => row[1] === 'SGR').reduce((sum, row) => sum + pdfNum(row[9]), 0))

  drawTotalsBox(doc, fonts, {
    x: doc.page.width - margin - 240,
    y,
    width: 240,
    lines: [
      { label: 'Total f?r? TVA', value: `${pdfFmt(receipt.totalNetFc)} ${purchaseReceipt.currency}` },
      { label: 'Total TVA', value: `${pdfFmt(receipt.totalVatFc)} ${purchaseReceipt.currency}` },
      { label: 'Total SGR', value: `${pdfFmt(totalSgrFc)} ${purchaseReceipt.currency}` },
      { label: 'Total recep?ie', value: `${pdfFmt(totalWithSgrFc)} ${purchaseReceipt.currency}` },
      ...(isRon ? [] : [{ label: 'Total ?n RON', value: `${pdfFmt(totalWithSgrRon)} RON` }]),
    ],
    highlightLast: true,
  })

  drawSignatureRow(doc, fonts, {
    margin,
    y: y + 112,
    labels: ['Recep?ionat', 'Verificat', 'Aprobat'],
  })

  doc.end()
})

export default router
