
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const id = String(params?.id || "")
    if (!id) {
      return NextResponse.json({ error: "Missing product id" }, { status: 400 })
    }

    const existing = await prisma.product.findFirst({ where: { id, tenantId } })
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    const name = String(body?.name ?? existing.name).trim()
    if (!name) {
      return NextResponse.json({ error: "Missing product name" }, { status: 400 })
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name,
        uom: String(body?.uom ?? existing.uom ?? "buc"),
        isActive: body?.isActive ?? existing.isActive,
      },
    })

    return NextResponse.json(product)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Bad request" }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    const id = String(params?.id || "")
    if (!id) {
      return NextResponse.json({ error: "Missing product id" }, { status: 400 })
    }

    const existing = await prisma.product.findFirst({ where: { id, tenantId } })
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    await prisma.product.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Bad request" }, { status: 400 })
  }
}
