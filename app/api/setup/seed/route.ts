import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const existing = await prisma.tenant.findFirst();

  if (existing) {
    return NextResponse.json({
      ok: true,
      message: "Seed already ran",
      tenantId: existing.id,
    });
  }

  const tenant = await prisma.tenant.create({
    data: { name: "Demo Restaurant SRL" },
  });

  const loc = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: "Punct lucru 1",
      code: "PL1",
    },
  });

  const wh = await prisma.warehouse.create({
    data: {
      tenantId: tenant.id,
      locationId: loc.id,
      name: "Depozit Principal",
      code: "MAIN",
    },
  });

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    locationId: loc.id,
    warehouseId: wh.id,
  });
}
