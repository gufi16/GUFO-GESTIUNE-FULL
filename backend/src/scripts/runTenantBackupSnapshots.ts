import { prisma } from "../lib/prisma"
import { persistTenantBackupSnapshot } from "../lib/tenantBackupSupport"

const AUTO_DAILY_BACKUP_LABEL = "auto-daily-tenant-snapshot"

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

async function main() {
  const force = process.argv.includes("--force")
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      companies: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      },
    },
  })

  let created = 0
  let skipped = 0
  const todayUtcStart = startOfUtcDay()

  for (const tenant of tenants) {
    const latestAutoBackup = await prisma.tenantBackup.findFirst({
      where: {
        tenantId: tenant.id,
        label: AUTO_DAILY_BACKUP_LABEL,
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })

    const latestAutoAt = latestAutoBackup?.createdAt ? new Date(latestAutoBackup.createdAt) : null
    const shouldSnapshot = force || !latestAutoAt || latestAutoAt < todayUtcStart

    if (!shouldSnapshot) {
      skipped += 1
      continue
    }

    await persistTenantBackupSnapshot({
      tenantId: tenant.id,
      companyId: tenant.companies[0]?.id || null,
      actorType: "SYSTEM",
      label: AUTO_DAILY_BACKUP_LABEL,
    })
    created += 1
  }

  console.log(
    JSON.stringify(
      {
        created,
        skipped,
        tenants: tenants.length,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
