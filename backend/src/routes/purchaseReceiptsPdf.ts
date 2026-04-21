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
            include: {
              uom: true,
              purchaseUom: true
            }
          },
          uom: true
        },
        orderBy: { createdAt: 'asc' }
      },
      supplier: true,
      location: true
    }
  })

  if (!receipt) {
    return res.status(404).json({ ok: false, error: 'Documentul nu a fost gasit.' })
  }

  const company = await resolveTenantCompany(prisma, tenantId, companyId)
  const supplier = receipt.supplier?.name || receipt.supplierName || 'Furnizor'
  const filename = `NIR_${safeFilePart(receipt.docNo)}_${safeFilePart(supplier)}.pdf`

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 26 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)

  const margin = 26
  const pageWidth = doc.page.width
  const contentWidth = pageWidth - margin * 2
  const dark = '#111111'

  let y = margin + 6
  doc.font(fonts.bold).fontSize(14).fillColor(dark).text(pdfText(company?.name), margin, y)
  y += 16
  doc.font(fonts.regular).fontSize(8.5)
  const companyLines = [
    `CUI: ${pdfText(company?.cui)}`,
    `Nr. ord. reg. com: ${pdfText(company?.regNo)}`,
    `Sediu: ${pdfText(company?.address)}`,
    `Judetul ${pdfText(company?.county)}`,
    `Capital social: ${pdfText(company?.shareCapital)}`,
    `IBAN: ${pdfText(company?.iban)}`,
    `Banca: ${pdfText(company?.bank)}`,
  ]
  for (const line of companyLines) {
    doc.text(line, margin, y)
    y += 13
  }

  y += 4
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(dark).lineWidth(1).stroke()
  y += 36

  doc.font(fonts.bold).fontSize(18).fillColor(dark).text('NOTA DE RECEPTIE SI CONSTATARE DE DIFERENTE', margin, y)
  y += 40

  const intro = `Subsemnatii, membrii ai comisiei de receptie, am procedat la receptionarea valorilor materiale furnizate de ${supplier}, cod fiscal ${pdfText(receipt.supplier?.cif || receipt.supplierCode)}, cu documentul ${pdfText(receipt.docNo)} din data de ${pdfDate(receipt.docDate)}, constatandu-se urmatoarele:`
  doc.font(fonts.regular).fontSize(9.5).text(intro, margin, y, { width: contentWidth, align: 'left' })
  y += 52

  const isRon = receipt.currency === 'RON'
  const columns = isRon
    ? [
        { label: 'Produs', width: 180, align: 'left' },
        { label: 'Cant. doc.\n intrare', width: 104, align: 'center' },
        { label: 'Cant.', width: 104, align: 'center' },
        { label: 'UM', width: 52, align: 'center' },
        { label: 'Pret achizitie\nRON, fara TVA', width: 104, align: 'center' },
        { label: 'Pret inreg. RON,\nfara TVA', width: 104, align: 'center' },
        { label: 'TVA unitar, RON', width: 104, align: 'center' },
        { label: 'TVA total, RON', width: 104, align: 'center' },
        { label: 'Pret cu TVA,\nRON', width: 104, align: 'center' },
        { label: 'Valoare BON\nfara TVA', width: 104, align: 'center' },
        { label: 'Valoare\ninregistrare,\nRON cu TVA', width: 104, align: 'center' },
      ]
    : [
        { label: 'Produs', width: 180, align: 'left' },
        { label: 'Cant. doc.\n intrare', width: 90, align: 'center' },
        { label: 'Cant.', width: 90, align: 'center' },
        { label: 'UM', width: 44, align: 'center' },
        { label: `Pret ${receipt.currency}\nfara TVA`, width: 86, align: 'center' },
        { label: `TVA ${receipt.currency}`, width: 86, align: 'center' },
        { label: `Pret cu TVA\n${receipt.currency}`, width: 86, align: 'center' },
        { label: `Valoare\n${receipt.currency}`, width: 90, align: 'center' },
        { label: 'Valoare RON', width: 90, align: 'center' },
      ]

  const rowHeight = 52
  let x = margin
  columns.forEach((col) => {
    doc.rect(x, y, col.width, rowHeight).stroke(dark)
    doc.font(fonts.bold).fontSize(8).fillColor(dark).text(col.label, x + 4, y + 14, { width: col.width - 8, align: col.align || 'center' })
    x += col.width
  })
  y += rowHeight

  receipt.items.forEach((item) => {
    const qty = pdfNum(item.qty)
    const unitNet = pdfNum(item.unitCostNetFc)
    const unitVat = qty > 0 ? pdfNum(item.lineVatFc) / qty : 0
    const unitGross = qty > 0 ? pdfNum(item.lineGrossFc) / qty : 0
    const row = isRon
      ? [
          pdfText(item.product?.name),
          pdfFmt(qty, 0),
          pdfFmt(qty, 0),
          pdfText(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code || 'Buc'),
          pdfFmt(unitNet, 2),
          pdfFmt(unitNet, 2),
          pdfFmt(unitVat, 2),
          pdfFmt(item.lineVatFc, 2),
          pdfFmt(unitGross, 2),
          pdfFmt(item.lineNetFc, 2),
          pdfFmt(item.lineGrossRon || item.lineGrossFc, 2),
        ]
      : [
          pdfText(item.product?.name),
          pdfFmt(qty, 0),
          pdfFmt(qty, 0),
          pdfText(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code || 'Buc'),
          pdfFmt(unitNet, 2),
          pdfFmt(item.lineVatFc, 2),
          pdfFmt(unitGross, 2),
          pdfFmt(item.lineGrossFc, 2),
          pdfFmt(item.lineGrossRon, 2),
        ]

    let xx = margin
    row.forEach((cell, index) => {
      const col = columns[index]
      doc.rect(xx, y, col.width, rowHeight).stroke(dark)
      doc.font(fonts.regular).fontSize(8.5).fillColor(dark).text(cell, xx + 4, y + 12, {
        width: col.width - 8,
        align: index === 0 ? 'left' : 'center',
      })
      xx += col.width
    })
    y += rowHeight
  })

  let totalLabelX = margin
  for (let i = 0; i < columns.length - 3; i++) totalLabelX += columns[i].width
  const totalLabelW = columns.slice(0, columns.length - 3).reduce((s, c) => s + c.width, 0)
  const lastThree = columns.slice(-3)
  doc.rect(margin, y, totalLabelW, 30).stroke(dark)
  doc.font(fonts.bold).fontSize(9).text('Total, RON', margin + totalLabelW - 90, y + 10, { width: 80, align: 'right' })
  let tx = margin + totalLabelW
  const totalValues = isRon
    ? [pdfFmt(receipt.totalVatFc, 2), pdfFmt(receipt.totalNetFc, 2), pdfFmt(receipt.totalGrossRon || receipt.totalGrossFc, 2)]
    : [pdfFmt(receipt.totalVatFc, 2), pdfFmt(receipt.totalGrossFc, 2), pdfFmt(receipt.totalGrossRon, 2)]
  totalValues.forEach((value, index) => {
    doc.rect(tx, y, lastThree[index].width, 30).stroke(dark)
    doc.font(fonts.bold).fontSize(9).text(value, tx + 4, y + 10, { width: lastThree[index].width - 8, align: 'center' })
    tx += lastThree[index].width
  })
  y += 64

  doc.font(fonts.regular).fontSize(10).text('Gestionar,', pageWidth - margin - 100, y)

  doc.end()
})

export default router
