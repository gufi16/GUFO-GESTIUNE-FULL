// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { MinutesDocType, Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { getNextNumberPreview, reserveNextNumber } from "../lib/numbering"
import { assertSufficientStock, decrementStockBalanceStrict } from "../lib/stock"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"
import { drawDocumentHero, drawInfoCards, drawSimpleTable, drawSignatureRow, drawTotalsBox, ensurePdfPage, pdfDate, pdfFmt, pdfText, registerPdfFonts } from "../lib/professionalPdf"

const router = Router()

router.use(requireAuth)

function num(value: any) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function text(value: any) {
  const t = String(value ?? "").trim()
  return t || null
}

function parseDate(value: any) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
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

function reasonLabel(code?: string | null) {
  if (code === "EXPIRED") return "Expirat"
  if (code === "DAMAGE") return "Deteriorat"
  if (code === "LOSS") return "Pierdere"
  if (code === "PRICE_UPDATE") return "Schimbare pret"
  return "Alt motiv"
}

function findingLabel(code?: string | null, reasonCode?: string | null) {
  if (code === "DAMAGE_PARTIAL") return "S-a constatat deteriorarea partiala a produselor mentionate in prezentul document."
  if (code === "DAMAGE_TOTAL") return "S-a constatat deteriorarea totala a produselor mentionate in prezentul document."
  if (code === "EXPIRED_FOUND") return "S-a constatat expirarea produselor mentionate in prezentul document, fara posibilitatea mentinerii lor la vanzare."
  if (code === "LOSS_FOUND") return "S-a constatat lipsa in gestiune pentru produsele mentionate in prezentul document."
  if (reasonCode === "EXPIRED") return "S-a constatat expirarea produselor mentionate in prezentul document."
  if (reasonCode === "LOSS") return "S-a constatat lipsa in gestiune pentru produsele mentionate in prezentul document."
  return "S-a constatat deprecierea produselor mentionate in prezentul document."
}

function docTypeLabel(type: MinutesDocType) {
  return type === "PRICE_CHANGE" ? "PROCES VERBAL DE SCHIMBARE PRET" : "PROCES VERBAL DE DETERIORARE"
}

function docTypeShortLabel(type: MinutesDocType) {
  return type === "PRICE_CHANGE" ? "Schimbare pret" : "Deteriorare"
}

function fmtQty(value: any) {
  return num(value).toLocaleString("ro-RO", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

function fmtMoney(value: any) {
  return num(value).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
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

  const totalQty = items.reduce((sum, item) => sum + num(item.qty), 0)
  const totalValue = items.reduce((sum, item) => sum + num(item.lineValue), 0)

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
            note: `${doc.docNo} - ${reasonLabel(doc.reasonCode)}`,
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
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const type = String(req.query.type || "").trim().toUpperCase()

  const docs = await prisma.minutesDoc.findMany({
    where: {
      tenantId,
      companyId,
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
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id } = req.params

  const doc = await prisma.minutesDoc.findFirst({
    where: { id, tenantId, companyId },
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
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id, header, items, postNow } = req.body || {}

  try {
    const type = String(header?.type || "").trim().toUpperCase()
    const locationId = text(header?.locationId)
    const docDate = parseDate(header?.docDate)
    const reasonCode = text(header?.reasonCode)
    const findingCode = text(header?.findingCode)
    const note = text(header?.note)
    const rawDocNo = String(header?.docNo || "").trim()

    if (type !== "DETERIORATION" && type !== "PRICE_CHANGE") {
      return res.status(400).json({ ok: false, error: "Tip document invalid." })
    }
    if (!locationId) return res.status(400).json({ ok: false, error: "Selecteaza locatia." })
    if (!docDate) return res.status(400).json({ ok: false, error: "Completeaza data documentului." })
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Documentul trebuie sa aiba cel putin o pozitie." })
    }

    let docId = id ? String(id) : null
    const numberingKey = type === "DETERIORATION" ? "deterioration" : "priceChange"
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
          companyId,
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
        where: { id: docId, tenantId, companyId },
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

    for (const raw of items) {
      const productId = String(raw?.productId || "").trim()
      const qty = Math.max(0, num(raw?.qty))
      const unitValue = Math.max(0, num(raw?.unitValue))
      const oldPrice = raw?.oldPrice == null ? null : Math.max(0, num(raw?.oldPrice))
      const newPrice = raw?.newPrice == null ? null : Math.max(0, num(raw?.newPrice))

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
          lineValue: type === "DETERIORATION" ? qty * unitValue : qty * Math.max(0, num(newPrice)),
          note: text(raw?.note),
        },
      })
    }

    await recalcMinutesDoc(docId)

    if (postNow === true) {
      await applyMinutesDoc(tenantId, companyId, docId)
    }

    const doc = await prisma.minutesDoc.findFirst({
      where: { id: docId, tenantId, companyId },
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
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Eroare la salvarea documentului",
    })
  }
})

router.get("/api/v1/minutes-docs/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id } = req.params

  const docData = await prisma.minutesDoc.findFirst({
    where: { id, tenantId, companyId },
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

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)
  const filename = `${safeFilePart(docData.docNo)}.pdf`
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({ size: "A4", margin: 36 })
  const fonts = registerPdfFonts(doc)
  doc.pipe(res)
  const margin = 36

  const drawHeader = () => drawDocumentHero(doc, fonts, {
    title: docTypeLabel(docData.type),
    subtitle: 'Document intern de gestiune',
    companyName: company?.name || '-',
    companyLines: [
      `CUI: ${pdfText(company?.cui)}`,
      `Reg. com.: ${pdfText(company?.regNo)}`,
      `Adres?: ${pdfText(company?.address)}`,
      `Localitate: ${pdfText(company?.city)} / ${pdfText(company?.county)}`,
      `Email: ${pdfText(company?.contactEmail || company?.email)}`,
    ],
    rightPairs: [
      { label: 'Num?r', value: pdfText(docData.docNo) },
      { label: 'Data', value: pdfDate(docData.docDate) },
      { label: 'Status', value: pdfText(docData.status) },
    ],
    margin,
  })

  let y = drawHeader()
  y = drawInfoCards(doc, fonts, {
    margin,
    y,
    cards: [
      {
        title: 'Detalii document',
        pairs: [
          { label: 'Loca?ie', value: pdfText(docData.location.name) },
          { label: 'Motiv', value: reasonLabel(docData.reasonCode) },
          { label: 'Tip', value: docTypeShortLabel(docData.type) },
          { label: 'Cantitate total?', value: pdfFmt(docData.totalQty, 3) },
        ],
      },
      {
        title: 'Observa?ii',
        pairs: [
          { label: 'Valoare total?', value: `${pdfFmt(docData.totalValue)} RON` },
          { label: 'Constatare', value: docData.type === 'DETERIORATION' ? findingLabel(docData.findingCode, docData.reasonCode) : 'Actualizare pre?uri comerciale' },
          { label: 'Not?', value: pdfText(docData.note) },
        ],
      },
    ],
    height: 132,
  }) + 18

  y = ensurePdfPage(doc, y, 40, margin, drawHeader)
  doc.font(fonts.bold).fontSize(10).fillColor('#0F172A').text('Pozi?ii document', margin, y)
  y += 14

  const columns = docData.type === 'DETERIORATION'
    ? [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 240, align: 'left' },
        { label: 'UM', width: 48, align: 'center' },
        { label: 'Cant.', width: 60, align: 'right' },
        { label: 'Val. unit.', width: 70, align: 'right' },
        { label: 'Valoare', width: 70, align: 'right' },
      ]
    : [
        { label: '#', width: 28, align: 'center' },
        { label: 'Produs', width: 226, align: 'left' },
        { label: 'UM', width: 46, align: 'center' },
        { label: 'Pre? vechi', width: 72, align: 'right' },
        { label: 'Pre? nou', width: 72, align: 'right' },
        { label: 'Impact', width: 72, align: 'right' },
      ]

  const rows = docData.items.map((item, index) => docData.type === 'DETERIORATION'
    ? [
        String(index + 1),
        item.product.name,
        item.product.uom?.code || '-',
        pdfFmt(item.qty, 3),
        pdfFmt(item.unitValue),
        pdfFmt(item.lineValue),
      ]
    : [
        String(index + 1),
        item.product.name,
        item.product.uom?.code || '-',
        pdfFmt(item.oldPrice),
        pdfFmt(item.newPrice),
        pdfFmt(item.lineValue),
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
    labels: docData.type === 'DETERIORATION' ? ['Gestionar', 'Aprobat'] : ['?ntocmit', 'Aprobat'],
  })

  doc.end()
})

export default router
