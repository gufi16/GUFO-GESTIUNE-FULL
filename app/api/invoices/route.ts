import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // evită caching dubios pe Render/Next

const prisma = new PrismaClient();

function toDecimal(n: number | string) {
  return new Prisma.Decimal(n);
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function getTenantIdFromUrl(req: Request) {
  const url = new URL(req.url);
  return (url.searchParams.get("tenantId") || "").trim();
}

// GET /api/invoices?tenantId=REST-1
export async function GET(req: Request) {
  const tenantId = getTenantIdFromUrl(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { customer: true, items: true },
  });

  return NextResponse.json(invoices);
}

// POST /api/invoices?tenantId=REST-1
export async function POST(req: Request) {
  const tenantId = getTenantIdFromUrl(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const customerId = String(body?.customerId || "").trim();
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!customerId) return jsonError("Missing customerId", 400);
  if (!items.length) return jsonError("Missing items[]", 400);

  // 1) verifică customer în tenant
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!customer) return jsonError("Customer not found", 404);

  // 2) ia CompanyProfile pentru serie/număr
  let profile = await prisma.companyProfile.findUnique({
    where: { tenantId },
  });

  // dacă n-ai profil, îl creează minimal
  if (!profile) {
    profile = await prisma.companyProfile.create({
      data: {
        tenantId,
        name: "Demo Company",
        taxId: "RO00000000",
        invoiceSeries: "FCT",
        invoiceNumberStart: 1,
        isVatPayer: true,
      },
    });
  }

  // 3) calculează next number
  const last = await prisma.invoice.findFirst({
    where: { tenantId, series: profile.invoiceSeries },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  const nextNumber = (last?.number ?? (profile.invoiceNumberStart - 1)) + 1;

  // 4) normalizează + calculează linii
  let computedItems: any[] = [];
  try {
    computedItems = items.map((raw: any) => {
      const description = String(raw?.description ?? "").trim();
      if (!description) throw new Error("Item.description missing");

      const uom = String(raw?.uom ?? "buc").trim() || "buc";

      const quantityNum = Number(raw?.quantity ?? 0);
      const unitPriceNum = Number(raw?.unitPrice ?? 0);
      const vatRateNum = Number(raw?.vatRate ?? 19);

      if (!Number.isFinite(quantityNum) || quantityNum <= 0)
        throw new Error("Item.quantity invalid");
      if (!Number.isFinite(unitPriceNum) || unitPriceNum < 0)
        throw new Error("Item.unitPrice invalid");
      if (!Number.isFinite(vatRateNum) || vatRateNum < 0)
        throw new Error("Item.vatRate invalid");

      const quantity = toDecimal(quantityNum);
      const unitPrice = toDecimal(unitPriceNum);
      const vatRate = toDecimal(vatRateNum);

      const lineNet = quantity.mul(unitPrice);
      const lineVat = lineNet.mul(vatRate).div(toDecimal(100));
      const lineTotal = lineNet.add(lineVat);

      const productId =
        raw?.productId && String(raw.productId).trim()
          ? String(raw.productId).trim()
          : null;

      const vatCategory =
        raw?.vatCategory && String(raw.vatCategory).trim()
          ? String(raw.vatCategory).trim()
          : "S";

      return {
        productId,
        description,
        uom,
        quantity,
        unitPrice,
        vatRate,
        vatCategory,
        lineNet,
        lineVat,
        lineTotal,
      };
    });
  } catch (e: any) {
    return jsonError("Invalid items", 400, { details: String(e?.message ?? e) });
  }

  let subtotal = toDecimal(0);
  let vatTotal = toDecimal(0);
  let total = toDecimal(0);

  for (const it of computedItems) {
    subtotal = subtotal.add(it.lineNet);
    vatTotal = vatTotal.add(it.lineVat);
    total = total.add(it.lineTotal);
  }

  // 5) creează factura + items
  try {
    const created = await prisma.invoice.create({
      data: {
        tenantId,
        series: profile.invoiceSeries,
        number: nextNumber,
        status: "ISSUED",
        currency: "RON",
        customerId,
        subtotal,
        vatTotal,
        total,
        items: {
          create: computedItems.map((it) => ({
            tenantId,
            productId: it.productId,
            description: it.description,
            uom: it.uom,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,
            vatCategory: it.vatCategory as any,
            lineNet: it.lineNet,
            lineVat: it.lineVat,
            lineTotal: it.lineTotal,
          })),
        },
      },
      include: { customer: true, items: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return jsonError("Failed to create invoice", 500, {
      details: String(e?.message ?? e),
    });
  }
}
