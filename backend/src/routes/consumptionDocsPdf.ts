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
        warehouse: true,
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
      return res.status(404).json({ ok: false, error: "Bonul de consum nu a fost gasit." })
    }

    const consumptionDoc = docData
    const validatedUser = consumptionDoc.validatedBy
      ? await prisma.user.findFirst({
          where: {
            id: consumptionDoc.validatedBy,
            tenantId,
          },
          select: {
            name: true,
            email: true,
          },
        })
      : null

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

    const metaCols = [120, 190, 120, 220]
    const metaRowHeight = 24

    const columns = [34, 430, 90, 110]
    const headers = [
      "Nr.",
      "Ingredient",
      "UM",
      "Cant.",
    ]

    const headerTitleHeight = 48
    const introHeight = 32
    const topHeaderHeight = 96
    const headerBlockHeight = Math.max(topHeaderHeight, headerTitleHeight + 10 + introHeight)
    const metaBlockHeight = metaRowHeight * 4
    const tableHeaderHeight = 28
    const rowHeight = 24
    const footerBlockHeight = 84
    const signatureBlockHeight = 56
    const metaTableWidth = metaCols.reduce((sum, value) => sum + value, 0)
    const metaStartX = margin + (contentWidth - metaTableWidth) / 2
    const itemsTableWidth = columns.reduce((sum, value) => sum + value, 0)
    const itemsStartX = margin + (contentWidth - itemsTableWidth) / 2

    type RowData = {
      no: string
      ingredient: string
      uom: string
      qty: string
    }

    const rows: RowData[] = docData.items.map((item, index) => ({
      no: String(index + 1),
      ingredient: text(item.ingredient?.name),
      uom: text(item.ingredient?.uom?.code),
      qty: fmt(item.qty, 3),
    }))

    const totalQty = rows.reduce((sum, row) => sum + num(row.qty), 0)

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

      drawBox(doc, margin, y, contentWidth, topHeaderHeight)
      doc
        .font(fonts.bold)
        .fontSize(12)
        .fillColor("#111111")
        .text(text(company?.name), margin + 8, y + 8, {
          width: 240,
          align: "left",
        })

      doc.font(fonts.regular).fontSize(8.7)
      const companyLines = [
        `CUI: ${text(company?.cui)}`,
        `Nr. Reg. Com.: ${text(company?.regNo)}`,
        `Adresa: ${text(company?.address)}`,
        `Email: ${text(company?.email)}`,
        `Telefon: ${text(company?.phone)}`,
      ]

      let companyY = y + 26
      for (const line of companyLines) {
        doc.text(line, margin + 8, companyY, {
          width: 240,
          align: "left",
        })
        companyY += 12
      }

      doc
        .font(fonts.bold)
        .fontSize(21)
        .text("BON DE CONSUM", margin, y + 16, {
          width: contentWidth,
          align: "center",
        })

      doc
        .font(fonts.regular)
        .fontSize(9)
        .text(
          "Act intern de consum materiale.",
          margin,
          y + 46,
          {
            width: contentWidth,
            align: "center",
          }
        )

      doc
        .font(fonts.regular)
        .fontSize(8.5)
        .text(`Pagina ${pageNo} / ${totalPagesCount}`, pageWidth - margin - 90, y - 2, {
          width: 90,
          align: "right",
        })

      if (consumptionDoc.status && consumptionDoc.status !== "VALIDATED") {
        doc.save()
        doc.rotate(-18, { origin: [pageWidth / 2, pageHeight / 2] })
        doc
          .font(fonts.bold)
          .fontSize(32)
          .fillColor(consumptionDoc.status === "DRAFT" ? "#b45309" : "#b91c1c")
          .opacity(0.16)
          .text(
            consumptionDoc.status === "DRAFT" ? "NEVALIDAT - NU A SCAZUT STOCUL" : "ANULAT",
            80,
            pageHeight / 2 - 20,
            { width: pageWidth - 160, align: "center" }
          )
        doc.restore()
      }
    }

    function drawMetaBlock() {
      let y = margin + headerBlockHeight + 10

      const metaRows = [
        ["Document", text(consumptionDoc.docNo), "Data document", fmtDateTime(consumptionDoc.docDate)],
        ["Locatie", text(consumptionDoc.location?.name), "Gestiune", text(consumptionDoc.warehouse?.name)],
        ["Status", text(consumptionDoc.status), "Nr. pozitii", String(consumptionDoc.items.length)],
        ["Nota", text(consumptionDoc.note), "Cantitate totala", fmt(totalQty, 3)],
      ]

      for (const row of metaRows) {
        let x = metaStartX

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
      let x = itemsStartX

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
      const values = [row.no, row.ingredient, row.uom, row.qty]

      let x = itemsStartX

      values.forEach((value, cellIndex) => {
        drawCell(doc, x, startY, columns[cellIndex], rowHeight, value, fonts, {
          fontSize: 8.4,
          align:
            cellIndex === 0 || cellIndex === 2
              ? "center"
              : cellIndex === 3
                ? "right"
                : "left",
        })
        x += columns[cellIndex]
      })
    }

    function drawFooterBlock(startY: number) {
      drawBox(doc, margin, startY, contentWidth, footerBlockHeight)

      let totalsY = startY + 10
      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? fonts.bold : fonts.regular).fontSize(bold ? 10 : 9)
        doc.text(label, margin + 12, totalsY, {
          width: 220,
          align: "left",
        })
        doc.text(value, margin + contentWidth - 120, totalsY, {
          width: 108,
          align: "right",
        })
        totalsY += bold ? 17 : 14
      }

      totalLine("Status document", text(consumptionDoc.status))
      totalLine("Nr. pozitii consum", String(consumptionDoc.items.length))
      totalLine("Cantitate totala consum", `${fmt(totalQty, 3)} ${text(docData.items[0]?.ingredient?.uom?.code || "")}`.trim(), true)
    }

    function drawSignature(startY: number) {
      const gap = 20
      const blockWidth = (contentWidth - gap) / 2
      const labels = ["Intocmit", "Predat din gestiune"]

      labels.forEach((label, index) => {
        const x = margin + index * (blockWidth + gap)
        doc.save()
        doc.lineWidth(0.7).strokeColor("#CBD5E1").rect(x, startY, blockWidth, 72).stroke()
        doc.restore()
        doc.save()
        doc.rect(x, startY, blockWidth, 24).fill("#EEF2F7")
        doc.restore()
        doc.save()
        doc.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, startY, blockWidth, 24).stroke()
        doc.restore()
        doc.font(fonts.bold).fontSize(9).text(label, x + 8, startY + 7, { width: blockWidth - 16, align: "center" })
        const value =
          label === "Intocmit"
            ? text(validatedUser?.name || validatedUser?.email || consumptionDoc.validatedBy || "-")
            : `${text(consumptionDoc.location?.name)}${consumptionDoc.warehouse?.name ? ` / ${text(consumptionDoc.warehouse?.name)}` : ""}`

        doc.font(fonts.regular).fontSize(8.5).fillColor("#111111").text(value, x + 8, startY + 40, {
          width: blockWidth - 16,
          align: "center",
        })
        doc.fillColor("#111111")
      })
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
        drawCell(doc, itemsStartX, y, itemsTableWidth, rowHeight, "Nu exista pozitii in document.", fonts, {
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
