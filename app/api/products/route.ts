import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function GET(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    const products = await prisma.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(products)
  } catch (e: any) {
    console.error("GET /api/products error:", e)
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    // ✅ IMPORTANT: asigură-te că tenantul există (altfel FK = 500)
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: {
        id: tenantId,         // setăm explicit ID-ul ca să fie exact ce bagi tu în input
        name: tenantId,       // poți pune alt nume mai târziu
      },
    })

    const body = await req.json()
    const name = String(body?.name || "").trim()
    if (!name) {
      return NextResponse.json({ error: "Missing product name" }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        tenantId,
        name,
        uom: String(body?.uom || "buc"),
        isActive: body?.isActive ?? true,
      },
    })

    return NextResponse.json(product)
  } catch (e: any) {
    console.error("POST /api/products error:", e)
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    )
  }
}
