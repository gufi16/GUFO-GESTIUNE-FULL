import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { MinutesDocType, Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { getNextNumberPreview, reserveNextNumber } from "../lib/numbering"
import { assertSufficientStock, decrementStockBalanceStrict } from "../lib/stock"
import { requireRequestCompanyId, resolveRequestCompany } from "../lib/companyScope"
import { drawSimpleTable, drawSignatureRow, drawTotalsBox, ensurePdfPage, pdfDate, pdfFmt, pdfText, registerPdfFonts } from "../lib/professionalPdf"
import {
  formatMinutesMoney,
  formatMinutesQty,
  minutesDocNumber,
  minutesDocText,
  minutesDocTypeLabel,
  minutesDocTypeShortLabel,
  minutesFindingLabel,
  minutesReasonLabel,
  parseMinutesDocDate,
  safeMinutesDocFilePart,
} from "../lib/minutesDocSupport"

const router = Router()

router.use(requireAuth)

type MinutesDocItemInput = {
  productId?: unknown
  qty?: unknown
  unitValue?: unknown
  oldPrice?: unknown
  newPrice?: unknown
  note?: unknown
}

type PdfTableColumn = {
  label: string
  width: number
  align?: "left" | "center" | "right"
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

function drawBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fillColor?: string | null) {
  doc.save()
  if (fillColor) {
    doc.fillColor(fillColor).rect(x, y, w, h).fill()
  }
  doc.lineWidth(0.8).strokeColor("#CBD5E1").rect(x, y, w, h).stroke()
  doc.restore()
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  textValue: string,
  fonts: { regular: string; bold: string },
  options?: {
    bold?: boolean
    align?: "left" | "center" | "right"
    fillColor?: string | null
    fontSize?: number
    paddingX?: number
  }
) {
  drawBox(doc, x, y, w, h, options?.fillColor || null)
  doc
    .font(options?.bold ? fonts.bold : fonts.regular)
    .fontSize(options?.fontSize || 8.6)
    .fillColor("#111827")
    .text(textValue || "", x + (options?.paddingX ?? 5), y + 6, {
      width: w - ((options?.paddingX ?? 5) * 2),
      align: options?.align || "left",
      ellipsis: true,
    })
}

async function recalcMinutesDoc(docId: string) {
  const items = await prisma.minutesDocItem.findMany({
    where: { minutesDocId: docId },
  })

  const totalQty = items.reduce((sum, item) => sum + minutesDocNumber(item.qty), 0)
  const totalValue = items.reduce((sum, item) => sum + minutesDocNumber(item.lineValue), 0)

  return prisma.minutesDoc.update({
    where: { id: docId },
    data: {
      totalQty,
      totalValue,
    },
  })
}

async function applyMinutesDoc(tenantId: string, companyId: string, docId: string) {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.minutesDoc.findFirst({
      where: { id: docId, tenantId, companyId },
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
    })

    if (!doc) throw new Error("Documentul nu a fost gasit.")
    if (doc.status !== "DRAFT") throw new Error("Doar documentele DRAFT pot fi postate.")

    if (doc.type === "DETERIORATION") {
      for (const item of doc.items) {
        await assertSufficientStock(tx, {
          tenantId,
          companyId,
          locationId: doc.locationId,
          productId: item.productId,
          requiredQty: item.qty,
          productName: item.product.name,
          uomCode: item.product.uom?.code,
        })

        await decrementStockBalanceStrict(tx, {
          tenantId,
          companyId,
          locationId: doc.locationId,
          productId: item.productId,
          qty: item.qty,
          productName: item.product.name,
          uomCode: item.product.uom?.code,
        })

        await tx.stockMove.create({
          data: {
            tenantId,
            locationId: doc.locationId,
            productId: item.productId,
            type: "OUT",
            qty: item.qty,
            refType: "MINUTES",
            refId: doc.id,
            note: `${doc.docNo} - ${minutesReasonLabel(doc.reasonCode)}`,
          },
        })
      }
    } else {
      for (const item of doc.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            price: new Prisma.Decimal(item.newPrice || item.oldPrice || 0),
          },
        })
      }
    }

    return tx.minutesDoc.update({
      where: { id: doc.id },
      data: {
        status: "POSTED",
      },
    })
  })
}

async function reserveUniqueMinutesDocNo(
  tenantId: string,
  key: "deterioration" | "priceChange"
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const nextDocNo = await prisma.$transaction((tx) => reserveNextNumber(tx, tenantId, key))
    const existing = await prisma.minutesDoc.findFirst({
      where: { tenantId, docNo: nextDocNo },
      select: { id: true },
    })

    if (!existing) {
      return nextDocNo
    }
  }

  throw new Error("Nu pot genera urmatorul numar de document. Verifica seriile si numerotarea.")
}

async function assertManualDocNoAvailable(tenantId: string, docNo: string, currentId?: string | null) {
  const existing = await prisma.minutesDoc.findFirst({
    where: {
      tenantId,
      docNo,
      ...(currentId ? { NOT: { id: currentId } } : {}),
    },
    select: { id: true },
  })

  if (existing) {
    throw new Error("Numarul documentului exista deja.")
  }
}

router.get("/api/v1/minutes-docs", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Tenant invalid." })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa este obligatorie." })
  const activeCompanyId = companyId
  const type = String(req.query.type || "").trim().toUpperCase()

  const docs = await prisma.minutesDoc.findMany({
    where: {
      tenantId,
      companyId: activeCompanyId,
      ...(type === "DETERIORATION" || type === "PRICE_CHANGE" ? { type: type as MinutesDocType } : {}),
    },
    include: {
      location: true,
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
  })

  res.json({
    ok: true,
    items: docs.map((doc) => ({
      ...doc,
      itemsCount: doc.items.length,
    })),
  })
})

router.get("/api/v1/minutes-docs/:id", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Tenant invalid." })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa este obligatorie." })
  const activeCompanyId = companyId
  const { id } = req.params

  const doc = await prisma.minutesDoc.findFirst({
    where: { id, tenantId, companyId: activeCompanyId },
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
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
  }

  return res.json({ ok: true, item: doc })
})

router.post("/api/v1/minutes-docs/full", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Tenant invalid." })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa este obligatorie." })
  const activeCompanyId = companyId
  const { id, header, items, postNow } = req.body || {}

  try {
    const rawType = String(header?.type || "").trim().toUpperCase()
    const locationId = minutesDocText(header?.locationId)
    const docDate = parseMinutesDocDate(header?.docDate)
    const reasonCode = minutesDocText(header?.reasonCode)
    const findingCode = minutesDocText(header?.findingCode)
    const note = minutesDocText(header?.note)
    const rawDocNo = String(header?.docNo || "").trim()
    const type: MinutesDocType | null =
      rawType === "DETERIORATION" || rawType === "PRICE_CHANGE" ? rawType : null

    if (!type) {
      return res.status(400).json({ ok: false, error: "Tip document invalid." })
    }
    if (!locationId) return res.status(400).json({ ok: false, error: "Selecteaza locatia." })
    if (!docDate) return res.status(400).json({ ok: false, error: "Completeaza data documentului." })
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Documentul trebuie sa aiba cel putin o pozitie." })
    }

    let docId = id ? String(id) : null
    const numberingKey: "deterioration" | "priceChange" = type === "DETERIORATION" ? "deterioration" : "priceChange"
    const preview = !docId ? await getNextNumberPreview(tenantId, numberingKey) : null
    const shouldConsumeAutoNumber = !docId && (!rawDocNo || rawDocNo === preview?.value)
    const autoDocNo = shouldConsumeAutoNumber ? await reserveUniqueMinutesDocNo(tenantId, numberingKey) : ""
    const finalDocNo = shouldConsumeAutoNumber ? autoDocNo : rawDocNo

    if (!finalDocNo) {
    return res.status(400).json({ ok: false, error: "Completeaza numarul documentului." })
    }

    if (!shouldConsumeAutoNumber) {
      await assertManualDocNoAvailable(tenantId, finalDocNo, docId)
    }

    if (!docId) {
      const created = await prisma.minutesDoc.create({
        data: {
          tenantId,
          companyId: activeCompanyId,
          locationId,
          type,
          docNo: finalDocNo,
          docDate,
          reasonCode,
          findingCode,
          note,
          status: "DRAFT",
        },
      })
      docId = created.id
    } else {
      const existing = await prisma.minutesDoc.findFirst({
        where: { id: docId, tenantId, companyId: activeCompanyId },
      })

      if (!existing) return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
      if (existing.status !== "DRAFT") {
        return res.status(400).json({ ok: false, error: "Documentul POSTED este read-only." })
      }

      await prisma.minutesDoc.update({
        where: { id: docId },
        data: {
          locationId,
          type,
          docNo: finalDocNo,
          docDate,
          reasonCode,
          findingCode,
          note,
        },
      })

      await prisma.minutesDocItem.deleteMany({
        where: { minutesDocId: docId },
      })
    }

    for (const raw of items as MinutesDocItemInput[]) {
      const productId = String(raw?.productId || "").trim()
      const qty = Math.max(0, minutesDocNumber(raw?.qty))
      const unitValue = Math.max(0, minutesDocNumber(raw?.unitValue))
      const oldPrice = raw?.oldPrice == null ? null : Math.max(0, minutesDocNumber(raw?.oldPrice))
      const newPrice = raw?.newPrice == null ? null : Math.max(0, minutesDocNumber(raw?.newPrice))

      if (!productId) throw new Error("Fiecare linie trebuie sa aiba produs.")
      if (type === "DETERIORATION" && qty <= 0) throw new Error("Cantitatea trebuie sa fie mai mare decat 0.")
    if (type === "PRICE_CHANGE" && newPrice == null) throw new Error("Completeaza pretul nou.")

      await prisma.minutesDocItem.create({
        data: {
          minutesDocId: docId,
          productId,
          qty,
          unitValue,
          oldPrice,
          newPrice,
          lineValue: type === "DETERIORATION" ? qty * unitValue : qty * Math.max(0, minutesDocNumber(newPrice)),
          note: minutesDocText(raw?.note),
        },
      })
    }

    if (!docId) throw new Error("Documentul nu a fost salvat corect.")
    const persistedDocId = docId

    await recalcMinutesDoc(persistedDocId)

    if (postNow === true) {
      await applyMinutesDoc(tenantId, activeCompanyId, persistedDocId)
    }

    const doc = await prisma.minutesDoc.findFirst({
      where: { id: persistedDocId, tenantId, companyId: activeCompanyId },
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
    })

    return res.json({ ok: true, item: doc })
  } catch (e: unknown) {
    return res.status(400).json({
      ok: false,
      error: e instanceof Error ? e.message : "Eroare la salvarea documentului",
    })
  }
})

router.get("/api/v1/minutes-docs/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = String(req.auth?.tenantId || "").trim()
  if (!tenantId) return res.status(401).json({ ok: false, error: "Tenant invalid." })
  const companyId = await requireRequestCompanyId(req)
  if (!companyId) return res.status(400).json({ ok: false, error: "Compania activa este obligatorie." })
  const activeCompanyId = companyId
  const { id } = req.params

  const docData = await prisma.minutesDoc.findFirst({
    where: { id, tenantId, companyId: activeCompanyId },
    include: {
      location: true,
      items: {
        include: {
          product: {
            include: { uom: true },
          },
        },
      },
    },
  })

  if (!docData) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost gasit." })
  }

  const company = await resolveRequestCompany(req)
  const filename = `${safeMinutesDocFilePart(docData.docNo)}.pdf`
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: "A4", margin: 36 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 36
  const pageWidth = doc.page.width
  const contentWidth = pageWidth - margin * 2

  const drawHeader = () => {
    const y = margin
    const leftWidth = 190
    const rightWidth = 160
    const centerWidth = contentWidth - leftWidth - rightWidth
    const centerX = margin + leftWidth
    const rightX = centerX + centerWidth
    const titleText = minutesDocTypeLabel(docData.type)

    doc.font(fonts.bold).fontSize(12).fillColor('#111827').text(pdfText(company?.name), margin, y + 8, {
      width: leftWidth - 16,
      align: 'left',
    })

    const companyLines = [
      `CUI: ${pdfText(company?.cui)}`,
      `Reg. com.: ${pdfText(company?.regNo)}`,
      `Adresa: ${pdfText(company?.address)}`,
      `Localitate: ${pdfText(company?.city)} / ${pdfText(company?.county)}`,
      `Email: ${pdfText(company?.contactEmail || company?.email)}`,
    ]

    let companyY = y + 28
    doc.font(fonts.regular).fontSize(8.6).fillColor('#334155')
    companyLines.forEach((lineText) => {
      doc.text(lineText, margin, companyY, {
        width: leftWidth - 16,
        align: 'left',
      })
      companyY += 10
    })

    doc.font(fonts.bold).fontSize(16).fillColor('#111827').text(titleText, centerX + 10, y + 6, {
      width: centerWidth - 20,
      align: 'center',
    })
    const titleHeight = doc.heightOfString(titleText, {
      width: centerWidth - 20,
      align: 'center',
    })
    const subtitleY = y + 10 + titleHeight
    doc.font(fonts.regular).fontSize(8.8).fillColor('#475569').text('Document justificativ de gestiune', centerX + 10, subtitleY, {
      width: centerWidth - 20,
      align: 'center',
    })
    const subtitleBottom = subtitleY + doc.heightOfString('Document justificativ de gestiune', {
      width: centerWidth - 20,
      align: 'center',
    })

    const rightLines = [
      `Numar: ${pdfText(docData.docNo)}`,
      `Data: ${pdfDate(docData.docDate)}`,
      `Status: ${pdfText(docData.status)}`,
    ]
    let rightY = y + 10
    doc.font(fonts.regular).fontSize(9.2).fillColor('#111827')
    rightLines.forEach((lineText) => {
      doc.text(lineText, rightX, rightY, {
        width: rightWidth,
        align: 'left',
      })
      rightY += 14
    })

    return Math.max(companyY + 10, rightY + 8, subtitleBottom + 8, y + 90)
  }

  const drawInfoTable = (x: number, startY: number, width: number, title: string, pairs: Array<{ label: string; value: string }>) => {
    const labelWidth = 118
    const titleHeight = 32
    const rowHeights = pairs.map((pair) => {
      const valueHeight = doc.heightOfString(pair.value || "-", {
        width: width - labelWidth - 20,
        align: "left",
      })
      return Math.max(30, Math.ceil(valueHeight) + 10)
    })
    const totalHeight = titleHeight + rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0)

    doc.save()
    doc.lineWidth(0.8).strokeColor("#CBD5E1").rect(x, startY, width, totalHeight).stroke()
    doc.restore()
    doc.font(fonts.bold).fontSize(10.5).fillColor("#0F172A").text(title, x + 12, startY + 11, {
      width: width - 24,
      align: "left",
    })

    let rowY = startY + titleHeight
    pairs.forEach((pair, index) => {
      const rowHeight = rowHeights[index]
      doc.save()
      doc.rect(x, rowY, labelWidth, rowHeight).fill("#E8EEF6")
      doc.restore()
      doc.save()
      doc.lineWidth(0.6).strokeColor("#CBD5E1").rect(x, rowY, width, rowHeight).stroke()
      doc.restore()
      doc.font(fonts.bold).fontSize(8.4).fillColor("#334155").text(pair.label, x + 8, rowY + 8, {
        width: labelWidth - 16,
        align: "left",
      })
      doc.font(fonts.regular).fontSize(8.8).fillColor("#111827").text(pair.value || "-", x + labelWidth + 10, rowY + 7, {
        width: width - labelWidth - 18,
        align: "left",
      })
      rowY += rowHeight
    })

    return startY + totalHeight
  }

  let y = drawHeader()
  const infoGap = 18
  const infoWidth = (contentWidth - infoGap) / 2
  const leftBottom = drawInfoTable(margin, y, infoWidth, 'Date document', [
    { label: 'Locatie', value: pdfText(docData.location.name) },
    { label: 'Motiv', value: minutesReasonLabel(docData.reasonCode) },
    { label: 'Tip', value: minutesDocTypeShortLabel(docData.type) },
    { label: 'Cantitate totala', value: pdfFmt(docData.totalQty, 3) },
  ])
  const rightBottom = drawInfoTable(margin + infoWidth + infoGap, y, infoWidth, 'Constatare / observatii', [
    { label: 'Valoare totala', value: `${pdfFmt(docData.totalValue)} RON` },
    { label: 'Constatare', value: docData.type === 'DETERIORATION' ? minutesFindingLabel(docData.findingCode, docData.reasonCode) : 'Actualizare preturi comerciale' },
    { label: 'Nota', value: pdfText(docData.note) },
  ])
  y = Math.max(leftBottom, rightBottom) + 18

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Pozitii document', margin, y)
  y += 14

  const columns: PdfTableColumn[] = docData.type === 'DETERIORATION'
    ? [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 150, align: 'left' },
        { label: 'Cod', width: 56, align: 'left' },
        { label: 'UM', width: 38, align: 'center' },
        { label: 'Cant.', width: 48, align: 'right' },
        { label: 'Val. unit.', width: 58, align: 'right' },
        { label: 'Valoare', width: 58, align: 'right' },
        { label: 'Nota linie', width: 87, align: 'left' },
      ]
    : [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 145, align: 'left' },
        { label: 'Cod', width: 56, align: 'left' },
        { label: 'UM', width: 34, align: 'center' },
        { label: 'Pret vechi', width: 65, align: 'right' },
        { label: 'Pret nou', width: 65, align: 'right' },
        { label: 'Impact', width: 60, align: 'right' },
        { label: 'Nota', width: 70, align: 'left' },
      ]

  const rows = docData.items.map((item, index) => docData.type === 'DETERIORATION'
    ? [
        String(index + 1),
        item.product.name,
        pdfText(item.product?.sku),
        item.product.uom?.code || '-',
        pdfFmt(item.qty, 3),
        pdfFmt(item.unitValue),
        pdfFmt(item.lineValue),
        pdfText(item.note),
      ]
    : [
        String(index + 1),
        item.product.name,
        pdfText(item.product?.sku),
        item.product.uom?.code || '-',
        pdfFmt(item.oldPrice),
        pdfFmt(item.newPrice),
        pdfFmt(item.lineValue),
        pdfText(item.note),
      ])

  y = drawSimpleTable(doc, fonts, {
    margin,
    y,
    columns,
    rows,
    rowHeight: 24,
    drawHeader,
  }) + 18

  drawTotalsBox(doc, fonts, {
    x: doc.page.width - margin - 220,
    y,
    width: 220,
    lines: [
      { label: 'Total cantitate', value: pdfFmt(docData.totalQty, 3) },
      { label: 'Total valoare', value: `${pdfFmt(docData.totalValue)} RON` },
    ],
  })

  drawSignatureRow(doc, fonts, {
    margin,
    y: y + 76,
    labels: docData.type === 'DETERIORATION' ? ['Intocmit', 'Gestionar', 'Comisie / Aprobat'] : ['Intocmit', 'Gestionar', 'Comisie / Aprobat'],
  })

  doc.end()
})

export default router
