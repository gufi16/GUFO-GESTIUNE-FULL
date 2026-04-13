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

function fmt(v: any, d = 2) {
  return num(v).toFixed(d)
}

function fmtDate(v: any) {
  if (!v) return "-"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
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
      align: options?.align ?? "left",
    })
}

router.get("/:id/pdf", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const { id } = req.params

    const docData = await prisma.consumptionDoc.findFirst({
      where: { id, tenantId, companyId },
      include: {
        location: true,
        sale: {
          include: {
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
        },
        items: {
          include: {
            ingredient: {
              include: {
                uom: true,
              },
            },
            finishedProduct: {
              include: {
                uom: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    if (!docData) {
      return res.status(404).json({ ok: false, error: "Bonul de consum nu a fost găsit." })
    }

    const consumptionDoc = docData

    const company = await resolveTenantCompany(prisma, tenantId, companyId)

    const filename = `BonConsum_${safeFilePart(consumptionDoc.docNo)}_${safeFilePart(consumptionDoc.location?.name || "locatie")}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 20,
      info: {
        Title: filename,
        Author: company?.name || "Gufo ERP",
        Subject: `Bon de consum ${consumptionDoc.docNo}`,
      },
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

    const metaCols = [96, 170, 90, 120, 90, 154]
    const metaRowHeight = 22

    const columns = [34, 170, 170, 60, 60, 160]
    const headers = [
      "Nr.",
      "Produs finit",
      "Ingredient",
      "UM",
      "Cant.",
      "Observatii",
    ]

    const headerTitleHeight = 48
    const introHeight = 70
    const topHeaderHeight = 128
    const headerBlockHeight = Math.max(topHeaderHeight, headerTitleHeight + 10 + introHeight)
    const metaBlockHeight = metaRowHeight * 3
    const tableHeaderHeight = 28
    const rowHeight = 24
    const footerBlockHeight = 120
    const signatureBlockHeight = 56

    type RowData = {
      no: string
      finishedProduct: string
      ingredient: string
      uom: string
      qty: string
      note: string
    }

    const rows: RowData[] = docData.items.map((item, index) => ({
      no: String(index + 1),
      finishedProduct: text(item.finishedProduct?.name),
      ingredient: text(item.ingredient?.name),
      uom: text(item.ingredient?.uom?.code),
      qty: fmt(item.qty, 3),
      note: text(item.note),
    }))

    const totalQty = rows.reduce((sum, row) => sum + num(row.qty), 0)

    const groupedFinishedProducts = Array.from(
      new Map(
        docData.items
          .filter((item) => item.finishedProduct)
          .map((item) => [
            item.finishedProduct!.id,
            {
              name: item.finishedProduct!.name,
              qtySold:
                docData.sale?.items
                  .filter((saleItem) => saleItem.productId === item.finishedProductId)
                  .reduce((acc, saleItem) => acc + num(saleItem.qty), 0) || 0,
              uom: item.finishedProduct?.uom?.code || "",
            },
          ])
      ).values()
    )

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
          footerBlockHeight -
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
          align: "left",
        })

      doc.font(fonts.regular).fontSize(8.5)
      const companyLines = [
        `CUI: ${text(company?.cui)}`,
        `Nr. Reg. Com.: ${text(company?.regNo)}`,
        `Adresa: ${text(company?.address)}`,
        `Banca: ${text(company?.bank)}`,
        `IBAN: ${text(company?.iban)}`,
        `Email: ${text(company?.email)}`,
        `Telefon: ${text(company?.phone)}`,
      ]

      let companyY = y + 26
      for (const line of companyLines) {
        doc.text(line, margin + 8, companyY, {
          width: companyWidth - 16,
          align: "left",
        })
        companyY += 12
      }

      const rightX = margin + companyWidth + gap

      drawBox(doc, rightX, y, rightWidth, headerTitleHeight)
      doc
        .font(fonts.bold)
        .fontSize(18)
        .text("BON DE CONSUM", rightX + 8, y + 14, {
          width: rightWidth - 16,
          align: "center",
        })

      drawBox(doc, rightX, y + headerTitleHeight + 10, rightWidth, introHeight)
      doc
        .font(fonts.regular)
        .fontSize(8.5)
        .text(
          "Document generat automat din consumul pe retetar. Bonul reflecta materiile prime si ingredientele consumate pentru produsele finite vandute prin POS.",
          rightX + 8,
          y + headerTitleHeight + 22,
          {
            width: rightWidth - 16,
            align: "justify",
          }
        )

      doc
        .font(fonts.regular)
        .fontSize(8.5)
        .text(`Pagina ${pageNo} / ${totalPagesCount}`, pageWidth - margin - 90, y - 2, {
          width: 90,
          align: "right",
        })
    }

    function drawMetaBlock() {
      let y = margin + headerBlockHeight + 10

      const saleReceiptNo = consumptionDoc.sale?.receiptNo || "-"
      const operatorName = consumptionDoc.sale?.operatorName || "-"
      const saleDate = consumptionDoc.sale?.soldAt ? fmtDateTime(consumptionDoc.sale.soldAt) : "-"

      const metaRows = [
        [
          "Document",
          text(consumptionDoc.docNo),
          "Data document",
          fmtDateTime(consumptionDoc.docDate),
          "Locatie",
          text(consumptionDoc.location?.name),
        ],
        [
          "Bon POS",
          text(saleReceiptNo),
          "Data vanzarii",
          saleDate,
          "Operator",
          text(operatorName),
        ],
        [
          "Nota",
          text(consumptionDoc.note),
          "Nr. pozitii",
          String(consumptionDoc.items.length),
          "Cantitate totala",
          fmt(totalQty, 3),
        ],
      ]

      for (const row of metaRows) {
        let x = margin

        for (let i = 0; i < metaCols.length; i++) {
          const cellText = row[i] || ""
          const isLabel = i % 2 === 0 && cellText !== ""

          drawCell(doc, x, y, metaCols[i], metaRowHeight, cellText, fonts, {
            bold: isLabel,
            fontSize: 9,
            align: "left",
            fillColor: isLabel ? "#f3f3f3" : null,
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
          align: index === 0 || index === 3 || index === 4 ? "center" : "left",
          fillColor: "#f3f3f3",
        })
        x += columns[index]
      })
    }

    function drawRow(row: RowData, startY: number) {
      const values = [
        row.no,
        row.finishedProduct,
        row.ingredient,
        row.uom,
        row.qty,
        row.note,
      ]

      let x = margin

      values.forEach((value, cellIndex) => {
        drawCell(doc, x, startY, columns[cellIndex], rowHeight, value, fonts, {
          fontSize: 8.4,
          align:
            cellIndex === 0 || cellIndex === 3
              ? "center"
              : cellIndex === 4
                ? "right"
                : "left",
        })
        x += columns[cellIndex]
      })
    }

    function drawFooterBlock(startY: number) {
      const leftWidth = 360
      const rightWidthBox = 280
      const rightX = margin + contentWidth - rightWidthBox

      drawBox(doc, margin, startY, leftWidth, footerBlockHeight)
      doc.font(fonts.bold).fontSize(10).text("Produse finite implicate", margin + 8, startY + 8, {
        width: leftWidth - 16,
        align: "left",
      })

      let y = startY + 28
      if (groupedFinishedProducts.length === 0) {
        doc.font(fonts.regular).fontSize(9).text("Nu exista produse finite asociate.", margin + 8, y, {
          width: leftWidth - 16,
          align: "left",
        })
      } else {
        groupedFinishedProducts.forEach((item) => {
          doc.font(fonts.regular).fontSize(9).text(
            `${item.name} - ${fmt(item.qtySold, 3)} ${item.uom || ""}`.trim(),
            margin + 8,
            y,
            {
              width: leftWidth - 16,
              align: "left",
            }
          )
          y += 14
        })
      }

      drawBox(doc, rightX, startY, rightWidthBox, footerBlockHeight)

      let totalsY = startY + 10
      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? fonts.bold : fonts.regular).fontSize(bold ? 10 : 9)
        doc.text(label, rightX + 8, totalsY, {
          width: 170,
          align: "left",
        })
        doc.text(value, rightX + 186, totalsY, {
          width: 70,
          align: "right",
        })
        totalsY += bold ? 17 : 14
      }

      totalLine("Nr. pozitii consum", String(consumptionDoc.items.length))
      totalLine("Cantitate totala consum", fmt(totalQty, 3), true)

      if (consumptionDoc.sale) {
        totalsY += 6
        doc.moveTo(rightX + 8, totalsY).lineTo(rightX + rightWidthBox - 8, totalsY).stroke("#111111")
        totalsY += 8
        totalLine("Bon POS", text(consumptionDoc.sale.receiptNo))
        totalLine("Total vanzare", fmt(num(consumptionDoc.sale.total)), true)
      }
    }

    function drawSignature(startY: number) {
      const leftX = margin
      const midX = pageWidth / 2 - 70
      const rightX = pageWidth - margin - 140

      doc.font(fonts.bold).fontSize(9)
      doc.text("Intocmit", leftX, startY, { width: 120, align: "center" })
      doc.text("Verificat", midX, startY, { width: 120, align: "center" })
      doc.text("Gestionar", rightX, startY, { width: 120, align: "center" })

      doc.moveTo(leftX, startY + 28).lineTo(leftX + 120, startY + 28).stroke("#111111")
      doc.moveTo(midX, startY + 28).lineTo(midX + 120, startY + 28).stroke("#111111")
      doc.moveTo(rightX, startY + 28).lineTo(rightX + 120, startY + 28).stroke("#111111")
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
          fontSize: 9,
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
        drawFooterBlock(y)
        y += footerBlockHeight + 18
        drawSignature(y)
      }
    })

    doc.end()
  } catch (error) {
    console.error("CONSUMPTION DOC PDF ERROR:", error)
    return res.status(500).json({
      ok: false,
      error: "Nu am putut genera PDF-ul bonului de consum.",
    })
  }
})

export default router
