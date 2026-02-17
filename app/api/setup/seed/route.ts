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

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
  });
}

