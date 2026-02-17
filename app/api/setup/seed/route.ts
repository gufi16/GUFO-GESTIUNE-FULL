
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export async function GET() {
  const existing = await prisma.tenant.findFirst();
  if (existing) {
    return NextResponse.json({ message: "Seed deja rulat" });
  }

  const tenant = await prisma.tenant.create({
    data: { name: "Demo Restaurant" },
  });

  await prisma.product.createMany({
    data: [
      { tenantId: tenant.id, name: "Pizza", uom: "BUC" },
      { tenantId: tenant.id, name: "Cola", uom: "BUC" }
    ]
  });

  return NextResponse.json({ ok: true });
}
