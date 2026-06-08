import fs from "node:fs"
import path from "node:path"
import { prisma } from "./prisma"
import { getUploadsRoot } from "./uploads"

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export type WorkerContext = {
  startedAt: Date
}

export const DEFAULT_WORKER_HEARTBEAT_RELATIVE_PATH = path.join("ops", "worker-heartbeat.json")

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function getWorkerHeartbeatFile() {
  const configured = String(process.env.WORKER_HEARTBEAT_FILE || "").trim()
  if (configured) {
    return configured
  }

  return path.join(getUploadsRoot(), DEFAULT_WORKER_HEARTBEAT_RELATIVE_PATH)
}

function writeWorkerHeartbeat(payload: Record<string, unknown>) {
  const heartbeatFile = getWorkerHeartbeatFile()
  if (!heartbeatFile) return

  ensureParentDir(heartbeatFile)
  fs.writeFileSync(heartbeatFile, JSON.stringify(payload, null, 2))
}

export async function runWorkerCycle(ctx: WorkerContext) {
  const now = new Date()
  const tenantCount = await prisma.tenant.count().catch(() => 0)

  console.log(
    `[worker] heartbeat ${now.toISOString()} tenants=${tenantCount} uptimeSec=${Math.floor(
      (now.getTime() - ctx.startedAt.getTime()) / 1000
    )}`
  )

  writeWorkerHeartbeat({
    ok: true,
    now: now.toISOString(),
    startedAt: ctx.startedAt.toISOString(),
    uptimeSec: Math.floor((now.getTime() - ctx.startedAt.getTime()) / 1000),
    tenantCount,
  })

  // Future worker jobs:
  // - outgoing e-Factura status polling
  // - incoming SPV scheduled sync
  // - retry processing for ANAF failures
  // - heavy exports / emails
}

export function getWorkerIntervalMs() {
  return toPositiveInt(process.env.WORKER_INTERVAL_MS, 60_000)
}
