// @ts-nocheck
import fs from "fs"
import path from "path"
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { buildTenantBackupStats, buildTenantExportZip, ensureTenantBackupDir } from "../lib/tenantExport"
import { restoreTenantBackupFromFile } from "../lib/tenantRestore"

const router = Router()

router.use(requireAuth)

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

  return res.json({ ok: true, items })
})

router.post("/api/v1/settings/backups", async (req: AuthedRequest, res) => {
  const tenantId = req.auth?.tenantId
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Tenant lipsa pentru backup." })
  }

  const label = String(req.body?.label || "").trim()
  const companyId = req.auth?.activeCompanyId || null

  try {
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
        createdByUserId: req.auth?.userId || null,
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
        actorId: req.auth?.userId,
        action: "TENANT_BACKUP_CREATED",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          fileName: finalFileName,
          fileSizeBytes: buffer.length,
          tableCounts,
        },
      },
    })

    return res.json({ ok: true, item })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut genera backup-ul clientului.",
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
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut restaura backup-ul clientului.",
    })
  }
})

export default router
