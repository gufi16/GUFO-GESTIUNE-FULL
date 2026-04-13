// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

router.use(requireAuth)

function num(v: any) {
  return Number(v || 0)
}

function fmt(v: any, d = 3) {
  return num(v).toFixed(d)
}

function fmtDateTime(v: any) {
  if (!v) return "-"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("ro-RO")
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
  const paddingY = options?.paddingY ?? 4

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

function mapStatusToRomanian(status: string) {
  if (status === "FINALIZED") return "FINALIZAT"
  if (status === "CANCELLED") return "ANULAT"
  return "IN LUCRU"
}

router.get("/:id/pdf", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const { id } = req.params

    const docData: any = await prisma.inventoryDoc.findFirst({
      where: { id, tenantId, companyId },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                uom: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    })

    if (!docData) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de inventar nu a fost găsit."
      })
    }

    const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)

    const filename = `Inventar_${safeFilePart(docData.docNo)}_${safeFilePart(docData.location?.name || "locatie")}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 18,
      info: {
        Title: filename,
        Author: company?.name || "Gufo ERP",
        Subject: `Inventar ${docData.docNo}`
      }
    })

    const fonts = registerFonts(doc)
    doc.pipe(res)

    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const margin = 18
    const contentWidth = pageWidth - margin * 2

    const companyWidth = 245
    const gap = 10
    const rightWidth = contentWidth - companyWidth - gap

    const metaCols = [82, 165, 90, 125, 80, 146]
    const metaRowHeight = 21

    const columns = [34, 290, 90, 60, 105, 105, 105]
    const headers = [
      "Nr.",
      "Produs",
      "SKU",
      "UM",
      "Stoc sistem",
      "Stoc numarat",
      "Diferenta"
    ]

    const topHeaderHeight = 112
    const titleHeight = 42
    const introHeight = 58
    const headerBlockHeight = Math.max(topHeaderHeight, titleHeight + 8 + introHeight)
    const metaBlockHeight = metaRowHeight * 2
    const tableHeaderHeight = 24
    const rowHeight = 22
    const totalsBlockHeight = 60
    const signatureBlockHeight = 42

    type RowData = {
      no: string
      productName: string
      sku: string
      uom: string
      systemQty: string
      countedQty: string
      differenceQty: string
    }

    const rows: RowData[] = docData.items.map((item: any, index: number) => ({
      no: String(index + 1),
      productName: text(item.product?.name),
      sku: text(item.product?.sku),
      uom: text(item.product?.uom?.code),
      systemQty: fmt(item.systemQty, 3),
      countedQty: fmt(item.countedQty, 3),
      differenceQty: fmt(item.differenceQty, 3)
    }))

    const totalSystemQty = rows.reduce((sum, row) => sum + num(row.systemQty), 0)
    const totalCountedQty = rows.reduce((sum, row) => sum + num(row.countedQty), 0)
    const totalDifferenceQty = rows.reduce((sum, row) => sum + num(row.differenceQty), 0)

    function drawPageHeader(pageNo: number, totalPagesCount: number) {
      const y = margin

      drawBox(doc, margin, y, companyWidth, topHeaderHeight)
      doc
        .font(fonts.bold)
        .fontSize(10.5)
        .fillColor("#111111")
        .text(text(company?.name), margin + 8, y + 8, {
          width: companyWidth - 16,
          align: "left"
        })

      doc.font(fonts.regular).fontSize(8.2)
      const companyLines = [
        `CUI: ${text(company?.cui)}`,
        `Nr. Reg. Com.: ${text(company?.regNo)}`,
        `Adresa: ${text(company?.address)}`,
        `Banca: ${text(company?.bank)}`,
        `IBAN: ${text(company?.iban)}`,
        `Email: ${text(company?.email)}`,
        `Telefon: ${text(company?.phone)}`
      ]

      let companyY = y + 25
      for (const line of companyLines) {
        doc.text(line, margin + 8, companyY, {
          width: companyWidth - 16,
          align: "left"
        })
        companyY += 11
      }

      const rightX = margin + companyWidth + gap

      drawBox(doc, rightX, y, rightWidth, titleHeight)
      doc
        .font(fonts.bold)
        .fontSize(17)
        .text("LISTA DE INVENTARIERE", rightX + 8, y + 11, {
          width: rightWidth - 16,
          align: "center"
        })

      drawBox(doc, rightX, y + titleHeight + 8, rightWidth, introHeight)
      doc
        .font(fonts.regular)
        .fontSize(8.4)
        .text(
          "Document de inventariere pentru verificarea stocurilor scriptice fata de cantitatile constatate faptic.",
          rightX + 8,
          y + titleHeight + 18,
          {
            width: rightWidth - 16,
            align: "justify"
          }
        )

      doc
        .font(fonts.regular)
        .fontSize(8)
        .text(`Pagina ${pageNo} / ${totalPagesCount}`, pageWidth - margin - 88, y - 1, {
          width: 88,
          align: "right"
        })
    }

    function drawMetaBlock() {
      let y = margin + headerBlockHeight + 8

      const metaRows = [
        [
          "Document",
          text(docData.docNo),
          "Data document",
          fmtDateTime(docData.docDate),
          "Locatie",
          text(docData.location?.name)
        ],
        [
          "Status",
          mapStatusToRomanian(text(docData.status)),
          "Finalizat la",
          docData.finalizedAt ? fmtDateTime(docData.finalizedAt) : "-",
          "Nr. pozitii",
          String(docData.items.length)
        ]
      ]

      for (const row of metaRows) {
        let x = margin

        for (let i = 0; i < metaCols.length; i++) {
          const cellText = row[i] || ""
          const isLabel = i % 2 === 0 && cellText !== ""

          drawCell(doc, x, y, metaCols[i], metaRowHeight, cellText, fonts, {
            bold: isLabel,
            fontSize: 8.5,
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
          align:
            index === 0 || index === 3 || index === 4 || index === 5 || index === 6
              ? "center"
              : "left",
          fillColor: "#f3f3f3"
        })
        x += columns[index]
      })
    }

    function drawRow(row: RowData, startY: number) {
      const values = [
        row.no,
        row.productName,
        row.sku,
        row.uom,
        row.systemQty,
        row.countedQty,
        row.differenceQty
      ]

      let x = margin

      values.forEach((value, cellIndex) => {
        drawCell(doc, x, startY, columns[cellIndex], rowHeight, value, fonts, {
          fontSize: 8.2,
          align:
            cellIndex === 0 || cellIndex === 3
              ? "center"
              : cellIndex === 4 || cellIndex === 5 || cellIndex === 6
                ? "right"
                : "left"
        })
        x += columns[cellIndex]
      })
    }

    function drawTotalsBlock(startY: number) {
      const blockWidth = 320
      const x = pageWidth - margin - blockWidth

      drawBox(doc, x, startY, blockWidth, totalsBlockHeight)

      let lineY = startY + 10

      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? fonts.bold : fonts.regular).fontSize(bold ? 9.5 : 8.8)
        doc.text(label, x + 10, lineY, {
          width: 180,
          align: "left"
        })
        doc.text(value, x + 200, lineY, {
          width: 100,
          align: "right"
        })
        lineY += bold ? 17 : 14
      }

      totalLine("Total stoc sistem", fmt(totalSystemQty, 3))
      totalLine("Total stoc numarat", fmt(totalCountedQty, 3))
      totalLine("Diferenta totala", fmt(totalDifferenceQty, 3), true)
    }

    function drawSignature(startY: number) {
      const blockWidth = 120
      const leftX = margin
      const centerX = pageWidth / 2 - blockWidth / 2
      const rightX = pageWidth - margin - blockWidth

      doc.font(fonts.bold).fontSize(8.5)
      doc.text("Intocmit", leftX, startY, { width: blockWidth, align: "center" })
      doc.text("Verificat", centerX, startY, { width: blockWidth, align: "center" })
      doc.text("Gestionar", rightX, startY, { width: blockWidth, align: "center" })

      doc.moveTo(leftX, startY + 22).lineTo(leftX + blockWidth, startY + 22).stroke("#111111")
      doc.moveTo(centerX, startY + 22).lineTo(centerX + blockWidth, startY + 22).stroke("#111111")
      doc.moveTo(rightX, startY + 22).lineTo(rightX + blockWidth, startY + 22).stroke("#111111")
    }

    function drawEmptyTable(startY: number) {
      const width = columns.reduce((sum, value) => sum + value, 0)
      drawCell(doc, margin, startY, width, rowHeight, "Nu exista pozitii in document.", fonts, {
        align: "center",
        fontSize: 8.8
      })
    }

    function availableRowsOnPage(isLastPage: boolean) {
      const reservedBottom = isLastPage ? totalsBlockHeight + 16 + signatureBlockHeight + 14 : 10

      return Math.max(
        1,
        Math.floor(
          (pageHeight -
            margin -
            headerBlockHeight -
            8 -
            metaBlockHeight -
            8 -
            tableHeaderHeight -
            reservedBottom) / rowHeight
        )
      )
    }

    const pages: RowData[][] = []
    if (rows.length === 0) {
      pages.push([])
    } else {
      let index = 0
      while (index < rows.length) {
        const remaining = rows.length - index
        const canFitLast = remaining <= availableRowsOnPage(true)
        const chunkSize = canFitLast ? availableRowsOnPage(true) : availableRowsOnPage(false)
        pages.push(rows.slice(index, index + chunkSize))
        index += chunkSize
      }
    }

    const totalPages = pages.length

    pages.forEach((pageRows, pageIndex) => {
      if (pageIndex > 0) {
        doc.addPage()
      }

      const currentPage = pageIndex + 1
      const isLastPage = currentPage === totalPages

      drawPageHeader(currentPage, totalPages)
      drawMetaBlock()

      let y = margin + headerBlockHeight + 8 + metaBlockHeight + 8

      drawTableHeader(y)
      y += tableHeaderHeight

      if (pageRows.length === 0) {
        drawEmptyTable(y)
        y += rowHeight
      } else {
        pageRows.forEach((row) => {
          drawRow(row, y)
          y += rowHeight
        })
      }

      if (isLastPage) {
        y += 10
        drawTotalsBlock(y)
        y += totalsBlockHeight + 14
        drawSignature(y)
      }
    })

    doc.end()
  } catch (error) {
    console.error("INVENTORY DOC PDF ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut genera PDF-ul inventarului."
    })
  }
})

export default router
