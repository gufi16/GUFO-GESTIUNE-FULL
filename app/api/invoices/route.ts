import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

function dec(v: any) {
  // Prisma.Decimal safe-ish
  return new Prisma.Decimal(v ?? 0);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") ?? "";

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      include: {
        customer: true,
        items: true,
      },
    });

    return NextResponse.json(invoices);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch invoices", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // IMPORTANT: tenantId din query, dar acceptam si din body (fallback)
    const body = await req.json().catch(() => ({} as any));
    const tenantId = searchParams.get("tenantId") ?? body?.tenantId ?? "";

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const customerId: string | undefined = body?.customerId;
    const items: any[] | undefined = body?.items;

    if (!customerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Missing items[]" }, { status: 400 });
    }

    // Customer must belong to tenant
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, tenantId: true, name: true },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found", tenantId, customerId },
        { status: 404 }
      );
    }

    // Company profile -> series + start number (optional)
    const profile = await prisma.companyProfile.findUnique({
      where: { tenantId },
      select: { invoiceSeries: true, invoiceNumberStart: true },
    });

    const series = profile?.invoiceSeries ?? "FCT";
    const numberStart = profile?.invoiceNumberStart ?? 1;

    // calc lines
    const computedItems = items.map((it) => {
      const description = String(it?.description ?? "").trim();
      const quantity = dec(it?.quantity ?? 1);
      const unitPrice = dec(it?.unitPrice ?? 0);
      const vatRate = dec(it?.vatRate ?? 19);

      if (!description) {
        throw new Error("Each item needs description");
      }

      const lineNet = quantity.mul(unitPrice);
      const lineVat = lineNet.mul(vatRate).div(100);
      const lineTotal = lineNet.add(lineVat);

      return {
        description,
        uom: String(it?.uom ?? "buc"),
        quantity,
        unitPrice,
        vatRate,
        vatCategory: it?.vatCategory ?? "S",
        lineNet,
        lineVat,
        lineTotal,
      };
    });

    const subtotal = computedItems.reduce((s, it) => s.add(it.lineNet), dec(0));
    const vatTotal = computedItems.reduce((s, it) => s.add(it.lineVat), dec(0));
    const total = computedItems.reduce((s, it) => s.add(it.lineTotal), dec(0));

    const result = await prisma.$transaction(async (tx) => {
      // next number for this tenant+series
      const last = await tx.invoice.findFirst({
        where: { tenantId, series },
        orderBy: { number: "desc" },
        select: { number: true },
      });

      const nextNumber = last?.number ? last.number + 1 : numberStart;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          series,
          number: nextNumber,
          status: body?.status ?? "DRAFT",
          currency: body?.currency ?? "RON",
          issueDate: body?.issueDate ? new Date(body.issueDate) : new Date(),
          dueDate: body?.dueDate ? new Date(body.dueDate) : null,
          customerId,

          subtotal,
          vatTotal,
          total,

          items: {
            create: computedItems.map((it) => ({
              tenantId,
              productId: it.productId ?? null,
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
        include: { customer: true, items: true },
      });

      return invoice;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create invoice", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
