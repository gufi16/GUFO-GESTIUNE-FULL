// @ts-nocheck
import { Router } from "express"
import jwt from "jsonwebtoken"
import fs from "fs"
import multer from "multer"
import path from "path"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { getNextNumberPreview, getNumberingConfig, normalizeNumberingPayload } from "../lib/numbering"
import { requireTenantModule } from "../lib/tenantModules"
import { anafHttpRequest } from "../lib/anafHttp"
import { getAnafCompanyDiagnostics, getAnafTokenDiagnostics } from "../lib/anafClient"
import { resolveTenantCompany, updateOrCreateTenantCompany } from "../lib/companyResolver"
import { resolveRequestCompany } from "../lib/companyScope"
import {
  ANAF_CREDENTIAL_SELECT,
  getCompanyAnafCredentialById,
  getDefaultCompanyAnafCredential,
  listCompanyAnafCredentials,
  mapAnafCredentialSummary,
  resolveCompanyWithAnafCredential,
  setDefaultCompanyAnafCredential,
  syncCompanyToDefaultAnafCredential,
  syncDefaultAnafCredentialToCompany,
} from "../lib/companyAnafCredentials"
import {
  deleteEfacturaCertificateFile,
  encryptSecret,
  ensureEfacturaCertDir,
  getEfacturaCertPath,
} from "../lib/efacturaCertificate"
import { ensureUploadSubdir } from "../lib/uploads"
import { getJwtSecret } from "../lib/auth"
import { ensureTenantAdminAccess } from "../lib/tenantAdmin"
import {
  type AnafOauthStatePayload,
  type EfacturaAgentDownloadTicketPayload,
  type EfacturaAgentPairingPayload,
  buildAnafOauthReturnUrl,
  clearAnafOauthContextCookie,
  createEfacturaAgentDownloadTicket,
  createEfacturaAgentPairingCode,
  decodeTokenExpiry,
  extractAnafCompanyPayload,
  getEffectiveAnafOauthConfig,
  getActiveCompanyId,
  getDefaultEfacturaAppUrl,
  getEfacturaAgentDownloadFileName,
  getEfacturaAgentDownloadSource,
  getCompanyRouteErrorMessage,
  getRequestAnafCredential,
  getRequestCompany,
  getRequestedCompanyId,
  getRequestedCredentialId,
  isValidEfacturaAgentDownloadTicketPayload,
  isValidEfacturaAgentPairingPayload,
  mapCompanyResponse,
  normalizeOptionalText,
  parseAnafOauthStateOrThrow,
  parseEfacturaAgentDownloadTicketOrThrow,
  parseEfacturaAgentPairingCodeOrThrow,
  persistAnafOauthError,
  requireExplicitAnafCompanyContext,
  requireExplicitAnafCompanyContextForAuth,
  resolveEfacturaAgentPairingDetails,
  updateRequestCompany,
} from "../lib/companyRouteSupport"

const router = Router()

const ANAF_AUTH_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/authorize"
const ANAF_TOKEN_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/token"
const ANAF_LOGOUT_URL = "https://login.anaf.ro/my.logout.php3?errorcode=19"
const ANAF_TEST_URL = "https://api.anaf.ro/TestOauth/jaxrs/hello?name=GuFo%20ERP"
const ANAF_CUI_LOOKUP_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva"
const JWT_SECRET = getJwtSecret()
const ANAF_OAUTH_CTX_COOKIE = "gufo_anaf_oauth_ctx"
const efacturaAgentUploadsDir = ensureUploadSubdir("efactura-agent")
const certUploadsDir = ensureEfacturaCertDir()
const efacturaAgentDownloadDirs = Array.from(new Set([
  String(process.env.GUFO_EFACTURA_AGENT_DOWNLOAD_DIR || "").trim(),
  efacturaAgentUploadsDir,
].filter(Boolean)))

const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, certUploadsDir)
  },
  filename: (_req: AuthedRequest, file, cb) => {
    const ext = String(path.extname(file.originalname || "").toLowerCase() || ".p12")
    const normalizedExt = ext === ".pfx" || ext === ".p12" ? ext : ".p12"
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${normalizedExt}`)
  },
})

const certUpload = multer({
  storage: certStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase()
    if (ext !== ".p12" && ext !== ".pfx") {
      cb(new Error("Sunt permise doar certificate .p12 sau .pfx."))
      return
    }
    cb(null, true)
  },
})

export async function handleAnafOauthCallback(req, res) {
  const code = String(req.query.code || "")
  const error = String(req.query.error || "")
  const errorDescription = String(req.query.error_description || "")
  const stateRaw = String(req.query.state || "")
  const cookieStateRaw = String(req.cookies?.[ANAF_OAUTH_CTX_COOKIE] || "")
  const effectiveStateRaw = cookieStateRaw || stateRaw

  clearAnafOauthContextCookie(res, ANAF_OAUTH_CTX_COOKIE)

  if (!effectiveStateRaw) {
    return res.status(400).send("Lipsesc parametrii OAuth ANAF.")
  }

  let state: AnafOauthStatePayload | null = null
  try {
    state = parseAnafOauthStateOrThrow(effectiveStateRaw, JWT_SECRET)
  } catch {
    return res.status(400).send("State OAuth invalid sau expirat.")
  }

  try {
    await requireExplicitAnafCompanyContext(prisma, state.tenantId, state.activeCompanyId || null)
  } catch (error: unknown) {
    return res.redirect(buildAnafOauthReturnUrl(
      state.returnTo,
      "error",
      getCompanyRouteErrorMessage(error, "Firma activa nu este disponibila pentru OAuth."),
    ))
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(prisma, state.tenantId, state.activeCompanyId || null)
  const moduleCheck = await requireTenantModule(state.tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).send("Modulul e-Factura nu este activ pe licenta acestui client.")
  }

  if (!oauthConfig.clientId || !oauthConfig.clientSecret || !oauthConfig.redirectUri) {
    return res.status(400).send("Configuratia ANAF nu este completa.")
  }

  if (error) {
    const nextError =
      errorDescription ||
      (error === "access_denied"
        ? "Autorizarea ANAF a fost anulata sau refuzata."
        : error || "Autorizarea ANAF nu a putut fi finalizata.")

    console.log("ANAF OAUTH CALLBACK ERROR", {
      error,
      errorDescription: errorDescription || null,
      codePresent: Boolean(code),
      hasStateParam: Boolean(stateRaw),
      hasStateCookie: Boolean(cookieStateRaw),
    })

    await persistAnafOauthError(
      prisma,
      state.tenantId,
      state.activeCompanyId,
      state.credentialId,
      nextError,
    )

    return res.redirect(buildAnafOauthReturnUrl(state.returnTo, "denied", nextError))
  }

  if (!code) {
    return res.status(400).send("Lipsesc parametrii OAuth ANAF.")
  }

  try {
    const authHeader = Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthConfig.redirectUri,
      token_content_type: "jwt",
    })

    const tokenRes = await fetch(ANAF_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })

    const payload = await tokenRes.json().catch(() => ({}))

    if (!tokenRes.ok || !payload?.access_token) {
      await persistAnafOauthError(
        prisma,
        state.tenantId,
        state.activeCompanyId,
        state.credentialId,
        String(payload?.error_description || payload?.error || "Nu am putut obtine token-ul ANAF."),
      )

      return res.redirect(buildAnafOauthReturnUrl(state.returnTo, "error"))
    }

    const company = await resolveTenantCompany(prisma, state.tenantId, state.activeCompanyId || null, {
      select: { id: true, tenantId: true, name: true },
    })

    if (!company?.id) {
      throw new Error("Firma activa nu este disponibila pentru salvarea tokenului ANAF.")
    }

    const credential = state.credentialId
      ? await getCompanyAnafCredentialById(prisma as any, state.tenantId, company.id, state.credentialId)
      : await getDefaultCompanyAnafCredential(prisma as any, state.tenantId, company.id)

    if (!credential?.id) {
      throw new Error("Nu exista o credențiala ANAF disponibila pentru firma activa.")
    }

    const updatedCredential = await prisma.companyAnafCredential.update({
      where: { id: credential.id },
      data: {
        efacturaOauthAccessToken: String(payload.access_token),
        efacturaOauthRefreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
        efacturaOauthAccessTokenExpiresAt: decodeTokenExpiry(String(payload.access_token)),
        efacturaOauthRefreshTokenExpiresAt: decodeTokenExpiry(payload.refresh_token ? String(payload.refresh_token) : null),
        efacturaOauthConnectedAt: new Date(),
        efacturaOauthLastError: null,
      },
      select: ANAF_CREDENTIAL_SELECT,
    })

    const activeCredential = credential.isDefault
      ? updatedCredential
      : await setDefaultCompanyAnafCredential(prisma as any, state.tenantId, company.id, updatedCredential.id)

    await syncDefaultAnafCredentialToCompany(prisma as any, company.id, activeCredential)

    return res.redirect(buildAnafOauthReturnUrl(state.returnTo, "success"))
  } catch (error: unknown) {
    await persistAnafOauthError(
      prisma,
      state.tenantId,
      state.activeCompanyId,
      state.credentialId,
      getCompanyRouteErrorMessage(error, "Eroare la schimbul token-ului ANAF."),
    )

    return res.redirect(buildAnafOauthReturnUrl(state.returnTo, "error"))
  }
}

router.get("/api/v1/company/efactura/oauth/callback", handleAnafOauthCallback)

router.get("/api/v1/public/efactura/agent-download", async (req, res) => {
  const ticket = String(req.query.ticket || "").trim()

  if (!ticket) {
    return res.status(401).json({
      ok: false,
      error: "Lipseste ticket-ul de descarcare.",
    })
  }

  let payload: EfacturaAgentDownloadTicketPayload | null = null
  try {
    payload = parseEfacturaAgentDownloadTicketOrThrow(ticket, JWT_SECRET)
  } catch {
    return res.status(401).json({
      ok: false,
      error: "Ticket-ul de descarcare este invalid sau expirat.",
    })
  }

  if (!isValidEfacturaAgentDownloadTicketPayload(payload)) {
    return res.status(401).json({
      ok: false,
      error: "Ticket-ul de descarcare este invalid.",
    })
  }

  const moduleCheck = await requireTenantModule(payload.tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource(efacturaAgentDownloadDirs)

  if (!source.available) {
    return res.status(404).json({
      ok: false,
      error: source.error,
    })
  }

  if (source.type === "external" && source.url) {
    return res.redirect(source.url)
  }

  if (source.type === "local" && source.fullPath) {
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader("Content-Disposition", `attachment; filename="${getEfacturaAgentDownloadFileName(source)}"`)
    return res.sendFile(source.fullPath)
  }

  return res.status(404).json({
    ok: false,
    error: "Installerul Gufo e-Factura nu este disponibil.",
  })
})

router.get("/api/v1/public/efactura/agent-pairing/resolve", async (req, res) => {
  const code = String(req.query.code || "").trim()

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Lipseste codul de pairing.",
    })
  }

  let payload: EfacturaAgentPairingPayload | null = null
  try {
    payload = parseEfacturaAgentPairingCodeOrThrow(code, JWT_SECRET)
  } catch {
    return res.status(401).json({
      ok: false,
      error: "Codul de pairing este invalid sau expirat.",
    })
  }

  const tenantId = String(payload?.sub || "").trim()

  if (!isValidEfacturaAgentPairingPayload(payload) || !tenantId) {
    return res.status(401).json({
      ok: false,
      error: "Codul de pairing este invalid.",
    })
  }

  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const { company, credential } = await resolveEfacturaAgentPairingDetails(prisma, tenantId, payload)

  return res.json({
    ok: true,
    pairing: {
      tenantId,
      companyName: company?.name || null,
      erpUrl: String(payload?.erpUrl || getDefaultEfacturaAppUrl()),
      certSerial: normalizeOptionalText(credential?.certSerial || payload?.certSerial || company?.efacturaCertSerial) || null,
      credentialId: payload?.credentialId || null,
      expiresAt: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
    },
  })
})

router.use(requireAuth)

const ALLOWED_POS_SYNC_INTERVALS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]

router.get("/api/v1/company", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const [company, oauthConfig] = await Promise.all([
      getRequestCompany(prisma, req, { includeCredentialList: true }),
      getEffectiveAnafOauthConfig(prisma, tenantId, getActiveCompanyId(req)),
    ])

    return res.json({
      ok: true,
      company: company ? mapCompanyResponse(company, oauthConfig) : null
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la incarcarea firmei"
    })
  }
})

router.get("/api/v1/company/cui-lookup", async (req: AuthedRequest, res) => {
  const cuiRaw = String(req.query.cui || "")
    .trim()
    .toUpperCase()
    .replace(/^RO/, "")
    .replace(/\D/g, "")

  if (!cuiRaw) {
    return res.status(400).json({
      ok: false,
      error: "Introdu un CUI valid.",
    })
  }

  try {
    const response = await fetch(ANAF_CUI_LOOKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        {
          cui: Number(cuiRaw),
          data: new Date().toISOString().slice(0, 10),
        },
      ]),
    })

    const payload = await response.json().catch(() => ({}))
    const found = Array.isArray(payload?.found) ? payload.found : []
    const item = found[0]

    if (!response.ok || !item) {
      return res.status(404).json({
        ok: false,
        error: payload?.message || "Nu am gasit firma dupa CUI in serviciul ANAF.",
      })
    }

    return res.json({
      ok: true,
      company: extractAnafCompanyPayload(item),
      raw: item,
    })
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: error?.message || "Nu am putut interoga serviciul ANAF pentru CUI.",
    })
  }
})

router.post("/api/v1/company", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId

  const {
    name,
    cui,
    regNo,
    address,
    city,
    county,
    country,
    postalCode,
    bank,
    iban,
    email,
    contactEmail,
    phone,
    isVatPayer,
    multiWarehouseEnabled,
    warehouseFilterEnabled,
    requireWarehouseOnDocuments,
    autoSelectSingleWarehouse,
    warehouseLabel,
    posSyncInterval,
    efacturaEnabled,
    efacturaEnvironment,
    efacturaSellerCountryCode,
    efacturaSellerCity,
    efacturaSellerCounty,
    efacturaSellerPostalCode,
    efacturaContactEmail,
    efacturaCertSerial,
    efacturaCertPassword,
    efacturaOauthClientId,
    efacturaOauthClientSecret,
    efacturaOauthRedirectUri
  } = req.body || {}

  if (!String(name || "").trim()) {
    return res.status(400).json({
      ok: false,
      error: "Numele firmei este obligatoriu."
    })
  }

  const nextIsVatPayer = isVatPayer !== undefined ? Boolean(isVatPayer) : true

  let nextPosSyncInterval = 5
  if (posSyncInterval !== undefined) {
    const parsed = Number(posSyncInterval)
    if (!ALLOWED_POS_SYNC_INTERVALS.includes(parsed)) {
      return res.status(400).json({
        ok: false,
        error: "Intervalul de sync POS este invalid."
      })
    }
    nextPosSyncInterval = parsed
  }

  try {
    const existing = await getRequestCompany(prisma, req)

    const company = await updateRequestCompany(prisma, req, {
        name: String(name).trim(),
        cui: cui ? String(cui).trim() : null,
        regNo: regNo ? String(regNo).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        county: county ? String(county).trim() : null,
        country: String(country || existing?.country || "RO").trim().toUpperCase() || "RO",
        postalCode: postalCode ? String(postalCode).trim() : null,
        bank: bank ? String(bank).trim() : null,
        iban: iban ? String(iban).trim() : null,
        email: email ? String(email).trim() : null,
        contactEmail: contactEmail ? String(contactEmail).trim() : null,
        phone: phone ? String(phone).trim() : null,
        isVatPayer: isVatPayer !== undefined
          ? nextIsVatPayer
          : (existing?.isVatPayer ?? true),
        multiWarehouseEnabled: Object.prototype.hasOwnProperty.call(req.body || {}, "multiWarehouseEnabled")
          ? Boolean(multiWarehouseEnabled)
          : (existing?.multiWarehouseEnabled ?? false),
        warehouseFilterEnabled: Object.prototype.hasOwnProperty.call(req.body || {}, "warehouseFilterEnabled")
          ? Boolean(warehouseFilterEnabled)
          : (existing?.warehouseFilterEnabled ?? false),
        requireWarehouseOnDocuments: Object.prototype.hasOwnProperty.call(req.body || {}, "requireWarehouseOnDocuments")
          ? Boolean(requireWarehouseOnDocuments)
          : (existing?.requireWarehouseOnDocuments ?? false),
        autoSelectSingleWarehouse: Object.prototype.hasOwnProperty.call(req.body || {}, "autoSelectSingleWarehouse")
          ? Boolean(autoSelectSingleWarehouse)
          : (existing?.autoSelectSingleWarehouse ?? true),
        warehouseLabel: String(
          warehouseLabel ||
          existing?.warehouseLabel ||
          "Gestiune",
        ).trim() || "Gestiune",
        efacturaEnabled: efacturaEnabled !== undefined
          ? Boolean(efacturaEnabled)
          : (existing?.efacturaEnabled ?? false),
        efacturaEnvironment: String(efacturaEnvironment || existing?.efacturaEnvironment || "test").trim() || "test",
        efacturaSellerCountryCode: String(efacturaSellerCountryCode || country || existing?.efacturaSellerCountryCode || existing?.country || "RO").trim().toUpperCase() || "RO",
        efacturaSellerCity: String(efacturaSellerCity || city || existing?.efacturaSellerCity || existing?.city || "").trim() || null,
        efacturaSellerCounty: String(efacturaSellerCounty || county || existing?.efacturaSellerCounty || existing?.county || "").trim() || null,
        efacturaSellerPostalCode: String(efacturaSellerPostalCode || postalCode || existing?.efacturaSellerPostalCode || existing?.postalCode || "").trim() || null,
        efacturaContactEmail: String(efacturaContactEmail || contactEmail || existing?.efacturaContactEmail || existing?.contactEmail || "").trim() || null,
        efacturaCertSerial: Object.prototype.hasOwnProperty.call(req.body || {}, "efacturaCertSerial")
          ? normalizeOptionalText(efacturaCertSerial)
          : existing?.efacturaCertSerial ?? null,
        efacturaCertPasswordEnc:
          typeof efacturaCertPassword === "string" && efacturaCertPassword.trim()
            ? encryptSecret(String(efacturaCertPassword).trim())
            : existing?.efacturaCertPasswordEnc ?? null,
        efacturaOauthClientId: efacturaOauthClientId ? String(efacturaOauthClientId).trim() : null,
        efacturaOauthClientSecret: efacturaOauthClientSecret ? String(efacturaOauthClientSecret).trim() : null,
        efacturaOauthRedirectUri: efacturaOauthRedirectUri ? String(efacturaOauthRedirectUri).trim() : null,
        posSyncInterval: posSyncInterval !== undefined
          ? nextPosSyncInterval
          : (existing?.posSyncInterval ?? 5),
        invoiceSeries: existing?.invoiceSeries ?? "FAC",
        purchaseSeries: existing?.purchaseSeries ?? "NIR",
        transferSeries: existing?.transferSeries ?? "TRF",
        inventorySeries: existing?.inventorySeries ?? "INV",
        productionSeries: existing?.productionSeries ?? "PROD",
        customerCodePrefix: existing?.customerCodePrefix ?? "CLI",
        supplierCodePrefix: existing?.supplierCodePrefix ?? "FUR",
      }, {
        name: String(name).trim(),
        cui: cui ? String(cui).trim() : null,
        regNo: regNo ? String(regNo).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        county: county ? String(county).trim() : null,
        country: String(country || "RO").trim().toUpperCase() || "RO",
        postalCode: postalCode ? String(postalCode).trim() : null,
        bank: bank ? String(bank).trim() : null,
        iban: iban ? String(iban).trim() : null,
        email: email ? String(email).trim() : null,
        contactEmail: contactEmail ? String(contactEmail).trim() : null,
        phone: phone ? String(phone).trim() : null,
        isVatPayer: nextIsVatPayer,
        multiWarehouseEnabled: Boolean(multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: Object.prototype.hasOwnProperty.call(req.body || {}, "autoSelectSingleWarehouse")
          ? Boolean(autoSelectSingleWarehouse)
          : true,
        warehouseLabel: String(warehouseLabel || "Gestiune").trim() || "Gestiune",
        efacturaEnabled: Boolean(efacturaEnabled),
        efacturaEnvironment: String(efacturaEnvironment || "test").trim() || "test",
        efacturaSellerCountryCode: String(efacturaSellerCountryCode || country || "RO").trim().toUpperCase() || "RO",
        efacturaSellerCity: String(efacturaSellerCity || city || "").trim() || null,
        efacturaSellerCounty: String(efacturaSellerCounty || county || "").trim() || null,
        efacturaSellerPostalCode: String(efacturaSellerPostalCode || postalCode || "").trim() || null,
        efacturaContactEmail: String(efacturaContactEmail || contactEmail || "").trim() || null,
        efacturaCertSerial: normalizeOptionalText(efacturaCertSerial),
        efacturaCertPasswordEnc:
          typeof efacturaCertPassword === "string" && efacturaCertPassword.trim()
            ? encryptSecret(String(efacturaCertPassword).trim())
            : null,
        efacturaOauthClientId: efacturaOauthClientId ? String(efacturaOauthClientId).trim() : null,
        efacturaOauthClientSecret: efacturaOauthClientSecret ? String(efacturaOauthClientSecret).trim() : null,
        efacturaOauthRedirectUri: efacturaOauthRedirectUri ? String(efacturaOauthRedirectUri).trim() : null,
        posSyncInterval: nextPosSyncInterval,
        invoiceSeries: "FAC",
        purchaseSeries: "NIR",
        transferSeries: "TRF",
        inventorySeries: "INV",
        productionSeries: "PROD",
        customerCodePrefix: "CLI",
        supplierCodePrefix: "FUR",
      })

    await syncCompanyToDefaultAnafCredential(prisma as any, tenantId, company.id)

    const resolvedCompany = await getRequestCompany(prisma, req, { includeCredentialList: true })

    return res.json({
      ok: true,
      company: mapCompanyResponse(resolvedCompany, await getEffectiveAnafOauthConfig(prisma, tenantId, getActiveCompanyId(req)))
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea firmei"
    })
  }
})

router.get("/api/v1/company/warehouse-config", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  try {
    const company = await getRequestCompany(prisma, req, {
      select: {
        multiWarehouseEnabled: true,
        warehouseFilterEnabled: true,
        requireWarehouseOnDocuments: true,
        autoSelectSingleWarehouse: true,
        warehouseLabel: true,
      },
    })

    return res.json({
      ok: true,
      settings: {
        multiWarehouseEnabled: Boolean(company?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(company?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(company?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: company?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(company?.warehouseLabel || "Gestiune"),
      },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut incarca setarile de gestiune.",
    })
  }
})

router.post("/api/v1/company/warehouse-config", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId

  try {
    const existing = await getRequestCompany(prisma, req)
    const settings = {
      multiWarehouseEnabled: Boolean(req.body?.multiWarehouseEnabled),
      warehouseFilterEnabled: Boolean(req.body?.warehouseFilterEnabled),
      requireWarehouseOnDocuments: Boolean(req.body?.requireWarehouseOnDocuments),
      autoSelectSingleWarehouse: req.body?.autoSelectSingleWarehouse !== false,
      warehouseLabel: String(req.body?.warehouseLabel || existing?.warehouseLabel || "Gestiune").trim() || "Gestiune",
    }

    const company = await updateRequestCompany(prisma, req, settings, {
      name: existing?.name || "Companie",
      code: existing?.code || "FIRMA-1",
      country: existing?.country || "RO",
      isVatPayer: existing?.isVatPayer ?? true,
      invoiceSeries: existing?.invoiceSeries || "FAC",
      purchaseSeries: existing?.purchaseSeries || "NIR",
      transferSeries: existing?.transferSeries || "TRF",
      inventorySeries: existing?.inventorySeries || "INV",
      consumptionSeries: existing?.consumptionSeries || "BC",
      productionSeries: existing?.productionSeries || "PROD",
      customerCodePrefix: existing?.customerCodePrefix || "CLI",
      supplierCodePrefix: existing?.supplierCodePrefix || "FUR",
      posSyncInterval: existing?.posSyncInterval || 5,
      efacturaEnvironment: existing?.efacturaEnvironment || "test",
      ...settings,
    })

    const resolvedCompany = await getRequestCompany(prisma, req, { includeCredentialList: true })

    return res.json({
      ok: true,
      settings: {
        multiWarehouseEnabled: Boolean(company?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(company?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(company?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: company?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(company?.warehouseLabel || "Gestiune"),
      },
      company: mapCompanyResponse(resolvedCompany, await getEffectiveAnafOauthConfig(prisma, tenantId, getActiveCompanyId(req))),
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Nu am putut salva setarile de gestiune.",
    })
  }
})

router.post(
  "/api/v1/company/efactura/certificate",
  requireAuth,
  certUpload.single("certificate"),
  async (req: AuthedRequest, res) => {
    if (!ensureTenantAdminAccess(req, res)) return
    const tenantId = req.auth!.tenantId
    const requestedCredentialId = getRequestedCredentialId(req)

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "Nu ai selectat niciun certificat .p12/.pfx.",
        })
      }

      const serial = normalizeOptionalText(req.body?.efacturaCertSerial)
      const password = String(req.body?.efacturaCertPassword || "").trim()
      if (!password) {
        fs.unlinkSync(req.file.path)
        return res.status(400).json({
          ok: false,
          error: "Parola certificatului este obligatorie la upload.",
        })
      }

      const existingCompany = await resolveRequestCompany(req, {
        select: {
          id: true,
          tenantId: true,
          name: true,
        },
      })

      if (!existingCompany?.id) {
        throw new Error("Firma activa nu este disponibila pentru certificatul SPV.")
      }

      let credential = requestedCredentialId
        ? await getCompanyAnafCredentialById(prisma as any, tenantId, existingCompany.id, requestedCredentialId)
        : await getDefaultCompanyAnafCredential(prisma as any, tenantId, existingCompany.id)

      if (!credential) {
        credential = await prisma.companyAnafCredential.create({
          data: {
            tenantId,
            companyId: existingCompany.id,
            label: `${existingCompany?.name || "Firma"} - SPV principal`,
            isDefault: true,
          },
          select: ANAF_CREDENTIAL_SELECT,
        })
      }

      const finalPath = getEfacturaCertPath(tenantId, existingCompany.id, req.file.originalname, credential.id)
      if (credential?.certFilename) {
        deleteEfacturaCertificateFile(tenantId, existingCompany.id, credential.certFilename, credential.id)
      }
      fs.renameSync(req.file.path, finalPath)

      const updatedCredential = await prisma.companyAnafCredential.update({
        where: { id: credential.id },
        data: {
          certFilename: path.basename(finalPath),
          certUploadedAt: new Date(),
          certSerial: serial,
          certPasswordEnc: encryptSecret(password),
          isDefault: credential.isDefault ?? true,
        },
        select: ANAF_CREDENTIAL_SELECT,
      })

      if (updatedCredential.isDefault) {
        await syncDefaultAnafCredentialToCompany(prisma as any, existingCompany.id, updatedCredential)
      }

      const company = await getRequestCompany(prisma, req, { includeCredentialList: true })

      return res.json({
        ok: true,
        company: mapCompanyResponse(company, await getEffectiveAnafOauthConfig(prisma, tenantId, getActiveCompanyId(req))),
      })
    } catch (error: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }
      return res.status(400).json({
        ok: false,
        error: error?.message || "Nu am putut salva certificatul e-Factura.",
      })
    }
  }
)

router.delete("/api/v1/company/efactura/certificate", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const requestedCredentialId = getRequestedCredentialId(req)

  try {
    const company = await resolveRequestCompany(req, {
      select: {
        id: true,
      },
    })

    if (company?.id && requestedCredentialId) {
      const credential = await getCompanyAnafCredentialById(prisma as any, tenantId, company.id, requestedCredentialId)
      if (!credential?.id) {
        return res.status(404).json({
          ok: false,
          error: "Credențiala selectata nu a fost gasita pentru firma activa.",
        })
      }
      deleteEfacturaCertificateFile(tenantId, company.id, credential.certFilename, credential.id)
      const updatedCredential = await prisma.companyAnafCredential.update({
        where: { id: credential.id },
        data: {
          certFilename: null,
          certUploadedAt: null,
          certPasswordEnc: null,
          certSerial: null,
        },
        select: ANAF_CREDENTIAL_SELECT,
      })
      if (updatedCredential.isDefault) {
        await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
      }
    } else {
      const current = await getRequestCompany(prisma, req, {
        select: {
          id: true,
          efacturaCertFilename: true,
        },
      })
      deleteEfacturaCertificateFile(tenantId, current?.id, current?.efacturaCertFilename)
      await updateRequestCompany(prisma, req, {
        efacturaCertFilename: null,
        efacturaCertUploadedAt: null,
      })
    }

    const updated = await getRequestCompany(prisma, req, { includeCredentialList: true })

    return res.json({
      ok: true,
      company: mapCompanyResponse(updated, await getEffectiveAnafOauthConfig(prisma, tenantId, getActiveCompanyId(req))),
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut sterge certificatul e-Factura.",
    })
  }
})

router.get("/api/v1/company/efactura/oauth/start", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const activeCompanyId = getActiveCompanyId(req)
  const requestedCompanyId = getRequestedCompanyId(req)
  const requestedCredentialId = getRequestedCredentialId(req)
  const returnTo = String(req.query.returnTo || "").trim() || "http://localhost:5173/setari/efactura"
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  let activeCompany: { id: string; name: string } | null = null
  try {
    activeCompany = await requireExplicitAnafCompanyContextForAuth(prisma, req, requestedCompanyId)
  } catch (error: any) {
    return res.status(409).json({
      ok: false,
      error: error?.message || "Nu am putut determina firma activa pentru OAuth ANAF.",
    })
  }

  const activeCredential = requestedCredentialId
    ? await getCompanyAnafCredentialById(prisma as any, tenantId, activeCompany.id, requestedCredentialId)
    : await getDefaultCompanyAnafCredential(prisma as any, tenantId, activeCompany.id)

  if (!activeCredential?.id) {
    return res.status(404).json({
      ok: false,
      error: "Credentiala ANAF selectata nu a fost gasita pentru firma activa.",
    })
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(prisma, tenantId, activeCompany.id)

  if (!oauthConfig.clientId || !oauthConfig.redirectUri) {
    return res.status(400).json({
      ok: false,
      error: "Platforma nu are configurata inca aplicatia ANAF. Completeaza datele globale din Control Panel.",
    })
  }

  const state = jwt.sign(
    {
      tenantId,
      returnTo,
      activeCompanyId: activeCompany.id,
      credentialId: activeCredential.id,
    },
    JWT_SECRET,
    { expiresIn: "15m" },
  )

  res.cookie(ANAF_OAUTH_CTX_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/company/efactura/oauth/callback",
    maxAge: 15 * 60 * 1000,
  })

  const params = new URLSearchParams({
    response_type: "code",
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    token_content_type: "jwt",
    scope: "",
    state,
  })

  console.log("ANAF OAUTH START", {
    tenantId,
    activeCompanyId: activeCompany.id,
    requestedCompanyId,
    credentialId: activeCredential.id,
    activeCompanyName: activeCompany?.name || null,
    usesPlatformConfig: oauthConfig.usesPlatformConfig,
    clientIdSuffix: oauthConfig.clientId ? oauthConfig.clientId.slice(-8) : "",
    redirectUri: oauthConfig.redirectUri,
  })

  return res.json({
    ok: true,
    url: `${ANAF_AUTH_URL}?${params.toString()}`,
    freshSessionUrl: ANAF_LOGOUT_URL,
    logoutUrl: ANAF_LOGOUT_URL,
  })
})

router.post("/api/v1/company/efactura/oauth/test", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const { company, credential } = await getRequestAnafCredential(prisma, req)

  if (!credential?.efacturaOauthAccessToken) {
    return res.status(400).json({
      ok: false,
      error: "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul cu certificatul digital.",
    })
  }

  try {
    const response = await anafHttpRequest(ANAF_TEST_URL, {
      headers: {
        Authorization: `Bearer ${credential.efacturaOauthAccessToken}`,
      },
    })

    const text = response.text

    if (!response.ok) {
      if (credential?.anafCredentialId) {
        const updatedCredential = await prisma.companyAnafCredential.update({
          where: { id: credential.anafCredentialId },
          data: {
            efacturaOauthLastError: text.slice(0, 1000),
          },
          select: ANAF_CREDENTIAL_SELECT,
        })
        await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
      }

      return res.status(400).json({
        ok: false,
        error: "Conexiunea ANAF a raspuns cu eroare.",
        details: text,
      })
    }

    if (credential?.anafCredentialId) {
      const updatedCredential = await prisma.companyAnafCredential.update({
        where: { id: credential.anafCredentialId },
        data: {
          efacturaOauthConnectedAt: credential.efacturaOauthConnectedAt ?? new Date(),
          efacturaOauthLastError: null,
        },
        select: ANAF_CREDENTIAL_SELECT,
      })
      await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
    }

    return res.json({
      ok: true,
      message: "Conexiunea ANAF a raspuns corect.",
      details: text,
      expiresAt: credential.efacturaOauthAccessTokenExpiresAt,
    })
  } catch (error: any) {
    if (credential?.anafCredentialId) {
      const updatedCredential = await prisma.companyAnafCredential.update({
        where: { id: credential.anafCredentialId },
        data: {
          efacturaOauthLastError: error?.message || "Eroare la testarea conexiunii ANAF.",
        },
        select: ANAF_CREDENTIAL_SELECT,
      })
      await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
    }

    return res.status(500).json({
      ok: false,
      error: error?.message || "Eroare la testarea conexiunii ANAF.",
    })
  }
})

router.get("/api/v1/company/efactura/agent-download-info", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource(efacturaAgentDownloadDirs)
  return res.json({
    ok: true,
    agent: source,
  })
})

router.get("/api/v1/company/efactura/credentials", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  try {
    const company = await getRequestCompany(prisma, req, {
      select: {
        id: true,
      },
    })

    if (!company?.id) {
      return res.status(404).json({
        ok: false,
        error: "Firma activa nu este disponibila.",
      })
    }

    const credentials = await listCompanyAnafCredentials(prisma as any, req.auth!.tenantId, company.id)
    return res.json({
      ok: true,
      credentials: credentials.map(mapAnafCredentialSummary),
      activeCredentialId: company?.anafCredentialId || null,
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut incarca lista de credențiale ANAF.",
    })
  }
})

router.post("/api/v1/company/efactura/credentials", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  try {
    const company = await getRequestCompany(prisma, req, {
      select: {
        id: true,
        name: true,
      },
    })

    if (!company?.id) {
      return res.status(404).json({
        ok: false,
        error: "Firma activa nu este disponibila.",
      })
    }

    const label = String(req.body?.label || "").trim()
    if (!label) {
      return res.status(400).json({
        ok: false,
        error: "Eticheta credențialei este obligatorie.",
      })
    }

    const existing = await listCompanyAnafCredentials(prisma as any, req.auth!.tenantId, company.id)
    const created = await prisma.companyAnafCredential.create({
      data: {
        tenantId: req.auth!.tenantId,
        companyId: company.id,
        label,
        isDefault: existing.length === 0,
      },
      select: ANAF_CREDENTIAL_SELECT,
    })

    if (created.isDefault) {
      await syncDefaultAnafCredentialToCompany(prisma as any, company.id, created)
    }

    const credentials = await listCompanyAnafCredentials(prisma as any, req.auth!.tenantId, company.id)
    return res.json({
      ok: true,
      credential: mapAnafCredentialSummary(created),
      credentials: credentials.map(mapAnafCredentialSummary),
      activeCredentialId: created.id,
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut crea credențiala ANAF.",
    })
  }
})

router.patch("/api/v1/company/efactura/credentials/:id", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  try {
    const company = await getRequestCompany(prisma, req, {
      select: {
        id: true,
      },
    })

    if (!company?.id) {
      return res.status(404).json({
        ok: false,
        error: "Firma activa nu este disponibila.",
      })
    }

    const credential = await getCompanyAnafCredentialById(
      prisma as any,
      req.auth!.tenantId,
      company.id,
      String(req.params.id || ""),
    )

    if (!credential?.id) {
      return res.status(404).json({
        ok: false,
        error: "Credențiala ANAF nu a fost gasita pentru firma activa.",
      })
    }

    const nextLabel = Object.prototype.hasOwnProperty.call(req.body || {}, "label")
      ? String(req.body?.label || "").trim()
      : credential.label
    if (!nextLabel) {
      return res.status(400).json({
        ok: false,
        error: "Eticheta credențialei este obligatorie.",
      })
    }

    const updateData: Record<string, any> = {
      label: nextLabel,
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "certSerial")) {
      updateData.certSerial = normalizeOptionalText(req.body?.certSerial)
    }

    let updatedCredential = credential
    if (req.body?.isDefault === true) {
      updatedCredential = await setDefaultCompanyAnafCredential(prisma as any, req.auth!.tenantId, company.id, credential.id)
      if (Object.keys(updateData).length > 0) {
        updatedCredential = await prisma.companyAnafCredential.update({
          where: { id: credential.id },
          data: updateData,
          select: ANAF_CREDENTIAL_SELECT,
        })
        await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
      }
    } else {
      updatedCredential = await prisma.companyAnafCredential.update({
        where: { id: credential.id },
        data: updateData,
      })
      if (updatedCredential.isDefault) {
        await syncDefaultAnafCredentialToCompany(prisma as any, company.id, updatedCredential)
      }
    }

    const credentials = await listCompanyAnafCredentials(prisma as any, req.auth!.tenantId, company.id)
    return res.json({
      ok: true,
      credential: mapAnafCredentialSummary(updatedCredential),
      credentials: credentials.map(mapAnafCredentialSummary),
      activeCredentialId: updatedCredential.id,
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut actualiza credențiala ANAF.",
    })
  }
})

router.get("/api/v1/company/efactura/agent-download", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource(efacturaAgentDownloadDirs)

  if (!source.available) {
    return res.status(404).json({
      ok: false,
      error: source.error,
    })
  }

  if (source.type === "external" && source.url) {
    return res.redirect(source.url)
  }

  if (source.type === "local" && source.fullPath) {
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader("Content-Disposition", `attachment; filename="${getEfacturaAgentDownloadFileName(source)}"`)
    return res.sendFile(source.fullPath)
  }

  return res.status(404).json({
    ok: false,
    error: "Installerul Gufo e-Factura nu este disponibil.",
  })
})

router.get("/api/v1/company/efactura/agent-download-link", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource(efacturaAgentDownloadDirs)

  if (!source.available) {
    return res.status(404).json({
      ok: false,
      error: source.error,
    })
  }

  if (source.type === "external" && source.url) {
    return res.json({
      ok: true,
      url: source.url,
      fileName: source.fileName || "Gufo-eFactura-Setup.exe",
    })
  }

  return res.json({
    ok: true,
    url: `/api/v1/public/efactura/agent-download?ticket=${encodeURIComponent(createEfacturaAgentDownloadTicket(tenantId || "", JWT_SECRET))}`,
    fileName: getEfacturaAgentDownloadFileName(source),
  })
})

router.post("/api/v1/company/efactura/agent-pairing-code", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const { company, credential } = await getRequestAnafCredential(prisma, req)

  const erpUrl = getDefaultEfacturaAppUrl()
  const certSerial = normalizeOptionalText(credential?.efacturaCertSerial || company?.efacturaCertSerial)
  const code = createEfacturaAgentPairingCode({
    tenantId: tenantId || "",
    companyId: company?.id || "",
    credentialId: credential?.anafCredentialId || null,
    erpUrl,
    certSerial,
  }, JWT_SECRET)
  const decoded = jwt.decode(code) as { exp?: number } | null

  return res.json({
    ok: true,
    pairing: {
      code,
      erpUrl,
      certSerial,
      credentialId: credential?.anafCredentialId || null,
      companyName: company?.name || null,
      expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    },
  })
})

router.get("/api/v1/company/efactura/diagnostics", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  try {
    const { credential } = await getRequestAnafCredential(prisma, req)

    return res.json({
      ok: true,
      diagnostics: getAnafCompanyDiagnostics(credential),
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut incarca diagnosticul ANAF.",
    })
  }
})

router.get("/api/v1/company/document-numbering", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId

  try {
    const settings = await getNumberingConfig(tenantId)
    const [invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier] = await Promise.all([
      getNextNumberPreview(tenantId, "invoice"),
      getNextNumberPreview(tenantId, "purchaseReceipt"),
      getNextNumberPreview(tenantId, "transfer"),
      getNextNumberPreview(tenantId, "inventory"),
      getNextNumberPreview(tenantId, "production"),
      getNextNumberPreview(tenantId, "deterioration"),
      getNextNumberPreview(tenantId, "priceChange"),
      getNextNumberPreview(tenantId, "customer"),
      getNextNumberPreview(tenantId, "supplier"),
    ])

    return res.json({
      ok: true,
      settings,
      previews: { invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la incarcarea numerotarii documentelor",
    })
  }
})

router.post("/api/v1/company/document-numbering", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId

  try {
    const settings = normalizeNumberingPayload(req.body)

    await updateRequestCompany(prisma, req, settings, {
      name: "Companie",
      ...settings,
    })

    const counterUpdates: Array<{ key: string; nextNumber: unknown }> = [
      { key: "invoice", nextNumber: req.body?.invoiceNextNumber },
      { key: "purchaseReceipt", nextNumber: req.body?.purchaseReceiptNextNumber },
      { key: "transfer", nextNumber: req.body?.transferNextNumber },
      { key: "inventory", nextNumber: req.body?.inventoryNextNumber },
      { key: "production", nextNumber: req.body?.productionNextNumber },
      { key: "deterioration", nextNumber: req.body?.deteriorationNextNumber },
      { key: "priceChange", nextNumber: req.body?.priceChangeNextNumber },
      { key: "customer", nextNumber: req.body?.customerNextNumber },
      { key: "supplier", nextNumber: req.body?.supplierNextNumber },
    ]

    for (const item of counterUpdates) {
      const parsed = Number(item.nextNumber)
      if (!Number.isFinite(parsed) || parsed < 1) continue

      await prisma.skuCounter.upsert({
        where: {
          tenantId_key: {
            tenantId,
            key: item.key,
          },
        },
        update: {
          value: Math.max(0, Math.floor(parsed) - 1),
        },
        create: {
          tenantId,
          key: item.key,
          value: Math.max(0, Math.floor(parsed) - 1),
        },
      })
    }

    const refreshedSettings = await getNumberingConfig(tenantId)
    const [invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier] = await Promise.all([
      getNextNumberPreview(tenantId, "invoice"),
      getNextNumberPreview(tenantId, "purchaseReceipt"),
      getNextNumberPreview(tenantId, "transfer"),
      getNextNumberPreview(tenantId, "inventory"),
      getNextNumberPreview(tenantId, "production"),
      getNextNumberPreview(tenantId, "deterioration"),
      getNextNumberPreview(tenantId, "priceChange"),
      getNextNumberPreview(tenantId, "customer"),
      getNextNumberPreview(tenantId, "supplier"),
    ])

    return res.json({
      ok: true,
      settings: refreshedSettings,
      previews: { invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea numerotarii documentelor",
    })
  }
})

router.get("/api/v1/company/pos-sync-config", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId

  try {
    const company = await getRequestCompany(prisma, req, {
      select: {
        posSyncInterval: true
      }
    })

    return res.json({
      ok: true,
      posSyncInterval: company?.posSyncInterval ?? 5,
      allowedIntervals: ALLOWED_POS_SYNC_INTERVALS
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la incarcarea setarilor POS"
    })
  }
})

router.post("/api/v1/company/pos-sync-config", async (req: AuthedRequest, res) => {
  if (!ensureTenantAdminAccess(req, res)) return
  const tenantId = req.auth!.tenantId
  const interval = Number(req.body?.posSyncInterval)

  if (!ALLOWED_POS_SYNC_INTERVALS.includes(interval)) {
    return res.status(400).json({
      ok: false,
      error: "Intervalul de sync POS este invalid."
    })
  }

  try {
    const company = await updateRequestCompany(prisma, req, {
      posSyncInterval: interval
    }, {
      name: "Companie",
      posSyncInterval: interval
    })

    return res.json({
      ok: true,
      posSyncInterval: company.posSyncInterval,
      allowedIntervals: ALLOWED_POS_SYNC_INTERVALS
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea setarilor POS"
    })
  }
})

export default router
