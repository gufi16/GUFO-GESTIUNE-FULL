// @ts-nocheck
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

router.use((req: any, _res, next) => {
  const authHeader = String(req.headers.authorization || "").trim()
  const tokenFromQuery = String(req.query?.token || "").trim()

  if (!authHeader && tokenFromQuery) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`
  }

  next()
})

router.use(requireAuth)

function formatDate(value?: Date | string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function formatNumber(value?: number | null, digits = 2) {
  return Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function getPageWidth(doc: any) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right
}

function getBottomLimit(doc: any) {
  return doc.page.height - doc.page.margins.bottom
}

function ensureSpace(doc: any, neededHeight: number) {
  if (doc.y + neededHeight > getBottomLimit(doc)) {
    doc.addPage()
  }
}

function drawCenteredSectionTitle(doc: any, title: string) {
  ensureSpace(doc, 36)

  const pageWidth = getPageWidth(doc)

  doc.moveDown(0.5)
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor("#0f172a")
    .text(title, doc.page.margins.left, doc.y, {
      width: pageWidth,
      align: "center",
    })

  doc.moveDown(0.6)
}

function drawInfoCard(doc: any, x: number, y: number, width: number, height: number, title: string, lines: string[]) {
  doc.save()
  doc.roundedRect(x, y, width, height, 12).fill("#f8fafc")
  doc.restore()

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#64748b")
    .text(title, x + 16, y + 14)

  doc.font("Helvetica").fontSize(12).fillColor("#0f172a")

  let lineY = y + 40
  for (const line of lines) {
    doc.text(line, x + 16, lineY, {
      width: width - 32,
      align: "left",
    })
    lineY += 22
  }
}

function drawTableHeader(
  doc: any,
  startX: number,
  startY: number,
  widths: number[],
  headers: string[],
  rowHeight = 30
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

function drawTableRow(
  doc: any,
  startX: number,
  startY: number,
  widths: number[],
  values: string[],
  rowHeight = 28
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

function drawTableSection(params: {
  doc: any
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

  const pageWidth = getPageWidth(doc)
  const sectionTitleHeight = 34
  const minRequired = sectionTitleHeight + headerHeight + rowHeight

  ensureSpace(doc, minRequired)

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
    const nextY = drawTableHeader(doc, startX, doc.y, widths, headers, headerHeight)
    doc.y = nextY
  }

  drawSectionHeader()

  if (rows.length === 0) {
    if (doc.y + rowHeight > getBottomLimit(doc)) {
      doc.addPage()
      drawSectionHeader()
    }

    const nextY = drawTableRow(
      doc,
      startX,
      doc.y,
      widths,
      ["-", "Nu exista date", "-", "-"],
      rowHeight
    )
    doc.y = nextY + 16
    return
  }

  for (const row of rows) {
    if (doc.y + rowHeight > getBottomLimit(doc)) {
      doc.addPage()
      drawSectionHeader()
    }

    const nextY = drawTableRow(doc, startX, doc.y, widths, row, rowHeight)
    doc.y = nextY
  }

  doc.moveDown(1)
}

router.get("/api/v1/production-docs", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const q = String(req.query.q || "").trim()
    const locationId = String(req.query.locationId || "").trim()

    const docs = await prisma.productionDoc.findMany({
      where: {
        tenantId,
        companyId,
        ...(locationId ? { locationId } : {}),
        ...(q
          ? {
              OR: [
                { docNo: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
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
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    })

    const items = docs.map((doc) => ({
      id: doc.id,
      docNo: doc.docNo,
      docDate: doc.docDate,
      note: doc.note ?? "",
      locationId: doc.locationId,
      locationName: doc.location?.name ?? "",
      itemsCount: doc.items.length,
      totalQty: doc.items.reduce((sum, row) => sum + Number(row.qty || 0), 0),
      products: doc.items.map((row) => ({
        productId: row.productId,
        sku: row.product?.sku ?? "",
        name: row.product?.name ?? "",
        uom: row.product?.uom?.code ?? "",
        qty: Number(row.qty || 0),
      })),
    }))

    return res.json({ ok: true, items })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut încărca documentele de producție.",
    })
  }
})

router.get("/api/v1/production-docs/:id", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id || "").trim()

    const doc = await prisma.productionDoc.findFirst({
      where: {
        id,
        tenantId,
        companyId,
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                recipe: {
                  include: {
                    items: {
                      include: {
                        ingredient: {
                          include: {
                            uom: true,
                          },
                        },
                      },
                      orderBy: { sortOrder: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de producție nu există.",
      })
    }

    const items = doc.items.map((row) => {
      const yieldQty = Number(row.product?.recipe?.yieldQty || 1)
      const producedQty = Number(row.qty || 0)

      const ingredients =
        row.product?.recipe?.items?.map((recipeItem) => {
          const ingredientQty =
            (Number(recipeItem.qty || 0) * producedQty) / (yieldQty || 1)

          return {
            ingredientId: recipeItem.ingredientId,
            sku: recipeItem.ingredient?.sku ?? "",
            name: recipeItem.ingredient?.name ?? "",
            uom: recipeItem.ingredient?.uom?.code ?? "",
            qty: ingredientQty,
          }
        }) || []

      return {
        id: row.id,
        productId: row.productId,
        sku: row.product?.sku ?? "",
        name: row.product?.name ?? "",
        uom: row.product?.uom?.code ?? "",
        qty: producedQty,
        ingredients,
      }
    })

    return res.json({
      ok: true,
      item: {
        id: doc.id,
        docNo: doc.docNo,
        docDate: doc.docDate,
        note: doc.note ?? "",
        locationId: doc.locationId,
        locationName: doc.location?.name ?? "",
        itemsCount: items.length,
        totalQty: items.reduce((sum, row) => sum + row.qty, 0),
        items,
      },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut încărca documentul de producție.",
    })
  }
})

router.get("/api/v1/production-docs/:id/pdf", async (req: AuthedRequest, res) => {
  try {
    const tenantId = req.auth!.tenantId
    const companyId = await requireRequestCompanyId(req)
    const id = String(req.params.id || "").trim()

    const docData = await prisma.productionDoc.findFirst({
      where: {
        id,
        tenantId,
        companyId,
      },
      include: {
        location: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                recipe: {
                  include: {
                    items: {
                      include: {
                        ingredient: {
                          include: {
                            uom: true,
                          },
                        },
                      },
                      orderBy: { sortOrder: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!docData) {
      return res.status(404).json({
        ok: false,
        error: "Documentul de producție nu există.",
      })
    }

    const pdf = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 42,
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader(
      "Content-Disposition",
      `inline; filename="production-${docData.docNo}.pdf"`
    )

    pdf.pipe(res)

    const pageWidth = getPageWidth(pdf)

    pdf
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#0f172a")
      .text("BON PRODUCTIE", pdf.page.margins.left, pdf.y, {
        width: pageWidth,
        align: "center",
      })

    pdf.moveDown(1.3)

    const infoY = pdf.y
    const cardGap = 18
    const cardWidth = (pageWidth - cardGap) / 2
    const cardHeight = 84
    const leftX = pdf.page.margins.left
    const rightX = leftX + cardWidth + cardGap

    drawInfoCard(pdf, leftX, infoY, cardWidth, cardHeight, "DOCUMENT", [
      `Numar: ${docData.docNo}`,
      `Data: ${formatDate(docData.docDate)}`,
    ])

    drawInfoCard(pdf, rightX, infoY, cardWidth, cardHeight, "DETALII", [
      `Locatie: ${docData.location?.name || "-"}`,
      `Pozitii: ${docData.items.length}`,
    ])

    pdf.y = infoY + cardHeight + 28

    if (docData.note) {
      ensureSpace(pdf, 60)

      pdf
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#334155")
        .text("Observatii", pdf.page.margins.left, pdf.y, {
          width: pageWidth,
          align: "left",
        })

      pdf.moveDown(0.35)

      pdf
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#0f172a")
        .text(docData.note, pdf.page.margins.left, pdf.y, {
          width: pageWidth,
          align: "left",
        })

      pdf.moveDown(1)
    }

    const tableTotalWidth = pageWidth - 80
    const tableStartX = pdf.page.margins.left + 40

    const productsTableWidths = [100, tableTotalWidth - 100 - 90 - 120, 90, 120]

    const productRows = docData.items.map((row) => [
      row.product?.sku || "-",
      row.product?.name || "-",
      row.product?.uom?.code || "-",
      formatNumber(Number(row.qty || 0), 2),
    ])

    drawTableSection({
      doc: pdf,
      title: "Produse finite",
      headers: ["SKU", "Produs", "UM", "Cantitate"],
      rows: productRows,
      widths: productsTableWidths,
      startX: tableStartX,
      rowHeight: 28,
      headerHeight: 30,
    })

    const aggregatedIngredients = new Map<
      string,
      { sku: string; name: string; uom: string; qty: number }
    >()

    for (const row of docData.items) {
      const yieldQty = Number(row.product?.recipe?.yieldQty || 1) || 1
      const producedQty = Number(row.qty || 0)
      const recipeItems = row.product?.recipe?.items || []

      for (const recipeItem of recipeItems) {
        const baseQty = Number(recipeItem.qty || 0)
        const lossPercent = Number(recipeItem.lossPercent || 0)
        const computedQty = (baseQty * producedQty) / yieldQty
        const finalQty = computedQty * (1 + lossPercent / 100)

        const key = recipeItem.ingredientId
        const existing = aggregatedIngredients.get(key)

        if (existing) {
          existing.qty += finalQty
        } else {
          aggregatedIngredients.set(key, {
            sku: recipeItem.ingredient?.sku || "-",
            name: recipeItem.ingredient?.name || "-",
            uom: recipeItem.ingredient?.uom?.code || "-",
            qty: finalQty,
          })
        }
      }
    }

    const ingredientRows = Array.from(aggregatedIngredients.values()).map((ingredient) => [
      ingredient.sku,
      ingredient.name,
      ingredient.uom,
      formatNumber(ingredient.qty, 3),
    ])

    const ingredientsTableWidths = [100, tableTotalWidth - 100 - 90 - 120, 90, 120]

    drawTableSection({
      doc: pdf,
      title: "Consum ingrediente",
      headers: ["SKU", "Ingredient", "UM", "Cantitate"],
      rows:
        ingredientRows.length > 0
          ? ingredientRows
          : [["-", "Nu exista consum de ingrediente calculat", "-", "-"]],
      widths: ingredientsTableWidths,
      startX: tableStartX,
      rowHeight: 28,
      headerHeight: 30,
    })

    ensureSpace(pdf, 82)

    const totalsY = pdf.y
    const totalsHeight = 68

    pdf.save()
    pdf.roundedRect(tableStartX, totalsY, tableTotalWidth, totalsHeight, 12).fill("#f8fafc")
    pdf.restore()

    pdf
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#334155")
      .text("Rezumat", tableStartX, totalsY + 14, {
        width: tableTotalWidth,
        align: "center",
      })

    pdf
      .font("Helvetica")
      .fontSize(11.5)
      .fillColor("#0f172a")
      .text(
        `Total pozitii: ${docData.items.length}`,
        tableStartX,
        totalsY + 40,
        {
          width: tableTotalWidth / 2,
          align: "center",
        }
      )

    pdf.text(
      `Cantitate totala produse: ${formatNumber(
        docData.items.reduce((sum, row) => sum + Number(row.qty || 0), 0),
        2
      )}`,
      tableStartX + tableTotalWidth / 2,
      totalsY + 40,
      {
        width: tableTotalWidth / 2,
        align: "center",
      }
    )

    pdf.end()
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut genera PDF-ul documentului de producție.",
    })
  }
})

export default router
