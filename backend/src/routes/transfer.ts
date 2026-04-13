// @ts-nocheck
import fs from "fs"
import { Router } from "express"
import PDFDocument from "pdfkit"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { assertSufficientStock, decrementStockBalanceStrict, incrementStockBalance } from "../lib/stock"
import { reserveNextNumber } from "../lib/numbering"
import { resolveTenantCompany } from "../lib/companyResolver"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()
router.use(requireAuth)

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function fmt(value: any, digits = 2) {
  return toNumber(value).toFixed(digits)
}

function fmtDate(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function fmtDateTime(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("ro-RO")
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function text(value: any) {
  const t = String(value || "").trim()
  return t || "-"
}

function registerFonts(doc: PDFKit.PDFDocument) {
  const regularCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf"
  ]

  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
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

async function recalcTransfer(transferId: string) {
  const items = await prisma.transferDocItem.findMany({
    where: { transferId }
  })

  const totalQty = items.reduce((sum, item) => sum + toNumber(item.qty), 0)
  const totalValue = items.reduce((sum, item) => sum + toNumber(item.lineValue), 0)

  return prisma.transferDoc.update({
    where: { id: transferId },
    data: {
      totalQty: new Prisma.Decimal(totalQty),
      totalValue: new Prisma.Decimal(totalValue)
    }
  })
}

router.get("/api/v1/transfers", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const month = String(req.query.month || "").trim()
  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()

  const where: any = { tenantId, companyId }

  if (month) {
    const [y, m] = month.split("-").map(Number)
    if (y && m && m >= 1 && m <= 12) {
      where.docDate = {
        gte: new Date(y, m - 1, 1),
        lt: new Date(y, m, 1)
      }
    }
  } else {
    if (dateFrom || dateTo) {
      where.docDate = {}
      if (dateFrom) where.docDate.gte = new Date(dateFrom)
      if (dateTo) {
        const end = new Date(dateTo)
        end.setDate(end.getDate() + 1)
        where.docDate.lt = end
      }
    }
  }

  const docs = await prisma.transferDoc.findMany({
    where,
    include: {
      fromLocation: true,
      toLocation: true,
      items: true
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }]
  })

  res.json({ ok: true, docs })
})

router.get("/api/v1/transfers/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const doc = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              vatRate: true
            }
          },
          uom: true,
          vatRate: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  })

  if (!doc) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost găsit." })
  }

  res.json({ ok: true, doc })
})

router.post("/api/v1/transfers/full", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const { id, header, items, postNow } = req.body || {}

  const fromLocationId = String(header?.fromLocationId || "").trim()
  const toLocationId = String(header?.toLocationId || "").trim()
  const rawDocNo = String(header?.docNo || "").trim()
  const docDate = String(header?.docDate || "").trim()

  if (!fromLocationId) {
    return res.status(400).json({ ok: false, error: "Locația predătoare este obligatorie." })
  }

  if (!toLocationId) {
    return res.status(400).json({ ok: false, error: "Locația primitoare este obligatorie." })
  }

  if (fromLocationId === toLocationId) {
    return res.status(400).json({ ok: false, error: "Locațiile trebuie să fie diferite." })
  }

  if (!docDate) {
    return res.status(400).json({ ok: false, error: "Data document este obligatorie." })
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "Documentul trebuie să aibă cel puțin o linie." })
  }

  const [fromLocation, toLocation] = await Promise.all([
    prisma.location.findFirst({ where: { id: fromLocationId, tenantId, OR: [{ companyId }, { companyId: null }] } }),
    prisma.location.findFirst({ where: { id: toLocationId, tenantId, OR: [{ companyId }, { companyId: null }] } })
  ])

  if (!fromLocation) {
    return res.status(404).json({ ok: false, error: "Locația predătoare nu există." })
  }

  if (!toLocation) {
    return res.status(404).json({ ok: false, error: "Locația primitoare nu există." })
  }

  try {
    let transferId = id ? String(id) : ""
    const autoDocNo =
      !transferId && !rawDocNo
        ? await prisma.$transaction((tx) => reserveNextNumber(tx, tenantId, "transfer"))
        : ""
    const docNo = rawDocNo || autoDocNo

    if (!transferId) {
      const duplicate = await prisma.transferDoc.findFirst({
        where: { tenantId, docNo }
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Există deja un transfer cu acest număr." })
      }

      const created = await prisma.transferDoc.create({
        data: {
          tenantId,
          companyId,
          fromLocationId,
          toLocationId,
          docNo,
          docDate: new Date(docDate),
          reason: header?.reason ? String(header.reason).trim() : null,
          note: header?.note ? String(header.note).trim() : null,
          delegateName: header?.delegateName ? String(header.delegateName).trim() : null,
          delegateCi: header?.delegateCi ? String(header.delegateCi).trim() : null,
          vehicle: header?.vehicle ? String(header.vehicle).trim() : null,
          vehicleNo: header?.vehicleNo ? String(header.vehicleNo).trim() : null,
          senderName: header?.senderName ? String(header.senderName).trim() : null,
          receiverName: header?.receiverName ? String(header.receiverName).trim() : null,
          approvedBy: header?.approvedBy ? String(header.approvedBy).trim() : null,
          status: "DRAFT"
        }
      })

      transferId = created.id
    } else {
      const existing = await prisma.transferDoc.findFirst({
        where: { id: transferId, tenantId, companyId }
      })

      if (!existing) {
        return res.status(404).json({ ok: false, error: "Transferul nu a fost găsit." })
      }

      if (existing.status !== "DRAFT") {
        return res.status(400).json({ ok: false, error: "Documentul POSTED este read-only." })
      }

      const duplicate = await prisma.transferDoc.findFirst({
        where: {
          tenantId,
          companyId,
          docNo,
          NOT: { id: transferId }
        }
      })

      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Există deja un transfer cu acest număr." })
      }

      await prisma.transferDoc.update({
        where: { id: transferId },
        data: {
          fromLocationId,
          toLocationId,
          docNo,
          docDate: new Date(docDate),
          reason: header?.reason ? String(header.reason).trim() : null,
          note: header?.note ? String(header.note).trim() : null,
          delegateName: header?.delegateName ? String(header.delegateName).trim() : null,
          delegateCi: header?.delegateCi ? String(header.delegateCi).trim() : null,
          vehicle: header?.vehicle ? String(header.vehicle).trim() : null,
          vehicleNo: header?.vehicleNo ? String(header.vehicleNo).trim() : null,
          senderName: header?.senderName ? String(header.senderName).trim() : null,
          receiverName: header?.receiverName ? String(header.receiverName).trim() : null,
          approvedBy: header?.approvedBy ? String(header.approvedBy).trim() : null
        }
      })
    }

    await prisma.transferDocItem.deleteMany({
      where: { transferId }
    })

    for (const raw of items) {
      const productId = String(raw.productId || "").trim()
      const qty = toNumber(raw.qty)
      const unitPrice = toNumber(raw.unitPrice || 0)

      if (!productId) {
        throw new Error("Fiecare linie trebuie să aibă produs.")
      }

      if (qty <= 0) {
        throw new Error("Cantitatea trebuie să fie mai mare decât 0.")
      }

      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId, companyId },
        include: {
          uom: true,
          vatRate: true
        }
      })

      if (!product) {
        throw new Error("Produs inexistent în una dintre linii.")
      }

      await assertSufficientStock(prisma, {
          tenantId,
          companyId,
          locationId: fromLocationId,
        productId,
        requiredQty: qty,
        productName: product.name,
        uomCode: product.uom?.code || null
      })

      await prisma.transferDocItem.create({
        data: {
          transferId,
          productId,
          uomId: product.uomId,
          qty: new Prisma.Decimal(qty),
          unitPrice: new Prisma.Decimal(unitPrice),
          lineValue: new Prisma.Decimal(qty * unitPrice),
          vatRateId: product.vatRateId,
          vatRateValue: new Prisma.Decimal(product.vatRate?.rate || 0)
        }
      })
    }

    await recalcTransfer(transferId)

    if (postNow === true) {
      await prisma.$transaction(async (tx) => {
        const doc = await tx.transferDoc.findFirst({
        where: { id: transferId, tenantId, companyId },
          include: { items: true }
        })

        if (!doc) throw new Error("Transferul nu a fost găsit.")
        if (doc.status !== "DRAFT") throw new Error("Doar documentele DRAFT pot fi postate.")

        for (const item of doc.items) {
          const qty = Number(item.qty || 0)

          const product = await tx.product.findFirst({
            where: { id: item.productId, tenantId, companyId },
            include: { uom: true }
          })

          await decrementStockBalanceStrict(tx, {
            tenantId,
            companyId,
            locationId: doc.fromLocationId,
            productId: item.productId,
            qty: new Prisma.Decimal(qty),
            productName: product?.name || "produs",
            uomCode: product?.uom?.code || null
          })

          await incrementStockBalance(tx, {
            tenantId,
            companyId,
            locationId: doc.toLocationId,
            productId: item.productId,
            qty: new Prisma.Decimal(qty)
          })

          await tx.stockMove.create({
            data: {
              tenantId,
              companyId,
              locationId: doc.fromLocationId,
              productId: item.productId,
              type: "OUT",
              qty: new Prisma.Decimal(qty),
              refType: "TRANSFER",
              refId: doc.id,
              note: `Nota transfer ${doc.docNo} către ${toLocation.name}`
            }
          })

          await tx.stockMove.create({
            data: {
              tenantId,
              companyId,
              locationId: doc.toLocationId,
              productId: item.productId,
              type: "IN",
              qty: new Prisma.Decimal(qty),
              refType: "TRANSFER",
              refId: doc.id,
              note: `Nota transfer ${doc.docNo} din ${fromLocation.name}`
            }
          })
        }

        await tx.transferDoc.update({
          where: { id: doc.id },
          data: { status: "POSTED" }
        })
      })
    }

    const doc = await prisma.transferDoc.findFirst({
      where: { id: transferId, tenantId, companyId },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            product: { include: { uom: true, vatRate: true } },
            uom: true,
            vatRate: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    })

    res.json({ ok: true, doc })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Eroare la salvarea transferului."
    })
  }
})

router.get("/api/v1/transfers/:id/pdf", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const docData = await prisma.transferDoc.findFirst({
    where: { id, tenantId, companyId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          product: { include: { uom: true } },
          uom: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  })

  if (!docData) {
    return res.status(404).json({ ok: false, error: "Documentul nu a fost găsit." })
  }

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId)

  const filename = `TRANSFER_${safeFilePart(docData.docNo)}_${safeFilePart(docData.fromLocation.name)}_${safeFilePart(docData.toLocation.name)}.pdf`

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

  const doc = new PDFDocument({
    size: "A4",
    margin: 36
  })

  const fonts = registerFonts(doc)
  doc.pipe(res)

  const width = doc.page.width - 72
  let y = 30

  doc.font(fonts.bold).fontSize(16).text("NOTĂ DE TRANSFER", 36, y, { width, align: "center" })
  y += 20
  doc.font(fonts.regular).fontSize(11).text("/ TRANSFER ÎNTRE GESTIUNI", 36, y, { width, align: "center" })
  y += 26
  doc.moveTo(36, y).lineTo(559, y).stroke()
  y += 18

  doc.font(fonts.bold).fontSize(11).text("Firma:", 36, y)
  doc.font(fonts.regular).text(text(company?.name), 110, y)
  y += 16
  doc.font(fonts.bold).text("CUI:", 36, y)
  doc.font(fonts.regular).text(text(company?.cui), 110, y)
  y += 16
  doc.font(fonts.bold).text("Nr. Reg. Com.:", 36, y)
  doc.font(fonts.regular).text(text(company?.regNo), 110, y)
  y += 16
  doc.font(fonts.bold).text("Sediu:", 36, y)
  doc.font(fonts.regular).text(text(company?.address), 110, y, { width: 450 })
  y += 28

  doc.font(fonts.bold).text("Nr. document:", 36, y)
  doc.font(fonts.regular).text(docData.docNo, 140, y)
  y += 16
  doc.font(fonts.bold).text("Data:", 36, y)
  doc.font(fonts.regular).text(fmtDate(docData.docDate), 140, y)
  y += 16
  doc.font(fonts.bold).text("Ora:", 36, y)
  doc.font(fonts.regular).text(new Date(docData.createdAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }), 140, y)
  y += 24

  doc.font(fonts.bold).text("Gestiune predătoare:", 36, y)
  doc.font(fonts.regular).text(docData.fromLocation.name, 180, y)
  y += 16
  doc.font(fonts.bold).text("Gestiune primitoare:", 36, y)
  doc.font(fonts.regular).text(docData.toLocation.name, 180, y)
  y += 16
  doc.font(fonts.bold).text("Motiv transfer:", 36, y)
  doc.font(fonts.regular).text(text(docData.reason), 180, y)
  y += 16
  doc.font(fonts.bold).text("Observații:", 36, y)
  doc.font(fonts.regular).text(text(docData.note), 180, y, { width: 350 })
  y += 24

  doc.moveTo(36, y).lineTo(559, y).stroke()
  y += 10

  const cols = [24, 68, 180, 40, 52, 62, 72]
  const headers = ["Nr.", "Cod produs", "Denumire produs", "UM", "Cant.", "Preț", "Valoare"]
  let x = 36

  doc.font(fonts.bold).fontSize(10)
  headers.forEach((h, i) => {
    doc.text(h, x + 2, y, { width: cols[i] - 4, align: i === 2 ? "left" : "center" })
    x += cols[i]
  })
  y += 14
  doc.moveTo(36, y).lineTo(559, y).stroke()
  y += 6

  doc.font(fonts.regular).fontSize(10)
  docData.items.forEach((item, index) => {
    let xx = 36
    const row = [
      String(index + 1),
      text(item.product?.sku),
      text(item.product?.name),
      text(item.uom?.code || item.product?.uom?.code),
      fmt(item.qty),
      fmt(item.unitPrice),
      fmt(item.lineValue)
    ]

    row.forEach((cell, i) => {
      doc.text(cell, xx + 2, y, {
        width: cols[i] - 4,
        align: i === 2 ? "left" : "center"
      })
      xx += cols[i]
    })

    y += 16
  })

  doc.moveTo(36, y).lineTo(559, y).stroke()
  y += 14

  doc.font(fonts.bold).text("Total cantități:", 350, y, { width: 120, align: "right" })
  doc.font(fonts.regular).text(fmt(docData.totalQty), 480, y, { width: 79, align: "right" })
  y += 16
  doc.font(fonts.bold).text("Total valoare:", 350, y, { width: 120, align: "right" })
  doc.font(fonts.regular).text(`${fmt(docData.totalValue)} lei`, 480, y, { width: 79, align: "right" })
  y += 24

  doc.moveTo(36, y).lineTo(559, y).stroke()
  y += 18

  doc.font(fonts.bold).text("Delegat / Transportator:", 36, y)
  doc.font(fonts.regular).text(text(docData.delegateName), 200, y)
  y += 16
  doc.font(fonts.bold).text("CI / BI:", 36, y)
  doc.font(fonts.regular).text(text(docData.delegateCi), 200, y)
  y += 16
  doc.font(fonts.bold).text("Mijloc transport:", 36, y)
  doc.font(fonts.regular).text(text(docData.vehicle), 200, y)
  y += 16
  doc.font(fonts.bold).text("Nr. auto:", 36, y)
  doc.font(fonts.regular).text(text(docData.vehicleNo), 200, y)
  y += 26

  doc.font(fonts.bold).text("Am predat,", 36, y)
  doc.font(fonts.bold).text("Am primit,", 330, y)
  y += 42
  doc.text("____________________", 36, y)
  doc.text("____________________", 330, y)
  y += 16
  doc.font(fonts.regular).text(text(docData.senderName), 36, y)
  doc.text(text(docData.receiverName), 330, y)
  y += 32

  doc.font(fonts.bold).text("Gestionar predător,", 36, y)
  doc.font(fonts.bold).text("Gestionar primitor,", 330, y)
  y += 42
  doc.text("____________________", 36, y)
  doc.text("____________________", 330, y)
  y += 32

  doc.font(fonts.bold).text("Avizat,", 36, y)
  y += 36
  doc.text("____________________", 36, y)
  y += 16
  doc.font(fonts.regular).text(text(docData.approvedBy), 36, y)

  doc.end()
})

export default router
