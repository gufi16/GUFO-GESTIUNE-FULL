import fs from "node:fs"
import path from "node:path"
import { prisma } from "../lib/prisma"
import { getUploadsConfig } from "../lib/uploads"

type CheckResult = {
  name: string
  ok: boolean
  details?: string
}

const results: CheckResult[] = []
const NO_WAREHOUSE_SCOPE = "__NO_WAREHOUSE__"
const SOFT_MODE = process.argv.includes("--soft")

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

  const allowApiOrigin = process.env.ALLOW_API_ORIGIN === "true"
  addResult(
    "API origin not trusted as browser origin by default",
    !allowApiOrigin,
    "Disable ALLOW_API_ORIGIN unless a browser app truly runs from api.gufo.ink."
  )

  const uploadsConfig = getUploadsConfig()
  addResult(
    "Persistent uploads storage configured",
    !uploadsConfig.usingFallbackRoot || uploadsConfig.allowEphemeralUploads,
    uploadsConfig.allowEphemeralUploads
      ? "ALLOW_EPHEMERAL_UPLOADS=true bypass is active. Remove it before selling to clients."
      : "Set UPLOADS_DIR to a persistent mounted path. Fallback uploads inside app/container are unsafe on redeploy."
  )

  const workerHeartbeatFile = String(process.env.WORKER_HEARTBEAT_FILE || "").trim()
  addResult(
    "Worker heartbeat file configured",
    workerHeartbeatFile.length > 0,
    "Set WORKER_HEARTBEAT_FILE so worker liveness can be checked outside request traffic."
  )

  const demoSeedEnabled = process.env.ENABLE_DEMO_SEED === "true"
  const allowProductionDemoSeed = process.env.ALLOW_PRODUCTION_DEMO_SEED === "true"
  addResult(
    "Demo seed disabled by default",
    !demoSeedEnabled,
    "Disable ENABLE_DEMO_SEED in production/client environments."
  )
  addResult(
    "Production demo seed bypass disabled",
    !allowProductionDemoSeed,
    "Disable ALLOW_PRODUCTION_DEMO_SEED outside explicit demo-only maintenance."
  )
}

function readFileSafe(relativePath: string) {
  const fullPath = path.join(process.cwd(), relativePath)
  return fs.readFileSync(fullPath, "utf8")
}

function assertRouteHardening() {
  const companyRoutes = readFileSafe("src/routes/company.ts")
  const backupsRoutes = readFileSafe("src/routes/backups.ts")
  const authMiddleware = readFileSafe("src/middleware/requireAuth.ts")
  const indexRoutes = readFileSafe("src/index.ts")
  const webAuthRoutes = readFileSafe("src/routes/webAuth.ts")

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

  addResult(
    "ERP session restricted to tenant subdomain",
    authMiddleware.includes("Contul nu are acces pe acest subdomeniu.") &&
      authMiddleware.includes("getTenantSubdomainFromRequest(req)") &&
      webAuthRoutes.includes("Contul nu are acces pe acest subdomeniu."),
    "ERP login and authenticated requests should be blocked when tenant session is used on another tenant subdomain."
  )
}

function assertTypedSensitiveModules() {
  const indexRoutes = readFileSafe("src/index.ts")
  const tenantRequest = readFileSafe("src/lib/tenantRequest.ts")
  const passwordReset = readFileSafe("src/lib/passwordReset.ts")
  const browserAuthCookies = readFileSafe("src/lib/browserAuthCookies.ts")
  const posRoutes = readFileSafe("src/routes/pos.ts")

  addResult(
    "Backend entrypoint no longer bypasses TypeScript",
    !indexRoutes.startsWith("// @ts-nocheck"),
    "Remove // @ts-nocheck from src/index.ts once extracted helpers and route ordering are stable."
  )

  addResult(
    "Tenant request logic extracted from ts-nocheck entrypoint",
    indexRoutes.includes('from "./lib/tenantRequest"') &&
      tenantRequest.includes("export async function resolveRequestedTenantId") &&
      tenantRequest.includes("export function getTenantSubdomainFromRequest"),
    "Keep tenant/subdomain resolution in a typed helper module instead of growing index.ts."
  )

  addResult(
    "Password reset token flow extracted from ts-nocheck entrypoint",
    indexRoutes.includes('from "./lib/passwordReset"') &&
      passwordReset.includes("export async function issuePasswordResetToken"),
    "Keep password reset token issuance in a typed helper module."
  )

  addResult(
    "Browser auth cookie helpers extracted from ts-nocheck entrypoint",
    indexRoutes.includes('from "./lib/browserAuthCookies"') &&
      browserAuthCookies.includes("export function setErpAuthCookie") &&
      browserAuthCookies.includes("export function setControlAuthCookie"),
    "Keep cookie/session helper logic in a typed helper module."
  )

  addResult(
    "POS public auth routes extracted from ts-nocheck entrypoint",
    posRoutes.includes('router.post("/api/v1/license/activate"') &&
      posRoutes.includes('router.post("/api/v1/pos/pair"') &&
      posRoutes.includes('router.post("/api/v1/pos/validate"') &&
      !indexRoutes.includes('app.post("/api/v1/license/activate"') &&
      !indexRoutes.includes('app.post("/api/v1/pos/pair"') &&
      !indexRoutes.includes('app.post("/api/v1/pos/validate"'),
    "Keep POS pairing and license activation in the typed POS router instead of index.ts."
  )
}

function assertOpsAssets() {
  const repoRoot = path.resolve(process.cwd(), "..")
  const requiredAssets = [
    "docs/production-ops-runbook.md",
    "docs/staging-production-cutover.md",
    "ops/hetzner/backup-db.sh",
    "ops/hetzner/restore-db.sh",
    "ops/hetzner/test-restore-db.sh",
    "ops/hetzner/health-check.sh",
    "ops/hetzner/health-check-worker.sh",
    "ops/hetzner/smoke-test.sh",
    "ops/hetzner/rollback-release.sh",
    "ops/hetzner/staging.env.example",
    "ops/hetzner/production.env.example",
    "ops/monitoring/docker-compose.monitoring.yml",
  ]

  for (const relativePath of requiredAssets) {
    const fullPath = path.join(repoRoot, relativePath)
    addResult(
      `Ops asset present: ${relativePath}`,
      fs.existsSync(fullPath),
      `Missing required ops asset ${relativePath}.`
    )
  }
}

async function assertStockBalanceConsistency() {
  const duplicateGroups = await prisma.$queryRawUnsafe<Array<{ duplicate_count: bigint }>>(
    `
      SELECT COUNT(*)::bigint AS duplicate_count
      FROM (
        SELECT 1
        FROM "StockBalance"
        GROUP BY "tenantId", "companyId", "locationId", "productId", "warehouseScope"
        HAVING COUNT(*) > 1
      ) duplicated
    `
  )
  const duplicateGroupCount = Number(duplicateGroups[0]?.duplicate_count || 0)

  addResult(
    "StockBalance uniqueness by warehouse scope",
    duplicateGroupCount === 0,
    duplicateGroupCount
      ? `Found ${duplicateGroupCount} duplicated stock balance groups.`
      : undefined
  )

  const badScopeRows = await prisma.$queryRawUnsafe<
    Array<{ id: string; warehouseId: string | null; warehouseScope: string | null }>
  >(
    `
      SELECT "id", "warehouseId", "warehouseScope"
      FROM "StockBalance"
      WHERE
        ("warehouseId" IS NULL AND COALESCE("warehouseScope", '') <> '${NO_WAREHOUSE_SCOPE}')
        OR
        ("warehouseId" IS NOT NULL AND COALESCE("warehouseScope", '') = '${NO_WAREHOUSE_SCOPE}')
      LIMIT 20
    `
  )

  addResult(
    "StockBalance warehouse scope mapping sane",
    badScopeRows.length === 0,
    badScopeRows.length
      ? `Found ${badScopeRows.length} rows with inconsistent warehouseScope mapping.`
      : undefined
  )
}

async function assertNoDefaultDemoData() {
  const [demoTenantCount, demoUserCount] = await Promise.all([
    prisma.tenant.count({
      where: {
        OR: [{ name: "Demo Tenant" }, { subdomain: "demo" }],
      },
    }),
    prisma.user.count({
      where: {
        email: "admin@demo.local",
      },
    }),
  ])

  addResult(
    "Default demo tenant absent from production data",
    demoTenantCount === 0,
    demoTenantCount
      ? `Found ${demoTenantCount} tenant record(s) matching default demo identifiers.`
      : undefined
  )

  addResult(
    "Default demo user absent from production data",
    demoUserCount === 0,
    demoUserCount
      ? `Found ${demoUserCount} user record(s) with admin@demo.local.`
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

  if (failed > 0 && !SOFT_MODE) {
    console.error(`Release readiness audit failed with ${failed} issue(s).`)
    process.exit(1)
  }

  if (failed > 0 && SOFT_MODE) {
    console.warn(`Release readiness audit completed with ${failed} issue(s) [soft mode].`)
    process.exit(0)
  }

  console.log("Release readiness audit passed.")
}

async function main() {
  assertEnvBasics()
  assertRouteHardening()
  assertTypedSensitiveModules()
  assertOpsAssets()
  try {
    await assertStockBalanceConsistency()
  } catch (error: any) {
    addResult(
      "StockBalance DB checks executed",
      false,
      error?.message || "Could not run DB consistency checks."
    )
  }
  try {
    await assertNoDefaultDemoData()
  } catch (error: any) {
    addResult(
      "Default demo data audit executed",
      false,
      error?.message || "Could not verify default demo data absence."
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
