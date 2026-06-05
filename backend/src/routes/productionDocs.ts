// @ts-nocheck
import { Router } from "express"
import PDFDocument from "pdfkit"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireRequestCompanyId } from "../lib/companyScope"
import { resolveTenantCompany } from "../lib/companyResolver"
import {
  drawProductionTableSection,
  ensureProductionPdfSpace,
  formatProductionPdfDate,
  formatProductionPdfNumber,
  getProductionPdfPageWidth,
} from "../lib/productionDocPdfSupport"

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
      error: e?.message || "Nu am putut incarca documentele de productie.",
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
        error: "Documentul de productie nu exista.",
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
      error: e?.message || "Nu am putut incarca documentul de productie.",
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
        error: "Documentul de productie nu exista.",
      })
    }

    const company = await resolveTenantCompany(prisma, tenantId, companyId)

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

    const pageWidth = getProductionPdfPageWidth(pdf)
    const fullWidth = pageWidth
    const headerY = pdf.y
    const leftW = 230
    const rightW = 180
    const centerW = fullWidth - leftW - rightW
    const leftX = pdf.page.margins.left
    const centerX = leftX + leftW
    const rightX = centerX + centerW

    pdf.save()
    pdf.lineWidth(0.8).strokeColor("#CBD5E1").rect(leftX, headerY, fullWidth, 86).stroke()
    pdf.moveTo(centerX, headerY).lineTo(centerX, headerY + 86).stroke()
    pdf.moveTo(rightX, headerY).lineTo(rightX, headerY + 86).stroke()
    pdf.restore()

    pdf.font("Helvetica-Bold").fontSize(12.5).fillColor("#111827").text(company?.name || "Gufo Gestiune", leftX + 12, headerY + 16, {
      width: leftW - 24,
      align: "left",
    })
    pdf.font("Helvetica").fontSize(9).fillColor("#334155").text("ERP gestiune - document productie", leftX + 12, headerY + 34, {
      width: leftW - 24,
      align: "left",
    })

    pdf.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text("BON DE PRODUCTIE", centerX + 12, headerY + 18, {
      width: centerW - 24,
      align: "center",
    })

    pdf.font("Helvetica").fontSize(9.5).fillColor("#111827")
    pdf.text(`Nr: ${docData.docNo}`, rightX + 12, headerY + 16, { width: rightW - 24, align: "left" })
    pdf.text(`Data: ${formatProductionPdfDate(docData.docDate)}`, rightX + 12, headerY + 30, { width: rightW - 24, align: "left" })
    pdf.text(`Status: ${docData.status || "-"}`, rightX + 12, headerY + 44, { width: rightW - 24, align: "left" })

    pdf.y = headerY + 98

    const metaStartX = pdf.page.margins.left + 12
    const metaTableWidth = pageWidth - 24
    const metaCols = [96, 170, 84, 108, 74, metaTableWidth - 96 - 170 - 84 - 108 - 74]
    const metaRows = [
      ["Locatie", docData.location?.name || "-", "Pozitii", String(docData.items.length), "Status", docData.status || "-"],
      ["Data", formatProductionPdfDate(docData.docDate), "Cantitate", formatProductionPdfNumber(docData.items.reduce((sum, row) => sum + Number(row.qty || 0), 0), 2), "Responsabil", "-"],
    ]

    let metaY = pdf.y
    for (const row of metaRows) {
      let x = metaStartX
      for (let i = 0; i < metaCols.length; i++) {
        const width = metaCols[i]
        const isLabel = i % 2 === 0
        pdf.save()
        if (isLabel) pdf.rect(x, metaY, width, 24).fill("#E8EEF6")
        pdf.restore()
        pdf.save()
        pdf.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, metaY, width, 24).stroke()
        pdf.restore()
        pdf.font(isLabel ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#111827").text(row[i], x + 8, metaY + 7, {
          width: width - 16,
          align: "left",
        })
        x += width
      }
      metaY += 24
    }

    pdf.y = metaY + 18

    if (docData.note) {
      ensureProductionPdfSpace(pdf, 60)

      pdf
        .font("Helvetica")
        .fontSize(10)
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
      formatProductionPdfNumber(Number(row.qty || 0), 2),
    ])

    drawProductionTableSection({
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
      formatProductionPdfNumber(ingredient.qty, 3),
    ])

    const ingredientsTableWidths = [100, tableTotalWidth - 100 - 90 - 120, 90, 120]

    drawProductionTableSection({
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

    ensureProductionPdfSpace(pdf, 150)

    const totalsY = pdf.y
    const totalsHeight = 52

    pdf.save()
    pdf.roundedRect(tableStartX, totalsY, tableTotalWidth, totalsHeight, 12).fill("#f8fafc")
    pdf.restore()

    pdf
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#0f172a")
      .text(
        `Total pozitii: ${docData.items.length}`,
        tableStartX,
        totalsY + 18,
        {
          width: tableTotalWidth / 2,
          align: "center",
        }
      )

    pdf.text(
        `Cantitate totala produse: ${formatProductionPdfNumber(
        docData.items.reduce((sum, row) => sum + Number(row.qty || 0), 0),
        2
      )}`,
      tableStartX + tableTotalWidth / 2,
      totalsY + 18,
      {
        width: tableTotalWidth / 2,
        align: "center",
      }
    )

    const signY = totalsY + totalsHeight + 20
    const signGap = 16
    const signWidth = (tableTotalWidth - signGap * 2) / 3
    ;["Intocmit", "Responsabil productie", "Aprobat"].forEach((label, index) => {
      const x = tableStartX + index * (signWidth + signGap)
      pdf.save()
      pdf.lineWidth(0.7).strokeColor("#CBD5E1").rect(x, signY, signWidth, 72).stroke()
      pdf.restore()
      pdf.save()
      pdf.rect(x, signY, signWidth, 26).fill("#EEF2F7")
      pdf.restore()
      pdf.save()
      pdf.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, signY, signWidth, 26).stroke()
      pdf.restore()
      pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(label, x + 10, signY + 8, {
        width: signWidth - 20,
        align: "center",
      })
      pdf.font("Helvetica").fontSize(8.5).fillColor("#64748B").text("Nume / semnatura", x + 10, signY + 46, {
        width: signWidth - 20,
        align: "center",
      })
    })

    pdf.end()
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut genera PDF-ul documentului de productie.",
    })
  }
})

export default router
