export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 })
    }

    const contentType = req.headers.get("content-type") || ""

    let body: any = {}

    // ✅ NU mai folosim req.json() direct (poate arunca SyntaxError dacă body e gol/invalid)
    if (contentType.includes("application/json")) {
      const raw = await req.text()
      if (!raw.trim()) {
        return NextResponse.json({ error: "Empty JSON body" }, { status: 400 })
      }
      try {
        body = JSON.parse(raw)
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
      }
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const fd = await req.formData()
      body = Object.fromEntries(fd.entries())
    } else {
      // fallback
      const raw = await req.text()
      if (raw.trim()) {
        try { body = JSON.parse(raw) } catch {}
      }
    }

    const name = body?.name

    if (!name || !String(name).trim()) {
      return NextResponse.json(
        { error: "Missing product name", receivedBody: body, contentType },
        { status: 400 }
      )
    }

    const product = await prisma.product.create({
      data: {
        tenantId,
        name: String(name).trim(),
        uom: body?.uom ? String(body.uom).trim() : "buc",
        isActive: body?.isActive ?? true,
      },
    })

    return NextResponse.json(product)
  } catch (e: any) {
    console.error("POST /api/products error:", e)
    return NextResponse.json(
      {
        error: e?.message || "Server error",
        code: e?.code,
      },
      { status: 500 }
    )
  }
}
