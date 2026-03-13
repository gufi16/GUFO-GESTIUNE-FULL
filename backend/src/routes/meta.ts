import { Router } from "express"
import path from "path"
import fs from "fs"
import multer from "multer"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"

const router = Router()


const DEFAULT_UOMS = [
  { code: "buc", name: "Bucată" },
  { code: "set", name: "Set" },
  { code: "portie", name: "Porție" },
  { code: "kg", name: "Kilogram" },
  { code: "g", name: "Gram" },
  { code: "l", name: "Litru" },
  { code: "ml", name: "Mililitru" },
  { code: "bax", name: "Bax" },
  { code: "cutie", name: "Cutie" },
  { code: "sac", name: "Sac" },
  { code: "lada", name: "Ladă" },
  { code: "pachet", name: "Pachet" },
  { code: "bidon", name: "Bidon" },
  { code: "sticla", name: "Sticlă" },
  { code: "doza", name: "Doză" }
] as const

async function ensureDefaultUoms(tenantId: string) {
  const existing = await prisma.uom.findMany({ where: { tenantId } })
  const byCode = new Map(existing.map(item => [item.code.trim().toLowerCase(), item]))

  for (const def of DEFAULT_UOMS) {
    const match = byCode.get(def.code)

    if (match) {
      if (match.code !== def.code || match.name !== def.name || !match.isActive) {
        await prisma.uom.update({
          where: { id: match.id },
          data: {
            code: def.code,
            name: def.name,
            isActive: true
          }
        })
      }
      continue
    }

    await prisma.uom.create({
      data: {
        tenantId,
        code: def.code,
        name: def.name,
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
      cb(new Error("Sunt permise doar fișiere imagine: jpg, png, webp, gif."))
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

  const locations = await prisma.location.findMany({
    where: { tenantId },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, locations })
})

router.post("/api/v1/meta/locations", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim()

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele locației este obligatoriu."
    })
  }

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Codul locației este obligatoriu."
    })
  }

  try {
    const existing = await prisma.location.findFirst({
      where: {
        tenantId,
        OR: [{ name }, { code }]
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Există deja o locație cu acest nume sau cod."
      })
    }

    const location = await prisma.location.create({
      data: {
        tenantId,
        name,
        code,
        isActive: true
      }
    })

    res.json({ ok: true, location })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Nu am putut salva locația."
    })
  }
})

router.put("/api/v1/meta/locations/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = String(req.params.id)

  const name = String(req.body?.name || "").trim()
  const code = String(req.body?.code || "").trim()
  const isActive = Boolean(req.body?.isActive)

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele locației este obligatoriu."
    })
  }

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Codul locației este obligatoriu."
    })
  }

  try {
    const current = await prisma.location.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Locația nu există."
      })
    }

    const duplicate = await prisma.location.findFirst({
      where: {
        tenantId,
        OR: [{ name }, { code }],
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Există deja o locație cu acest nume sau cod."
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
      error: "Nu am putut actualiza locația."
    })
  }
})

router.delete("/api/v1/meta/locations/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const id = String(req.params.id)

  try {
    const current = await prisma.location.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Locația nu există."
      })
    }

    await prisma.location.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Locația este utilizată și nu poate fi ștearsă."
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
    const supplier = await prisma.supplier.create({
      data: {
        tenantId,
        name,
        code,
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
        error: "Furnizorul nu există."
      })
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
        error: "Furnizorul nu există."
      })
    }

    await prisma.supplier.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Furnizorul este utilizat și nu poate fi șters."
    })
  }
})

/* =========================
   UOM (UNITATI DE MASURA)
========================= */

router.get("/api/v1/meta/uom", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  await ensureDefaultUoms(tenantId)

  const items = await prisma.uom.findMany({
    where: { tenantId },
    orderBy: { code: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/uom", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const code = String(req.body?.code || "").trim().toUpperCase()
  const name = String(req.body?.name || "").trim()

  if (!code || !name) {
    return res.status(400).json({
      ok: false,
      error: "Codul și denumirea sunt obligatorii."
    })
  }

  try {
    const existing = await prisma.uom.findFirst({
      where: {
        tenantId,
        code
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Această unitate există deja."
      })
    }

    const item = await prisma.uom.create({
      data: {
        tenantId,
        code,
        name,
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
  const id = String(req.params.id)

  const code = String(req.body?.code || "").trim().toUpperCase()
  const name = String(req.body?.name || "").trim()
  const isActive = Boolean(req.body?.isActive)

  if (!code || !name) {
    return res.status(400).json({
      ok: false,
      error: "Codul și denumirea sunt obligatorii."
    })
  }

  try {
    const current = await prisma.uom.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Unitatea nu există."
      })
    }

    const duplicate = await prisma.uom.findFirst({
      where: {
        tenantId,
        code,
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Există deja o unitate cu acest cod."
      })
    }

    const item = await prisma.uom.update({
      where: { id },
      data: {
        code,
        name,
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
  const id = String(req.params.id)

  try {
    const current = await prisma.uom.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Unitatea nu există."
      })
    }

    await prisma.uom.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Unitatea este utilizată și nu poate fi ștearsă."
    })
  }
})

/* =========================
   VAT
========================= */

router.get("/api/v1/meta/vat", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const items = await prisma.vatRate.findMany({
    where: { tenantId },
    orderBy: { rate: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/vat", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const rawRate = req.body?.rate
  const rate = Number(rawRate)

  if (!Number.isFinite(rate)) {
    return res.status(400).json({
      ok: false,
      error: "Cota TVA trebuie să fie numerică."
    })
  }

  try {
    const existing = await prisma.vatRate.findFirst({
      where: {
        tenantId,
        rate: Math.round(rate)
      }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Această cotă TVA există deja."
      })
    }

    const item = await prisma.vatRate.create({
      data: {
        tenantId,
        rate: Math.round(rate),
        name: `TVA ${Math.round(rate)}%`,
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
  const id = String(req.params.id)

  const rawRate = req.body?.rate
  const rate = Number(rawRate)
  const isActive = Boolean(req.body?.isActive)

  if (!Number.isFinite(rate)) {
    return res.status(400).json({
      ok: false,
      error: "Cota TVA trebuie să fie numerică."
    })
  }

  try {
    const current = await prisma.vatRate.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Cota TVA nu există."
      })
    }

    const duplicate = await prisma.vatRate.findFirst({
      where: {
        tenantId,
        rate: Math.round(rate),
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Această cotă TVA există deja."
      })
    }

    const item = await prisma.vatRate.update({
      where: { id },
      data: {
        rate: Math.round(rate),
        name: `TVA ${Math.round(rate)}%`,
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
  const id = String(req.params.id)

  try {
    const current = await prisma.vatRate.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Cota TVA nu există."
      })
    }

    await prisma.vatRate.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Cota TVA este utilizată și nu poate fi ștearsă."
    })
  }
})

/* =========================
   DEPARTMENTS
========================= */

router.get("/api/v1/meta/departments", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const items = await prisma.department.findMany({
    where: { tenantId },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/departments", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const name = String(req.body?.name || "").trim()

  if (!name) {
    return res.status(400).json({
      ok: false,
      error: "Numele departamentului este obligatoriu."
    })
  }

  try {
    const existing = await prisma.department.findFirst({
      where: { tenantId, name }
    })

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "Departamentul există deja."
      })
    }

    const item = await prisma.department.create({
      data: {
        tenantId,
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
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Departamentul nu există."
      })
    }

    const duplicate = await prisma.department.findFirst({
      where: {
        tenantId,
        name,
        NOT: { id }
      }
    })

    if (duplicate) {
      return res.status(400).json({
        ok: false,
        error: "Există deja un departament cu acest nume."
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
  const id = String(req.params.id)

  try {
    const current = await prisma.department.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Departamentul nu există."
      })
    }

    await prisma.department.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Departamentul este folosit și nu poate fi șters."
    })
  }
})

/* =========================
   CATEGORIES
========================= */

router.get("/api/v1/meta/categories", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const items = await prisma.category.findMany({
    where: { tenantId },
    include: {
      department: true
    },
    orderBy: { name: "asc" }
  })

  res.json({ ok: true, items })
})

router.post("/api/v1/meta/categories", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

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
          tenantId
        }
      })

      if (!dep) {
        return res.status(404).json({
          ok: false,
          error: "Departamentul selectat nu există."
        })
      }
    }

    const item = await prisma.category.create({
      data: {
        tenantId,
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
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Categoria nu există."
      })
    }

    if (departmentId) {
      const dep = await prisma.department.findFirst({
        where: {
          id: departmentId,
          tenantId
        }
      })

      if (!dep) {
        return res.status(404).json({
          ok: false,
          error: "Departamentul selectat nu există."
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
  const id = String(req.params.id)

  try {
    const current = await prisma.category.findFirst({
      where: { id, tenantId }
    })

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Categoria nu există."
      })
    }

    await prisma.category.delete({
      where: { id }
    })

    res.json({ ok: true })
  } catch {
    res.status(400).json({
      ok: false,
      error: "Categoria este utilizată și nu poate fi ștearsă."
    })
  }
})

export default router