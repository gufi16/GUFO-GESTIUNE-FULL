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
  const usersRoutes = readFileSafe("src/routes/users.ts")
  const dashboardRoutes = readFileSafe("src/routes/dashboard.ts")
  const customersRoutes = readFileSafe("src/routes/customers.ts")
  const backupsTypedRoutes = readFileSafe("src/routes/backups.ts")
  const adminRoutes = readFileSafe("src/routes/admin.ts")
  const spvClassicRoutes = readFileSafe("src/routes/spvClassic.ts")
  const productionRoutes = readFileSafe("src/routes/production.ts")
  const stockLotsLib = readFileSafe("src/lib/stockLots.ts")
  const stockLib = readFileSafe("src/lib/stock.ts")
  const warehouseLib = readFileSafe("src/lib/warehouse.ts")
  const companyResolverLib = readFileSafe("src/lib/companyResolver.ts")
  const companyAnafCredentialsLib = readFileSafe("src/lib/companyAnafCredentials.ts")
  const anafClientLib = readFileSafe("src/lib/anafClient.ts")
  const incomingEfacturaLib = readFileSafe("src/lib/incomingEfactura.ts")
  const tenantExportLib = readFileSafe("src/lib/tenantExport.ts")
  const tenantRestoreLib = readFileSafe("src/lib/tenantRestore.ts")
  const professionalPdfLib = readFileSafe("src/lib/professionalPdf.ts")
  const purchaseReceiptsPdfRoutes = readFileSafe("src/routes/purchaseReceiptsPdf.ts")
  const inventoryDocsPdfRoutes = readFileSafe("src/routes/inventoryDocsPdf.ts")
  const inventoryRoutes = readFileSafe("src/routes/inventory.ts")
  const stockRoutes = readFileSafe("src/routes/stock.ts")
  const purchaseRoutes = readFileSafe("src/routes/purchase.ts")
  const reportsRoutes = readFileSafe("src/routes/reports.ts")
  const etransportRoutes = readFileSafe("src/routes/etrransport.ts")
  const transferRoutes = readFileSafe("src/routes/transfer.ts")
  const incomingEfacturaRoutes = readFileSafe("src/routes/incomingEfactura.ts")
  const consumptionDocsPdfRoutes = readFileSafe("src/routes/consumptionDocsPdf.ts")
  const consumptionRoutes = readFileSafe("src/routes/consumption.ts")
  const productionDocsRoutes = readFileSafe("src/routes/productionDocs.ts")
  const productionDocPdfSupport = readFileSafe("src/lib/productionDocPdfSupport.ts")
  const minutesDocsRoutes = readFileSafe("src/routes/minutesDocs.ts")
  const minutesDocSupport = readFileSafe("src/lib/minutesDocSupport.ts")
  const transferRouteSupport = readFileSafe("src/lib/transferRouteSupport.ts")
  const incomingEfacturaRouteSupport = readFileSafe("src/lib/incomingEfacturaRouteSupport.ts")
  const ownerMiddleware = readFileSafe("src/middleware/requireOwner.ts")
  const metaRoutes = readFileSafe("src/routes/meta.ts")
  const productRoutes = readFileSafe("src/routes/products.ts")
  const adminRouteSupport = readFileSafe("src/lib/adminRouteSupport.ts")
  const tenantRequest = readFileSafe("src/lib/tenantRequest.ts")
  const passwordReset = readFileSafe("src/lib/passwordReset.ts")
  const browserAuthCookies = readFileSafe("src/lib/browserAuthCookies.ts")
  const metaRouteSupport = readFileSafe("src/lib/metaRouteSupport.ts")
  const productRouteSupport = readFileSafe("src/lib/productRouteSupport.ts")
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

  addResult(
    "Users management routes no longer bypass TypeScript",
    !usersRoutes.startsWith("// @ts-nocheck") &&
      usersRoutes.includes('router.post("/api/v1/users/:id/reset-password"') &&
      usersRoutes.includes("mustChangePassword"),
    "Keep user creation/update/reset flows in typed routes because they control temporary passwords and forced password change."
  )

  addResult(
    "Dashboard route no longer bypasses TypeScript",
    !dashboardRoutes.startsWith("// @ts-nocheck") &&
      dashboardRoutes.includes('router.get("/api/v1/dashboard"'),
    "Keep dashboard aggregation logic type-checked because it mixes Prisma queries, raw SQL, and response shaping."
  )

  addResult(
    "Customers route no longer bypasses TypeScript",
    !customersRoutes.startsWith("// @ts-nocheck") &&
      customersRoutes.includes('router.post("/api/v1/customers"') &&
      customersRoutes.includes("reserveUniqueCustomerCode"),
    "Keep customer CRUD and code reservation type-checked because they affect commercial documents and partner master data."
  )

  addResult(
    "Backups route no longer bypasses TypeScript",
    !backupsTypedRoutes.startsWith("// @ts-nocheck") &&
      backupsTypedRoutes.includes('router.post("/api/v1/settings/backups/upload-restore"') &&
      backupsTypedRoutes.includes("persistTenantBackupSnapshot"),
    "Keep tenant backup and restore flows type-checked because they manipulate recovery files and safety snapshots."
  )

  addResult(
    "SPV classic route no longer bypasses TypeScript",
    !spvClassicRoutes.startsWith("// @ts-nocheck") &&
      spvClassicRoutes.includes('router.get("/api/v1/spv-classic/status"') &&
      spvClassicRoutes.includes("getRequiredTenantId"),
    "Keep SPV classic status and diagnostics routes type-checked because they touch fiscal integration state."
  )

  addResult(
    "Production route no longer bypasses TypeScript",
    !productionRoutes.startsWith("// @ts-nocheck") &&
      productionRoutes.includes('router.post("/api/v1/production"') &&
      productionRoutes.includes("requireRequestCompanyId"),
    "Keep production document generation and recipe consumption flows type-checked because they move stock and create accounting-relevant documents."
  )

  addResult(
    "Stock lot allocation helpers no longer bypass TypeScript",
    !stockLotsLib.startsWith("// @ts-nocheck") &&
      stockLotsLib.includes("export async function allocateProductLots") &&
      stockLotsLib.includes("Prisma.StockLotOrderByWithRelationInput"),
    "Keep FIFO/FEFO lot allocation logic type-checked because it directly mutates remaining quantities and costs."
  )

  addResult(
    "Stock balance helpers no longer bypass TypeScript",
    !stockLib.startsWith("// @ts-nocheck") &&
      stockLib.includes("export async function decrementStockBalanceStrict") &&
      stockLib.includes("type StockMutationParams"),
    "Keep stock balance increment/decrement helpers type-checked because they directly control inventory availability and negative stock behavior."
  )

  addResult(
    "Warehouse helpers no longer bypass TypeScript",
    !warehouseLib.startsWith("// @ts-nocheck") &&
      warehouseLib.includes("export async function ensureDefaultWarehouseForLocation") &&
      warehouseLib.includes("export async function resolveWarehouseForLocation"),
    "Keep default warehouse bootstrap and warehouse selection logic type-checked because they affect every stock movement scope."
  )

  addResult(
    "Company resolver no longer bypasses TypeScript",
    !companyResolverLib.startsWith("// @ts-nocheck") &&
      companyResolverLib.includes("export async function resolveTenantCompanyForAuth") &&
      companyResolverLib.includes("function collectAllowedCompanyIds"),
    "Keep tenant company resolution and allowed company filtering type-checked because they decide which legal entity a user can operate on."
  )

  addResult(
    "Company ANAF credential helpers no longer bypass TypeScript",
    !companyAnafCredentialsLib.startsWith("// @ts-nocheck") &&
      companyAnafCredentialsLib.includes("type LegacyCompany") &&
      companyAnafCredentialsLib.includes("export function mapAnafCredentialSummary") &&
      companyAnafCredentialsLib.includes("export async function resolveCompanyWithAnafCredential"),
    "Keep ANAF credential hydration and legacy-company sync helpers type-checked because they drive OAuth/certificate data used by e-Factura and e-Transport integrations."
  )

  addResult(
    "ANAF client helpers no longer bypass TypeScript",
    !anafClientLib.startsWith("// @ts-nocheck") &&
      anafClientLib.includes("export async function loadAnafCompanyContext") &&
      anafClientLib.includes("export function requireAnafReadyCompany") &&
      anafClientLib.includes("export async function anafUploadXml") &&
      anafClientLib.includes("export async function anafUploadEtransportXml"),
    "Keep ANAF client request/diagnostics helpers type-checked because they orchestrate certificate and OAuth traffic for e-Factura and e-Transport."
  )

  addResult(
    "Incoming e-Factura parsing helpers no longer bypass TypeScript",
    !incomingEfacturaLib.startsWith("// @ts-nocheck") &&
      incomingEfacturaLib.includes("type ParsedInvoiceLine") &&
      incomingEfacturaLib.includes("export function extractXmlFromAnafDownload") &&
      incomingEfacturaLib.includes("export function parseIncomingEInvoiceXml"),
    "Keep incoming e-Factura download/XML parsing helpers type-checked because they interpret ANAF payloads and invoice XML before import/linking."
  )

  addResult(
    "Tenant export helpers no longer bypass TypeScript",
    !tenantExportLib.startsWith("// @ts-nocheck") &&
      tenantExportLib.includes("type TenantExportManifest") &&
      tenantExportLib.includes("export async function buildTenantExportZip") &&
      tenantExportLib.includes("export function buildTenantBackupStats"),
    "Keep tenant export/backup packaging helpers type-checked because they assemble production customer data, uploads, and generated XML files into recovery archives."
  )

  addResult(
    "Tenant restore helpers no longer bypass TypeScript",
    !tenantRestoreLib.startsWith("// @ts-nocheck") &&
      tenantRestoreLib.includes("export async function restoreTenantBackupFromFile") &&
      tenantRestoreLib.includes("export async function restoreMissingTenantFilesFromBackupFile") &&
      tenantRestoreLib.includes("function normalizeRecord"),
    "Keep tenant restore helpers type-checked because they rebuild production customer data, documents, and uploads from backup archives."
  )

  addResult(
    "Professional PDF helpers no longer bypass TypeScript",
    !professionalPdfLib.startsWith("// @ts-nocheck") &&
      professionalPdfLib.includes("export function registerPdfFonts") &&
      professionalPdfLib.includes("export function drawSimpleTable"),
    "Keep shared PDF rendering helpers type-checked because they are reused across inventory, transfer, and accounting documents."
  )

  addResult(
    "Purchase receipt PDF route no longer bypasses TypeScript",
    !purchaseReceiptsPdfRoutes.startsWith("// @ts-nocheck") &&
      purchaseReceiptsPdfRoutes.includes('router.get("/:id/pdf"') &&
      purchaseReceiptsPdfRoutes.includes("const columns: PdfColumn[]"),
    "Keep purchase receipt PDF rendering type-checked because it generates accounting-supporting reception documents from live receipt data."
  )

  addResult(
    "Inventory PDF route no longer bypasses TypeScript",
    !inventoryDocsPdfRoutes.startsWith("// @ts-nocheck") &&
      inventoryDocsPdfRoutes.includes('router.get("/:id/pdf"') &&
      inventoryDocsPdfRoutes.includes("type InventoryDocPdfData"),
    "Keep inventory PDF rendering type-checked because it summarizes counted vs scriptic stock directly from live inventory documents."
  )

  addResult(
    "Inventory route no longer bypasses TypeScript",
    !inventoryRoutes.startsWith("// @ts-nocheck") &&
      inventoryRoutes.includes('router.post("/api/v1/inventory"') &&
      inventoryRoutes.includes("type InventoryItemInput") &&
      inventoryRoutes.includes("validateInventoryPayload"),
    "Keep inventory draft/update/finalize flows type-checked because they directly recalculate stock balances and adjustment moves."
  )

  addResult(
    "Stock route no longer bypasses TypeScript",
    !stockRoutes.startsWith("// @ts-nocheck") &&
      stockRoutes.includes('router.get("/api/v1/stock/global"') &&
      stockRoutes.includes('router.post("/api/v1/stock/transfer"') &&
      stockRoutes.includes("function toPositiveInt"),
    "Keep stock visibility and direct transfer routes type-checked because they expose quantities, movement history, and manual stock transfers."
  )

  addResult(
    "Purchase route no longer bypasses TypeScript",
    !purchaseRoutes.startsWith("// @ts-nocheck") &&
      purchaseRoutes.includes('router.post("/api/v1/purchase-receipts/full"') &&
      purchaseRoutes.includes("type PurchaseReceiptItemInput") &&
      purchaseRoutes.includes("async function createOrReplaceReceiptItems"),
    "Keep purchase receipt draft/post flows type-checked because they generate inbound stock, supplier reception values, and source invoice linking."
  )

  addResult(
    "Reports route no longer bypasses TypeScript",
    !reportsRoutes.startsWith("// @ts-nocheck") &&
      reportsRoutes.includes('router.get("/api/v1/reports/advanced"') &&
      reportsRoutes.includes("function parseDateStart"),
    "Keep advanced reporting type-checked because it aggregates sales, stock, inventory differences, and consumption trends."
  )

  addResult(
    "RO e-Transport route no longer bypasses TypeScript",
    !etransportRoutes.startsWith("// @ts-nocheck") &&
      etransportRoutes.includes('router.get("/api/v1/etransport/notices"') &&
      etransportRoutes.includes("function getErrorMessage"),
    "Keep RO e-Transport notice creation, validation, status, and receipt flows type-checked because they integrate with ANAF and transport compliance data."
  )

  addResult(
    "Transfer route helpers extracted from ts-nocheck route",
    transferRoutes.includes('from "../lib/transferRouteSupport"') &&
      transferRouteSupport.includes("export function serializeTransferDoc") &&
      transferRouteSupport.includes("export function buildETransportSummary") &&
      transferRouteSupport.includes("export function classifyEtransportStatus") &&
      transferRouteSupport.includes("export function safeTransferFilePart"),
    "Keep transfer serialization, e-Transport summary/status helpers, and file-safe formatting in a typed helper module before removing // @ts-nocheck from the large transfer route."
  )

  addResult(
    "Incoming e-Factura route helpers extracted from ts-nocheck route",
    incomingEfacturaRoutes.includes('from "../lib/incomingEfacturaRouteSupport"') &&
      incomingEfacturaRouteSupport.includes("export function incomingEfacturaMoney") &&
      incomingEfacturaRouteSupport.includes("export function incomingEfacturaDateRo") &&
      incomingEfacturaRouteSupport.includes("export function joinIncomingEfacturaAddressParts") &&
      incomingEfacturaRouteSupport.includes("export function normalizeIncomingEfacturaCurrency"),
    "Keep incoming e-Factura formatting, address joining, currency normalization, and safe filename/date helpers in a typed helper module before removing // @ts-nocheck from the large route."
  )

  addResult(
    "Incoming e-Factura route no longer bypasses TypeScript",
    !incomingEfacturaRoutes.startsWith("// @ts-nocheck") &&
      incomingEfacturaRoutes.includes('router.get("/api/v1/efactura/incoming"') &&
      incomingEfacturaRoutes.includes("errorMessage(error"),
    "Keep incoming/outgoing e-Factura list, sync, PDF/XML export, and supplier-creation flows type-checked because they import ANAF documents into purchasing workflows."
  )

  addResult(
    "Consumption PDF route no longer bypasses TypeScript",
    !consumptionDocsPdfRoutes.startsWith("// @ts-nocheck") &&
      consumptionDocsPdfRoutes.includes('router.get("/:id/pdf"') &&
      consumptionDocsPdfRoutes.includes("type ConsumptionDocPdfData"),
    "Keep consumption PDF rendering type-checked because it reflects live stock issue documents and validation state."
  )

  addResult(
    "Consumption route no longer bypasses TypeScript",
    !consumptionRoutes.startsWith("// @ts-nocheck") &&
      consumptionRoutes.includes('router.post("/api/v1/consumption-docs"') &&
      consumptionRoutes.includes("normalizeConsumptionItems") &&
      consumptionRoutes.includes("buildAggregateConsumptionPayload"),
    "Keep consumption draft/update/aggregate flows type-checked because they generate stock issue documents directly from manual input and recipe-driven sales."
  )

  addResult(
    "Production PDF helpers extracted from ts-nocheck route",
    productionDocsRoutes.includes('from "../lib/productionDocPdfSupport"') &&
      productionDocPdfSupport.includes("export function formatProductionPdfDate") &&
      productionDocPdfSupport.includes("export function drawProductionTableSection"),
    "Keep shared production PDF layout helpers in a typed module before removing // @ts-nocheck from the large production docs route."
  )

  addResult(
    "Production docs route no longer bypasses TypeScript",
    !productionDocsRoutes.startsWith("// @ts-nocheck") &&
      productionDocsRoutes.includes('router.get("/api/v1/production-docs/:id/pdf"') &&
      productionDocsRoutes.includes("type ProductionDocDetailData"),
    "Keep production document list/detail/PDF routes type-checked because they combine production output, recipe ingredients, and document exports."
  )

  addResult(
    "Minutes docs route no longer bypasses TypeScript",
    !minutesDocsRoutes.startsWith("// @ts-nocheck") &&
      minutesDocsRoutes.includes('router.post("/api/v1/minutes-docs/full"') &&
      minutesDocsRoutes.includes("type MinutesDocItemInput"),
    "Keep minutes documents type-checked because deterioration and price-change minutes directly change stock or selling prices."
  )

  addResult(
    "Minutes doc helpers extracted from typed route",
    minutesDocsRoutes.includes('from "../lib/minutesDocSupport"') &&
      minutesDocSupport.includes("export function minutesReasonLabel") &&
      minutesDocSupport.includes("export function minutesFindingLabel") &&
      minutesDocSupport.includes("export function minutesDocTypeLabel") &&
      minutesDocSupport.includes("export function formatMinutesMoney"),
    "Keep minute document parsing, reason/finding labels, and money/qty formatting in a typed helper module instead of regressing into the route file."
  )

  addResult(
    "Admin route no longer bypasses TypeScript",
    !adminRoutes.startsWith("// @ts-nocheck") &&
      adminRoutes.includes('router.get("/api/v1/admin/clients"') &&
      adminRoutes.includes("requireOwner"),
    "Keep control-panel tenant onboarding, licensing, and terminal management flows type-checked because they drive production provisioning."
  )

  addResult(
    "Admin route helpers extracted from ts-nocheck route",
    adminRoutes.includes('from "../lib/adminRouteSupport"') &&
      adminRouteSupport.includes("export function slugify") &&
      adminRouteSupport.includes("export function isReservedSubdomain") &&
      adminRouteSupport.includes("export function collectDefinedStrings") &&
      adminRouteSupport.includes("export async function generateUniqueTenantSubdomain") &&
      adminRouteSupport.includes("export async function generateUniqueDeviceId") &&
      adminRouteSupport.includes("export async function ensureTenantEfacturaModuleEnabled") &&
      adminRouteSupport.includes("export function buildTenantStatus") &&
      adminRouteSupport.includes("export function buildLicenseSummary") &&
      adminRouteSupport.includes("export function buildPosLicenseValidationResponse") &&
      adminRouteSupport.includes("export function moduleMapFromLicense") &&
      adminRouteSupport.includes("export function inferTerminalDeviceType") &&
      adminRouteSupport.includes("export function resolveTerminalDisplayLabel") &&
      adminRouteSupport.includes("export function serializeAdminLocationSummary") &&
      adminRouteSupport.includes("export function serializeAdminTerminalSummary") &&
      adminRouteSupport.includes("export function serializeCreatedAdminTerminalItem"),
    "Keep client onboarding, subdomain generation, temporary passwords, and terminal provisioning helpers in a typed helper module."
  )

  addResult(
    "Admin owner guard extracted from ts-nocheck route",
    adminRoutes.includes('from "../middleware/requireOwner"') &&
      ownerMiddleware.includes("export function requireOwner") &&
      ownerMiddleware.includes("hasGlobalControlPanelOwnerAccess"),
    "Keep the control-panel owner authorization guard in typed middleware instead of re-declaring it inside the large admin route."
  )

  addResult(
    "Meta route helpers extracted from ts-nocheck route",
    metaRoutes.includes('from "../lib/metaRouteSupport"') &&
      metaRouteSupport.includes("export async function ensureDefaultUoms") &&
      metaRouteSupport.includes("export function inferTerminalDeviceType") &&
      metaRouteSupport.includes("export function normalizeWarehouseType") &&
      metaRouteSupport.includes("export function normalizeFiscalCode") &&
      metaRouteSupport.includes("export function mergeImageUrl"),
    "Keep terminal classification, default UOM bootstrap, image normalization, and warehouse/TVA helpers in a typed helper module."
  )

  addResult(
    "Product route helpers extracted from ts-nocheck route",
    productRoutes.includes('from "../lib/productRouteSupport"') &&
      productRouteSupport.includes("export function normalizeProductFlags") &&
      productRouteSupport.includes("export function serializeProduct") &&
      productRouteSupport.includes("export async function getNextAvailableProductSkuValue") &&
      productRouteSupport.includes("export function normalizeImageUrl") &&
      productRouteSupport.includes("export function toNullableText"),
    "Keep SKU generation, class normalization, image normalization, and product/recipe serialization in a typed helper module."
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
