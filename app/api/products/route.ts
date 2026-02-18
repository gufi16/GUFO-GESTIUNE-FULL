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

    // body safe (dacă vine gol / nu e JSON -> {})
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const rawName = body?.name ?? body?.productName ?? body?.product?.name ?? ""
    const name = String(rawName).trim()

    if (!name) {
      return NextResponse.json(
        { error: "Missing product name", receivedBody: body },
        { status: 400 }
      )
    }

    // asigură tenant existent (FK)
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, name: tenantId },
    })

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
