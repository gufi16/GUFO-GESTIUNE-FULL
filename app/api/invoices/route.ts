import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"
import { Decimal } from "@prisma/client/runtime/library"

type InvoiceItemInput = {
  productId?: string | null
  description: string
  uom?: string
  quantity?: number | string
  unitPrice?: number | string
  vatRate?: number | string
  vatCategory?: "S" | "Z" | "E" | "AE" | "K" | "O"
}

function toDecimal(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return new Decimal(fallback)
  // acceptă number sau string numeric
  return new Decimal(v)
}

// GET /api/invoices?tenantId=...
export async function GET(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      include: { customer: true, items: true },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(invoices)
  } catch (e: any) {
    console.error("GET /api/invoices error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}

// POST /api/invoices?tenantId=...
export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const customerId: string | undefined = body.customerId
    const items: InvoiceItemInput[] | undefined = body.items

    if (!customerId) return NextResponse.json({ error: "Missing customerId" }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Missing items" }, { status: 400 })
    }

    // IMPORTANT: customer trebuie să fie pe același tenantId
    const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } })
    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found for this tenant", tenantId, customerId },
        { status: 404 }
      )
    }

    const profile = await prisma.companyProfile.findUnique({ where: { tenantId } })
    if (!profile) return NextResponse.json({ error: "Company profile not configured" }, { status: 400 })

    const lastInvoice = await prisma.invoice.findFirst({
      where: { tenantId, series: profile.invoiceSeries },
      orderBy: { number: "desc" },
      select: { number: true },
    })

    const nextNumber = lastInvoice ? lastInvoice.number + 1 : profile.invoiceNumberStart

    let subtotal = new Decimal(0)
    let vatTotal = new Decimal(0)
    let total = new Decimal(0)

    const created = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          series: profile.invoiceSeries,
          number: nextNumber,
          customerId,
          status: "DRAFT",
        },
      })

      for (const it of items) {
        if (!it?.description) {
          throw new Error("Each item must have description")
        }

        const quantity = toDecimal(it.quantity, 1)
        const unitPrice = toDecimal(it.unitPrice, 0)
        const vatRate = toDecimal(it.vatRate, 0)

        const lineNet = quantity.mul(unitPrice)
        const lineVat = lineNet.mul(vatRate).div(100)
        const lineTotal = lineNet.add(lineVat)

        subtotal = subtotal.add(lineNet)
        vatTotal = vatTotal.add(lineVat)
        total = total.add(lineTotal)

        await tx.invoiceItem.create({
          data: {
            tenantId,
            invoiceId: inv.id,
            // productId e OPTIONAL; nu forțăm tipuri aiurea
            ...(it.productId ? { productId: it.productId } : {}),
            description: it.description,
            uom: it.uom ?? "buc",
            quantity,
            unitPrice,
            vatRate,
            vatCategory: it.vatCategory ?? "S",
            lineNet,
            lineVat,
            lineTotal,
          },
        })
      }

      const updated = await tx.invoice.update({
        where: { id: inv.id },
        data: { subtotal, vatTotal, total },
        include: { customer: true, items: true },
      })

      return updated
    })

    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    console.error("POST /api/invoices error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
