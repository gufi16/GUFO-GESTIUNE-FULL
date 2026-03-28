import dotenv from "dotenv"
import { prisma } from "./lib/prisma"
import { getWorkerIntervalMs, runWorkerCycle } from "./lib/workerJobs"

dotenv.config()

const startedAt = new Date()
const intervalMs = getWorkerIntervalMs()

async function main() {
  console.log(`[worker] started at ${startedAt.toISOString()}`)
  console.log(`[worker] interval ${intervalMs}ms`)

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
