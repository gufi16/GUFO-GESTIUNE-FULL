
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const tenantId = getTenantId(req)
    const body = await req.json()
    const product = await prisma.product.update({
      where: { id: params.id },
      data: {
        name: body.name,
        uom: body.uom,
        isActive: body.isActive
      }
    })
    return NextResponse.json(product)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const tenantId = getTenantId(req)
    await prisma.product.delete({
      where: { id: params.id }
    })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
}
