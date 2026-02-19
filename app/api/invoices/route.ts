// app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

// Dacă ai deja prisma în "@/lib/prisma", poți înlocui blocul de mai jos cu:
// import { prisma } from "@/lib/prisma";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type CreateInvoiceBody = {
  customerId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate?: number; // 0/5/9/19 etc
  }>;
  currency?: string; // optional
  notes?: string; // optional
  issueDate?: string; // optional ISO
  dueDate?: string; // optional ISO
};

// Helper: calc totals
function calcLine(quantity: number, unitPrice: number, vatRate: number) {
  const qty = Number(quantity || 0);
  const price = Number(unitPrice || 0);
  const vat = Number(vatRate || 0);

  const net = qty * price;
  const vatAmount = net * (vat / 100);
  const gross = net + vatAmount;

  return { net, vatAmount, gross, vat };
}

function getTenantId(req: Request) {
  const { searchParams } = new URL(req.url);
  return searchParams.get("tenantId")?.trim() || null;
}

/**
 * GET /api/invoices?tenantId=REST-1
 * Returnează lista de facturi pentru tenant (cu items + customer, dacă vrei)
 */
export async function GET(req: Request) {
  try {
    const tenantId = getTenantId(req);
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

    return NextResponse.json(invoices, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invoices?tenantId=REST-1
 * Body:
 * {
 *   "customerId": "...",
 *   "items":[{"description":"Test","quantity":2,"unitPrice":100,"vatRate":19}]
 * }
 */
export async function POST(req: Request) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const body = (await req.json()) as CreateInvoiceBody;

    if (!body?.customerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Missing items[]" }, { status: 400 });
    }

    // Verifică clientul în tenant-ul corect
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Normalizează items + calcule
    const normalizedItems = body.items.map((it, idx) => {
      const description = String(it.description || "").trim();
      const quantity = Number(it.quantity);
      const unitPrice = Number(it.unitPrice);
      const vatRate = Number(it.vatRate ?? 19);

      if (!description) {
        throw new Error(`Item[${idx}] missing description`);
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Item[${idx}] invalid quantity`);
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error(`Item[${idx}] invalid unitPrice`);
      }
      if (!Number.isFinite(vatRate) || vatRate < 0) {
        throw new Error(`Item[${idx}] invalid vatRate`);
      }

      const { net, vatAmount, gross } = calcLine(quantity, unitPrice, vatRate);

      return {
        description,
        quantity,
        unitPrice,
        vatRate,
        netAmount: net, // dacă schema ta NU are câmpurile astea, scoate-le
        vatAmount: vatAmount,
        grossAmount: gross,
      };
    });

    // Totaluri
    const totals = normalizedItems.reduce(
      (acc, it) => {
        acc.net += it.netAmount ?? it.quantity * it.unitPrice;
        acc.vat += it.vatAmount ?? (it.quantity * it.unitPrice * (it.vatRate / 100));
        acc.gross += it.grossAmount ?? (it.quantity * it.unitPrice * (1 + it.vatRate / 100));
        return acc;
      },
      { net: 0, vat: 0, gross: 0 }
    );

    // (optional) invoice number simplu: INV-<timestamp>
    const invoiceNumber = `INV-${Date.now()}`;

    // IMPORTANT:
    // Dacă schema ta de Prisma NU are câmpurile: invoiceNumber/currency/notes/issueDate/dueDate/totalNet/totalVat/totalGross,
    // scoate-le din create() ca să nu crape.
    const created = await prisma.invoice.create({
      data: {
        tenantId,
        customerId: body.customerId,

        invoiceNumber,
        currency: body.currency ?? "RON",
        notes: body.notes ?? null,
        issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,

        totalNet: totals.net,
        totalVat: totals.vat,
        totalGross: totals.gross,

        items: {
          create: normalizedItems.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,

            // Dacă schema NU are aceste câmpuri, scoate-le:
            netAmount: it.netAmount,
            vatAmount: it.vatAmount,
            grossAmount: it.grossAmount,
          })),
        },
      },
      include: {
        customer: true,
        items: true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
