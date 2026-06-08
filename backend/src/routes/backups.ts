import fs from "fs"
import path from "path"
import { Router } from "express"
import multer from "multer"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildTenantBackupStats, buildTenantExportZip, ensureTenantBackupDir } from "../lib/tenantExport"
import { restoreMissingTenantFilesFromBackupFile, restoreTenantBackupFromFile } from "../lib/tenantRestore"
import { ensureTenantAdminAccess } from "../lib/tenantAdmin"

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const isZip =
      String(file.mimetype || "").includes("zip") ||
      String(file.originalname || "").toLowerCase().endsWith(".zip")
    if (!isZip) {
      cb(new Error("Se accepta doar fisiere backup .zip."))
      return
    }
    cb(null, true)
  },
})

router.use(requireAuth)
router.use((req: AuthedRequest, res, next) => {
  if (!ensureTenantAdminAccess(req, res)) return
  next()
})

function sanitizeLabel(value: string) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function fileBaseName(value: string) {
  return String(value || "")
    .replace(/\.zip$/i, "")
    .trim()
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

async function persistTenantBackupSnapshot(
  tenantId: string,
  companyId: string | null,
  userId: string | null | undefined,
  label: string,
) {
  const { zip, filename } = await buildTenantExportZip(tenantId)
  const tenantEntry = zip.getEntry("data/tenant.json")
  const payload = tenantEntry ? JSON.parse(zip.readAsText(tenantEntry)) : null
  const tableCounts = buildTenantBackupStats(payload)
  const backupDir = ensureTenantBackupDir(tenantId)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const baseName = sanitizeLabel(label) || fileBaseName(filename)
  const finalFileName = `${timestamp}-${baseName}.zip`
  const absolutePath = path.join(backupDir, finalFileName)
  const buffer = zip.toBuffer()
  fs.writeFileSync(absolutePath, buffer)

  const item = await prisma.tenantBackup.create({
    data: {
      tenantId,
      companyId,
      createdByUserId: userId || null,
      label: label || null,
      fileName: finalFileName,
      filePath: absolutePath,
      fileSizeBytes: buffer.length,
      tableCounts,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorType: "USER",
      actorId: userId || null,
      action: "TENANT_BACKUP_CREATED",
      entityType: "TenantBackup",
      entityId: item.id,
      payload: {
        fileName: finalFileName,
        fileSizeBytes: buffer.length,
        tableCounts,
        label,
      },
    },
  })

  return item
}

router.get("/api/v1/settings/backups", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const items = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return res.json({
    ok: true,
    items: items.map((item) => ({
      ...item,
      fileExists: fs.existsSync(item.filePath),
    })),
  })
})

router.post("/api/v1/settings/backups", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const label = String(req.body?.label || "").trim()
  const companyId = req.auth?.activeCompanyId || null

  try {
    const item = await persistTenantBackupSnapshot(
      tenantId,
      companyId,
      req.auth?.userId,
      label || "backup-manual",
    )

    return res.json({ ok: true, item })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut genera backup-ul clientului."),
    })
  }
})

router.post("/api/v1/settings/backups/restore-latest", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const backups = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const latestBackup = backups.find((item) => fs.existsSync(item.filePath))

  if (!latestBackup) {
    return res.status(404).json({ ok: false, error: "Nu exista niciun backup valid pe server pentru restore." })
  }

  try {
    const safetyBackup = await persistTenantBackupSnapshot(
      tenantId,
      req.auth?.activeCompanyId || null,
      req.auth?.userId,
      "siguranta-inainte-restore",
    )

    const restored = await restoreTenantBackupFromFile(tenantId, latestBackup.filePath)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RESTORED_LATEST",
        entityType: "TenantBackup",
        entityId: latestBackup.id,
        payload: {
          fileName: latestBackup.fileName,
          restored,
          safetyBackupId: safetyBackup.id,
          safetyBackupFileName: safetyBackup.fileName,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      safetyBackup: {
        id: safetyBackup.id,
        fileName: safetyBackup.fileName,
      },
      message: "Ultimul backup a fost restaurat. Starea curenta a fost salvata automat inainte de restore.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut restaura ultimul backup."),
    })
  }
})

router.post("/api/v1/settings/backups/recover-files-latest", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const backups = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const latestBackup = backups.find((item) => fs.existsSync(item.filePath))
  if (!latestBackup) {
    return res.status(404).json({ ok: false, error: "Nu exista niciun backup valid pe server pentru recuperarea fisierelor." })
  }

  try {
    const restored = await restoreMissingTenantFilesFromBackupFile(tenantId, latestBackup.filePath)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RECOVER_FILES_LATEST",
        entityType: "TenantBackup",
        entityId: latestBackup.id,
        payload: {
          fileName: latestBackup.fileName,
          restored,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      message: "Fisierele lipsa au fost recuperate din ultimul backup disponibil, fara suprascriere.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut recupera fisierele lipsa."),
    })
  }
})

router.post("/api/v1/settings/backups/upload-restore", upload.single("backup"), async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  if (!req.file?.buffer?.length) {
    return res.status(400).json({ ok: false, error: "Nu ai incarcat niciun backup .zip." })
  }

  const originalName = String(req.file.originalname || "backup-manual.zip").trim() || "backup-manual.zip"
  const backupDir = ensureTenantBackupDir(tenantId)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const finalFileName = `${timestamp}-${sanitizeLabel(fileBaseName(originalName)) || "backup-manual"}.zip`
  const absolutePath = path.join(backupDir, finalFileName)

  try {
    const safetyBackup = await persistTenantBackupSnapshot(
      tenantId,
      req.auth?.activeCompanyId || null,
      req.auth?.userId,
      "siguranta-inainte-restore-upload",
    )

    fs.writeFileSync(absolutePath, req.file.buffer)

    const item = await prisma.tenantBackup.create({
      data: {
        tenantId,
        companyId: req.auth?.activeCompanyId || null,
        createdByUserId: req.auth?.userId || null,
        label: "restore-upload-manual",
        fileName: finalFileName,
        filePath: absolutePath,
        fileSizeBytes: req.file.buffer.length,
        tableCounts: Prisma.JsonNull,
      },
    })

    const restored = await restoreTenantBackupFromFile(tenantId, absolutePath)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RESTORED_FROM_UPLOAD",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          fileName: finalFileName,
          restored,
          safetyBackupId: safetyBackup.id,
          safetyBackupFileName: safetyBackup.fileName,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      uploadedBackup: {
        id: item.id,
        fileName: item.fileName,
      },
      safetyBackup: {
        id: safetyBackup.id,
        fileName: safetyBackup.fileName,
      },
      message: "Backup-ul incarcat a fost restaurat. Starea curenta a fost salvata automat inainte de restore.",
    })
  } catch (error: unknown) {
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath)
      } catch {
        // ignore cleanup errors
      }
    }
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut restaura backup-ul incarcat."),
    })
  }
})

router.get("/api/v1/settings/backups/:id/download", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const item = await prisma.tenantBackup.findFirst({
    where: {
      id: req.params.id,
      tenantId,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Backup-ul nu a fost gasit." })
  }

  if (!fs.existsSync(item.filePath)) {
    return res.status(404).json({ ok: false, error: "Fisierul backup nu mai exista pe server." })
  }

  res.setHeader("Content-Type", "application/zip")
  res.setHeader("Content-Disposition", `attachment; filename="${item.fileName}"`)
  return res.send(fs.readFileSync(item.filePath))
})

router.post("/api/v1/settings/backups/:id/recover-files", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const item = await prisma.tenantBackup.findFirst({
    where: {
      id: req.params.id,
      tenantId,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Backup-ul nu a fost gasit." })
  }

  if (!fs.existsSync(item.filePath)) {
    return res.status(404).json({ ok: false, error: "Fisierul backup nu mai exista pe server." })
  }

  try {
    const restored = await restoreMissingTenantFilesFromBackupFile(tenantId, item.filePath)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RECOVER_FILES",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          fileName: item.fileName,
          restored,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      message: "Fisierele lipsa au fost recuperate din backup, fara suprascriere.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut recupera fisierele lipsa din backup."),
    })
  }
})

router.delete("/api/v1/settings/backups/:id", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const item = await prisma.tenantBackup.findFirst({
    where: {
      id: req.params.id,
      tenantId,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Backup-ul nu a fost gasit." })
  }

  if (!fs.existsSync(item.filePath)) {
    return res.status(404).json({ ok: false, error: "Fisierul backup nu mai exista pe server." })
  }

  try {
    if (fs.existsSync(item.filePath)) {
      fs.unlinkSync(item.filePath)
    }
  } catch {
    // ignore file cleanup errors
  }

  await prisma.tenantBackup.delete({
    where: { id: item.id },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorType: "USER",
      actorId: req.auth?.userId,
      action: "TENANT_BACKUP_DELETED",
      entityType: "TenantBackup",
      entityId: item.id,
      payload: {
        fileName: item.fileName,
      },
    },
  })

  return res.json({ ok: true })
})

router.post("/api/v1/settings/backups/:id/restore", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const item = await prisma.tenantBackup.findFirst({
    where: {
      id: req.params.id,
      tenantId,
    },
  })

  if (!item) {
    return res.status(404).json({ ok: false, error: "Backup-ul nu a fost gasit." })
  }

  try {
    const restored = await restoreTenantBackupFromFile(tenantId, item.filePath)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RESTORED",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          fileName: item.fileName,
          restored,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      message: "Backup-ul a fost restaurat direct din server.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut restaura backup-ul clientului."),
    })
  }
})

export default router
