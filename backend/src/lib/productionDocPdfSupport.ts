import type PDFDocument from "pdfkit"

export function formatProductionPdfDate(value?: Date | string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

export function formatProductionPdfNumber(value?: number | null, digits = 2) {
  return Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function getProductionPdfPageWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right
}

export function getProductionPdfBottomLimit(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.bottom
}

export function ensureProductionPdfSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > getProductionPdfBottomLimit(doc)) {
    doc.addPage()
  }
}

export function drawProductionTableHeader(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  widths: number[],
  headers: string[],
  rowHeight = 30,
) {
  let x = startX

  for (let i = 0; i < headers.length; i++) {
    const width = widths[i]

    doc.save()
    doc.rect(x, startY, width, rowHeight).fill("#dbe7f5")
    doc.restore()

    doc.save()
    doc.rect(x, startY, width, rowHeight).lineWidth(0.7).strokeColor("#cbd5e1").stroke()
    doc.restore()

    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text(headers[i], x + 10, startY + 9, {
        width: width - 20,
        align: i === headers.length - 1 ? "right" : "left",
        ellipsis: true,
      })

    x += width
  }

  return startY + rowHeight
}

export function drawProductionTableRow(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  widths: number[],
  values: string[],
  rowHeight = 28,
) {
  let x = startX

  for (let i = 0; i < values.length; i++) {
    const width = widths[i]

    doc.save()
    doc.rect(x, startY, width, rowHeight).fill("#ffffff")
    doc.restore()

    doc.save()
    doc.rect(x, startY, width, rowHeight).lineWidth(0.6).strokeColor("#dbe3ee").stroke()
    doc.restore()

    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text(values[i], x + 10, startY + 8, {
        width: width - 20,
        align: i === values.length - 1 ? "right" : "left",
        ellipsis: true,
      })

    x += width
  }

  return startY + rowHeight
}

export function drawProductionTableSection(params: {
  doc: PDFKit.PDFDocument
  title: string
  headers: string[]
  rows: string[][]
  widths: number[]
  startX: number
  rowHeight?: number
  headerHeight?: number
}) {
  const {
    doc,
    title,
    headers,
    rows,
    widths,
    startX,
    rowHeight = 28,
    headerHeight = 30,
  } = params

  const pageWidth = getProductionPdfPageWidth(doc)
  const sectionTitleHeight = 34
  const minRequired = sectionTitleHeight + headerHeight + rowHeight

  ensureProductionPdfSpace(doc, minRequired)

  const drawSectionHeader = () => {
    doc
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor("#0f172a")
      .text(title, doc.page.margins.left, doc.y, {
        width: pageWidth,
        align: "center",
      })

    doc.moveDown(0.6)
    const nextY = drawProductionTableHeader(doc, startX, doc.y, widths, headers, headerHeight)
    doc.y = nextY
  }

  drawSectionHeader()

  if (rows.length === 0) {
    if (doc.y + rowHeight > getProductionPdfBottomLimit(doc)) {
      doc.addPage()
      drawSectionHeader()
    }

    const nextY = drawProductionTableRow(
      doc,
      startX,
      doc.y,
      widths,
      ["-", "Nu exista date", "-", "-"],
      rowHeight,
    )
    doc.y = nextY + 16
    return
  }

  for (const row of rows) {
    if (doc.y + rowHeight > getProductionPdfBottomLimit(doc)) {
      doc.addPage()
      drawSectionHeader()
    }

    const nextY = drawProductionTableRow(doc, startX, doc.y, widths, row, rowHeight)
    doc.y = nextY
  }

  doc.moveDown(1)
}
