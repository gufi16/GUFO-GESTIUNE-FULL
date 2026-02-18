import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    const id = params.id
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // protecție multi-tenant
    const existing = await prisma.customer.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.customer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("DELETE /api/customers/[id] error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
