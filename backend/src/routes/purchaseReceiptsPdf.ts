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

type PdfColumn = {
  label: string
  width: number
  align: "left" | "center" | "right"
}

function num(v: unknown) {
  return Number(v || 0)
}

function fmt(v: unknown, d = 2) {
  return num(v).toFixed(d)
}

function toDateInput(v: unknown): string | number | Date | null {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === "string" || typeof v === "number") return v
  return null
}

function fmtDate(v: unknown) {
  const dateInput = toDateInput(v)
  if (!dateInput) return "-"
  const d = new Date(dateInput)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function text(v: unknown) {
  const t = String(v || "").trim()
  return t || "-"
}

function safeFilePart(value: unknown) {
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
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant lipsa in sesiune." })
  }

  const companyId = String((await requireRequestCompanyId(req)) || "").trim()
  if (!companyId) {
    return res.status(400).json({ ok: false, error: "Firma activa lipsa." })
  }

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

  let y = margin + 4
  doc.font(fonts.bold).fontSize(13).fillColor(dark).text(pdfText(company?.name), margin, y)
  y += 15
  doc.font(fonts.regular).fontSize(8.2)
  const companyLines = [
    `CUI: ${pdfText(company?.cui)}`,
    `Nr. ord. reg. com: ${pdfText(company?.regNo)}`,
    `Sediu: ${pdfText(company?.address)}`,
    `Judetul ${pdfText(company?.county)}`,
    `IBAN: ${pdfText(company?.iban)}`,
    `Banca: ${pdfText(company?.bank)}`,
  ]
  for (const line of companyLines) {
    doc.text(line, margin, y)
    y += 11
  }

  y += 4
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(dark).lineWidth(1).stroke()
  y += 24

  doc.font(fonts.bold).fontSize(17).fillColor(dark).text('NOTA DE RECEPTIE SI CONSTATARE DE DIFERENTE', margin, y)
  y += 24

  const intro = `Subsemnatii, membrii ai comisiei de receptie, am procedat la receptionarea valorilor materiale furnizate de ${supplier}, cod fiscal ${pdfText(receipt.supplier?.cif || receipt.supplierCode)}, cu documentul ${pdfText(receipt.docNo)} din data de ${pdfDate(receipt.docDate)}, constatandu-se urmatoarele:`
  doc.font(fonts.regular).fontSize(9).text(intro, margin, y, { width: contentWidth, align: 'left' })
  y += 34

  const isRon = receipt.currency === 'RON'
  const columns: PdfColumn[] = isRon
    ? [
        { label: 'Produs', width: 170, align: 'left' },
        { label: 'Cant. doc.\nintrare', width: 68, align: 'center' },
        { label: 'Cant.', width: 60, align: 'center' },
        { label: 'UM', width: 38, align: 'center' },
        { label: 'Pret achizitie\nRON fara TVA', width: 72, align: 'center' },
        { label: 'Pret inreg.\nRON fara TVA', width: 72, align: 'center' },
        { label: 'TVA unitar\nRON', width: 72, align: 'center' },
        { label: 'TVA total\nRON', width: 72, align: 'center' },
        { label: 'Valoare\nfara TVA', width: 82, align: 'center' },
        { label: 'Valoare inreg.\nRON cu TVA', width: 83, align: 'center' },
      ]
    : [
        { label: 'Produs', width: 210, align: 'left' },
        { label: 'Cant. doc.\nintrare', width: 72, align: 'center' },
        { label: 'Cant.', width: 64, align: 'center' },
        { label: 'UM', width: 42, align: 'center' },
        { label: `Pret ${receipt.currency}\nfara TVA`, width: 90, align: 'center' },
        { label: `TVA ${receipt.currency}`, width: 82, align: 'center' },
        { label: `Pret cu TVA\n${receipt.currency}`, width: 90, align: 'center' },
        { label: `Valoare\n${receipt.currency}`, width: 92, align: 'center' },
        { label: 'Valoare RON', width: 95, align: 'center' },
      ]

  const headerHeight = 42
  let x = margin
  columns.forEach((col) => {
    doc.rect(x, y, col.width, headerHeight).stroke(dark)
    doc.font(fonts.bold).fontSize(7.6).fillColor(dark).text(col.label, x + 3, y + 10, { width: col.width - 6, align: col.align || 'center' })
    x += col.width
  })
  y += headerHeight

  receipt.items.forEach((item) => {
    const qty = pdfNum(item.qty)
    const unitNet = pdfNum(item.unitCostNetFc)
    const unitVat = qty > 0 ? pdfNum(item.lineVatFc) / qty : 0
    const unitGross = qty > 0 ? pdfNum(item.lineGrossFc) / qty : 0
    const productName = pdfText(item.product?.name)
    const productHeight = doc.heightOfString(productName, { width: columns[0].width - 8, align: 'left' })
    const rowHeight = Math.max(28, productHeight + 10)
    const row = isRon
      ? [
          productName,
          pdfFmt(qty, 0),
          pdfFmt(qty, 0),
          pdfText(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code || 'Buc'),
          pdfFmt(unitNet, 2),
          pdfFmt(unitNet, 2),
          pdfFmt(unitVat, 2),
          pdfFmt(item.lineVatFc, 2),
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
      doc.font(fonts.regular).fontSize(8.2).fillColor(dark).text(cell, xx + 4, y + 7, {
        width: col.width - 8,
        align: index === 0 ? 'left' : 'center',
      })
      xx += col.width
    })
    y += rowHeight
  })

  const totalLabelW = columns.slice(0, columns.length - 3).reduce((s, c) => s + c.width, 0)
  const lastThree = columns.slice(-3)
  doc.rect(margin, y, totalLabelW, 30).stroke(dark)
  doc.font(fonts.bold).fontSize(9).text(`Total${isRon ? ', RON' : ''}`, margin + totalLabelW - 90, y + 10, { width: 80, align: 'right' })
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
