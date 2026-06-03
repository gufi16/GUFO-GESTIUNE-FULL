import { prisma } from "./lib/prisma"
import { loadEnv } from "./lib/loadEnv"
import { getWorkerHeartbeatFile, getWorkerIntervalMs, runWorkerCycle } from "./lib/workerJobs"

loadEnv()

const startedAt = new Date()
const intervalMs = getWorkerIntervalMs()

async function main() {
  console.log(`[worker] started at ${startedAt.toISOString()}`)
  console.log(`[worker] interval ${intervalMs}ms`)
  if (getWorkerHeartbeatFile()) {
    console.log(`[worker] heartbeat file ${getWorkerHeartbeatFile()}`)
  }

  await runWorkerCycle({ startedAt })

  const timer = setInterval(() => {
    void runWorkerCycle({ startedAt })
  }, intervalMs)

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down`)
    clearInterval(timer)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch(async (error) => {
  console.error("[worker] fatal error", error)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
