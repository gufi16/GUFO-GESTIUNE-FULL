import { prisma } from "./prisma"

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export type WorkerContext = {
  startedAt: Date
}

export async function runWorkerCycle(ctx: WorkerContext) {
  const now = new Date()
  const tenantCount = await prisma.tenant.count().catch(() => 0)

  console.log(
    `[worker] heartbeat ${now.toISOString()} tenants=${tenantCount} uptimeSec=${Math.floor(
      (now.getTime() - ctx.startedAt.getTime()) / 1000
    )}`
  )

  // Future worker jobs:
  // - outgoing e-Factura status polling
  // - incoming SPV scheduled sync
  // - retry processing for ANAF failures
  // - heavy exports / emails
}

export function getWorkerIntervalMs() {
  return toPositiveInt(process.env.WORKER_INTERVAL_MS, 60_000)
}
