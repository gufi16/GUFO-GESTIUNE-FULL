import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"
import { Decimal } from "@prisma/client/runtime/library"

// GET /api/invoices?tenantId=...
export async function GET(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(invoices)
  } catch (e: any) {
    console.error("GET /api/invoices error:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/invoices?tenantId=...
export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    const body = await req.json()
    const { customerId, items } = body

    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 })
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    const profile = await prisma.companyProfile.findUnique({
      where: { tenantId },
    })

    if (!profile) {
      return NextResponse.json({ error: "Company profile not configured" }, { status: 400 })
    }

    const lastInvoice = await prisma.invoice.findFirst({
      where: { tenantId, series: profile.invoiceSeries },
      orderBy: { number: "desc" },
    })

    const nextNumber = lastInvoice
      ? lastInvoice.number + 1
      : profile.invoiceNumberStart

    let subtotal = new Decimal(0)
    let vatTotal = new Decimal(0)
    let total = new Decimal(0)

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId,
          series: profile.invoiceSeries,
          number: nextNumber,
          customerId,
          status: "DRAFT",
        },
      })

      for (const item of items) {
        const quantity = new Decimal(item.quantity || 1)
        const unitPrice = new Decimal(item.unitPrice || 0)
        const vatRate = new Decimal(item.vatRate || 0)

        const lineNet = quantity.mul(unitPrice)
        const lineVat = lineNet.mul(vatRate).div(100)
        const lineTotal = lineNet.add(lineVat)

        subtotal = subtotal.add(lineNet)
        vatTotal = vatTotal.add(lineVat)
        total = total.add(lineTotal)

        await tx.invoiceItem.create({
          data: {
            tenantId,
            invoiceId: created.id,
            productId: item.productId || null,
            description: item.description,
            uom: item.uom || "buc",
            quantity,
            unitPrice,
            vatRate,
            vatCategory: "S",
            lineNet,
            lineVat,
            lineTotal,
          },
        })
      }

      await tx.invoice.update({
        where: { id: created.id },
        data: { subtotal, vatTotal, total },
      })

      return created
    })

    return NextResponse.json(invoice)
  } catch (e: any) {
    console.error("POST /api/invoices error:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
