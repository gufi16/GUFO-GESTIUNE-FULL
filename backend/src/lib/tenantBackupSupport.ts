import fs from "fs"
import path from "path"

import { prisma } from "./prisma"
import { buildTenantBackupStats, buildTenantExportZip, ensureTenantBackupDir } from "./tenantExport"

type BackupActorType = "SYSTEM" | "OWNER" | "USER"

type PersistTenantBackupSnapshotInput = {
  actorId?: string | null
  actorType?: BackupActorType
  companyId?: string | null
  label: string
  tenantId: string
}

const AUTO_DAILY_BACKUP_LABEL = "auto-daily-tenant-snapshot"

const TENANT_BACKUP_RETENTION_DAYS = Math.max(1, Number(process.env.TENANT_BACKUP_RETENTION_DAYS || 7))

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

async function cleanupExpiredTenantBackups(tenantId: string) {
  const cutoff = new Date(Date.now() - TENANT_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const expired = await prisma.tenantBackup.findMany({
    where: {
      tenantId,
      createdAt: {
        lt: cutoff,
      },
    },
    select: {
      id: true,
      filePath: true,
    },
  })

  for (const item of expired) {
    try {
      if (fs.existsSync(item.filePath)) {
        fs.unlinkSync(item.filePath)
      }
    } catch {
      // ignore cleanup errors and still remove stale DB entries
    }
  }

  if (expired.length) {
    await prisma.tenantBackup.deleteMany({
      where: {
        id: {
          in: expired.map((item) => item.id),
        },
      },
    })
  }

  return expired.length
}

export async function persistTenantBackupSnapshot(input: PersistTenantBackupSnapshotInput) {
  const { tenantId, companyId = null, actorId, actorType = "USER", label } = input
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
      createdByUserId: actorId || null,
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
      actorType,
      actorId: actorId || null,
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

  const removedExpiredBackups = await cleanupExpiredTenantBackups(tenantId)

  if (removedExpiredBackups > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "SYSTEM",
        actorId: null,
        action: "TENANT_BACKUP_RETENTION_CLEANUP",
        entityType: "TenantBackup",
        entityId: item.id,
        payload: {
          retentionDays: TENANT_BACKUP_RETENTION_DAYS,
          removedExpiredBackups,
        },
      },
    })
  }

  return item
}

export async function getTenantBackupHealth(tenantId: string) {
  const backups = await prisma.tenantBackup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 5,
  })

  const latestAutomatic = await prisma.tenantBackup.findFirst({
    where: {
      tenantId,
      label: AUTO_DAILY_BACKUP_LABEL,
    },
    orderBy: { createdAt: "desc" },
  })

  const latest = backups[0] || null
  const latestExisting = backups.find((item) => fs.existsSync(item.filePath)) || null
  const latestCounts =
    latestExisting?.tableCounts && typeof latestExisting.tableCounts === "object"
      ? (latestExisting.tableCounts as Record<string, unknown>)
      : null

  const customerCount = typeof latestCounts?.customers === "number" ? latestCounts.customers : 0
  const productCount = typeof latestCounts?.products === "number" ? latestCounts.products : 0
  const documentsCount =
    (typeof latestCounts?.purchaseReceipts === "number" ? latestCounts.purchaseReceipts : 0) +
    (typeof latestCounts?.transferDocs === "number" ? latestCounts.transferDocs : 0) +
    (typeof latestCounts?.consumptionDocs === "number" ? latestCounts.consumptionDocs : 0) +
    (typeof latestCounts?.productionDocs === "number" ? latestCounts.productionDocs : 0) +
    (typeof latestCounts?.inventoryDocs === "number" ? latestCounts.inventoryDocs : 0) +
    (typeof latestCounts?.minutesDocs === "number" ? latestCounts.minutesDocs : 0) +
    (typeof latestCounts?.salesInvoices === "number" ? latestCounts.salesInvoices : 0) +
    (typeof latestCounts?.sales === "number" ? latestCounts.sales : 0)

  const status = latestExisting ? "protected" : latest ? "missing_file" : "missing_backup"
  const latestAutomaticAt = latestAutomatic?.createdAt || null
  const automaticBackupStatus = latestAutomaticAt
    ? Date.now() - new Date(latestAutomaticAt).getTime() <= 36 * 60 * 60 * 1000
      ? "fresh"
      : "stale"
    : "missing"

  return {
    backupsCount: backups.length,
    automaticBackupStatus,
    customerCount,
    documentsCount,
    latestAutomaticBackupAt: latestAutomaticAt,
    latestAutomaticBackupId: latestAutomatic?.id || null,
    latestBackupAt: latest?.createdAt || null,
    latestBackupFileExists: Boolean(latestExisting),
    latestBackupId: latestExisting?.id || latest?.id || null,
    latestBackupLabel: latestExisting?.label || latest?.label || null,
    latestBackupFileName: latestExisting?.fileName || latest?.fileName || null,
    productCount,
    status,
  }
}
