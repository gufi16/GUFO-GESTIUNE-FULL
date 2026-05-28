// @ts-nocheck
import { Router } from "express"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { reserveNextNumber } from "../lib/numbering"
import { buildCompanyScopedTenantWhere, requireRequestCompanyId } from "../lib/companyScope"
import { resolveWarehouseForLocation } from "../lib/warehouse"

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
    label: "SGR",
    qty,
    unitPrice: sgrUnit,
    vatRate: 0,
    totalFc: sgrTotalFc,
    totalRon: sgrTotalFc * toNumber(item?.receipt?.fxRate || 1),
    isSgr
  }
}

function serializeReceipt(receipt: any) {
  if (!receipt) return receipt

  const serializeProduct = (product: any) => {
    if (!product) return product
    return {
      ...product,
      price: toNumber(product.price),
      costPrice: toNumber(product.costPrice),
      purchaseFactor: toNumber(product.purchaseFactor || 1),
      sgrValue: toNumber(product.sgrValue),
      trackLot: Boolean(product.trackLot),
      trackExpiry: Boolean(product.trackExpiry),
      costMethod: product.costMethod || "AVG",
      vatRate: product.vatRate
        ? {
            ...product.vatRate,
            rate: toNumber(product.vatRate.rate)
          }
        : product.vatRate
    }
  }

  const items = Array.isArray(receipt.items)
    ? receipt.items.map((item: any) => ({
        ...item,
        qty: toNumber(item.qty),
        conversionFactor: toNumber(item.conversionFactor || 1),
        stockQty: toNumber(item.stockQty),
        unitCostNetFc: toNumber(item.unitCostNetFc),
        unitCostNetRon: toNumber(item.unitCostNetRon),
        lineNetFc: toNumber(item.lineNetFc),
        lineVatFc: toNumber(item.lineVatFc),
        lineGrossFc: toNumber(item.lineGrossFc),
        lineNetRon: toNumber(item.lineNetRon),
        lineVatRon: toNumber(item.lineVatRon),
        lineGrossRon: toNumber(item.lineGrossRon),
        vatRateValue: toNumber(item.vatRateValue),
        lotNo: item.lotNo || null,
        expiryDate: item.expiryDate || null,
        product: serializeProduct(item.product),
        vatRate: item.vatRate
          ? {
            ...item.vatRate,
              rate: toNumber(item.vatRate.rate)
            }
          : item.vatRate
      }))
    : receipt.items

  return {
    ...receipt,
    fxRate: toNumber(receipt.fxRate || 1),
    totalNetFc: toNumber(receipt.totalNetFc),
    totalVatFc: toNumber(receipt.totalVatFc),
    totalGrossFc: toNumber(receipt.totalGrossFc),
    totalNetRon: toNumber(receipt.totalNetRon),
    totalVatRon: toNumber(receipt.totalVatRon),
    totalGrossRon: toNumber(receipt.totalGrossRon),
    items
  }
}

function enrichReceipt(receipt: any) {
  receipt = serializeReceipt(receipt)
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
      isSgr: false,
      lotNo: item.lotNo || null,
      expiryDate: item.expiryDate || null
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

async function createOrReplaceReceiptItems(
  client: typeof prisma | Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  receiptId: string,
  fxRate: number,
  items: any[]
) {
  await client.purchaseReceiptItem.deleteMany({
    where: { receiptId }
  })

  for (const raw of items) {
    const productId = String(raw.productId || "")
    const qty = toNumber(raw.qty)
    const requestedConversionFactor = toNumber(raw.conversionFactor || 0)
    let conversionFactor = requestedConversionFactor || 1
    const unitCostNetFc = toNumber(raw.unitCostNetFc)
    const vatRateValue = toNumber(raw.vatRateValue)
    const lotNo = String(raw.lotNo || "").trim() || null
    const expiryDateRaw = String(raw.expiryDate || "").trim()

    if (!productId) {
      throw new Error("Fiecare linie trebuie sa aiba produs.")
    }

    if (qty <= 0) {
      throw new Error("Cantitatea trebuie sa fie mai mare decat 0.")
    }

    if (conversionFactor <= 0) {
      throw new Error("Factorul de conversie trebuie sa fie mai mare decat 0.")
    }

    if (unitCostNetFc < 0) {
      throw new Error("Pretul fara TVA trebuie sa fie >= 0.")
    }

    const product = await client.product.findFirst({
      where: {
        id: productId,
        tenantId,
        companyId
      },
      include: {
        vatRate: true,
        uom: true,
        purchaseUom: true
      }
    })

    if (!product) {
      throw new Error("Produs inexistent in una dintre linii.")
    }

    if (product.trackLot && !lotNo) {
      throw new Error(`Produsul ${product.name} necesita lot pe receptie.`)
    }

    if (product.trackExpiry && !expiryDateRaw) {
      throw new Error(`Produsul ${product.name} necesita data expirarii pe receptie.`)
    }

    const expiryDate = expiryDateRaw.length > 0 ? new Date(`${expiryDateRaw}T00:00:00`) : null

    if (expiryDateRaw && (!expiryDate || Number.isNaN(expiryDate.getTime()))) {
      throw new Error(`Data expirarii nu este valida pentru produsul ${product.name}.`)
    }

    const usedUomId = raw.uomId || product.purchaseUomId || product.uomId
    const allowedUomIds = [product.uomId, product.purchaseUomId].filter(Boolean)

    if (!allowedUomIds.includes(usedUomId)) {
      throw new Error("UM selectata nu este valida pentru produsul ales.")
    }

    const uom = await client.uom.findFirst({
      where: {
        id: usedUomId,
        tenantId
      }
    })

    if (!uom) {
      throw new Error("UM inexistenta in una dintre linii.")
    }

    const defaultFactor = usedUomId === product.uomId ? 1 : Math.max(0.000001, toNumber(product.purchaseFactor || 1))
    conversionFactor =
      usedUomId === product.uomId
        ? 1
        : Math.max(0.000001, requestedConversionFactor > 0 ? requestedConversionFactor : defaultFactor)

    const stockQty = qty * conversionFactor

    const lineNetFc = qty * unitCostNetFc
    const lineVatFc = (lineNetFc * vatRateValue) / 100
    const lineGrossFc = lineNetFc + lineVatFc

    const unitCostNetRon = unitCostNetFc * fxRate
    const lineNetRon = lineNetFc * fxRate
    const lineVatRon = lineVatFc * fxRate
    const lineGrossRon = lineGrossFc * fxRate

    await client.purchaseReceiptItem.create({
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
        vatRateValue,
        lotNo,
        expiryDate
      }
    })
  }

  await recalcReceiptWithClient(client, receiptId)
}

async function recalcReceiptWithClient(client: typeof prisma | Prisma.TransactionClient, receiptId: string) {
  const items = await client.purchaseReceiptItem.findMany({
    where: { receiptId }
  })

  const totalNetFc = items.reduce((s, x) => s + toNumber(x.lineNetFc), 0)
  const totalVatFc = items.reduce((s, x) => s + toNumber(x.lineVatFc), 0)
  const totalGrossFc = items.reduce((s, x) => s + toNumber(x.lineGrossFc), 0)

  const totalNetRon = items.reduce((s, x) => s + toNumber(x.lineNetRon), 0)
  const totalVatRon = items.reduce((s, x) => s + toNumber(x.lineVatRon), 0)
  const totalGrossRon = items.reduce((s, x) => s + toNumber(x.lineGrossRon), 0)

  return client.purchaseReceipt.update({
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

async function recalcReceipt(receiptId: string) {
  return recalcReceiptWithClient(prisma, receiptId)
}

async function postReceiptToStockWithClient(
  tx: typeof prisma | Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  receiptId: string
) {
  const receipt = await tx.purchaseReceipt.findFirst({
    where: {
      id: receiptId,
      tenantId,
      companyId
    },
    include: {
      items: {
        include: {
          product: true
        }
      },
      warehouse: true
    }
  })

  if (!receipt) {
    throw new Error("Receipt not found")
  }

  if (receipt.status !== "DRAFT") {
    throw new Error("Doar documentele DRAFT pot fi postate.")
  }

  if (!receipt.items.length) {
    throw new Error("Documentul nu are pozitii.")
  }

  for (const item of receipt.items) {
    const stockQty = toNumber(item.stockQty)
    const unitCostNetRon = toNumber(item.unitCostNetRon)
    const lineNetRon = toNumber(item.lineNetRon)
    const shouldCreateLot = Boolean(item.product?.trackLot || item.product?.trackExpiry)
    const lotNo =
      String(item.lotNo || "").trim() ||
      (shouldCreateLot ? `${receipt.docNo}-${String(item.product?.sku || item.productId).trim()}` : "")

    let lotId: string | null = null

    if (shouldCreateLot) {
      const lot = await tx.stockLot.create({
        data: {
          tenantId,
          companyId,
          locationId: receipt.locationId,
          warehouseId: receipt.warehouseId || null,
          productId: item.productId,
          sourceReceiptId: receipt.id,
          sourceReceiptItemId: item.id,
          lotNo,
          expiryDate: item.expiryDate || null,
          receivedAt: receipt.docDate,
          initialQty: stockQty,
          remainingQty: stockQty,
          unitCostNetRon,
          totalRemainingValue: lineNetRon
        }
      })
      lotId = lot.id
    }

    await tx.stockBalance.upsert({
      where: {
        tenantId_companyId_locationId_productId_warehouseScope: {
          tenantId,
          companyId,
          locationId: receipt.locationId,
          productId: item.productId,
          warehouseScope: String(receipt.warehouseId || "").trim() || "__NO_WAREHOUSE__",
        }
      },
      update: {
        qty: {
          increment: stockQty
        },
        warehouseScope: String(receipt.warehouseId || "").trim() || "__NO_WAREHOUSE__",
        warehouseId: receipt.warehouseId || null
      },
      create: {
        tenantId,
        companyId,
        locationId: receipt.locationId,
        warehouseId: receipt.warehouseId || null,
        warehouseScope: String(receipt.warehouseId || "").trim() || "__NO_WAREHOUSE__",
        productId: item.productId,
        qty: stockQty
      }
    })

    await tx.stockMove.create({
      data: {
        tenantId,
        companyId,
        locationId: receipt.locationId,
        warehouseId: receipt.warehouseId || null,
        productId: item.productId,
        lotId,
        type: "IN",
        qty: stockQty,
        unitCost: unitCostNetRon,
        totalValue: lineNetRon,
        refType: "PURCHASE",
        refId: receipt.id,
        refItemId: item.id,
        note: `NIR ${receipt.docNo}`
      }
    })

    await tx.product.update({
      where: { id: item.productId },
      data: {
        costPrice: item.unitCostNetRon
      }
    })
  }

  return tx.purchaseReceipt.update({
    where: { id: receiptId },
    data: {
      status: "POSTED"
    }
  })
}

async function postReceiptToStock(tenantId: string, companyId: string, receiptId: string) {
  return prisma.$transaction(async (tx) => postReceiptToStockWithClient(tx, tenantId, companyId, receiptId))
}

router.get("/api/v1/purchase-receipts", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const dateFrom = String(req.query.dateFrom || "").trim()
  const dateTo = String(req.query.dateTo || "").trim()
  const month = String(req.query.month || "").trim()

  const where: any = buildCompanyScopedTenantWhere(tenantId, companyId)

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
      warehouse: true,
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
  const companyId = await requireRequestCompanyId(req)
  const id = req.params.id

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: {
      id,
      ...buildCompanyScopedTenantWhere(tenantId, companyId)
    },
    include: {
      location: true,
      warehouse: true,
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
  const companyId = await requireRequestCompanyId(req)
  const { id, header, items, postNow } = req.body || {}

  try {
    const locationId = header?.locationId
    const requestedWarehouseId = header?.warehouseId
    const supplierId = header?.supplierId || null
    const supplierName = header?.supplierName || null
    const supplierCode = header?.supplierCode || null
    const sourceIncomingEInvoiceId = header?.sourceIncomingEInvoiceId ? String(header.sourceIncomingEInvoiceId) : null
    const spvDownloadId = header?.spvDownloadId ? String(header.spvDownloadId) : null
    const spvUploadIndex = header?.spvUploadIndex ? String(header.spvUploadIndex) : null
    const spvInvoiceNo = header?.spvInvoiceNo ? String(header.spvInvoiceNo) : null
    const rawDocNo = String(header?.docNo || "").trim()
    const docDate = header?.docDate
    const note = header?.note || null

    if (!locationId) {
      return res.status(400).json({ ok: false, error: "locationId is required" })
    }

    if (!docDate) {
      return res.status(400).json({ ok: false, error: "docDate is required" })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Documentul trebuie sa aiba cel putin o pozitie."
      })
    }

    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        OR: [{ companyId }, { companyId: null }],
      }
    })

    if (!location) {
      return res.status(404).json({ ok: false, error: "Location not found" })
    }

    const warehouse = await prisma.$transaction((tx) =>
      resolveWarehouseForLocation(tx, {
        tenantId,
        companyId,
        locationId,
        warehouseId: requestedWarehouseId,
      })
    )

    let supplier: any = null
    if (supplierId) {
      supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          ...buildCompanyScopedTenantWhere(tenantId, companyId),
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

    const receiptId = await prisma.$transaction(async (tx) => {
      let nextReceiptId = id ? String(id) : null
      const autoDocNo =
        !nextReceiptId && !rawDocNo
          ? await reserveNextNumber(tx, tenantId, "purchaseReceipt")
          : ""
      const finalDocNo = rawDocNo || autoDocNo

      if (!nextReceiptId) {
        const duplicate = await tx.purchaseReceipt.findFirst({
          where: {
            tenantId,
            companyId,
            docNo: finalDocNo
          }
        })

        if (duplicate) {
          throw new Error("Exista deja un document cu acest numar.")
        }

        const created = await tx.purchaseReceipt.create({
          data: {
            tenantId,
            companyId,
            locationId,
            warehouseId: warehouse.id,
            supplierId: supplier?.id || null,
            supplierName: supplier?.name || (supplierName ? String(supplierName).trim() : null),
            supplierCode: supplier?.code || (supplierCode ? String(supplierCode).trim() : null),
            docNo: finalDocNo,
            docDate: new Date(docDate),
            currency: normalizedCurrency,
            fxRate: normalizedFxRate,
            note: note ? String(note).trim() : null,
            sourceIncomingEInvoiceId,
            spvDownloadId,
            spvUploadIndex,
            spvInvoiceNo,
            status: "DRAFT"
          }
        })

        nextReceiptId = created.id
      } else {
        const existing = await tx.purchaseReceipt.findFirst({
          where: {
            id: nextReceiptId,
            ...buildCompanyScopedTenantWhere(tenantId, companyId)
          }
        })

        if (!existing) {
          throw new Error("Receipt not found")
        }

        if (existing.status !== "DRAFT") {
          throw new Error("Documentul POSTED este read-only si nu mai poate fi modificat.")
        }

        const duplicate = await tx.purchaseReceipt.findFirst({
          where: {
            tenantId,
            companyId,
            docNo: finalDocNo,
            NOT: { id: nextReceiptId }
          }
        })

        if (duplicate) {
          throw new Error("Exista deja un document cu acest numar.")
        }

        await tx.purchaseReceipt.update({
          where: { id: nextReceiptId },
          data: {
            companyId,
            locationId,
            warehouseId: warehouse.id,
            supplierId: supplier?.id || null,
            supplierName: supplier?.name || (supplierName ? String(supplierName).trim() : null),
            supplierCode: supplier?.code || (supplierCode ? String(supplierCode).trim() : null),
            docNo: finalDocNo,
            docDate: new Date(docDate),
            currency: normalizedCurrency,
            fxRate: normalizedFxRate,
            note: note ? String(note).trim() : null,
            sourceIncomingEInvoiceId,
            spvDownloadId,
            spvUploadIndex,
            spvInvoiceNo
          }
        })
      }

      await createOrReplaceReceiptItems(tx, tenantId, companyId, nextReceiptId, normalizedFxRate, items)

      if (postNow === true) {
        await postReceiptToStockWithClient(tx, tenantId, companyId, nextReceiptId)
      }

      return nextReceiptId
    })

    const receipt = await prisma.purchaseReceipt.findFirst({
      where: {
        id: receiptId,
        ...buildCompanyScopedTenantWhere(tenantId, companyId)
      },
      include: {
        location: true,
        warehouse: true,
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

    if (sourceIncomingEInvoiceId) {
      await prisma.incomingEInvoice.updateMany({
        where: {
          tenantId,
          id: sourceIncomingEInvoiceId,
          companyId,
        },
        data: {
          linkedReceiptId: receiptId,
          status: "LINKED",
          supplierId: supplier?.id || null,
        },
      })
    }

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
  const companyId = await requireRequestCompanyId(req)
  const id = req.params.id

  try {
    await postReceiptToStock(tenantId, companyId, id)

    const receipt = await prisma.purchaseReceipt.findFirst({
      where: {
        id,
        tenantId,
        companyId
      },
      include: {
        location: true,
        warehouse: true,
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
  const companyId = await requireRequestCompanyId(req)
  const id = req.params.id

  const receipt = await prisma.purchaseReceipt.findFirst({
    where: {
      id,
      ...buildCompanyScopedTenantWhere(tenantId, companyId)
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
