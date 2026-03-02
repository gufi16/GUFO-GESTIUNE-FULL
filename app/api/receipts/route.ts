import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function getTenantId(req: Request) {
  const url = new URL(req.url);
  return (url.searchParams.get("tenantId") || "").trim();
}

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

const ALLOWED_VAT = new Set([5, 11, 21]);

// GET /api/receipts?tenantId=REST-1
export async function GET(req: Request) {
  const tenantId = getTenantId(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  const receipts = await prisma.receipt.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      partner: true,
      items: { include: { product: true } },
    },
  });

  return NextResponse.json(receipts);
}

// POST /api/receipts?tenantId=REST-1
// Body:
// {
//   partnerId?: string | null,
//   date?: string,
//   currency?: "RON" | "EUR" | ...,
//   fxRate?: number, // curs către RON (ex: EUR->RON)
//   notes?: string,
//   items: [
//     {
//       productId?: string,
//       productName?: string, uom?: string, salePrice?: number,  // dacă e produs nou
//       qty: number,
//       unitPrice: number,   // fără TVA, în moneda recepției
//       vatRate?: 5|11|21
//     }
//   ]
// }
export async function POST(req: Request) {
  const tenantId = getTenantId(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const partnerIdRaw = body?.partnerId ? String(body.partnerId).trim() : "";
  const partnerId = partnerIdRaw || null;

  const currency = String(body?.currency || "RON").trim().toUpperCase();
  const fxRateNum = Number(body?.fxRate ?? 1);
  const fxRate = Number.isFinite(fxRateNum) && fxRateNum > 0 ? fxRateNum : 1;

  const notes = body?.notes ? String(body.notes) : null;

  const dateStr = body?.date ? String(body.date) : null;
  const date = dateStr ? new Date(dateStr) : new Date();

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return jsonError("Missing items[]", 400);

  // validate partner (optional)
  if (partnerId) {
    const partner = await prisma.customer.findFirst({ where: { id: partnerId, tenantId } });
    if (!partner) return jsonError("Partner not found in this tenant", 404);
  }

  // next number (NIR) - simplu: max(number)+1
  const last = await prisma.receipt.findFirst({
    where: { tenantId, series: "NIR" },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const nextNumber = (last?.number ?? 0) + 1;

  // normalize items, create missing products when needed
  const normalized: Array<{
    productId: string;
    uom: string;
    qty: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    // for updating product prices
    purchasePriceRon: Prisma.Decimal;
    salePrice?: Prisma.Decimal | null;
  }> = [];

  for (const raw of items) {
    const qtyNum = Number(raw?.qty ?? 0);
    const unitPriceNum = Number(raw?.unitPrice ?? 0);
    const vatRateNum = Number(raw?.vatRate ?? 21);

    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return jsonError("Invalid item.qty", 400);
    if (!Number.isFinite(unitPriceNum) || unitPriceNum < 0) return jsonError("Invalid item.unitPrice", 400);
    if (!Number.isFinite(vatRateNum) || !ALLOWED_VAT.has(vatRateNum)) {
      return jsonError("Invalid item.vatRate. Allowed: 5, 11, 21", 400);
    }

    // product: existing or new
    let productId = raw?.productId ? String(raw.productId).trim() : "";
    let uom = raw?.uom ? String(raw.uom).trim() : "buc";

    if (!productId) {
      const productName = raw?.productName ? String(raw.productName).trim() : "";
      if (!productName) return jsonError("Missing item.productId or item.productName", 400);

      const salePriceNum = raw?.salePrice !== undefined && raw?.salePrice !== null ? Number(raw.salePrice) : null;
      const salePrice =
        salePriceNum !== null && Number.isFinite(salePriceNum) && salePriceNum >= 0 ? dec(salePriceNum) : null;

      const createdProduct = await prisma.product.create({
        data: {
          tenantId,
          name: productName,
          uom: uom || "buc",
          salePrice,
          // purchasePrice îl setăm mai jos după conversie
        },
        select: { id: true, uom: true },
      });

      productId = createdProduct.id;
      uom = createdProduct.uom;
    } else {
      // verify product in tenant
      const p = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { uom: true } });
      if (!p) return jsonError("Product not found in this tenant", 404);
      if (!uom) uom = p.uom;
    }

    const qty = dec(qtyNum);
    const unitPrice = dec(unitPriceNum);
    const vatRate = dec(vatRateNum);
    const lineTotal = qty.mul(unitPrice);

    // convert purchase cost to RON for ledger + product.purchasePrice
    const purchasePriceRon = unitPrice.mul(dec(fxRate));

    const salePriceNum = raw?.salePrice !== undefined && raw?.salePrice !== null ? Number(raw.salePrice) : null;
    const salePrice =
      salePriceNum !== null && Number.isFinite(salePriceNum) && salePriceNum >= 0 ? dec(salePriceNum) : null;

    normalized.push({
      productId,
      uom: uom || "buc",
      qty,
      unitPrice,
      vatRate,
      lineTotal,
      purchasePriceRon,
      salePrice,
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          series: "NIR",
          number: nextNumber,
          date,
          partnerId,
          currency,
          fxRate: dec(fxRate),
          notes,
          items: {
            create: normalized.map((it) => ({
              tenantId,
              productId: it.productId,
              uom: it.uom,
              qty: it.qty,
              unitPrice: it.unitPrice,
              vatRate: it.vatRate,
              lineTotal: it.lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      // update product prices + ledger entries
      for (const line of receipt.items) {
        const n = normalized.find((x) => x.productId === line.productId);
        if (!n) continue;

        await tx.product.update({
          where: { id: line.productId },
          data: {
            purchasePrice: n.purchasePriceRon,
            ...(n.salePrice !== null ? { salePrice: n.salePrice } : {}),
          },
        });

        await tx.stockLedger.create({
          data: {
            tenantId,
            productId: line.productId,
            direction: "IN",
            qty: line.qty,
            unitCost: n.purchasePriceRon,
            totalCost: n.purchasePriceRon.mul(line.qty),
            docType: "NIR",
            docId: receipt.id,
            docLineId: line.id,
            receiptId: receipt.id,
          },
        });
      }

      return tx.receipt.findUnique({
        where: { id: receipt.id },
        include: { partner: true, items: { include: { product: true } } },
      });
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return jsonError("Failed to create receipt", 500, { details: String(e?.message ?? e) });
  }
}