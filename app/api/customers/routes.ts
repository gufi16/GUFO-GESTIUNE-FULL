import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantId } from "@/lib/tenant"

export async function GET(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    const customers = await prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(customers)
  } catch (e: any) {
    console.error("GET /api/customers error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })

    // asigură tenant existent (ca la products)
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, name: tenantId },
    })

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const name = String(body?.name || "").trim()
    if (!name) return NextResponse.json({ error: "Missing customer name" }, { status: 400 })

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        name,
        email: body?.email ? String(body.email).trim() : null,
        phone: body?.phone ? String(body.phone).trim() : null,
        vatCode: body?.vatCode ? String(body.vatCode).trim() : null,
        regNo: body?.regNo ? String(body.regNo).trim() : null,
        address: body?.address ? String(body.address).trim() : null,
        city: body?.city ? String(body.city).trim() : null,
        country: body?.country ? String(body.country).trim() : "RO",
        notes: body?.notes ? String(body.notes).trim() : null,
        isActive: body?.isActive ?? true,
      },
    })

    return NextResponse.json(customer)
  } catch (e: any) {
    console.error("POST /api/customers error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
