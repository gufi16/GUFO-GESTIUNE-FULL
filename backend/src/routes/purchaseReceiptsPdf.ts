// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompany } from "../lib/companyResolver"

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
  const { id } = req.params

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: { id, tenantId },
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
        orderBy: {
          createdAt: "asc"
        }
      },
      supplier: true,
      location: true
    }
  })

  if (!receipt) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost găsit." })
  }

  const purchaseReceipt = receipt

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)

  const supplier = purchaseReceipt.supplier?.name || receipt.supplierName || "Furnizor"
  const filename = `NIR_${safeFilePart(purchaseReceipt.docNo)}_${safeFilePart(supplier)}.pdf`

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 20,
    info: {
      Title: filename,
      Author: company?.name || "Gufo ERP",
      Subject: `NIR ${purchaseReceipt.docNo}`
    }
  })

  const fonts = registerFonts(doc)
  doc.pipe(res)

  const pageWidth = doc.page.width
  const pageHeight = doc.page.height
  const margin = 20
  const contentWidth = pageWidth - margin * 2

  const companyWidth = 250
  const gap = 12
  const rightWidth = contentWidth - companyWidth - gap

  const metaCols = [84, 178, 84, 124, 84, 154]
  const metaRowHeight = 22

  const isRon = purchaseReceipt.currency === "RON"

  const columns = isRon
    ? [34, 212, 46, 60, 64, 48, 88, 76, 96]
    : [34, 206, 44, 58, 60, 46, 82, 74, 90, 96]

  const headers = isRon
    ? [
        "Nr.",
        "Denumirea produselor",
        "UM",
        "Cant.",
        "Pret unitar",
        "TVA %",
        "Valoare fara TVA",
        "TVA",
        "Valoare cu TVA"
      ]
    : [
        "Nr.",
        "Denumirea produselor",
        "UM",
        "Cant.",
        "Pret unitar",
        "TVA %",
        `Val. ${purchaseReceipt.currency} fara TVA`,
        `TVA ${purchaseReceipt.currency}`,
        `Val. ${purchaseReceipt.currency} cu TVA`,
        "Valoare RON"
      ]

  const headerTitleHeight = 48
  const introHeight = 70
  const topHeaderHeight = 128
  const headerBlockHeight = Math.max(topHeaderHeight, headerTitleHeight + 10 + introHeight)
  const hasSpvTrace =
    Boolean(purchaseReceipt.sourceIncomingEInvoiceId) ||
    Boolean(purchaseReceipt.spvDownloadId) ||
    Boolean(purchaseReceipt.spvUploadIndex) ||
    Boolean(purchaseReceipt.spvInvoiceNo)

  const metaRows = [
    [
      "Furnizor",
      supplier,
      "Cod furnizor",
      text(purchaseReceipt.supplier?.code || purchaseReceipt.supplierCode),
      "Document",
      text(purchaseReceipt.docNo)
    ],
    [
      "Locatie",
      text(purchaseReceipt.location?.name),
      "Moneda",
      text(purchaseReceipt.currency),
      "Data document",
      fmtDate(purchaseReceipt.docDate)
    ],
    [
      "Curs",
      isRon ? "1.00" : fmt(purchaseReceipt.fxRate, 4),
      "Status",
      text(purchaseReceipt.status),
      "Tip sursa",
      hasSpvTrace ? "RO e-Factura" : "Intern"
    ]
  ]

  if (hasSpvTrace) {
    metaRows.push([
      "ID descarcare",
      text(purchaseReceipt.spvDownloadId),
      "Index incarcare",
      text(purchaseReceipt.spvUploadIndex),
      "Factura SPV",
      text(purchaseReceipt.spvInvoiceNo)
    ])
  }

  const metaBlockHeight = metaRowHeight * metaRows.length
  const tableHeaderHeight = 28
  const rowHeight = 24
  const totalsHeight = isRon ? 96 : 156
  const signatureBlockHeight = 56

  type RowData = {
    no: string
    type: "PRODUCT" | "SGR"
    productName: string
    uom: string
    qty: string
    unitPrice: string
    vatRate: string
    net: string
    vat: string
    gross: string
    ronGross?: string
  }

  const rows: RowData[] = []
  let runningNo = 1

  receipt.items.forEach((item) => {
    const productName = text(item.product?.name)
    const uomCode = text(item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code)
    const qty = num(item.qty)
    const lineNetFc = num(item.lineNetFc)
    const lineVatFc = num(item.lineVatFc)
    const lineGrossFc = num(item.lineGrossFc)
    const lineGrossRon = num(item.lineGrossRon)

    rows.push({
      no: String(runningNo++),
      type: "PRODUCT",
      productName,
      uom: uomCode,
      qty: fmt(qty, 3),
      unitPrice: fmt(item.unitCostNetFc),
      vatRate: fmt(item.vatRateValue),
      net: fmt(lineNetFc),
      vat: fmt(lineVatFc),
      gross: fmt(lineGrossFc),
      ronGross: fmt(lineGrossRon)
    })

    const isSgr = Boolean(item.product?.isSgr)
    const sgrUnit = isSgr ? num(item.product?.sgrValue || 0.5) : 0
    const sgrNetFc = qty * sgrUnit
    const sgrVatFc = 0
    const sgrGrossFc = sgrNetFc
    const sgrGrossRon = sgrGrossFc * num(purchaseReceipt.fxRate || 1)

    if (isSgr && sgrNetFc > 0) {
      rows.push({
        no: String(runningNo++),
        type: "SGR",
        productName: `SGR ${productName}`,
        uom: uomCode,
        qty: fmt(qty, 3),
        unitPrice: fmt(sgrUnit),
        vatRate: "0.00",
        net: fmt(sgrNetFc),
        vat: fmt(sgrVatFc),
        gross: fmt(sgrGrossFc),
        ronGross: fmt(sgrGrossRon)
      })
    }
  })

  const totalSgrFc = rows
    .filter((row) => row.type === "SGR")
    .reduce((sum, row) => sum + num(row.gross), 0)

  const totalSgrRon = rows
    .filter((row) => row.type === "SGR")
    .reduce((sum, row) => sum + num(row.ronGross), 0)

  const totalWithSgrFc = num(receipt.totalGrossFc) + totalSgrFc
  const totalWithSgrRon = num(receipt.totalGrossRon) + totalSgrRon

  const rowsPerFirstPage = Math.max(
    1,
    Math.floor(
      (pageHeight -
        margin -
        headerBlockHeight -
        10 -
        metaBlockHeight -
        8 -
        tableHeaderHeight -
        110) /
        rowHeight
    )
  )

  const rowsPerMiddlePage = Math.max(
    1,
    Math.floor(
      (pageHeight -
        margin -
        headerBlockHeight -
        10 -
        metaBlockHeight -
        8 -
        tableHeaderHeight -
        36) /
        rowHeight
    )
  )

  const rowsPerLastPage = Math.max(
    1,
    Math.floor(
      (pageHeight -
        margin -
        headerBlockHeight -
        10 -
        metaBlockHeight -
        8 -
        tableHeaderHeight -
        14 -
        totalsHeight -
        18 -
        signatureBlockHeight -
        24) /
        rowHeight
    )
  )

  function paginateRows(allRows: RowData[]) {
    if (allRows.length === 0) {
      return [[]]
    }

    if (allRows.length <= rowsPerLastPage) {
      return [allRows]
    }

    const pages: RowData[][] = []
    let index = 0

    const firstCount = Math.min(rowsPerFirstPage, allRows.length)
    pages.push(allRows.slice(index, index + firstCount))
    index += firstCount

    while (allRows.length - index > rowsPerLastPage) {
      const middleCount = Math.min(rowsPerMiddlePage, allRows.length - index - rowsPerLastPage)
      pages.push(allRows.slice(index, index + middleCount))
      index += middleCount
    }

    pages.push(allRows.slice(index))
    return pages
  }

  const paginatedRows = paginateRows(rows)
  const totalPages = paginatedRows.length

  function drawPageHeader(pageNo: number, totalPagesCount: number) {
    let y = margin

    drawBox(doc, margin, y, companyWidth, topHeaderHeight)
    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor("#111111")
      .text(text(company?.name), margin + 8, y + 8, {
        width: companyWidth - 16,
        align: "left"
      })

    doc.font(fonts.regular).fontSize(8.5)
    const companyLines = [
      `CUI: ${text(company?.cui)}`,
      `Nr. Reg. Com.: ${text(company?.regNo)}`,
      `Adresa: ${text(company?.address)}`,
      `Banca: ${text(company?.bank)}`,
      `IBAN: ${text(company?.iban)}`,
      `Email: ${text(company?.email)}`,
      `Telefon: ${text(company?.phone)}`
    ]

    let companyY = y + 26
    for (const line of companyLines) {
      doc.text(line, margin + 8, companyY, {
        width: companyWidth - 16,
        align: "left"
      })
      companyY += 12
    }

    const rightX = margin + companyWidth + gap

    drawBox(doc, rightX, y, rightWidth, headerTitleHeight)
    doc
      .font(fonts.bold)
      .fontSize(16)
      .text("NOTA DE RECEPTIE SI CONSTATARE DE DIFERENTE", rightX + 8, y + 14, {
        width: rightWidth - 16,
        align: "center"
      })

    drawBox(doc, rightX, y + headerTitleHeight + 10, rightWidth, introHeight)
    doc
      .font(fonts.regular)
      .fontSize(8.5)
      .text(
        `Subsemnatii, membrii comisiei de receptie, am procedat la receptionarea valorilor materiale furnizate de ${supplier}, constatandu-se urmatoarele:`,
        rightX + 8,
        y + headerTitleHeight + 22,
        {
          width: rightWidth - 16,
          align: "justify"
        }
      )

    doc
      .font(fonts.regular)
      .fontSize(8.5)
      .text(`Pagina ${pageNo} / ${totalPagesCount}`, pageWidth - margin - 90, y - 2, {
        width: 90,
        align: "right"
      })
  }

  function drawMetaBlock() {
    let y = margin + headerBlockHeight + 10

    for (const row of metaRows) {
      let x = margin

      for (let i = 0; i < metaCols.length; i++) {
        const cellText = row[i] || ""
        const isLabel = i % 2 === 0 && cellText !== ""

        drawCell(doc, x, y, metaCols[i], metaRowHeight, cellText, fonts, {
          bold: isLabel,
          fontSize: 9,
          align: "left",
          fillColor: isLabel ? "#f3f3f3" : null
        })

        x += metaCols[i]
      }

      y += metaRowHeight
    }
  }

  function drawTableHeader(startY: number) {
    let x = margin

    headers.forEach((header, index) => {
      drawCell(doc, x, startY, columns[index], tableHeaderHeight, header, fonts, {
        bold: true,
        fontSize: 8,
        align: index === 1 ? "left" : "center",
        fillColor: "#f3f3f3"
      })
      x += columns[index]
    })
  }

  function drawRow(row: RowData, startY: number) {
    const values = isRon
      ? [
          row.no,
          row.productName,
          row.uom,
          row.qty,
          row.unitPrice,
          row.vatRate,
          row.net,
          row.vat,
          row.gross
        ]
      : [
          row.no,
          row.productName,
          row.uom,
          row.qty,
          row.unitPrice,
          row.vatRate,
          row.net,
          row.vat,
          row.gross,
          row.ronGross || "0.00"
        ]

    let x = margin

    values.forEach((value, cellIndex) => {
      const isSgrRow = row.type === "SGR"

      drawCell(doc, x, startY, columns[cellIndex], rowHeight, value, fonts, {
        fontSize: 8.4,
        align:
          cellIndex === 1
            ? "left"
            : cellIndex === 0 || cellIndex === 2 || cellIndex === 5
              ? "center"
              : "right",
        fillColor: isSgrRow ? "#f8fafc" : null,
        paddingX: cellIndex === 1 && isSgrRow ? 12 : 4
      })
      x += columns[cellIndex]
    })
  }

  function drawTotals(startY: number) {
    const totalsWidth = 280
    const totalsX = margin + contentWidth - totalsWidth

    drawBox(doc, totalsX, startY, totalsWidth, totalsHeight)

    let totalsY = startY + 8

    const totalLine = (label: string, value: string, bold = false) => {
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(bold ? 10 : 9)
      doc.text(label, totalsX + 8, totalsY, {
        width: 182,
        align: "left"
      })
      doc.text(value, totalsX + 194, totalsY, {
        width: 70,
        align: "right"
      })
      totalsY += bold ? 17 : 14
    }

    totalLine(`Total fara TVA ${purchaseReceipt.currency}`, fmt(purchaseReceipt.totalNetFc))
    totalLine(`Total TVA ${purchaseReceipt.currency}`, fmt(purchaseReceipt.totalVatFc))
    totalLine(`Total SGR ${purchaseReceipt.currency}`, fmt(totalSgrFc))
    doc.moveTo(totalsX + 8, totalsY + 1).lineTo(totalsX + totalsWidth - 8, totalsY + 1).stroke("#111111")
    totalsY += 6
    totalLine(`Total general cu SGR ${purchaseReceipt.currency}`, fmt(totalWithSgrFc), true)

    if (!isRon) {
      totalsY += 3
      doc.moveTo(totalsX + 8, totalsY).lineTo(totalsX + totalsWidth - 8, totalsY).dash(2, { space: 2 }).stroke("#111111")
      doc.undash()
      totalsY += 7
      totalLine("Total fara TVA RON", fmt(purchaseReceipt.totalNetRon))
      totalLine("Total TVA RON", fmt(purchaseReceipt.totalVatRon))
      totalLine("Total SGR RON", fmt(totalSgrRon))
      doc.moveTo(totalsX + 8, totalsY + 1).lineTo(totalsX + totalsWidth - 8, totalsY + 1).stroke("#111111")
      totalsY += 6
      totalLine("Total general cu SGR RON", fmt(totalWithSgrRon), true)
    }
  }

  function drawSignature(startY: number) {
    const signatureX = pageWidth - margin - 180
    const labelWidth = 120

    doc.font(fonts.bold).fontSize(9)
    doc.text("Gestionar", signatureX, startY, {
      width: labelWidth,
      align: "center"
    })

    doc.moveTo(signatureX, startY + 28).lineTo(signatureX + 120, startY + 28).stroke("#111111")
  }

  paginatedRows.forEach((pageRows, pageIndex) => {
    if (pageIndex > 0) {
      doc.addPage()
    }

    const currentPage = pageIndex + 1
    const isLastPage = currentPage === totalPages

    drawPageHeader(currentPage, totalPages)
    drawMetaBlock()

    let y = margin + headerBlockHeight + 10 + metaBlockHeight + 8

    drawTableHeader(y)
    y += tableHeaderHeight

    if (pageRows.length === 0) {
      const colspanWidth = columns.reduce((sum, value) => sum + value, 0)
      drawCell(doc, margin, y, colspanWidth, rowHeight, "Nu exista pozitii in document.", fonts, {
        align: "center",
        fontSize: 9
      })
      y += rowHeight
    } else {
      pageRows.forEach((row) => {
        drawRow(row, y)
        y += rowHeight
      })
    }

    if (isLastPage) {
      y += 14
      drawTotals(y)
      y += totalsHeight + 18
      drawSignature(y)
    }
  })

  doc.end()
})

export default router
