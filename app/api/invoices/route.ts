// app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma, VatCategory } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type CreateInvoiceBody = {
  customerId: string;
  issueDate?: string; // ISO
  dueDate?: string; // ISO
  currency?: string; // default RON
  status?: "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
  items: Array<{
    description: string;
    quantity: number; // ex 2
    unitPrice: number; // ex 100
    vatRate?: number; // ex 19
    vatCategory?: VatCategory; // S/Z/E/AE/K/O
    uom?: string; // default "buc"
    productId?: string | null;
  }>;
};

function getTenantId(req: Request) {
  const { searchParams } = new URL(req.url);
  return searchParams.get("tenantId")?.trim() || null;
}

function toDec(n: number | string) {
  // Prisma Decimal
  return new Prisma.Decimal(n);
}

function calcLine(qty: Prisma.Decimal, unitPrice: Prisma.Decimal, vatRate: Prisma.Decimal) {
  const lineNet = qty.mul(unitPrice);
  const lineVat = lineNet.mul(vatRate).div(new Prisma.Decimal(100));
  const lineTotal = lineNet.add(lineVat);
  return { lineNet, lineVat, lineTotal };
}

/**
 * GET /api/invoices?tenantId=REST-1
 */
export async function GET(req: Request) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { customer: true, items: true },
    });

    return NextResponse.json(invoices, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/invoices?tenantId=REST-1
 * body: { customerId, items:[...] }
 */
export async function POST(req: Request) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

    const body = (await req.json()) as CreateInvoiceBody;

    if (!body?.customerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Missing items[]" }, { status: 400 });
    }

    // tenant exists?
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // customer must belong to same tenant
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId },
    });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // CompanyProfile for series + numbering
    const profile = await prisma.companyProfile.findUnique({
      where: { tenantId },
      select: { invoiceSeries: true, invoiceNumberStart: true },
    });
    const series = profile?.invoiceSeries ?? "FCT";
    const startNo = profile?.invoiceNumberStart ?? 1;

    const currency = (body.currency || "RON").trim() || "RON";
    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;

    // normalize items + totals
    const normalized = body.items.map((it, idx) => {
      const description = String(it.description || "").trim();
      if (!description) throw new Error(`Item[${idx}] missing description`);

      const qtyNum = Number(it.quantity);
      const priceNum = Number(it.unitPrice);
      const vatNum = Number(it.vatRate ?? 19);

      if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error(`Item[${idx}] invalid quantity`);
      if (!Number.isFinite(priceNum) || priceNum < 0) throw new Error(`Item[${idx}] invalid unitPrice`);
      if (!Number.isFinite(vatNum) || vatNum < 0) throw new Error(`Item[${idx}] invalid vatRate`);

      const quantity = toDec(qtyNum);
      const unitPrice = toDec(priceNum);
      const vatRate = toDec(vatNum);

      const { lineNet, lineVat, lineTotal } = calcLine(quantity, unitPrice, vatRate);

      return {
        tenantId,
        productId: it.productId ?? null,
        description,
        uom: it.uom?.trim() || "buc",
        quantity,
        unitPrice,
        vatRate,
        vatCategory: it.vatCategory ?? "S",
        lineNet,
        lineVat,
        lineTotal,
      };
    });

    const subtotal = normalized.reduce((acc, it) => acc.add(it.lineNet), toDec(0));
    const vatTotal = normalized.reduce((acc, it) => acc.add(it.lineVat), toDec(0));
    const total = normalized.reduce((acc, it) => acc.add(it.lineTotal), toDec(0));

    // Create invoice + items in one transaction, with next number
    const created = await prisma.$transaction(async (tx) => {
      // compute next number for (tenantId, series)
      const last = await tx.invoice.findFirst({
        where: { tenantId, series },
        orderBy: { number: "desc" },
        select: { number: true },
      });

      const nextNumber = last?.number ? last.number + 1 : startNo;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          series,
          number: nextNumber,
          issueDate,
          dueDate,
          status: body.status ?? "DRAFT",
          currency,
          customerId: body.customerId,
          subtotal,
          vatTotal,
          total,
          // efacturaStatus defaults to NONE in schema
          items: {
            create: normalized.map((it) => ({
              tenantId: it.tenantId,
              productId: it.productId,
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

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
