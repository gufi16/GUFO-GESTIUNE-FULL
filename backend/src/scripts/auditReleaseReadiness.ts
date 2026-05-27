import fs from "node:fs"
import path from "node:path"
import { prisma } from "../lib/prisma"

type CheckResult = {
  name: string
  ok: boolean
  details?: string
}

const results: CheckResult[] = []
const NO_WAREHOUSE_SCOPE = "__NO_WAREHOUSE__"

function addResult(name: string, ok: boolean, details?: string) {
  results.push({ name, ok, details })
}

function assertEnvBasics() {
  const jwtSecret = String(process.env.JWT_SECRET || "")
  addResult(
    "JWT_SECRET configured",
    jwtSecret.trim().length >= 16 && jwtSecret !== "dev_secret",
    "Set JWT_SECRET with a strong random value (at least 16 chars)."
  )

  const cpEmail = String(process.env.CONTROL_PANEL_EMAIL || "").trim()
  const cpPass = String(process.env.CONTROL_PANEL_PASSWORD || "").trim()
  addResult(
    "Control panel credentials configured",
    cpEmail.length > 0 && cpPass.length >= 8,
    "Set CONTROL_PANEL_EMAIL and CONTROL_PANEL_PASSWORD."
  )

  const allowDevLogin = process.env.ALLOW_DEV_CONTROL_PANEL_LOGIN === "true"
  const allowDevToken = process.env.ALLOW_DEV_CONTROL_PANEL_TOKEN === "true"
  addResult(
    "Dev bypass flags disabled",
    !allowDevLogin && !allowDevToken,
    "Disable ALLOW_DEV_CONTROL_PANEL_LOGIN and ALLOW_DEV_CONTROL_PANEL_TOKEN in production."
  )
}

function readFileSafe(relativePath: string) {
  const fullPath = path.join(process.cwd(), relativePath)
  return fs.readFileSync(fullPath, "utf8")
}

function assertRouteHardening() {
  const companyRoutes = readFileSafe("src/routes/company.ts")
  const backupsRoutes = readFileSafe("src/routes/backups.ts")

  addResult(
    "Backup routes protected by tenant admin guard",
    backupsRoutes.includes("ensureTenantAdminAccess"),
    "Expected ensureTenantAdminAccess guard in backups routes."
  )

  const requiredCompanyGuards = [
    "/api/v1/company/efactura/certificate",
    "/api/v1/company/efactura/oauth/start",
    "/api/v1/company/efactura/oauth/test",
    "/api/v1/company/efactura/diagnostics",
    "/api/v1/company/document-numbering",
    "/api/v1/company/pos-sync-config",
  ]

  for (const endpoint of requiredCompanyGuards) {
    const routeIndex = companyRoutes.indexOf(endpoint)
    const guardIndex =
      routeIndex >= 0
        ? companyRoutes.indexOf("if (!ensureTenantAdminAccess(req, res)) return", routeIndex)
        : -1
    addResult(
      `Route guarded: ${endpoint}`,
      routeIndex >= 0 && guardIndex >= 0 && guardIndex - routeIndex < 350,
      "Route should enforce ensureTenantAdminAccess near handler start."
    )
  }
}

async function assertStockBalanceConsistency() {
  const duplicateGroups = await prisma.stockBalance.groupBy({
    by: ["tenantId", "companyId", "locationId", "productId", "warehouseScope"],
    _count: { id: true },
    having: {
      id: {
        _count: {
          gt: 1,
        },
      },
    },
  })

  addResult(
    "StockBalance uniqueness by warehouse scope",
    duplicateGroups.length === 0,
    duplicateGroups.length
      ? `Found ${duplicateGroups.length} duplicated stock balance groups.`
      : undefined
  )

  const badScopeRows = await prisma.stockBalance.findMany({
    where: {
      OR: [
        {
          warehouseId: null,
          NOT: { warehouseScope: NO_WAREHOUSE_SCOPE },
        },
        {
          warehouseId: { not: null },
          warehouseScope: NO_WAREHOUSE_SCOPE,
        },
      ],
    },
    take: 20,
    select: {
      id: true,
      warehouseId: true,
      warehouseScope: true,
    },
  })

  addResult(
    "StockBalance warehouse scope mapping sane",
    badScopeRows.length === 0,
    badScopeRows.length
      ? `Found ${badScopeRows.length} rows with inconsistent warehouseScope mapping.`
      : undefined
  )
}

function printResultsAndExit() {
  let failed = 0
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL"
    // Keep output plain and machine-readable.
    console.log(`[${status}] ${result.name}${result.details ? ` - ${result.details}` : ""}`)
    if (!result.ok) failed += 1
  }

  if (failed > 0) {
    console.error(`Release readiness audit failed with ${failed} issue(s).`)
    process.exit(1)
  }

  console.log("Release readiness audit passed.")
}

async function main() {
  assertEnvBasics()
  assertRouteHardening()
  try {
    await assertStockBalanceConsistency()
  } catch (error: any) {
    addResult(
      "StockBalance DB checks executed",
      false,
      error?.message || "Could not run DB consistency checks."
    )
  }
  printResultsAndExit()
}

main()
  .catch((error) => {
    console.error("Release readiness audit crashed:", error?.message || error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
