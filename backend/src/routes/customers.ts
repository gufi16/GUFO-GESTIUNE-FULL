import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { reserveNextNumber } from "../lib/numbering"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()

router.use(requireAuth)

function getTenantId(req: AuthedRequest) {
  const tenantId = req.auth?.tenantId ?? undefined
  return tenantId
}

function normalizeText(value: any) {
  const text = String(value ?? "").trim()
  return text || null
}

async function reserveUniqueCustomerCode(tx: any, tenantId: string, companyId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = await reserveNextNumber(tx, tenantId, "customer")
    const existing = await tx.customer.findFirst({
      where: { tenantId, companyId, code },
      select: { id: true },
    })
    if (!existing) return code
  }
  throw new Error("Nu am putut genera un cod unic pentru client.")
}

router.get("/api/v1/customers", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const q = String(req.query.q || "").trim()

  const items = await prisma.customer.findMany({
    where: {
      tenantId,
      companyId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { cif: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: q ? 20 : 200,
  })

  return res.json({
    ok: true,
    customers: items,
  })
})

router.get("/api/v1/customers/:id", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const id = req.params.id

  const customer = await prisma.customer.findFirst({
    where: { id, tenantId, companyId },
  })

  if (!customer) {
    return res.status(404).json({ ok: false, error: "Clientul nu a fost gasit." })
  }

  return res.json({
    ok: true,
    customer,
  })
})

router.post("/api/v1/customers", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const name = String(req.body?.name || "").trim()
  if (!name) {
    return res.status(400).json({ ok: false, error: "Numele clientului este obligatoriu." })
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const manualCode = normalizeText(req.body?.code)
      if (manualCode) {
        const duplicate = await tx.customer.findFirst({
          where: { tenantId, companyId, code: manualCode },
          select: { id: true },
        })
        if (duplicate) throw new Error("Exista deja un client cu acest cod.")
      }
      const code = manualCode || (await reserveUniqueCustomerCode(tx, tenantId, companyId))

      return tx.customer.create({
        data: {
          tenantId,
          companyId,
          name,
          code,
          cif: normalizeText(req.body?.cif),
          regNo: normalizeText(req.body?.regNo),
          address: normalizeText(req.body?.address),
          city: normalizeText(req.body?.city),
          county: normalizeText(req.body?.county),
          country: normalizeText(req.body?.country),
          postalCode: normalizeText(req.body?.postalCode),
          phone: normalizeText(req.body?.phone),
          email: normalizeText(req.body?.email),
          vatPayer: req.body?.vatPayer === undefined ? null : Boolean(req.body?.vatPayer),
          isActive: req.body?.isActive !== false,
        },
      })
    })

    return res.json({
      ok: true,
      customer,
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut crea clientul.",
    })
  }
})

router.put("/api/v1/customers/:id", async (req: AuthedRequest, res) => {
  const tenantId = getTenantId(req)
  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Tenant invalid." })
  }
  const companyId = await requireRequestCompanyId(req)

  const id = req.params.id

  const current = await prisma.customer.findFirst({
    where: { id, tenantId, companyId },
  })

  if (!current) {
    return res.status(404).json({ ok: false, error: "Clientul nu a fost gasit." })
  }

  const name = String(req.body?.name || "").trim()
  if (!name) {
    return res.status(400).json({ ok: false, error: "Numele clientului este obligatoriu." })
  }

  try {
    const nextCode = normalizeText(req.body?.code)
    if (nextCode) {
      const duplicate = await prisma.customer.findFirst({
        where: { tenantId, companyId, code: nextCode, NOT: { id } },
        select: { id: true },
      })
      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja un client cu acest cod." })
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name,
        code: nextCode,
        cif: normalizeText(req.body?.cif),
        regNo: normalizeText(req.body?.regNo),
        address: normalizeText(req.body?.address),
        city: normalizeText(req.body?.city),
        county: normalizeText(req.body?.county),
        country: normalizeText(req.body?.country),
        postalCode: normalizeText(req.body?.postalCode),
        phone: normalizeText(req.body?.phone),
        email: normalizeText(req.body?.email),
        vatPayer: req.body?.vatPayer === undefined ? current.vatPayer : Boolean(req.body?.vatPayer),
        isActive: req.body?.isActive !== false,
      },
    })

    return res.json({
      ok: true,
      customer,
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut actualiza clientul.",
    })
  }
})

export default router
