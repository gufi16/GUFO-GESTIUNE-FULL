
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"
import { resolveTenantCompany } from "../lib/companyResolver"
import { drawDocumentHero, drawInfoCards, drawSignatureRow, drawTotalsBox, pdfDate, pdfFmt, registerPdfFonts } from "../lib/professionalPdf"

const router = Router()

function toNumber(val: unknown) {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

function parseDateStart(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  if (!text.includes("T")) {
    d.setHours(0, 0, 0, 0)
  }
  return d
}

function parseDateEnd(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  if (!text.includes("T")) {
    d.setHours(23, 59, 59, 999)
  }
  return d
}

function getNetUnitPrice(unitPrice: number, vatRate: number) {
  if (!vatRate || vatRate <= 0) return unitPrice
  return unitPrice / (1 + vatRate / 100)
}

type ReportsRecipeIngredientLike = {
  costPrice: unknown
}

type ReportsRecipeItemLike = {
  qty: unknown
  lossPercent: unknown
  ingredient?: ReportsRecipeIngredientLike | null
}

type ReportsRecipeLike = {
  status?: string | null
  isActive?: boolean | null
  yieldQty?: unknown
  items?: ReportsRecipeItemLike[] | null
}

type ReportsProductLike = {
  isSgr?: boolean | null
  sgrValue?: unknown
  sgrPackagingType?: string | null
  sgrVolumeLiters?: unknown
  costPrice?: unknown
  recipe?: ReportsRecipeLike | null
}

type ReportsSaleItemLike = {
  unitPrice: unknown
  vatRate: unknown
  product?: ReportsProductLike | null
}

function isSyntheticSgrSaleItem(item: ReportsSaleItemLike) {
  const product = item?.product
  if (!product?.isSgr) return false

  const unitPrice = toNumber(item?.unitPrice)
  const vatRate = toNumber(item?.vatRate)
  const sgrValue = toNumber(product?.sgrValue || 0.5)

  return vatRate === 0 && Math.abs(unitPrice - sgrValue) < 0.0001
}

function productUnitCost(product: ReportsProductLike | null | undefined) {
  const recipe = product?.recipe
  const recipeItems = Array.isArray(recipe?.items) ? recipe.items : []

  if (recipe?.status === "ACTIVE" && recipe?.isActive !== false && recipeItems.length > 0) {
    const yieldQty = Math.max(toNumber(recipe?.yieldQty || 1), 0.000001)
    return recipeItems.reduce((sum: number, item: ReportsRecipeItemLike) => {
      const qty = toNumber(item?.qty)
      const lossPercent = toNumber(item?.lossPercent)
      const ingredientCost = toNumber(item?.ingredient?.costPrice || 0)

      return sum + ((qty / yieldQty) * (1 + lossPercent / 100) * ingredientCost)
    }, 0)
  }

  return toNumber(product?.costPrice || 0)
}

function formatDayLabel(date: Date) {
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  return `${day}.${month}`
}

function reportFileDate(value: unknown) {
  return String(value || "").replace(/[^0-9]/g, "") || "interval"
}

function reportMoney(value: unknown) {
  return `${pdfFmt(value)} RON`
}

function reportPeriod(from: Date, to: Date) {
  return `${pdfDate(from)} - ${pdfDate(to)}`
}

function sgrVolumeLabel(value: unknown) {
  const volume = toNumber(value)
  return volume > 0 ? `${pdfFmt(volume, 3)} L` : "-"
}

function isSameSgrSyntheticLine(item: ReportsSaleItemLike) {
  return isSyntheticSgrSaleItem(item)
}

type AccountingReportKind = "sales" | "sgr"

type ReportPdfFonts = { regular: string; bold: string }
type ReportPdfColumn = { label: string; width: number; align?: "left" | "center" | "right" }

function clipPdfCell(doc: PDFKit.PDFDocument, font: string, value: unknown, width: number) {
  const text = String(value ?? "-").replace(/\s+/g, " ").trim() || "-"
  doc.font(font).fontSize(8.3)
  if (doc.widthOfString(text) <= width) return text

  const suffix = "..."
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (doc.widthOfString(`${text.slice(0, mid)}${suffix}`) <= width) low = mid
    else high = mid - 1
  }
  return `${text.slice(0, Math.max(1, low))}${suffix}`
}

function drawAccountingTable(
  doc: PDFKit.PDFDocument,
  fonts: ReportPdfFonts,
  options: {
    margin: number
    y: number
    title: string
    columns: ReportPdfColumn[]
    rows: string[][]
    headerColor?: string
    totalRowIndexes?: number[]
    rowHeight?: number
    bottomMargin?: number
  },
) {
  const rowHeight = options.rowHeight || 25
  const bottomMargin = options.bottomMargin || options.margin + 108
  let y = options.y

  const drawColumns = () => {
    let x = options.margin
    for (const column of options.columns) {
      doc.save().rect(x, y, column.width, rowHeight).fill(options.headerColor || "#17324D").restore()
      doc.font(fonts.bold).fontSize(8.2).fillColor("#FFFFFF").text(column.label, x + 6, y + 8, {
        width: column.width - 12,
        height: 10,
        lineBreak: false,
        align: column.align || "left",
      })
      x += column.width
    }
    y += rowHeight
  }

  const addContinuationPage = () => {
    doc.addPage({ size: "A4", layout: doc.page.layout === "landscape" ? "landscape" : "portrait", margin: options.margin })
    y = options.margin
    doc.font(fonts.bold).fontSize(10).fillColor("#17324D").text(`${options.title} - continuare`, options.margin, y)
    y += 20
    drawColumns()
  }

  drawColumns()
  const rows = options.rows.length ? options.rows : [["Nu exista date pentru intervalul selectat.", ...options.columns.slice(1).map(() => "-")]]

  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > doc.page.height - bottomMargin) addContinuationPage()
    let x = options.margin
    for (let index = 0; index < options.columns.length; index += 1) {
      const column = options.columns[index]
      const isTotalRow = options.totalRowIndexes?.includes(rowIndex) === true
      const fill = isTotalRow ? "#E8F8F1" : rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC"
      doc.save().rect(x, y, column.width, rowHeight).fill(fill).restore()
      doc.save().lineWidth(0.55).strokeColor("#D7DEEA").rect(x, y, column.width, rowHeight).stroke().restore()
      const value = clipPdfCell(doc, isTotalRow ? fonts.bold : fonts.regular, row[index] || "-", column.width - 12)
      doc.font(isTotalRow ? fonts.bold : fonts.regular).fontSize(8.3).fillColor("#1E293B").text(value, x + 6, y + 8, {
        width: column.width - 12,
        height: 10,
        lineBreak: false,
        align: column.align || "left",
      })
      x += column.width
    }
    y += rowHeight
  })

  return y
}

function sgrMaterialLabel(value: unknown) {
  switch (String(value || "").trim().toUpperCase()) {
    case "PET":
      return "Plastic"
    case "METAL":
      return "Metal"
    case "STICLA":
      return "Sticla"
    default:
      return "Neclasificat"
  }
}

function sgrTypeLabel(value: unknown) {
  switch (String(value || "").trim().toUpperCase()) {
    case "PET":
      return "PET"
    case "METAL":
      return "Doza"
    case "STICLA":
      return "Sticla"
    default:
      return "Neclasificat"
  }
}

function drawSgrReportHeader(
  doc: PDFKit.PDFDocument,
  fonts: ReportPdfFonts,
  options: { companyName: string; period: string; locationName: string; generatedAt: string; totalQty: number; typeTotals: Map<string, { qty: number; value: number }>; totalSgr: number },
) {
  const margin = 36
  const contentWidth = doc.page.width - margin * 2
  let y = margin

  doc.font(fonts.bold).fontSize(21).fillColor("#111827").text("RAPORT VANZARI SGR", margin, y)
  doc.font(fonts.regular).fontSize(11).fillColor("#50627D").text("Centralizator ambalaje vandute si garantii aferente", margin, y + 28)
  doc.save().rect(doc.page.width - margin - 142, y + 3, 142, 26).fill("#167D72").restore()
  doc.font(fonts.bold).fontSize(8.8).fillColor("#FFFFFF").text("RAPORT CONTABIL", doc.page.width - margin - 142, y + 11, { width: 142, align: "center" })
  y += 51

  const meta = [
    ["Companie", options.companyName],
    ["Perioada", options.period],
    ["Punct de lucru", options.locationName],
    ["Data generarii", options.generatedAt],
    ["Moneda", "RON"],
  ]
  const metaWidth = contentWidth / meta.length
  meta.forEach(([label, value], index) => {
    const x = margin + index * metaWidth
    doc.save().rect(x, y, metaWidth, 37).fill("#F7F9FC").restore()
    doc.save().lineWidth(0.65).strokeColor("#C8D4E3").rect(x, y, metaWidth, 37).stroke().restore()
    doc.font(fonts.regular).fontSize(7.8).fillColor("#64748B").text(label, x + 8, y + 7)
    doc.font(fonts.regular).fontSize(9.4).fillColor("#334155").text(value || "-", x + 8, y + 19, { width: metaWidth - 16, lineBreak: false })
  })
  y += 54

  const cards = [
    ["TOTAL AMBALAJE", `${pdfFmt(options.totalQty, 0)} buc`],
    ["PET", `${pdfFmt(options.typeTotals.get("PET")?.qty || 0, 0)} buc`],
    ["DOZE", `${pdfFmt(options.typeTotals.get("METAL")?.qty || 0, 0)} buc`],
    ["STICLA", `${pdfFmt(options.typeTotals.get("STICLA")?.qty || 0, 0)} buc`],
    ["TOTAL GARANTII", reportMoney(options.totalSgr)],
  ]
  const gap = 7
  const cardWidth = (contentWidth - gap * (cards.length - 1)) / cards.length
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + gap)
    doc.save().lineWidth(0.7).strokeColor("#C8D4E3").rect(x, y, cardWidth, 46).stroke().restore()
    doc.font(fonts.regular).fontSize(8.1).fillColor("#64748B").text(label, x + 6, y + 8, { width: cardWidth - 12, align: "center" })
    doc.font(fonts.bold).fontSize(15).fillColor("#111827").text(value, x + 6, y + 22, { width: cardWidth - 12, align: "center", lineBreak: false })
  })

  return y + 58
}

function ensureAccountingFooterSpace(doc: PDFKit.PDFDocument, fonts: ReportPdfFonts, y: number, margin: number, title: string) {
  if (y + 130 <= doc.page.height - margin) return y
  doc.addPage({ size: "A4", layout: doc.page.layout === "landscape" ? "landscape" : "portrait", margin })
  doc.font(fonts.bold).fontSize(10).fillColor("#17324D").text(`${title} - totaluri`, margin, margin)
  return margin + 22
}

async function sendAccountingPdf(kind: AccountingReportKind, req: AuthedRequest, res: any) {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" })

  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ error: "Firma activa lipsa." })

  const from = parseDateStart(req.query.dateFrom) || parseDateStart(req.query.from) || new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const to = parseDateEnd(req.query.dateTo) || parseDateEnd(req.query.to) || new Date()
  const locationId = String(req.query.locationId || "").trim() || null
  const company = await resolveTenantCompany(prisma, tenantId, companyId)
  if (!company) return res.status(404).json({ error: "Firma activa nu a fost gasita." })

  const sales = await prisma.sale.findMany({
    where: {
      tenantId,
      companyId,
      soldAt: { gte: from, lte: to },
      ...(locationId ? { locationId } : {}),
    },
    include: {
      location: { select: { name: true } },
      terminal: { select: { label: true } },
      items: {
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              isSgr: true,
              sgrValue: true,
              sgrPackagingType: true,
              sgrVolumeLiters: true,
              uom: { select: { code: true } },
            },
          },
        },
      },
    },
    orderBy: [{ soldAt: "asc" }, { receiptNo: "asc" }],
  })

  const totalGross = sales.reduce((sum, sale) => sum + toNumber(sale.total), 0)
  const recordedSgrTotal = sales.reduce((sum, sale) => sum + toNumber(sale.sgrTotal), 0)
  const totalWithoutSgr = totalGross - recordedSgrTotal
  const paymentTotals = new Map<string, number>()
  for (const sale of sales) {
    const payment = String(sale.paymentType || "ALTA PLATA")
    paymentTotals.set(payment, (paymentTotals.get(payment) || 0) + toNumber(sale.total))
  }

  const sgrRows = new Map<string, { sku: string; name: string; packagingType: string; volumeLiters: number; qty: number; unit: number; value: number }>()
  let unallocatedSgr = 0
  for (const sale of sales) {
    let allocated = 0
    for (const item of sale.items) {
      if (!item.product?.isSgr || isSameSgrSyntheticLine(item)) continue
      const qty = toNumber(item.qty)
      const unit = toNumber(item.product.sgrValue || 0.5)
      const value = qty * unit
      if (qty <= 0 || value <= 0) continue
      allocated += value
      const packagingType = String(item.product.sgrPackagingType || "").trim().toUpperCase()
      const volumeLiters = toNumber(item.product.sgrVolumeLiters)
      const key = `${item.product.sku}|${item.product.name}|${packagingType}|${volumeLiters}|${unit}`
      const row = sgrRows.get(key) || { sku: item.product.sku || "-", name: item.product.name, packagingType, volumeLiters, qty: 0, unit, value: 0 }
      row.qty += qty
      row.value += value
      sgrRows.set(key, row)
    }
    unallocatedSgr += Math.max(0, toNumber(sale.sgrTotal) - allocated)
  }
  if (unallocatedSgr > 0.0001) {
    sgrRows.set("documentat", {
      sku: "-",
      name: "SGR conform bonurilor fiscale",
      packagingType: "",
      volumeLiters: 0,
      qty: 0,
      unit: 0,
      value: unallocatedSgr,
    })
  }
  // The product rows are the auditable source for the SGR report. Older sales can contain an outdated sgrTotal.
  const calculatedSgrTotal = Array.from(sgrRows.values()).reduce((sum, row) => sum + row.value, 0)
  const reportSgrTotal = calculatedSgrTotal > 0 ? calculatedSgrTotal : recordedSgrTotal

  const isSgr = kind === "sgr"
  const title = isSgr ? "RAPORT SGR" : "RAPORT VANZARI"
  const locationName = locationId ? sales[0]?.location?.name || "Locatia selectata" : "Toate locatiile"
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, info: { Title: title, Author: "Gufo ERP" } })
  const fonts = registerPdfFonts(doc)
  const safeFrom = reportFileDate(req.query.dateFrom || from.toISOString().slice(0, 10))
  const safeTo = reportFileDate(req.query.dateTo || to.toISOString().slice(0, 10))

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename=${isSgr ? "Raport_SGR" : "Raport_Vanzari"}_${safeFrom}-${safeTo}.pdf`)
  doc.pipe(res)

  let signatureY: number | null = null
  if (isSgr) {
    const sortedSgrRows = Array.from(sgrRows.values()).sort((a, b) => b.value - a.value)
    const typeTotals = new Map<string, { qty: number; value: number }>()
    for (const row of sortedSgrRows) {
      const key = String(row.packagingType || "").toUpperCase()
      const total = typeTotals.get(key) || { qty: 0, value: 0 }
      total.qty += row.qty
      total.value += row.value
      typeTotals.set(key, total)
    }

    const summaryRows = ["PET", "METAL", "STICLA"]
      .map((type) => ({ type, total: typeTotals.get(type) || { qty: 0, value: 0 } }))
      .filter(({ total }) => total.qty > 0 || total.value > 0)
      .map(({ type, total }) => [
        sgrTypeLabel(type),
        sgrMaterialLabel(type),
        pdfFmt(total.qty, 3),
        reportMoney(0.5),
        reportMoney(total.value),
        reportSgrTotal > 0 ? `${pdfFmt((total.value / reportSgrTotal) * 100, 1)}%` : "-",
      ])

    const unclassified = typeTotals.get("") || { qty: 0, value: 0 }
    if (unclassified.qty > 0 || unclassified.value > 0) {
      summaryRows.push([
        "Neclasificat",
        "Neclasificat",
        unclassified.qty ? pdfFmt(unclassified.qty, 3) : "-",
        "-",
        reportMoney(unclassified.value),
        reportSgrTotal > 0 ? `${pdfFmt((unclassified.value / reportSgrTotal) * 100, 1)}%` : "-",
      ])
    }
    const totalQty = sortedSgrRows.reduce((sum, row) => sum + row.qty, 0)
    summaryRows.push(["TOTAL", "", pdfFmt(totalQty, 3), "", reportMoney(reportSgrTotal), reportSgrTotal > 0 ? "100,0%" : "-"])

    let y = drawSgrReportHeader(doc, fonts, {
      companyName: company.name,
      period: reportPeriod(from, to),
      locationName,
      generatedAt: new Date().toLocaleDateString("ro-RO"),
      totalQty,
      typeTotals,
      totalSgr: reportSgrTotal,
    })
    doc.font(fonts.bold).fontSize(13).fillColor("#111827").text("1. Centralizator pe tip de ambalaj", 36, y)
    y += 19
    y = drawAccountingTable(doc, fonts, {
      margin: 36,
      y,
      title: "Centralizator SGR",
      headerColor: "#167D72",
      totalRowIndexes: [summaryRows.length - 1],
      rowHeight: 22,
      bottomMargin: 36,
      columns: [
        { label: "Tip ambalaj", width: 110 },
        { label: "Material", width: 110 },
        { label: "Cantitate vanduta", width: 140, align: "right" },
        { label: "Garantie / buc", width: 125, align: "right" },
        { label: "Valoare garantii", width: 145, align: "right" },
        { label: "Pondere din total", width: 140, align: "right" },
      ],
      rows: summaryRows,
    }) + 18

    doc.font(fonts.bold).fontSize(13).fillColor("#111827").text("2. Detaliere pe produse", 36, y)
    y += 19
    const detailRows = sortedSgrRows.map((row) => [
      row.sku,
      row.name,
      sgrTypeLabel(row.packagingType),
      sgrVolumeLabel(row.volumeLiters),
      row.qty ? pdfFmt(row.qty, 3) : "-",
      row.unit ? reportMoney(row.unit) : "-",
      reportMoney(row.value),
    ])
    detailRows.push(["TOTAL", "", "", "", pdfFmt(totalQty, 3), "", reportMoney(reportSgrTotal)])
    drawAccountingTable(doc, fonts, {
      margin: 36,
      y,
      title: "Detaliere produse SGR",
      totalRowIndexes: [detailRows.length - 1],
      rowHeight: 21,
      bottomMargin: 36,
      columns: [
        { label: "Cod produs", width: 82 },
        { label: "Denumire produs", width: 236 },
        { label: "Tip ambalaj", width: 100 },
        { label: "Volum", width: 70, align: "right" },
        { label: "Cantitate", width: 90, align: "right" },
        { label: "Garantie / buc", width: 95, align: "right" },
        { label: "Total SGR", width: 97, align: "right" },
      ],
      rows: detailRows,
    })
  } else {
    let y = drawDocumentHero(doc, fonts, {
      title,
      subtitle: `Centralizator vanzari pentru contabilitate${company.cui ? ` · CUI ${company.cui}` : ""}`,
      companyName: company.name,
      companyLines: [company.cui ? `CUI: ${company.cui}` : "", company.address || "", company.city || ""].filter(Boolean),
      rightPairs: [
        { label: "Perioada", value: reportPeriod(from, to) },
        { label: "Locatie", value: locationName },
        { label: "Generat", value: new Date().toLocaleDateString("ro-RO") },
      ],
      margin: 36,
    })
    y = drawInfoCards(doc, fonts, {
      margin: 36,
      y,
      height: 100,
      cards: [
        { title: "Document", pairs: [{ label: "Perioada", value: reportPeriod(from, to) }, { label: "Locatie", value: locationName }] },
        { title: "Vanzari", pairs: [{ label: "Bonuri", value: String(sales.length) }, { label: "Fara SGR", value: reportMoney(totalWithoutSgr) }] },
        { title: "Incasari", pairs: Array.from(paymentTotals.entries()).slice(0, 3).map(([label, value]) => ({ label, value: reportMoney(value) })) },
      ],
    }) + 18
    y = drawAccountingTable(doc, fonts, {
      margin: 36,
      y,
      title,
      columns: [
        { label: "Data / ora", width: 105 },
        { label: "Bon", width: 90 },
        { label: "Locatie", width: 130 },
        { label: "Plata", width: 85 },
        { label: "Fara SGR", width: 95, align: "right" },
        { label: "SGR", width: 75, align: "right" },
        { label: "Total", width: 95, align: "right" },
      ],
      rows: sales.map((sale) => [
        new Date(sale.soldAt).toLocaleString("ro-RO"),
        sale.receiptNo || sale.clientSaleId || "-",
        sale.location?.name || "-",
        String(sale.paymentType || "-"),
        reportMoney(toNumber(sale.total) - toNumber(sale.sgrTotal)),
        reportMoney(sale.sgrTotal),
        reportMoney(sale.total),
      ]),
    }) + 16
    y = ensureAccountingFooterSpace(doc, fonts, y, 36, title)
    y = drawTotalsBox(doc, fonts, {
      x: doc.page.width - 275,
      y,
      width: 239,
      lines: [
        { label: "Total fara SGR", value: reportMoney(totalWithoutSgr) },
        { label: "Total SGR", value: reportMoney(recordedSgrTotal) },
        { label: "TOTAL INCASARI", value: reportMoney(totalGross) },
      ],
      highlightLast: true,
    }) + 28
    signatureY = y
  }

  if (signatureY !== null) {
    drawSignatureRow(doc, fonts, { margin: 36, y: signatureY, labels: ["Intocmit", "Verificat", "Contabilitate"] })
  } else {
    doc.font(fonts.regular).fontSize(8.5).fillColor("#64748B").text(
      "Raport contabil SGR generat din Gufo ERP",
      36,
      doc.page.height - 34,
      { width: doc.page.width - 72 }
    )
  }
  doc.end()
}

router.get("/api/v1/reports/accounting/sales/pdf", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await sendAccountingPdf("sales", req, res)
  } catch (error) {
    console.error("SALES ACCOUNTING PDF ERROR:", error)
    if (!res.headersSent) res.status(500).json({ error: "Nu am putut genera raportul de vanzari." })
  }
})

router.get("/api/v1/reports/accounting/sgr/pdf", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await sendAccountingPdf("sgr", req, res)
  } catch (error) {
    console.error("SGR ACCOUNTING PDF ERROR:", error)
    if (!res.headersSent) res.status(500).json({ error: "Nu am putut genera raportul SGR." })
  }
})

router.get("/api/v1/reports/advanced", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || "").trim()
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const companyId = await requireRequestCompanyId(req)
    if (!companyId) {
      return res.status(400).json({ error: "Company is required" })
    }

    const activeCompanyId = companyId

    const from =
      parseDateStart(req.query.dateFrom) ||
      parseDateStart(req.query.from) ||
      new Date("2000-01-01")

    const to =
      parseDateEnd(req.query.dateTo) ||
      parseDateEnd(req.query.to) ||
      new Date()

    const locationId = String(req.query.locationId || "").trim() || null
    const terminalId = String(req.query.terminalId || "").trim() || null
    const warehouseId = String(req.query.warehouseId || "").trim() || null
    const whereLocation = locationId ? { locationId } : {}
    const whereTerminal = terminalId ? { terminalId } : {}
    const whereWarehouse = warehouseId ? { warehouseId } : {}

    const [locations, products, sales, stockBalances, inventoryDocs, consumptionDocs, stockMoves] =
      await Promise.all([
        prisma.location.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            isActive: true,
          },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            code: true,
          },
        }),

        prisma.product.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            class: true,
            costPrice: true,
            uom: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: { name: "asc" },
        }),

        prisma.sale.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            soldAt: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
            ...whereTerminal,
          },
          include: {
            items: {
              include: {
                product: {
                  include: {
                    uom: true,
                    recipe: {
                      include: {
                        items: {
                          include: {
                            ingredient: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            location: true,
          },
          orderBy: { soldAt: "asc" },
        }),

        prisma.stockBalance.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            ...whereLocation,
            ...whereWarehouse,
          },
          include: {
            product: {
              include: {
                uom: true,
              },
            },
            location: true,
          },
          orderBy: {
            product: {
              name: "asc",
            },
          },
        }),

        prisma.inventoryDoc.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            status: "FINALIZED",
            docDate: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
            ...whereWarehouse,
          },
          include: {
            location: true,
            items: {
              include: {
                product: {
                  include: {
                    uom: true,
                  },
                },
              },
            },
          },
          orderBy: { docDate: "desc" },
        }),

        prisma.consumptionDoc.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            status: "VALIDATED",
            aggregateParentId: null,
            docDate: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
            ...whereWarehouse,
          },
          include: {
            location: true,
            items: {
              include: {
                ingredient: {
                  include: {
                    uom: true,
                  },
                },
                finishedProduct: true,
              },
            },
          },
          orderBy: { docDate: "desc" },
        }),

        prisma.stockMove.findMany({
          where: {
            tenantId,
            companyId: activeCompanyId,
            createdAt: {
              gte: from,
              lte: to,
            },
            ...whereLocation,
            ...whereWarehouse,
          },
          include: {
            product: {
              include: {
                uom: true,
              },
            },
            location: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ])

    let totalSales = 0
    let estimatedProfit = 0

    const salesByLocationMap: Record<string, {
      locationId: string | null
      id: string | null
      name: string
      sales: number
      total: number
      profit: number
      margin: number
    }> = {}

    const salesTrendMap: Record<string, {
      sortKey: string
      name: string
      sales: number
      profit: number
    }> = {}

    const topProductsMap: Record<string, {
      productId: string
      name: string
      qty: number
      sales: number
      total: number
      profit: number
      marginPercent: number
    }> = {}

    const topProfitProductsMap: Record<string, {
      productId: string
      name: string
      profit: number
      qty: number
      total: number
    }> = {}

    const unprofitableProductsMap: Record<string, {
      productId: string
      name: string
      profit: number
      qty: number
      total: number
    }> = {}

    for (const sale of sales) {
      const saleTotal = toNumber(sale.total)
      totalSales += saleTotal

      const locKey = sale.locationId || "no-location"
      if (!salesByLocationMap[locKey]) {
        salesByLocationMap[locKey] = {
          locationId: sale.locationId || null,
          id: sale.locationId || null,
          name: sale.location?.name || "Fara locatie",
          sales: 0,
          total: 0,
          profit: 0,
          margin: 0,
        }
      }

      salesByLocationMap[locKey].sales += saleTotal
      salesByLocationMap[locKey].total += saleTotal

      const trendKey = sale.soldAt.toISOString().slice(0, 10)
      if (!salesTrendMap[trendKey]) {
        salesTrendMap[trendKey] = {
          sortKey: trendKey,
          name: formatDayLabel(sale.soldAt),
          sales: 0,
          profit: 0,
        }
      }
      salesTrendMap[trendKey].sales += saleTotal

      for (const item of sale.items) {
        if (isSyntheticSgrSaleItem(item)) continue

        const key = item.productId
        const qty = toNumber(item.qty)
        const unitPriceGross = toNumber(item.unitPrice)
        const vatRate = toNumber(item.vatRate)
        const unitPriceNet = getNetUnitPrice(unitPriceGross, vatRate)
        const lineRevenueNet = qty * unitPriceNet
        const lineCost = qty * productUnitCost(item.product)
        const lineProfit = lineRevenueNet - lineCost

        estimatedProfit += lineProfit
        salesByLocationMap[locKey].profit += lineProfit
        salesTrendMap[trendKey].profit += lineProfit

        if (!topProductsMap[key]) {
          topProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            qty: 0,
            sales: 0,
            total: 0,
            profit: 0,
            marginPercent: 0,
          }
        }

        topProductsMap[key].qty += qty
        topProductsMap[key].sales += lineRevenueNet
        topProductsMap[key].total += lineRevenueNet
        topProductsMap[key].profit += lineProfit

        if (!topProfitProductsMap[key]) {
          topProfitProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            profit: 0,
            qty: 0,
            total: 0,
          }
        }
        topProfitProductsMap[key].profit += lineProfit
        topProfitProductsMap[key].qty += qty
        topProfitProductsMap[key].total += lineRevenueNet

        if (!unprofitableProductsMap[key]) {
          unprofitableProductsMap[key] = {
            productId: item.productId,
            name: item.product?.name || "Produs",
            profit: 0,
            qty: 0,
            total: 0,
          }
        }
        unprofitableProductsMap[key].profit += lineProfit
        unprofitableProductsMap[key].qty += qty
        unprofitableProductsMap[key].total += lineRevenueNet
      }
    }

    const salesByLocation = Object.values(salesByLocationMap)
      .map((row) => ({
        ...row,
        margin: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
        marginPercent: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
      }))
      .sort((a, b) => b.sales - a.sales)

    const salesTrend = Object.values(salesTrendMap)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ sortKey, ...row }) => row)

    const topProducts = Object.values(topProductsMap)
      .map((row) => ({
        ...row,
        marginPercent: row.sales > 0 ? (row.profit / row.sales) * 100 : 0,
      }))
      .sort((a, b) => {
        if (b.qty !== a.qty) return b.qty - a.qty
        return b.sales - a.sales
      })
      .slice(0, 15)

    const topProfitProducts = Object.values(topProfitProductsMap)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 15)

    const unprofitableProducts = Object.values(unprofitableProductsMap)
      .filter((row) => row.profit <= 0 && row.total > 0)
      .sort((a, b) => a.profit - b.profit)
      .slice(0, 15)

    let totalInventoryDiff = 0
    const inventoryDiffItems: Array<{
      docId: string
      docNo: string
      docDate: Date
      location: string
      product: string
      stock: number
      qty: number
      um: string
      status: string
      scriptic: number
      numarat: number
      diferenta: number
    }> = []

    for (const doc of inventoryDocs) {
      for (const item of doc.items) {
        const diff = toNumber(item.differenceQty)
        totalInventoryDiff += diff

        inventoryDiffItems.push({
          docId: doc.id,
          docNo: doc.docNo,
          docDate: doc.docDate,
          location: doc.location?.name || "Fara locatie",
          product: item.product?.name || "Produs",
          stock: diff,
          qty: diff,
          um: item.product?.uom?.code || "buc",
          status: "diferenta",
          scriptic: toNumber(item.systemQty),
          numarat: toNumber(item.countedQty),
          diferenta: diff,
        })
      }
    }

    const consumptionByIngredientMap: Record<
      string,
      { ingredientId: string; name: string; qty: number; um: string; uomCode: string; uomName: string }
    > = {}

    for (const doc of consumptionDocs) {
      for (const item of doc.items) {
        const key = item.ingredientId
        if (!consumptionByIngredientMap[key]) {
          consumptionByIngredientMap[key] = {
            ingredientId: key,
            name: item.ingredient?.name || "Ingredient",
            qty: 0,
            um: item.ingredient?.uom?.code || "buc",
            uomCode: item.ingredient?.uom?.code || "buc",
            uomName: item.ingredient?.uom?.name || "Bucata",
          }
        }

        consumptionByIngredientMap[key].qty += toNumber(item.qty)
      }
    }

    const rawConsumption = Object.values(consumptionByIngredientMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20)

    const lowStockAlerts = stockBalances
      .filter((row) => {
        const qty = toNumber(row.qty)
        return qty <= 5
      })
      .map((row) => ({
        productId: row.productId,
        name: row.product?.name || "Produs",
        product: row.product?.name || "Produs",
        location: row.location?.name || "Fara locatie",
        stock: toNumber(row.qty),
        qty: toNumber(row.qty),
        quantity: toNumber(row.qty),
        um: row.product?.uom?.code || "buc",
        uom: row.product?.uom?.code || "buc",
        status: toNumber(row.qty) <= 0 ? "critic" : "scazut",
        reason: toNumber(row.qty) <= 0 ? "stoc negativ sau zero" : "stoc critic",
      }))

    const noCostAlerts = stockBalances
      .filter((row) => toNumber(row.qty) > 0 && toNumber(row.product?.costPrice) <= 0)
      .map((row) => ({
        productId: row.productId,
        name: row.product?.name || "Produs",
        product: row.product?.name || "Produs",
        location: row.location?.name || "Fara locatie",
        stock: toNumber(row.qty),
        qty: toNumber(row.qty),
        quantity: toNumber(row.qty),
        um: row.product?.uom?.code || "buc",
        uom: row.product?.uom?.code || "buc",
        status: "fara cost",
        reason: "produs cu stoc dar fara cost",
      }))

    const stockAlerts = [...lowStockAlerts, ...noCostAlerts, ...inventoryDiffItems]
      .sort((a, b) => Math.abs(toNumber(a.stock)) - Math.abs(toNumber(b.stock)))
      .slice(0, 25)

    const negativeStockProducts = lowStockAlerts
      .filter((item) => toNumber(item.stock) <= 0)
      .sort((a, b) => a.stock - b.stock)

    const stockIssues = negativeStockProducts.map((item) => ({
      productId: item.productId,
      product: item.product,
      location: item.location,
      qty: item.qty,
    }))

    const recentStockMoves = stockMoves.map((move) => ({
      id: move.id,
      date: move.createdAt,
      type: move.type,
      product: move.product?.name || "Produs",
      location: move.location?.name || "Fara locatie",
      qty: toNumber(move.qty),
      um: move.product?.uom?.code || "buc",
      refType: move.refType || null,
      note: move.note || "",
    }))

    const productClassLabels: Record<string, string> = {
      MARFA: "Marfa",
      PRODUS_FIN: "Produse finite",
      MATERIE_PRIMA: "Materii prime",
      AMBALAJE: "Ambalaje",
      CONSUMABILE: "Consumabile",
      SEMIFABRICATE: "Semifabricate",
      REZIDUALE: "Reziduale",
      ALTE_MATERIALE: "Alte materiale",
    }

    const productMixCountMap: Record<string, number> = {}
    for (const product of products) {
      const label = productClassLabels[product.class] || product.class
      productMixCountMap[label] = (productMixCountMap[label] || 0) + 1
    }

    const productMixTotal = Object.values(productMixCountMap).reduce((acc, value) => acc + value, 0)
    const productMix = Object.entries(productMixCountMap)
      .map(([name, count]) => ({
        name,
        count,
        value: productMixTotal > 0 ? Number(((count / productMixTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    const activeLocations = salesByLocation.filter((row) => row.sales > 0).length
    const averageMargin = totalSales > 0 ? (estimatedProfit / totalSales) * 100 : 0

    res.json({
      ok: true,
      filters: {
        from,
        to,
        dateFrom: from,
        dateTo: to,
        locationId,
        warehouseId,
      },
      locations,
      totalSales,
      estimatedProfit,
      averageMargin,
      activeLocations,
      salesTrend,
      monthlyTrend: salesTrend,
      salesByLocation,
      topProducts,
      topProfitProducts,
      unprofitableProducts,
      rawConsumption,
      consumptionRawMaterials: rawConsumption,
      stockAlerts,
      negativeStockProducts,
      stockIssues,
      totalInventoryDiff,
      inventoryDiffItems,
      consumptionByIngredient: rawConsumption,
      recentStockMoves,
      pieData: productMix,
      productMix,
    })
  } catch (err) {
    console.error("REPORTS ADVANCED ERROR:", err)
    return res.status(500).json({
      ok: false,
      error: "Eroare rapoarte",
    })
  }
})

export default router
