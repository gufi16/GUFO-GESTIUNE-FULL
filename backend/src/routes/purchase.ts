import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()

router.use(requireAuth)

function toNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeCurrency(value: any): "RON" | "EUR" | "USD" | "HUF" {
  const c = String(value || "RON").toUpperCase()
  if (c === "EUR" || c === "USD" || c === "HUF") return c
  return "RON"
}

function parseDate(value: any) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function buildReceiptSgrLine(item: any) {
  const product = item?.product || null
  const qty = toNumber(item?.qty)
  const isSgr = Boolean(product?.isSgr)
  const sgrUnit = isSgr ? toNumber(product?.sgrValue || 0.5) : 0
  const sgrTotalFc = qty * sgrUnit

  return {
    type: "SGR",
    sourceItemId: item?.id || null,
    productId: item?.productId || null,
    label: `SGR ${product?.name || ""}`.trim(),
    qty,
    unitPrice: sgrUnit,
    vatRate: 0,
    totalFc: sgrTotalFc,
    totalRon: sgrTotalFc * toNumber(item?.receipt?.fxRate || 1),
    isSgr
  }
}

function enrichReceipt(receipt: any) {
  if (!receipt) return receipt

  const items = Array.isArray(receipt.items)
    ? receipt.items.map((item: any) => {
        const sgrUnit = item?.product?.isSgr ? toNumber(item?.product?.sgrValue || 0.5) : 0
        const sgrTotalFc = toNumber(item?.qty) * sgrUnit

        return {
          ...item,
          isSgr: Boolean(item?.product?.isSgr),
          sgrUnit,
          sgrTotalFc,
          sgrTotalRon: sgrTotalFc * toNumber(receipt.fxRate || 1)
        }
      })
    : []

  const documentLines = items.flatMap((item: any) => {
    const productLine = {
      type: "PRODUCT",
      sourceItemId: item.id,
      productId: item.productId,
      label: item.product?.name || "",
      qty: toNumber(item.qty),
      unitPrice: toNumber(item.unitCostNetFc),
      vatRate: toNumber(item.vatRateValue),
      totalFc: toNumber(item.lineNetFc),
      totalRon: toNumber(item.lineNetRon),
      isSgr: false
    }

    const sgrLine = buildReceiptSgrLine({ ...item, receipt })
    return sgrLine.isSgr ? [productLine, sgrLine] : [productLine]
  })

  const totalSgrFc = documentLines
    .filter((line: any) => line.type === "SGR")
    .reduce((sum: number, line: any) => sum + toNumber(line.totalFc), 0)

  const totalSgrRon = totalSgrFc * toNumber(receipt.fxRate || 1)

  return {
    ...receipt,
    items,
    documentLines,
    totalSgrFc,
    totalSgrRon,
    totalWithSgrFc: toNumber(receipt.totalGrossFc) + totalSgrFc,
    totalWithSgrRon: toNumber(receipt.totalGrossRon) + totalSgrRon
  }
}

async function recalcReceipt(receiptId: string) {
  const items = await prisma.purchaseReceiptItem.findMany({
    where: { receiptId }
  })

  const totalNetFc = items.reduce((s, x) => s + toNumber(x.lineNetFc), 0)
  const totalVatFc = items.reduce((s, x) => s + toNumber(x.lineVatFc), 0)
  const totalGrossFc = items.reduce((s, x) => s + toNumber(x.lineGrossFc), 0)

  const totalNetRon = items.reduce((s, x) => s + toNumber(x.lineNetRon), 0)
  const totalVatRon = items.reduce((s, x) => s + toNumber(x.lineVatRon), 0)
  const totalGrossRon = items.reduce((s, x) => s + toNumber(x.lineGrossRon), 0)

  return prisma.purchaseReceipt.update({
    where: { id: receiptId },
    data: {
      totalNetFc,
      totalVatFc,
      totalGrossFc,
      totalNetRon,
      totalVatRon,
      totalGrossRon
    }
  })
}

async function createOrReplaceReceiptItems(
  tenantId: string,
  receiptId: string,
  fxRate: number,
  items: any[]
) {
  await prisma.purchaseReceiptItem.deleteMany({
    where: { receiptId }
  })

  for (const raw of items) {
    const productId = String(raw.productId || "")
    const qty = toNumber(raw.qty)
    const conversionFactor = toNumber(raw.conversionFactor || 1)
    const unitCostNetFc = toNumber(raw.unitCostNetFc)
    const vatRateValue = toNumber(raw.vatRateValue)

    if (!productId) {
      throw new Error("Fiecare linie trebuie să aibă produs.")
    }

    if (qty <= 0) {
      throw new Error("Cantitatea trebuie să fie mai mare decât 0.")
    }

    if (conversionFactor <= 0) {
      throw new Error("Factorul de conversie trebuie să fie mai mare decât 0.")
    }

    if (unitCostNetFc < 0) {
      throw new Error("Prețul fără TVA trebuie să fie >= 0.")
    }

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        tenantId
      },
      include: {
        vatRate: true,
        uom: true,
        purchaseUom: true
      }
    })

    if (!product) {
      throw new Error("Produs inexistent în una dintre linii.")
    }

    const usedUomId = raw.uomId || product.purchaseUomId || product.uomId

    const uom = await prisma.uom.findFirst({
      where: {
        id: usedUomId,
        tenantId
      }
    })

    if (!uom) {
      throw new Error("UM inexistentă în una dintre linii.")
    }

    const stockQty = qty * conversionFactor

    const lineNetFc = qty * unitCostNetFc
    const lineVatFc = (lineNetFc * vatRateValue) / 100
    const lineGrossFc = lineNetFc + lineVatFc

    const unitCostNetRon = unitCostNetFc * fxRate
    const lineNetRon = lineNetFc * fxRate
    const lineVatRon = lineVatFc * fxRate
    const lineGrossRon = lineGrossFc * fxRate

    await prisma.purchaseReceiptItem.create({
      data: {
        receiptId,
        productId,
        uomId: usedUomId,
        qty,
        conversionFactor,
        stockQty,
        unitCostNetFc,
        unitCostNetRon,
        lineNetFc,
        lineVatFc,
        lineGrossFc,
        lineNetRon,
        lineVatRon,
        lineGrossRon,
        vatRateId: raw.vatRateId || product.vatRateId || null,
        vatRateValue
      }
    })
  }

  await recalcReceipt(receiptId)
}

async function postReceiptToStock(tenantId: string, receiptId: string) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.findFirst({
      where: {
        id: receiptId,
        tenantId
      },
      include: {
        items: true
      }
    })

    if (!receipt) {
      throw new Error("Receipt not found")
    }

    if (receipt.status !== "DRAFT") {
      throw new Error("Doar documentele DRAFT pot fi postate.")
    }

    if (!receipt.items.length) {
      throw new Error("Documentul nu are poziții.")
    }

    for (const item of receipt.items) {
      const stockQty = toNumber(item.stockQty)

      await tx.stockBalance.upsert({
        where: {
          tenantId_locationId_productId: {
            tenantId,
            locationId: receipt.locationId,
            productId: item.productId
          }
        },
        update: {
          qty: {
            increment: stockQty
          }
        },
        create: {
          tenantId,
          locationId: receipt.locationId,
          productId: item.productId,
          qty: stockQty
        }
      })

      await tx.stockMove.create({
        data: {
          tenantId,
          locationId: receipt.locationId,
          productId: item.productId,
          type: "IN",
          qty: stockQty,
          refType: "PURCHASE",
          refId: receipt.id,
          note: `NIR ${receipt.docNo}`
        }
      })
    }

    return tx.purchaseReceipt.update({
      where: { id: receiptId },
      data: {
        status: "POSTED"
      }
    })
  })
}

router.get("/api/v1/purchase-receipts", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const month = String(req.query.month || "").trim()

  const where: any = {
    tenantId
  }

  if (month) {
    const [y, m] = month.split("-").map(Number)
    if (y && m && m >= 1 && m <= 12) {
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 1)
      where.docDate = {
        gte: start,
        lt: end
      }
    }
  } else {
    const start = parseDate(dateFrom)
    const end = parseDate(dateTo)

    if (start || end) {
      where.docDate = {}
      if (start) where.docDate.gte = start
      if (end) {
        const endPlusOne = new Date(end)
        endPlusOne.setDate(endPlusOne.getDate() + 1)
        where.docDate.lt = endPlusOne
      }
    }
  }

  const receipts = await prisma.purchaseReceipt.findMany({
    where,
    include: {
      location: true,
      supplier: true,
      items: true
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }]
  })

  res.json({
    ok: true,
    receipts: receipts.map(enrichReceipt)
  })
})

router.get("/api/v1/purchase-receipts/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = req.params.id

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: {
      id,
      tenantId
    },
    include: {
      location: true,
      supplier: true,
      items: {
        include: {
          product: {
            include: {
              uom: true,
              purchaseUom: true,
              vatRate: true
            }
          },
          uom: true,
          vatRate: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  })

  if (!receipt) {
    return res.status(404).json({
      ok: false,
      error: "Receipt not found"
    })
  }

  res.json({
    ok: true,
    receipt: enrichReceipt(receipt)
  })
})

router.post("/api/v1/purchase-receipts/full", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const { id, header, items, postNow } = req.body || {}

  try {
    const locationId = header?.locationId
    const supplierId = header?.supplierId || null
    const supplierName = header?.supplierName || null
    const supplierCode = header?.supplierCode || null
    const docNo = header?.docNo
    const docDate = header?.docDate
    const note = header?.note || null

    if (!locationId) {
      return res.status(400).json({ ok: false, error: "locationId is required" })
    }

    if (!docNo || !String(docNo).trim()) {
      return res.status(400).json({ ok: false, error: "docNo is required" })
    }

    if (!docDate) {
      return res.status(400).json({ ok: false, error: "docDate is required" })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Documentul trebuie să aibă cel puțin o poziție."
      })
    }

    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId
      }
    })

    if (!location) {
      return res.status(404).json({ ok: false, error: "Location not found" })
    }

    let supplier: any = null
    if (supplierId) {
      supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          tenantId
        }
      })

      if (!supplier) {
        return res.status(404).json({ ok: false, error: "Supplier not found" })
      }
    }

    const normalizedCurrency = normalizeCurrency(header?.currency)
    const normalizedFxRate =
      normalizedCurrency === "RON" ? 1 : toNumber(header?.fxRate)

    if (normalizedCurrency !== "RON" && normalizedFxRate <= 0) {
      return res.status(400).json({
        ok: false,
        error: "fxRate is required for foreign currency"
      })
    }

    let receiptId = id ? String(id) : null

    if (!receiptId) {
      const duplicate = await prisma.purchaseReceipt.findFirst({
        where: {
          tenantId,
          docNo: String(docNo).trim()
        }
      })

      if (duplicate) {
        return res.status(400).json({
          ok: false,
          error: "Există deja un document cu acest număr."
        })
      }

      const created = await prisma.purchaseReceipt.create({
        data: {
          tenantId,
          locationId,
          supplierId: supplier?.id || null,
          supplierName: supplier?.name || (supplierName ? String(supplierName).trim() : null),
          supplierCode: supplier?.code || (supplierCode ? String(supplierCode).trim() : null),
          docNo: String(docNo).trim(),
          docDate: new Date(docDate),
          currency: normalizedCurrency,
          fxRate: normalizedFxRate,
          note: note ? String(note).trim() : null,
          status: "DRAFT"
        }
      })

      receiptId = created.id
    } else {
      const existing = await prisma.purchaseReceipt.findFirst({
        where: {
          id: receiptId,
          tenantId
        }
      })

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "Receipt not found"
        })
      }

      if (existing.status !== "DRAFT") {
        return res.status(400).json({
          ok: false,
          error: "Documentul POSTED este read-only și nu mai poate fi modificat."
        })
      }

      const duplicate = await prisma.purchaseReceipt.findFirst({
        where: {
          tenantId,
          docNo: String(docNo).trim(),
          NOT: { id: receiptId }
        }
      })

      if (duplicate) {
        return res.status(400).json({
          ok: false,
          error: "Există deja un document cu acest număr."
        })
      }

      await prisma.purchaseReceipt.update({
        where: { id: receiptId },
        data: {
          locationId,
          supplierId: supplier?.id || null,
          supplierName: supplier?.name || (supplierName ? String(supplierName).trim() : null),
          supplierCode: supplier?.code || (supplierCode ? String(supplierCode).trim() : null),
          docNo: String(docNo).trim(),
          docDate: new Date(docDate),
          currency: normalizedCurrency,
          fxRate: normalizedFxRate,
          note: note ? String(note).trim() : null
        }
      })
    }

    await createOrReplaceReceiptItems(tenantId, receiptId, normalizedFxRate, items)

    if (postNow === true) {
      await postReceiptToStock(tenantId, receiptId)
    }

    const receipt = await prisma.purchaseReceipt.findFirst({
      where: {
        id: receiptId,
        tenantId
      },
      include: {
        location: true,
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                purchaseUom: true,
                vatRate: true
              }
            },
            uom: true,
            vatRate: true
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    })

    res.json({
      ok: true,
      receipt: enrichReceipt(receipt)
    })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Eroare la salvarea documentului"
    })
  }
})

router.post("/api/v1/purchase-receipts/:id/post", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = req.params.id

  try {
    await postReceiptToStock(tenantId, id)

    const receipt = await prisma.purchaseReceipt.findFirst({
      where: {
        id,
        tenantId
      },
      include: {
        location: true,
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                uom: true,
                purchaseUom: true,
                vatRate: true
              }
            },
            uom: true,
            vatRate: true
          }
        }
      }
    })

    res.json({
      ok: true,
      receipt: enrichReceipt(receipt)
    })
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Eroare la postare"
    })
  }
})

router.post("/api/v1/purchase-receipts/:id/cancel", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = req.params.id

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: {
      id,
      tenantId
    }
  })

  if (!receipt) {
    return res.status(404).json({
      ok: false,
      error: "Receipt not found"
    })
  }

  if (receipt.status === "POSTED") {
    return res.status(400).json({
      ok: false,
      error: "Posted receipts cannot be cancelled"
    })
  }

  const cancelled = await prisma.purchaseReceipt.update({
    where: { id },
    data: {
      status: "CANCELLED"
    }
  })

  res.json({
    ok: true,
    receipt: cancelled
  })
})

export default router