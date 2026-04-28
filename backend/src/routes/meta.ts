// @ts-nocheck
import { Router } from "express"
import path from "path"
import fs from "fs"
import multer from "multer"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { reserveNextNumber } from "../lib/numbering"
import { requireRequestCompanyId } from "../lib/companyScope"

const router = Router()


const DEFAULT_UOMS = [
  { code: "buc", name: "Bucata", standardCode: "C62" },
  { code: "set", name: "Set", standardCode: "SET" },
  { code: "portie", name: "Portie", standardCode: "C62" },
  { code: "kg", name: "Kilogram", standardCode: "KGM" },
  { code: "g", name: "Gram", standardCode: "GRM" },
  { code: "l", name: "Litru", standardCode: "LTR" },
  { code: "ml", name: "Mililitru", standardCode: "MLT" },
  { code: "bax", name: "Bax", standardCode: "C62" },
  { code: "cutie", name: "Cutie", standardCode: "C62" },
  { code: "sac", name: "Sac", standardCode: "C62" },
  { code: "lada", name: "Lada", standardCode: "C62" },
  { code: "pachet", name: "Pachet", standardCode: "C62" },
  { code: "bidon", name: "Bidon", standardCode: "C62" },
  { code: "sticla", name: "Sticla", standardCode: "C62" },
  { code: "doza", name: "Doza", standardCode: "C62" }
] as const

function buildCompanyScope(companyId: string) {
  return [{ companyId }, { companyId: null }]
}

function normalizeStandardUomCode(value: any) {
  const text = String(value || "").trim().toUpperCase()
  return text || null
}

async function buildPreferredCompanyFilter(
  model: "location" | "terminal",
  tenantId: string,
  companyId: string
) {
  const companiesCount = await prisma.company.count({
    where: { tenantId },
  })

  if (companiesCount > 1) {
    return { companyId }
  }

  const hasCompanySpecific =
    model === "location"
      ? (await prisma.location.count({
          where: { tenantId, companyId },
        })) > 0
      : (await prisma.terminal.count({
          where: { tenantId, companyId },
        })) > 0

  return hasCompanySpecific ? { companyId } : { companyId: null }
}

async function ensureDefaultUoms(tenantId: string, companyId: string) {
  const existing = await prisma.uom.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
  })
  const byCode = new Map(existing.map(item => [item.code.trim().toLowerCase(), item]))

  for (const def of DEFAULT_UOMS) {
    const match = byCode.get(def.code)

    if (match) {
      const resolvedStandardCode = String(match.standardCode || "").trim() || def.standardCode

      if (
        match.code !== def.code ||
        match.name !== def.name ||
        match.standardCode !== resolvedStandardCode ||
        !match.isActive
      ) {
        await prisma.uom.update({
          where: { id: match.id },
          data: {
            code: def.code,
            name: def.name,
            standardCode: resolvedStandardCode,
            isActive: true
          }
        })
      }
      continue
    }

    await prisma.uom.create({
      data: {
        tenantId,
        companyId,
        code: def.code,
        name: def.name,
        standardCode: def.standardCode,
        isActive: true
      }
    })
  }
}


const uploadsDir = path.join(process.cwd(), "uploads", "categories")
fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase()
    const safeExt = ext || ".jpg"
    const baseName = path
      .basename(file.originalname || "image", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50)

    cb(null, `${Date.now()}-${baseName}${safeExt}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)
    if (!ok) {
      cb(new Error("Sunt permise doar fisiere imagine: jpg, png, webp, gif."))
      return
    }
    cb(null, true)
  }
})

router.use(requireAuth)

function normalizeImageUrl(value: any) {
  const text = String(value || "").trim()
  return text || null
}

function buildPublicImageUrl(req: any, folder: "products" | "categories", filename: string) {
  return `${req.protocol}://${req.get("host")}/uploads/${folder}/${filename}`
}

router.post(
  "/api/v1/meta/categories/upload-image",
  upload.single("image"),
  async (req: AuthedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Nu ai selectat nicio imagine." })
    }

    return res.json({
      ok: true,
      imageUrl: buildPublicImageUrl(req, "categories", req.file.filename)
    })
  }
)

/* =========================
   LOCATIONS
========================= */

router.get("/api/v1/meta/locations", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const companyFilter = await buildPreferredCompanyFilter("location", tenantId, companyId)

  const locations = await prisma.location.findMany({
    where: {
      tenantId,
      ...companyFilter,
    },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, locations })
})

router.get("/api/v1/meta/terminals", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const locationId = String(req.query.locationId || "").trim()
  const companyFilter = await buildPreferredCompanyFilter("terminal", tenantId, companyId)

  const terminals = await prisma.terminal.findMany({
    where: {
      tenantId,
      ...companyFilter,
      ...(locationId ? { locationId } : {}),
    },
    select: {
      id: true,
      label: true,
      deviceId: true,
      locationId: true,
      location: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
    orderBy: [{ label: "asc" }, { deviceId: "asc" }],
  })

  res.json({ ok: true, terminals })
})

router.post("/api/v1/meta/locations", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim()

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele locatiei este obligatoriu."
    })
  }

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Codul locatiei este obligatoriu."
    })
  }

  try {
    const existing = await prisma.location.findFirst({
      where: {
        tenantId,
        AND: [
          { OR: buildCompanyScope(companyId) },
          { OR: [{ name }, { code }] }
        ]
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Exista deja o locatie cu acest nume sau cod."
      })
    }

    const location = await prisma.location.create({
      data: {
        tenantId,
        companyId,
        name,
        code,
        isActive: true
      }
    })

    res.json({ ok: true, location })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva locatia."
    })
  }
})

router.put("/api/v1/meta/locations/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim()
  const isActive = Boolean(req.body?.isActive)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele locatiei este obligatoriu."
    })
  }

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Codul locatiei este obligatoriu."
    })
  }

  try {
    const current = await prisma.location.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Locatia nu exista."
      })
    }

    const duplicate = await prisma.location.findFirst({
      where: {
        tenantId,
        companyId: current.companyId ?? companyId,
        OR: [{ name }, { code }],
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Exista deja o locatie cu acest nume sau cod."
      })
    }

    const location = await prisma.location.update({
      where: { id },
      data: {
        name,
        code,
        isActive
      }
    })

    res.json({ ok: true, location })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza locatia."
    })
  }
})

router.delete("/api/v1/meta/locations/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  try {
    const current = await prisma.location.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Locatia nu exista."
      })
    }

    await prisma.location.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Locatia este utilizata si nu poate fi stearsa."
    })
  }
})

/* =========================
   SUPPLIERS
========================= */

router.get("/api/v1/meta/suppliers", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const suppliers = await prisma.supplier.findMany({
    where: { tenantId },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, suppliers })
})

async function reserveUniqueSupplierCode(tx: any, tenantId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = await reserveNextNumber(tx, tenantId, "supplier")
    const existing = await tx.supplier.findFirst({
      where: { tenantId, code },
      select: { id: true },
    })
    if (!existing) return code
  }
  throw new Error("Nu am putut genera un cod unic pentru furnizor.")
}

router.post("/api/v1/meta/suppliers", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim() || null
  const cif = String(req.body?.cif || "").trim() || null
  const regCom = String(req.body?.regCom || req.body?.regNo || "").trim() || null
  const address = String(req.body?.address || "").trim() || null
  const city = String(req.body?.city || "").trim() || null
  const country = String(req.body?.country || "").trim() || null
  const phone = String(req.body?.phone || "").trim() || null
  const email = String(req.body?.email || "").trim() || null

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele furnizorului este obligatoriu."
    })
  }

  try {
    const supplier = await prisma.$transaction(async (tx) => {
      if (code) {
        const duplicate = await tx.supplier.findFirst({
          where: { tenantId, code },
          select: { id: true },
        })
        if (duplicate) throw new Error("Exista deja un furnizor cu acest cod.")
      }
      const nextCode = code || (await reserveUniqueSupplierCode(tx, tenantId))

      return tx.supplier.create({
        data: {
          tenantId,
          name,
          code: nextCode,
          cif,
          regCom,
          address,
          city,
          country,
          phone,
          email,
          isActive: true
        }
      })
    })

    res.json({ ok: true, supplier })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva furnizorul."
    })
  }
})

router.put("/api/v1/meta/suppliers/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = String(req.params.id)

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim() || null
  const cif = String(req.body?.cif || "").trim() || null
  const regCom = String(req.body?.regCom || req.body?.regNo || "").trim() || null
  const address = String(req.body?.address || "").trim() || null
  const city = String(req.body?.city || "").trim() || null
  const country = String(req.body?.country || "").trim() || null
  const phone = String(req.body?.phone || "").trim() || null
  const email = String(req.body?.email || "").trim() || null
  const isActive = Boolean(req.body?.isActive)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele furnizorului este obligatoriu."
    })
  }

  try {
    const current = await prisma.supplier.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Furnizorul nu exista."
      })
    }

    if (code) {
      const duplicate = await prisma.supplier.findFirst({
        where: { tenantId, code, NOT: { id } },
        select: { id: true },
      })
      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Exista deja un furnizor cu acest cod." })
      }
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name,
        code,
        cif,
        regCom,
        address,
        city,
        country,
        phone,
        email,
        isActive
      }
    })

    res.json({ ok: true, supplier })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza furnizorul."
    })
  }
})

router.delete("/api/v1/meta/suppliers/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = String(req.params.id)

  try {
    const current = await prisma.supplier.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Furnizorul nu exista."
      })
    }

    await prisma.supplier.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Furnizorul este utilizat si nu poate fi sters."
    })
  }
})

/* =========================
   UOM (UNITATI DE MASURA)
========================= */

router.get("/api/v1/meta/uom", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  await ensureDefaultUoms(tenantId, companyId)

  const items = await prisma.uom.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
    orderBy: { code: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/uom", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const code = String(req.body?.code || "").trim().toUpperCase()
  const standardCode = normalizeStandardUomCode(req.body?.standardCode)
  const name = String(req.body?.name || "").trim()

  if (!code || !name) {
    return res.status(400).json({
      ok: false,
      error: "Codul si denumirea sunt obligatorii."
    })
  }

  try {
    const existing = await prisma.uom.findFirst({
      where: {
        tenantId,
        companyId,
        code
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Aceasta unitate exista deja."
      })
    }

    const item = await prisma.uom.create({
      data: {
        tenantId,
        companyId,
        code,
        name,
        standardCode,
        isActive: true
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva unitatea."
    })
  }
})

router.put("/api/v1/meta/uom/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const code = String(req.body?.code || "").trim().toUpperCase()
  const standardCode = normalizeStandardUomCode(req.body?.standardCode)
  const name = String(req.body?.name || "").trim()
  const isActive = Boolean(req.body?.isActive)

  if (!code || !name) {
    return res.status(400).json({
      ok: false,
      error: "Codul si denumirea sunt obligatorii."
    })
  }

  try {
    const current = await prisma.uom.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Unitatea nu exista."
      })
    }

    const duplicate = await prisma.uom.findFirst({
      where: {
        tenantId,
        companyId: current.companyId ?? companyId,
        code,
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Exista deja o unitate cu acest cod."
      })
    }

    const item = await prisma.uom.update({
      where: { id },
      data: {
        code,
        name,
        standardCode,
        isActive
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza unitatea."
    })
  }
})

router.delete("/api/v1/meta/uom/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  try {
    const current = await prisma.uom.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Unitatea nu exista."
      })
    }

    await prisma.uom.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Unitatea este utilizata si nu poate fi stearsa."
    })
  }
})

/* =========================
   VAT
========================= */

const FISCAL_CODES = ["A", "B", "C", "D", "E", "F", "G"] as const

function normalizeFiscalCode(value: unknown) {
  const code = String(value || "").trim().toUpperCase()
  if (!code) return null
  return FISCAL_CODES.includes(code as (typeof FISCAL_CODES)[number]) ? code : null
}

router.get("/api/v1/meta/vat", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const items = await prisma.vatRate.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
    orderBy: [{ rate: "asc" }]
  })

  res.json({ ok: true, items, fiscalCodes: FISCAL_CODES })
})

router.post("/api/v1/meta/vat", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const rawRate = req.body?.rate
  const rate = Number(rawRate)
  const fiscalCode = normalizeFiscalCode(req.body?.fiscalCode)

  if (!Number.isFinite(rate)) {
    return res.status(400).json({
      ok: false,
      error: "Cota TVA trebuie sa fie numerica."
    })
  }

  if (req.body?.fiscalCode && !fiscalCode) {
    return res.status(400).json({
      ok: false,
      error: "Codul fiscal trebuie sa fie una dintre valorile A, B, C, D, E, F sau G."
    })
  }

  try {
    const roundedRate = Math.round(rate)

    const existing = await prisma.vatRate.findFirst({
      where: {
        tenantId,
        companyId,
        rate: roundedRate
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Aceasta cota TVA exista deja."
      })
    }

    if (fiscalCode) {
      const duplicateFiscalCode = await prisma.vatRate.findFirst({
        where: {
          tenantId,
          companyId,
          fiscalCode
        }
      })

      if (duplicateFiscalCode) {
        return res.status(400).json({
          ok: false,
          error: `Codul fiscal ${fiscalCode} este deja folosit pe alta cota TVA.`
        })
      }
    }

      const item = await prisma.vatRate.create({
        data: {
          tenantId,
          companyId,
          rate: roundedRate,
          name: `TVA ${roundedRate}%`,
        fiscalCode,
        isActive: true
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva cota TVA."
    })
  }
})

router.put("/api/v1/meta/vat/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const rawRate = req.body?.rate
  const rate = Number(rawRate)
  const isActive = Boolean(req.body?.isActive)
  const fiscalCode = normalizeFiscalCode(req.body?.fiscalCode)

  if (!Number.isFinite(rate)) {
    return res.status(400).json({
      ok: false,
      error: "Cota TVA trebuie sa fie numerica."
    })
  }

  if (req.body?.fiscalCode && !fiscalCode) {
    return res.status(400).json({
      ok: false,
      error: "Codul fiscal trebuie sa fie una dintre valorile A, B, C, D, E, F sau G."
    })
  }

  try {
    const current = await prisma.vatRate.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Cota TVA nu exista."
      })
    }

    const roundedRate = Math.round(rate)

    const duplicate = await prisma.vatRate.findFirst({
      where: {
        tenantId,
        companyId: current.companyId ?? companyId,
        rate: roundedRate,
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Aceasta cota TVA exista deja."
      })
    }

    if (fiscalCode) {
      const duplicateFiscalCode = await prisma.vatRate.findFirst({
        where: {
          tenantId,
          companyId: current.companyId ?? companyId,
          fiscalCode,
          NOT: { id }
        }
      })

      if (duplicateFiscalCode) {
        return res.status(400).json({
          ok: false,
          error: `Codul fiscal ${fiscalCode} este deja folosit pe alta cota TVA.`
        })
      }
    }

    const item = await prisma.vatRate.update({
      where: { id },
        data: {
          companyId: current.companyId ?? companyId,
          rate: roundedRate,
          name: `TVA ${roundedRate}%`,
        fiscalCode,
        isActive
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza cota TVA."
    })
  }
})

router.delete("/api/v1/meta/vat/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  try {
    const current = await prisma.vatRate.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Cota TVA nu exista."
      })
    }

    await prisma.vatRate.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Cota TVA este utilizata si nu poate fi stearsa."
    })
  }
})

/* =========================
   DEPARTMENTS
========================= */

router.get("/api/v1/meta/departments", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const items = await prisma.department.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/departments", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const name = String(req.body?.name || "").trim()

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele departamentului este obligatoriu."
    })
  }

  try {
    const existing = await prisma.department.findFirst({
      where: { tenantId, companyId, name }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Departamentul exista deja."
      })
    }

    const item = await prisma.department.create({
      data: {
        tenantId,
        companyId,
        name,
        isActive: true
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva departamentul."
    })
  }
})

router.put("/api/v1/meta/departments/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)
  const name = String(req.body?.name || "").trim()
  const isActive = Boolean(req.body?.isActive)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele departamentului este obligatoriu."
    })
  }

  try {
    const current = await prisma.department.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Departamentul nu exista."
      })
    }

    const duplicate = await prisma.department.findFirst({
      where: {
        tenantId,
        companyId: current.companyId ?? companyId,
        name,
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Exista deja un departament cu acest nume."
      })
    }

    const item = await prisma.department.update({
      where: { id },
      data: { name, isActive }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza departamentul."
    })
  }
})

router.delete("/api/v1/meta/departments/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  try {
    const current = await prisma.department.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Departamentul nu exista."
      })
    }

    await prisma.department.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Departamentul este folosit si nu poate fi sters."
    })
  }
})

/* =========================
   CATEGORIES
========================= */

router.get("/api/v1/meta/categories", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const items = await prisma.category.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
    include: {
      department: true
    },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/categories", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)

  const name = String(req.body?.name || "").trim()
  const imageUrl = normalizeImageUrl(req.body?.imageUrl)
  const departmentIdRaw = String(req.body?.departmentId || "").trim()
  const departmentId = departmentIdRaw || null
  const isVisibleInPos = req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele categoriei este obligatoriu."
    })
  }

  try {
    if (departmentId) {
      const dep = await prisma.department.findFirst({
        where: {
          id: departmentId,
          tenantId,
          OR: buildCompanyScope(companyId),
        }
      })

      if (!dep) {
        return res.status(404).json({
          ok: false,
          error: "Departamentul selectat nu exista."
        })
      }
    }

    const item = await prisma.category.create({
      data: {
        tenantId,
        companyId,
        name,
        imageUrl,
        departmentId,
        isActive: true,
        isVisibleInPos
      },
      include: {
        department: true
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva categoria."
    })
  }
})

router.put("/api/v1/meta/categories/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  const name = String(req.body?.name || "").trim()
  const imageUrl = normalizeImageUrl(req.body?.imageUrl)
  const departmentIdRaw = String(req.body?.departmentId || "").trim()
  const departmentId = departmentIdRaw || null
  const isActive = Boolean(req.body?.isActive)
  const isVisibleInPos = req.body?.isVisibleInPos === undefined ? true : Boolean(req.body?.isVisibleInPos)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele categoriei este obligatoriu."
    })
  }

  try {
    const current = await prisma.category.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Categoria nu exista."
      })
    }

    if (departmentId) {
      const dep = await prisma.department.findFirst({
        where: {
          id: departmentId,
          tenantId,
          OR: buildCompanyScope(companyId),
        }
      })

      if (!dep) {
        return res.status(404).json({
          ok: false,
          error: "Departamentul selectat nu exista."
        })
      }
    }

    const item = await prisma.category.update({
      where: { id },
      data: {
        name,
        imageUrl,
        departmentId,
        isActive,
        isVisibleInPos
      },
      include: {
        department: true
      }
    })

    res.json({ ok: true, item })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut actualiza categoria."
    })
  }
})

router.delete("/api/v1/meta/categories/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const companyId = await requireRequestCompanyId(req)
  const id = String(req.params.id)

  try {
    const current = await prisma.category.findFirst({
      where: {
        id,
        tenantId,
        OR: buildCompanyScope(companyId),
      }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Categoria nu exista."
      })
    }

    await prisma.category.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Categoria este utilizata si nu poate fi stearsa."
    })
  }
})

export default router
