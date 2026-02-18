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

    // ✅ Acceptă atât JSON cât și FormData (ca să nu mai pice cu 500)
    const contentType = req.headers.get("content-type") || ""
    let name: any
    let uom: any
    let isActive: any

    if (contentType.includes("application/json")) {
      const body = await req.json()
      name = body?.name
      uom = body?.uom
      isActive = body?.isActive
    } else {
      const fd = await req.formData()
      name = fd.get("name")
      uom = fd.get("uom")
      isActive = fd.get("isActive")
    }

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Missing product name" }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        tenantId,
        name: String(name).trim(),
        uom: (uom ? String(uom).trim() : "buc") || "buc",
        isActive:
          isActive === undefined || isActive === null
            ? true
            : String(isActive) === "true" || isActive === true,
      },
    })

    return NextResponse.json(product)
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    )
  }
}
