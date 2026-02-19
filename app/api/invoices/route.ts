import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

function dec(v: any) {
  return new Prisma.Decimal(v ?? 0);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        items: true,
      },
    });

    return NextResponse.json(invoices);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to fetch invoices", details: err.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const body = await req.json();

    const { customerId, items } = body;

    if (!customerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Missing items[]" }, { status: 400 });
    }

    // verificare client în tenant
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Company profile pentru serie + numerotare
    const profile = await prisma.companyProfile.findUnique({
      where: { tenantId },
    });

    const series = profile?.invoiceSeries ?? "FCT";
    const startNumber = profile?.invoiceNumberStart ?? 1;

    const computedItems = items.map((it: any) => {
      const quantity = dec(it.quantity);
      const unitPrice = dec(it.unitPrice);
      const vatRate = dec(it.vatRate ?? 19);

      const lineNet = quantity.mul(unitPrice);
      const lineVat = lineNet.mul(vatRate).div(100);
      const lineTotal = lineNet.add(lineVat);

      return {
        description: it.description,
        uom: it.uom ?? "buc",
        quantity,
        unitPrice,
        vatRate,
        vatCategory: it.vatCategory ?? "S",
        lineNet,
        lineVat,
        lineTotal,
      };
    });

    const subtotal = computedItems.reduce(
      (sum, it) => sum.add(it.lineNet),
      dec(0)
    );

    const vatTotal = computedItems.reduce(
      (sum, it) => sum.add(it.lineVat),
      dec(0)
    );

    const total = computedItems.reduce(
      (sum, it) => sum.add(it.lineTotal),
      dec(0)
    );

    const result = await prisma.$transaction(async (tx) => {
      const lastInvoice = await tx.invoice.findFirst({
        where: { tenantId, series },
        orderBy: { number: "desc" },
      });

      const nextNumber = lastInvoice
        ? lastInvoice.number + 1
        : startNumber;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          series,
          number: nextNumber,
          issueDate: new Date(),
          status: "DRAFT",
          currency: "RON",
          customerId,
          subtotal,
          vatTotal,
          total,
          items: {
            create: computedItems.map((it) => ({
              tenantId,
              description: it.description,
              uom: it.uom,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              vatRate: it.vatRate,
              vatCategory: it.vatCategory,
              lineNet: it.lineNet,
              lineVat: it.lineVat,
              lineTotal: it.lineTotal,
            })),
          },
        },
        include: {
          customer: true,
          items: true,
        },
      });

      return invoice;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to create invoice", details: err.message },
      { status: 500 }
    );
  }
}
