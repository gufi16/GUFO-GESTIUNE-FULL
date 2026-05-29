// @ts-nocheck
import fs from "fs"
import PDFDocument from "pdfkit"
import { repairText } from "./textRepair"

type Fonts = {
  regular: string
  bold: string
}

type Pair = {
  label: string
  value: string
}

type TableColumn = {
  label: string
  width: number
  align?: "left" | "center" | "right"
}

export function registerPdfFonts(doc: PDFKit.PDFDocument): Fonts {
  const regularCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:\Windows\Fonts\arial.ttf",
  ]

  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:\Windows\Fonts\arialbd.ttf",
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

export function pdfText(value: any) {
  const raw = repairText(value).trim()
  if (!raw) return "-"

  const repaired = raw
    .replace(/�/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .trim()

  return repaired || "-"
}

export function pdfNum(value: any) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function pdfDate(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

export function pdfDateTime(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("ro-RO")
}

export function pdfFmt(value: any, digits = 2) {
  return pdfNum(value).toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function drawPanel(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, options?: { fill?: string | null; stroke?: string | null; radius?: number }) {
  const fill = options?.fill ?? null
  const stroke = options?.stroke ?? "#D7DEEA"
  const radius = options?.radius ?? 12
  doc.save()
  if (fill) {
    doc.roundedRect(x, y, w, h, radius).fill(fill)
  }
  if (stroke) {
    doc.lineWidth(0.8).strokeColor(stroke).roundedRect(x, y, w, h, radius).stroke()
  }
  doc.restore()
}

export function drawDocumentHero(doc: PDFKit.PDFDocument, fonts: Fonts, options: {
  title: string
  subtitle?: string
  companyName: string
  companyLines: string[]
  rightPairs: Pair[]
  margin: number
}) {
  const margin = options.margin
  const width = doc.page.width - margin * 2
  const leftW = Math.min(250, width * 0.27)
  const rightW = Math.min(170, width * 0.22)
  const centerW = width - leftW - rightW
  const y = margin
  const centerX = margin + leftW
  const rightX = centerX + centerW
  const heroHeight = 86

  doc.save()
  doc.lineWidth(0.8).strokeColor("#CBD5E1").rect(margin, y, width, heroHeight).stroke()
  doc.moveTo(centerX, y).lineTo(centerX, y + heroHeight).stroke()
  doc.moveTo(rightX, y).lineTo(rightX, y + heroHeight).stroke()
  doc.restore()

  doc.font(fonts.bold).fontSize(12.5).fillColor("#111827").text(options.companyName || "Companie", margin + 12, y + 16, {
    width: leftW - 24,
    align: "left",
  })
  if (options.subtitle) {
    doc.font(fonts.regular).fontSize(8.8).fillColor("#334155").text(options.subtitle, margin + 12, y + 34, {
      width: leftW - 24,
      align: "left",
    })
  }

  doc.font(fonts.bold).fontSize(17).fillColor("#111827").text(options.title, centerX + 16, y + 12, {
    width: centerW - 32,
    align: "center",
  })

  let lineY = y + 18
  for (const pair of options.rightPairs.slice(0, 4)) {
    doc.font(fonts.regular).fontSize(9).fillColor("#111827").text(`${pair.label}: ${pair.value || "-"}`, rightX + 12, lineY, {
      width: rightW - 24,
      align: "left",
    })
    lineY += 14
  }

  return y + heroHeight + 18
}

export function drawInfoCards(doc: PDFKit.PDFDocument, fonts: Fonts, options: {
  margin: number
  y: number
  cards: Array<{ title: string; pairs: Pair[] }>
  height?: number
}) {
  const gap = 14
  const width = doc.page.width - options.margin * 2
  const count = options.cards.length
  const cardW = (width - gap * (count - 1)) / count
  const cardH = options.height ?? 118

  options.cards.forEach((card, index) => {
    const x = options.margin + index * (cardW + gap)
    doc.save()
    doc.lineWidth(0.8).strokeColor("#CBD5E1").rect(x, options.y, cardW, cardH).stroke()
    doc.restore()
    doc.font(fonts.bold).fontSize(10.5).fillColor("#0F172A").text(card.title, x + 12, options.y + 12, {
      width: cardW - 28,
    })
    let y = options.y + 34
    for (const pair of card.pairs.slice(0, 4)) {
      doc.save()
      doc.rect(x, y, 88, 22).fill("#E8EEF6")
      doc.restore()
      doc.save()
      doc.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, y, cardW, 22).stroke()
      doc.restore()
      doc.font(fonts.bold).fontSize(8.3).fillColor("#334155").text(pair.label, x + 8, y + 7, { width: 72 })
      doc.font(fonts.regular).fontSize(8.8).fillColor("#111827").text(pair.value || "-", x + 98, y + 6, { width: cardW - 108 })
      y += 22
    }
  })

  return options.y + cardH
}

export function ensurePdfPage(doc: PDFKit.PDFDocument, y: number, needed: number, margin: number, drawHeader?: () => number) {
  const limit = doc.page.height - margin - 64
  if (y + needed <= limit) return y
  doc.addPage({ size: doc.page.size, layout: doc.page.layout, margin })
  return drawHeader ? drawHeader() : margin
}

export function drawSimpleTable(doc: PDFKit.PDFDocument, fonts: Fonts, options: {
  margin: number
  y: number
  columns: TableColumn[]
  rows: string[][]
  rowHeight?: number
  drawHeader?: () => number
}) {
  const rowHeight = options.rowHeight ?? 24
  let y = options.y
  let x = options.margin

  options.columns.forEach((col) => {
    doc.save()
    doc.rect(x, y, col.width, rowHeight).fill("#182033")
    doc.restore()
    doc.save()
    doc.lineWidth(0.6).strokeColor("#D7DEEA").rect(x, y, col.width, rowHeight).stroke()
    doc.restore()
    doc.font(fonts.bold).fontSize(8.5).fillColor("#FFFFFF").text(col.label, x + 6, y + 7, {
      width: col.width - 12,
      align: col.align || "left",
    })
    x += col.width
  })
  y += rowHeight + 2

  for (const row of options.rows) {
    y = ensurePdfPage(doc, y, rowHeight, options.margin, options.drawHeader)
    let xx = options.margin
    row.forEach((cell, index) => {
      const col = options.columns[index]
      doc.save()
      doc.lineWidth(0.6).strokeColor("#E2E8F0").rect(xx, y, col.width, rowHeight).stroke()
      doc.restore()
      doc.font(fonts.regular).fontSize(8.5).fillColor("#111827").text(cell || "-", xx + 6, y + 7, {
        width: col.width - 12,
        align: col.align || "left",
      })
      xx += col.width
    })
    y += rowHeight
  }

  return y
}

export function drawTotalsBox(doc: PDFKit.PDFDocument, fonts: Fonts, options: {
  x: number
  y: number
  width: number
  lines: Pair[]
  highlightLast?: boolean
}) {
  const height = 20 + options.lines.length * 18
  drawPanel(doc, options.x, options.y, options.width, height, { fill: "#FCFCFD" })
  let y = options.y + 12
  options.lines.forEach((line, index) => {
    const isLast = index === options.lines.length - 1 && options.highlightLast
    doc.font(isLast ? fonts.bold : fonts.regular).fontSize(isLast ? 10 : 9).fillColor("#111827")
    doc.text(line.label, options.x + 12, y, { width: options.width * 0.55 })
    doc.text(line.value, options.x + options.width * 0.45, y, { width: options.width * 0.45 - 12, align: "right" })
    y += 18
  })
  return options.y + height
}

export function drawSignatureRow(doc: PDFKit.PDFDocument, fonts: Fonts, options: {
  margin: number
  y: number
  labels: string[]
}) {
  const gap = 18
  const width = doc.page.width - options.margin * 2
  const cardW = (width - gap * (options.labels.length - 1)) / options.labels.length
  options.labels.forEach((label, index) => {
    const x = options.margin + index * (cardW + gap)
    doc.save()
    doc.lineWidth(0.8).strokeColor("#CBD5E1").rect(x, options.y, cardW, 82).stroke()
    doc.restore()
    doc.save()
    doc.rect(x, options.y, cardW, 28).fill("#EEF2F7")
    doc.restore()
    doc.save()
    doc.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, options.y, cardW, 28).stroke()
    doc.restore()
    doc.font(fonts.bold).fontSize(9).fillColor("#0F172A").text(label, x + 12, options.y + 9, {
      width: cardW - 24,
      align: "center",
    })
    doc.font(fonts.regular).fontSize(8).fillColor("#64748B").text("Nume / semnatura", x + 12, options.y + 48, {
      width: cardW - 24,
      align: "center",
    })
  })
  return options.y + 82
}
