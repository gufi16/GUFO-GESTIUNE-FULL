import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function GET(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)

    if (!tenantId) {
      return NextResponse.json(
        { error: "Missing tenantId" },
        { status: 400 }
      )
    }

    const products = await prisma.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    })

    return NextResponse.json(products)
  } catch (e: any) {
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
      return NextResponse.json(
        { error: "Missing tenantId" },
        { status: 400 }
      )
    }

    const body = await req.json()

    if (!body?.name || !String(body.name).trim()) {
      return NextResponse.json(
        { error: "Missing product name" },
        { status: 400 }
      )
    }

    const product = await prisma.product.create({
      data: {
        tenantId,
        name: String(body.name).trim(),
        uom: body.uom || "buc",
        isActive: body.isActive ?? true
      }
    })

    return NextResponse.json(product)
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    )
  }
}
