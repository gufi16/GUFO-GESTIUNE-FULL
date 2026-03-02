import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getTenantId(req: NextRequest) {
  return req.nextUrl.searchParams.get("tenantId") || "";
}

export async function GET(req: NextRequest) {
  const tenantId = getTenantId(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  const receipts = await prisma.receipt.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: true,
      items: { include: { product: true } },
    },
  });

  return NextResponse.json(receipts);
}

export async function POST(req: NextRequest) {
  const tenantId = getTenantId(req);
  if (!tenantId) return jsonError("Missing tenantId", 400);

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body", 400);

  // Acceptam si "partnerId" (legacy) dar in DB e supplierId
  const supplierId: string = body.supplierId || body.partnerId;
  if (!supplierId) return jsonError("Missing supplierId (or partnerId)", 400);

  const currency: string = body.currency || "RON";
  const exchangeRateRaw = body.exchangeRate ?? body.fxRate ?? 1;
  const exchangeRate = Number(exchangeRateRaw);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return jsonError("Invalid exchangeRate", 400);
  }

  const updateSalePrice: boolean = Boolean(body.updateSalePrice);

  const itemsInput = Array.isArray(body.items) ? body.items : [];
  if (itemsInput.length === 0) return jsonError("Receipt must have items", 400);

  // Normalizare items + calcule
  const items = itemsInput.map((it: any) => {
    const productId = String(it.productId || "");
    const description = String(it.description || it.name || "");
    const uom = String(it.uom || "buc");

    const quantity = Number(it.qty ?? it.quantity ?? 0);
    const unitPrice = Number(it.unitPrice ?? it.price ?? 0);
    const vatRate = Number(it.vatRate ?? 19);

    if (!productId) throw new Error("Missing productId in items");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid quantity in items");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Invalid unitPrice in items");
    if (!Number.isFinite(vatRate) || vatRate < 0) throw new Error("Invalid vatRate in items");

    // Line totals (fara rotunjiri agresive; DB Decimal)
    const lineNet = quantity * unitPrice;
    const lineVat = lineNet * (vatRate / 100);
    const lineTotal = lineNet + lineVat;

    // cost in RON (fara TVA) pentru stoc
    const unitCostRon = unitPrice * exchangeRate;

    const salePrice = it.salePrice != null ? Number(it.salePrice) : null;

    return {
      productId,
      description,
      uom,
      quantity,
      unitPrice,
      vatRate,
      lineNet,
      lineVat,
      lineTotal,
      unitCostRon,
      salePrice,
    };
  });

  let subtotal = 0;
  let vatTotal = 0;
  let total = 0;

  for (const it of items) {
    subtotal += it.lineNet;
    vatTotal += it.lineVat;
    total += it.lineTotal;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Create receipt + items
      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          supplierId,
          currency,
          exchangeRate,
          subtotal,
          vatTotal,
          total,
          items: {
            create: items.map((it) => ({
              tenantId,
              productId: it.productId,
              description: it.description,
              uom: it.uom,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              vatRate: it.vatRate,
              lineNet: it.lineNet,
              lineVat: it.lineVat,
              lineTotal: it.lineTotal,
              unitCostRon: it.unitCostRon,
            })),
          },
        },
        include: {
          supplier: true,
          items: { include: { product: true } },
        },
      });

      // Stock ledger IN + update product purchasePrice (si optional salePrice)
      for (const it of items) {
        // 1) ledger IN
        await tx.stockLedger.create({
          data: {
            tenantId,
            productId: it.productId,
            direction: "IN",
            quantity: it.quantity,
            unitCostRon: it.unitCostRon,
            totalCostRon: it.unitCostRon * it.quantity,
            sourceType: "RECEIPT",
            sourceId: receipt.id,
          },
        });

        // 2) update product purchasePrice (ultimul cost intrare in RON)
        const productUpdate: any = {
          purchasePrice: it.unitCostRon,
        };

        // optional salePrice update (daca UI trimite)
        if (updateSalePrice && it.salePrice != null && Number.isFinite(it.salePrice)) {
          productUpdate.salePrice = it.salePrice;
        }

        await tx.product.update({
          where: { id: it.productId },
          data: productUpdate,
        });
      }

      return receipt;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const msg = err?.message || "Failed to create receipt";
    return jsonError(msg, 400);
  }
}