// @ts-nocheck
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { reserveNextNumber } from "../lib/numbering"
import {
  collectMessageItems,
  extractDownloadId,
  extractUploadIndex,
  extractXmlFromAnafDownload,
  getEfacturaBaseUrl,
  normalizeCompanyCui,
  parseAnafPayload,
  parseIncomingEInvoiceXml,
  readStringField,
  summarizeAnafResponse,
} from "../lib/incomingEfactura"

const router = Router()

router.use(requireAuth)

function toDateOrNull(value: any) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toNumber(value: any) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCurrency(value: any): "RON" | "EUR" | "USD" | "HUF" {
  const current = String(value || "RON").toUpperCase()
  if (current === "EUR" || current === "USD" || current === "HUF") return current
  return "RON"
}

async function getAnafCompanyContext(tenantId: string) {
  return prisma.company.findUnique({
    where: { tenantId },
    select: {
      cui: true,
      efacturaEnvironment: true,
      efacturaOauthAccessToken: true,
      efacturaOauthLastError: true,
    },
  })
}

async function matchSupplier(tenantId: string, supplierCif: string, supplierName: string) {
  if (supplierCif) {
    const byCif = await prisma.supplier.findFirst({
      where: {
        tenantId,
        cif: {
          contains: supplierCif,
          mode: "insensitive",
        },
      },
      select: { id: true, code: true, name: true },
    })
    if (byCif) return byCif
  }

  if (supplierName) {
    const byName = await prisma.supplier.findFirst({
      where: {
        tenantId,
        name: {
          equals: supplierName,
          mode: "insensitive",
        },
      },
      select: { id: true, code: true, name: true },
    })
    if (byName) return byName
  }

  return null
}

async function matchProduct(tenantId: string, line: any) {
  const skuCandidates = [line.externalCode, line.productCode, line.barcode]
    .map((value: any) => String(value || "").trim())
    .filter(Boolean)

  for (const candidate of skuCandidates) {
    const bySku = await prisma.product.findFirst({
      where: { tenantId, sku: candidate },
      select: {
        id: true,
        name: true,
        sku: true,
        purchaseFactor: true,
        costPrice: true,
        purchaseUom: { select: { id: true, code: true } },
        uom: { select: { id: true, code: true } },
        vatRate: { select: { rate: true } },
      },
    })
    if (bySku) return bySku
  }

  if (line.productName) {
    const byName = await prisma.product.findFirst({
      where: {
        tenantId,
        name: {
          equals: String(line.productName).trim(),
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        purchaseFactor: true,
        costPrice: true,
        purchaseUom: { select: { id: true, code: true } },
        uom: { select: { id: true, code: true } },
        vatRate: { select: { rate: true } },
      },
    })
    if (byName) return byName
  }

  return null
}

async function upsertIncomingInvoice(
  tenantId: string,
  rawMessage: any,
  xmlText: string,
  parsedInvoice: any
) {
  const supplier = await matchSupplier(
    tenantId,
    parsedInvoice.supplierCif || "",
    parsedInvoice.supplierName || ""
  )

  const downloadId =
    extractDownloadId(rawMessage, JSON.stringify(rawMessage || {})) ||
    readStringField(rawMessage, ["downloadId", "id"])

  const uploadIndex =
    extractUploadIndex(rawMessage, JSON.stringify(rawMessage || {})) ||
    readStringField(rawMessage, ["uploadIndex", "index_incarcare"])

  if (!downloadId) {
    throw new Error("Factura primita nu are ID de descarcare.")
  }

  const baseRecord = await prisma.incomingEInvoice.upsert({
    where: {
      tenantId_spvDownloadId: {
        tenantId,
        spvDownloadId: downloadId,
      },
    },
    update: {
      supplierId: supplier?.id || null,
      supplierName: parsedInvoice.supplierName || null,
      supplierCode: supplier?.code || null,
      supplierCif: parsedInvoice.supplierCif || null,
      customerName: parsedInvoice.customerName || null,
      customerCif: parsedInvoice.customerCif || null,
      invoiceNo: parsedInvoice.invoiceNo || null,
      invoiceDate: toDateOrNull(parsedInvoice.invoiceDate),
      currency: normalizeCurrency(parsedInvoice.currency),
      totalNet: toNumber(parsedInvoice.totalNet),
      totalVat: toNumber(parsedInvoice.totalVat),
      totalGross: toNumber(parsedInvoice.totalGross),
      spvUploadIndex: uploadIndex || null,
      spvMessageId: readStringField(rawMessage, ["id", "messageId", "mesajId"]) || null,
      spvCommunicationDate: toDateOrNull(
        readStringField(rawMessage, ["data_creare", "date", "createdAt", "communicationDate"])
      ),
      xmlText,
      rawPayload: rawMessage || null,
      syncedAt: new Date(),
    },
    create: {
      tenantId,
      supplierId: supplier?.id || null,
      supplierName: parsedInvoice.supplierName || null,
      supplierCode: supplier?.code || null,
      supplierCif: parsedInvoice.supplierCif || null,
      customerName: parsedInvoice.customerName || null,
      customerCif: parsedInvoice.customerCif || null,
      invoiceNo: parsedInvoice.invoiceNo || null,
      invoiceDate: toDateOrNull(parsedInvoice.invoiceDate),
      currency: normalizeCurrency(parsedInvoice.currency),
      totalNet: toNumber(parsedInvoice.totalNet),
      totalVat: toNumber(parsedInvoice.totalVat),
      totalGross: toNumber(parsedInvoice.totalGross),
      spvDownloadId: downloadId,
      spvUploadIndex: uploadIndex || null,
      spvMessageId: readStringField(rawMessage, ["id", "messageId", "mesajId"]) || null,
      spvCommunicationDate: toDateOrNull(
        readStringField(rawMessage, ["data_creare", "date", "createdAt", "communicationDate"])
      ),
      xmlText,
      rawPayload: rawMessage || null,
      status: "SYNCED",
    },
  })

  await prisma.incomingEInvoiceItem.deleteMany({
    where: { invoiceId: baseRecord.id },
  })

  for (const line of parsedInvoice.lines || []) {
    const matchedProduct = await matchProduct(tenantId, line)
    await prisma.incomingEInvoiceItem.create({
      data: {
        invoiceId: baseRecord.id,
        matchedProductId: matchedProduct?.id || null,
        lineIndex: Number(line.lineIndex || 0),
        productName: String(line.productName || "").trim() || "Produs",
        productCode: line.productCode ? String(line.productCode).trim() : null,
        externalCode: line.externalCode ? String(line.externalCode).trim() : null,
        barcode: line.barcode ? String(line.barcode).trim() : null,
        uomCode: line.uomCode ? String(line.uomCode).trim() : null,
        qty: toNumber(line.qty),
        unitPrice: toNumber(line.unitPrice),
        vatRate: toNumber(line.vatRate),
        lineNet: toNumber(line.lineNet),
        lineVat: toNumber(line.lineVat),
        lineGross: toNumber(line.lineGross),
      },
    })
  }

  return prisma.incomingEInvoice.findUnique({
    where: { id: baseRecord.id },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: {
            include: {
              purchaseUom: true,
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { lineIndex: "asc" },
      },
    },
  })
}

router.post("/api/v1/efactura/incoming/sync", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await getAnafCompanyContext(tenantId)
  const cif = normalizeCompanyCui(company?.cui)

  if (!cif || !company?.efacturaOauthAccessToken) {
    return res.status(400).json({
      ok: false,
      error: "Firma nu are CUI sau token ANAF activ pentru sincronizarea facturilor primite.",
    })
  }

  const days = Math.min(60, Math.max(1, Number(req.body?.days || req.query.days || 30)))
  const baseUrl = getEfacturaBaseUrl(company.efacturaEnvironment)
  const listUrl = `${baseUrl}/listaMesajeFactura?zile=${days}&cif=${encodeURIComponent(cif)}`

  try {
    const listResponse = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${company.efacturaOauthAccessToken}`,
      },
    })

    const listText = await listResponse.text()
    const listPayload = parseAnafPayload(listText)
    const messageItems = collectMessageItems(listPayload)

    if (!listResponse.ok) {
      return res.status(400).json({
        ok: false,
        error: summarizeAnafResponse(listPayload, listText) || "Nu am putut citi lista facturilor din SPV.",
      })
    }

    let synced = 0
    let skipped = 0

    for (const item of messageItems) {
      const rawItemText = JSON.stringify(item || {})
      const downloadId = extractDownloadId(item, rawItemText)
      if (!downloadId) {
        skipped += 1
        continue
      }

      const downloadUrl = `${baseUrl}/descarcare?id=${encodeURIComponent(downloadId)}`
      const downloadResponse = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${company.efacturaOauthAccessToken}`,
        },
      })

      if (!downloadResponse.ok) {
        skipped += 1
        continue
      }

      const buffer = Buffer.from(await downloadResponse.arrayBuffer())
      const { xmlText } = extractXmlFromAnafDownload(buffer)
      const parsedInvoice = parseIncomingEInvoiceXml(xmlText)

      if (normalizeCompanyCui(parsedInvoice.customerCif) !== cif) {
        skipped += 1
        continue
      }

      await upsertIncomingInvoice(tenantId, item, xmlText, parsedInvoice)
      synced += 1
    }

    return res.json({
      ok: true,
      synced,
      skipped,
      message: `Sincronizare SPV finalizata: ${synced} facturi primite actualizate.`,
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Eroare la sincronizarea facturilor primite din SPV.",
    })
  }
})

router.get("/api/v1/efactura/incoming", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const items = await prisma.incomingEInvoice.findMany({
    where: { tenantId },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: true,
        },
        orderBy: { lineIndex: "asc" },
      },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  })

  return res.json({ ok: true, items })
})

router.get("/api/v1/efactura/incoming/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
    include: {
      supplier: true,
      linkedReceipt: true,
      items: {
        include: {
          matchedProduct: {
            include: {
              purchaseUom: true,
              uom: true,
              vatRate: true,
            },
          },
        },
        orderBy: { lineIndex: "asc" },
      },
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  return res.json({ ok: true, item })
})

router.get("/api/v1/efactura/incoming/:id/xml", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const item = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
    select: {
      invoiceNo: true,
      spvDownloadId: true,
      xmlText: true,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `inline; filename=\"factura-spv-${String(item.invoiceNo || item.spvDownloadId || "document").replace(/[^a-zA-Z0-9._-]/g, "-")}.xml\"`
  )
  return res.send(item.xmlText)
})

router.post("/api/v1/efactura/incoming/:id/create-supplier", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const invoice = await prisma.incomingEInvoice.findFirst({
    where: { tenantId, id: req.params.id },
    select: {
      id: true,
      supplierId: true,
      supplierName: true,
      supplierCif: true,
    },
  })

  if (!invoice) {
    return res.status(404).json({ ok: false, error: "Factura primita SPV nu a fost gasita." })
  }

  if (invoice.supplierId) {
    const existing = await prisma.supplier.findFirst({
      where: { tenantId, id: invoice.supplierId },
    })
    return res.json({ ok: true, supplier: existing })
  }

  if (!String(invoice.supplierName || "").trim()) {
    return res.status(400).json({ ok: false, error: "Factura nu are furnizor suficient pentru creare automata." })
  }

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const existingByCif =
        invoice.supplierCif
          ? await tx.supplier.findFirst({
              where: {
                tenantId,
                cif: {
                  contains: invoice.supplierCif,
                  mode: "insensitive",
                },
              },
            })
          : null

      if (existingByCif) {
        await tx.incomingEInvoice.update({
          where: { id: invoice.id },
          data: {
            supplierId: existingByCif.id,
            supplierCode: existingByCif.code || null,
          },
        })
        return existingByCif
      }

      const code = await reserveNextNumber(tx, tenantId, "supplier")
      const created = await tx.supplier.create({
        data: {
          tenantId,
          name: String(invoice.supplierName || "").trim(),
          code,
          cif: invoice.supplierCif ? String(invoice.supplierCif).trim() : null,
          isActive: true,
        },
      })

      await tx.incomingEInvoice.update({
        where: { id: invoice.id },
        data: {
          supplierId: created.id,
          supplierCode: created.code || null,
        },
      })

      return created
    })

    return res.json({ ok: true, supplier })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut crea furnizorul din factura SPV.",
    })
  }
})

export default router
