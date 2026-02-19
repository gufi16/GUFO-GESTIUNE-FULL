import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

// DELETE /api/customers/[id]?tenantId=...
export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    const id = String(params?.id || "").trim()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // safety: ensure this customer belongs to tenant
    const existing = await prisma.customer.findFirst({
      where: { id, tenantId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.customer.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("DELETE /api/customers/[id] error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
