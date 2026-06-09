import { prisma } from "../lib/prisma"
import { getTenantBackupHealth, persistTenantBackupSnapshot } from "../lib/tenantBackupSupport"

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

  for (const tenant of tenants) {
    const health = await getTenantBackupHealth(tenant.id)
    const latestAt = health.latestBackupAt ? new Date(health.latestBackupAt) : null
    const ageMs = latestAt ? Date.now() - latestAt.getTime() : Number.POSITIVE_INFINITY
    const shouldSnapshot = force || !latestAt || ageMs > 20 * 60 * 60 * 1000

    if (!shouldSnapshot) {
      skipped += 1
      continue
    }

    await persistTenantBackupSnapshot({
      tenantId: tenant.id,
      companyId: tenant.companies[0]?.id || null,
      actorType: "SYSTEM",
      label: "auto-daily-tenant-snapshot",
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
