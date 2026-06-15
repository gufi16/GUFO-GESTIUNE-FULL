import fs from "fs"
import path from "path"
import { Router } from "express"
import multer from "multer"
import AdmZip from "adm-zip"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { ensureTenantBackupDir } from "../lib/tenantExport"
import { getTenantBackupHealth, persistTenantBackupSnapshot } from "../lib/tenantBackupSupport"
import { EXCHANGE_EXPORTABLE_MODULES, exportTenantDataWorkbookZip, importTenantDataWorkbookZip } from "../lib/backupDataExchange"
import {
  describeTenantBackupModulesFromFile,
  restoreMissingTenantFilesFromBackupFile,
  restoreTenantBackupFromFile,
  restoreTenantBackupSelectionFromFile,
} from "../lib/tenantRestore"
import { ensureTenantAdminAccess } from "../lib/tenantAdmin"

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024,
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

function parseSelectedModules(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || "").trim()).filter(Boolean)
}

function parseExportModules(value: unknown) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? String(value)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []

  const allowed = new Set<string>(EXCHANGE_EXPORTABLE_MODULES)
  const modules = rawValues.map((item) => String(item || "").trim()).filter((item) => allowed.has(item))
  return modules.length ? Array.from(new Set(modules)) : [...EXCHANGE_EXPORTABLE_MODULES]
}

function isAllowedImportFile(file: Express.Multer.File | undefined) {
  if (!file?.buffer?.length) return false
  const name = String(file.originalname || "").toLowerCase()
  const mime = String(file.mimetype || "").toLowerCase()
  return name.endsWith(".zip") || name.endsWith(".xlsx") || mime.includes("zip") || mime.includes("spreadsheet")
}

function isZipBackupFile(file: Express.Multer.File | undefined) {
  if (!file?.buffer?.length) return false
  const name = String(file.originalname || "").toLowerCase()
  const mime = String(file.mimetype || "").toLowerCase()
  return name.endsWith(".zip") || mime.includes("zip")
}

async function cleanupMissingTenantBackupEntries(tenantId: string) {
  const items = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const existingItems = items.filter((item) => fs.existsSync(item.filePath))
  const missingIds = items.filter((item) => !fs.existsSync(item.filePath)).map((item) => item.id)

  if (missingIds.length) {
    await prisma.tenantBackup.deleteMany({
      where: {
        tenantId,
        id: { in: missingIds },
      },
    })
  }

  return existingItems
}

router.get("/api/v1/settings/backups", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const items = await cleanupMissingTenantBackupEntries(tenantId)
  const health = await getTenantBackupHealth(tenantId)

  return res.json({
    ok: true,
    health,
    items: items.map((item) => ({
      ...item,
      fileExists: true,
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
    const item = await persistTenantBackupSnapshot({
      tenantId,
      companyId,
      actorId: req.auth?.userId,
      actorType: "USER",
      label: label || "backup-manual",
    })

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
    const safetyBackup = await persistTenantBackupSnapshot({
      tenantId,
      companyId: req.auth?.activeCompanyId || null,
      actorId: req.auth?.userId,
      actorType: "USER",
      label: "siguranta-inainte-restore",
    })

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

router.post("/api/v1/settings/backups/sync-cloud", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const requestedBackupId = String(req.body?.backupId || "").trim()
  const modules = parseSelectedModules(req.body?.modules)
  if (!modules.length) {
    return res.status(400).json({ ok: false, error: "Selecteaza cel putin un modul pentru sync." })
  }

  const backups = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const sourceBackup = requestedBackupId
    ? backups.find((item) => item.id === requestedBackupId)
    : backups.find((item) => fs.existsSync(item.filePath))

  if (!sourceBackup) {
    return res.status(404).json({ ok: false, error: "Nu exista backup sursa pentru sync cloud." })
  }

  if (!fs.existsSync(sourceBackup.filePath)) {
    return res.status(404).json({ ok: false, error: "Fisierul sursa nu mai exista pe server." })
  }

  try {
    const restored = await restoreTenantBackupSelectionFromFile(tenantId, sourceBackup.filePath, modules, "sync_missing")

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_SYNC_CLOUD",
        entityType: "TenantBackup",
        entityId: sourceBackup.id,
        payload: {
          fileName: sourceBackup.fileName,
          modules,
          restored: restored as Prisma.InputJsonValue,
        },
      },
    })

    return res.json({
      ok: true,
      restored,
      sourceBackup: {
        id: sourceBackup.id,
        fileName: sourceBackup.fileName,
        createdAt: sourceBackup.createdAt,
      },
      message: "Sync cloud finalizat. Au fost aduse doar datele lipsa, fara dubluri.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut executa sync cloud."),
    })
  }
})

router.post("/api/v1/settings/backups/upload-restore", upload.single("backup"), async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  if (!isZipBackupFile(req.file)) {
    return res.status(400).json({ ok: false, error: "Nu ai incarcat niciun backup .zip valid." })
  }
  const file = req.file!

  const originalName = String(file.originalname || "backup-manual.zip").trim() || "backup-manual.zip"
  const backupDir = ensureTenantBackupDir(tenantId)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const finalFileName = `${timestamp}-${sanitizeLabel(fileBaseName(originalName)) || "backup-manual"}.zip`
  const absolutePath = path.join(backupDir, finalFileName)

  try {
    const safetyBackup = await persistTenantBackupSnapshot({
      tenantId,
      companyId: req.auth?.activeCompanyId || null,
      actorId: req.auth?.userId,
      actorType: "USER",
      label: "siguranta-inainte-restore-upload",
    })

    fs.writeFileSync(absolutePath, file.buffer)

    const item = await prisma.tenantBackup.create({
      data: {
        tenantId,
        companyId: req.auth?.activeCompanyId || null,
        createdByUserId: req.auth?.userId || null,
        label: "restore-upload-manual",
        fileName: finalFileName,
        filePath: absolutePath,
        fileSizeBytes: file.buffer.length,
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

router.get("/api/v1/settings/backups/data-export", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru export." })
  }

  try {
    const exported = await exportTenantDataWorkbookZip(tenantId, parseExportModules(req.query.modules))

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_DATA_EXPORT_XLSX",
        entityType: "Tenant",
        entityId: tenantId,
        payload: {
          fileName: exported.fileName,
          modules: parseExportModules(req.query.modules),
          files: exported.files,
        },
      },
    })

    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${exported.fileName}"`)
    return res.send(exported.buffer)
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut genera exportul Excel."),
    })
  }
})

router.post("/api/v1/settings/backups/data-import", upload.single("file"), async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru import." })
  }

  if (!isAllowedImportFile(req.file)) {
    return res.status(400).json({ ok: false, error: "Incarca un fisier .zip sau .xlsx valid." })
  }

  try {
    const importBuffer = req.file!.originalname.toLowerCase().endsWith(".xlsx")
      ? (() => {
          const zip = new AdmZip()
          zip.addFile(path.posix.basename(req.file!.originalname), req.file!.buffer)
          return zip.toBuffer()
        })()
      : req.file!.buffer

    const imported = await importTenantDataWorkbookZip(tenantId, importBuffer)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_DATA_IMPORT_XLSX",
        entityType: "Tenant",
        entityId: tenantId,
        payload: {
          fileName: req.file?.originalname || "import",
          imported: imported as Prisma.InputJsonValue,
        },
      },
    })

    return res.json({
      ok: true,
      imported,
      message: "Importul Excel a fost finalizat.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut importa fisierele Excel."),
    })
  }
})

router.get("/api/v1/settings/backups/:id/modules", async (req: AuthedRequest, res) => {
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
    const modules = describeTenantBackupModulesFromFile(tenantId, item.filePath)
    return res.json({
      ok: true,
      backup: {
        id: item.id,
        fileName: item.fileName,
        createdAt: item.createdAt,
      },
      modules,
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut citi modulele disponibile din backup."),
    })
  }
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

router.post("/api/v1/settings/backups/:id/restore-selected", async (req: AuthedRequest, res) => {
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

  const modules = parseSelectedModules(req.body?.modules)
  if (!modules.length) {
    return res.status(400).json({ ok: false, error: "Selecteaza cel putin un modul pentru restore." })
  }

  try {
    const safetyBackup = await persistTenantBackupSnapshot({
      tenantId,
      companyId: req.auth?.activeCompanyId || null,
      actorId: req.auth?.userId,
      actorType: "USER",
      label: "siguranta-inainte-restore-selectiv",
    })

    const restored = await restoreTenantBackupSelectionFromFile(tenantId, item.filePath, modules)

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_RESTORED_SELECTED",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          fileName: item.fileName,
          modules,
          restored: restored as Prisma.InputJsonValue,
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
      message: "Modulele selectate au fost aduse inapoi din backupul de pe server.",
    })
  } catch (error: unknown) {
    return res.status(500).json({
      ok: false,
      error: errorMessage(error, "Nu am putut restaura modulele selectate din backup."),
    })
  }
})

export default router
