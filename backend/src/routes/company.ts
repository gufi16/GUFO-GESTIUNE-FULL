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
import { getAnafCompanyDiagnostics } from "../lib/anafClient"
import {
  deleteEfacturaCertificateFile,
  encryptSecret,
  ensureEfacturaCertDir,
  getEfacturaCertPath,
  hasEfacturaCertificateFile,
} from "../lib/efacturaCertificate"

const router = Router()

const ANAF_AUTH_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/authorize"
const ANAF_TOKEN_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/token"
const ANAF_TEST_URL = "https://api.anaf.ro/TestOauth/jaxrs/hello?name=GuFo%20ERP"
const ANAF_CUI_LOOKUP_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva"
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret"
const ANAF_OAUTH_CTX_COOKIE = "gufo_anaf_oauth_ctx"
const certUploadsDir = ensureEfacturaCertDir()
const efacturaAgentDownloadDirs = [
  String(process.env.GUFO_EFACTURA_AGENT_DOWNLOAD_DIR || "").trim(),
  path.join(process.cwd(), "uploads", "efactura-agent"),
  path.join(process.cwd(), "..", "uploads", "efactura-agent"),
  "/opt/poshard/gufo-gestiune-full/uploads/efactura-agent",
].filter(Boolean)

const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, certUploadsDir)
  },
  filename: (req: AuthedRequest, file, cb) => {
    cb(null, path.basename(getEfacturaCertPath(req.auth!.tenantId, file.originalname)))
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

function normalizeOptionalText(value: unknown) {
  const text = String(value || "").trim()
  return text || null
}

function getLatestEfacturaAgentFile() {
  const files = efacturaAgentDownloadDirs.flatMap((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      return []
    }

    return fs
      .readdirSync(dirPath)
      .filter((entry) => entry.toLowerCase().endsWith(".exe"))
      .map((entry) => {
        const fullPath = path.join(dirPath, entry)
        const stats = fs.statSync(fullPath)
        return {
          fileName: entry,
          fullPath,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          mtimeMs: stats.mtimeMs,
        }
      })
  })

  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files[0] || null
}

function getEfacturaAgentDownloadSource() {
  const externalUrl = String(process.env.GUFO_EFACTURA_AGENT_DOWNLOAD_URL || "").trim()
  if (externalUrl) {
    return {
      available: true,
      type: "external" as const,
      url: externalUrl,
      fileName:
        String(process.env.GUFO_EFACTURA_AGENT_FILE_NAME || "").trim() || "Gufo-eFactura-Setup.exe",
      updatedAt: null,
      size: null,
    }
  }

  const latestFile = getLatestEfacturaAgentFile()
  if (!latestFile) {
    return {
      available: false,
      type: "missing" as const,
      error:
        "Nu exista inca un installer Gufo e-Factura publicat pe server. Pune fisierul .exe in uploads/efactura-agent sau configureaza GUFO_EFACTURA_AGENT_DOWNLOAD_URL / GUFO_EFACTURA_AGENT_DOWNLOAD_DIR.",
    }
  }

  return {
    available: true,
    type: "local" as const,
    url: null,
    fileName: latestFile.fileName,
    fullPath: latestFile.fullPath,
    updatedAt: latestFile.updatedAt,
    size: latestFile.size,
  }
}

function mapCompanyResponse(company: any, oauthConfig: any) {
  const hasStoredCertificate = hasEfacturaCertificateFile(company?.tenantId, company?.efacturaCertFilename)

  return {
    ...company,
    efacturaPlatformConfigured: oauthConfig.platformConfigured,
    efacturaUsesPlatformConfig: oauthConfig.usesPlatformConfig,
    efacturaCertHasFile: hasStoredCertificate,
    efacturaCertPasswordConfigured: Boolean(company?.efacturaCertPasswordEnc),
  }
}

async function getEffectiveAnafOauthConfig(tenantId: string) {
  const [company, platform] = await Promise.all([
    prisma.company.findUnique({
      where: { tenantId },
      select: {
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
    prisma.platformConfig.findUnique({
      where: { key: "global" },
      select: {
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
  ])

  return {
    clientId:
      company?.efacturaOauthClientId &&
      company?.efacturaOauthClientSecret &&
      company?.efacturaOauthRedirectUri
        ? company.efacturaOauthClientId
        : platform?.efacturaOauthClientId || "",
    clientSecret:
      company?.efacturaOauthClientId &&
      company?.efacturaOauthClientSecret &&
      company?.efacturaOauthRedirectUri
        ? company.efacturaOauthClientSecret
        : platform?.efacturaOauthClientSecret || "",
    redirectUri:
      company?.efacturaOauthClientId &&
      company?.efacturaOauthClientSecret &&
      company?.efacturaOauthRedirectUri
        ? company.efacturaOauthRedirectUri
        : platform?.efacturaOauthRedirectUri || "",
    platformConfigured: Boolean(
      platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
    usesPlatformConfig: Boolean(
      !company?.efacturaOauthClientId &&
        !company?.efacturaOauthClientSecret &&
        !company?.efacturaOauthRedirectUri &&
        platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
  }
}

function decodeTokenExpiry(token: string | null | undefined) {
  if (!token) return null
  const decoded = jwt.decode(token) as { exp?: number } | null
  if (!decoded?.exp) return null
  return new Date(decoded.exp * 1000)
}

function normalizeRomanianCounty(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return ""
  return text
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function extractAnafCompanyPayload(entry: any) {
  const general = entry?.date_generale || {}
  const headquarters = entry?.adresa_sediu_social || {}
  const registration = entry?.inregistrare_RTVAI || entry?.inregistrare_scop_Tva || {}

  const county =
    headquarters?.sdenumire_Judet ||
    general?.judet ||
    general?.denumire_Judet ||
    ""
  const city =
    headquarters?.sdenumire_Localitate ||
    general?.localitate ||
    general?.denumire_Localitate ||
    ""
  const postalCode =
    headquarters?.scod_Postal ||
    general?.codPostal ||
    general?.cod_postal ||
    ""
  const address =
    headquarters?.sdenumire_Strada && headquarters?.snumar_Strada
      ? `${headquarters.sdenumire_Strada} ${headquarters.snumar_Strada}`.trim()
      : headquarters?.sdenumire_Strada ||
        general?.adresa_domiciliu_fiscal ||
        general?.adresa ||
        general?.adresa_completa ||
        ""

  return {
    name: String(general?.denumire || "").trim(),
    cui: String(general?.cui || "").trim(),
    regNo: String(general?.nrRegCom || general?.nr_reg_com || "").trim(),
    address: String(address || "").trim(),
    city: String(city || "").trim(),
    county: normalizeRomanianCounty(county),
    postalCode: String(postalCode || "").trim(),
    country: "RO",
    isVatPayer:
      registration?.scpTVA !== undefined
        ? Boolean(registration.scpTVA)
        : general?.scpTVA !== undefined
          ? Boolean(general.scpTVA)
          : true,
  }
}

export async function handleAnafOauthCallback(req, res) {
  const code = String(req.query.code || "")
  const error = String(req.query.error || "")
  const errorDescription = String(req.query.error_description || "")
  const stateRaw = String(req.query.state || "")
  const cookieStateRaw = String(req.cookies?.[ANAF_OAUTH_CTX_COOKIE] || "")
  const effectiveStateRaw = cookieStateRaw || stateRaw

  res.clearCookie(ANAF_OAUTH_CTX_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/company/efactura/oauth/callback",
  })

  if (!effectiveStateRaw) {
    return res.status(400).send("Lipsesc parametrii OAuth ANAF.")
  }

  let state: { tenantId: string; returnTo: string } | null = null
  try {
    state = jwt.verify(effectiveStateRaw, JWT_SECRET) as { tenantId: string; returnTo: string }
  } catch {
    return res.status(400).send("State OAuth invalid sau expirat.")
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(state.tenantId)
  const moduleCheck = await requireTenantModule(state.tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).send("Modulul e-Factura nu este activ pe licenta acestui client.")
  }

  if (!oauthConfig.clientId || !oauthConfig.clientSecret || !oauthConfig.redirectUri) {
    return res.status(400).send("Configuratia ANAF nu este completa.")
  }

  if (error) {
    const nextError =
      error === "access_denied"
        ? "Autorizarea ANAF a fost anulata sau refuzata."
        : errorDescription || error || "Autorizarea ANAF nu a putut fi finalizata."

    await prisma.company.update({
      where: { tenantId: state.tenantId },
      data: {
        efacturaOauthLastError: nextError,
      },
    })

    return res.redirect(
      `${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=denied`,
    )
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
      await prisma.company.update({
        where: { tenantId: state.tenantId },
        data: {
          efacturaOauthLastError: String(payload?.error_description || payload?.error || "Nu am putut obtine token-ul ANAF."),
        },
      })

      return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=error`)
    }

    await prisma.company.update({
      where: { tenantId: state.tenantId },
      data: {
        efacturaOauthAccessToken: String(payload.access_token),
        efacturaOauthRefreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
        efacturaOauthAccessTokenExpiresAt: decodeTokenExpiry(String(payload.access_token)),
        efacturaOauthRefreshTokenExpiresAt: decodeTokenExpiry(payload.refresh_token ? String(payload.refresh_token) : null),
        efacturaOauthConnectedAt: new Date(),
        efacturaOauthLastError: null,
      },
    })

    return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=success`)
  } catch (error: any) {
    await prisma.company.update({
      where: { tenantId: state.tenantId },
      data: {
        efacturaOauthLastError: error?.message || "Eroare la schimbul token-ului ANAF.",
      },
    })

    return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=error`)
  }
}

router.get("/api/v1/company/efactura/oauth/callback", handleAnafOauthCallback)

router.use(requireAuth)

const ALLOWED_POS_SYNC_INTERVALS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]

router.get("/api/v1/company", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const [company, oauthConfig] = await Promise.all([
      prisma.company.findUnique({
        where: { tenantId }
      }),
      getEffectiveAnafOauthConfig(tenantId),
    ])

    return res.json({
      ok: true,
      company: company ? mapCompanyResponse(company, oauthConfig) : null
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la încărcarea firmei"
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
    const existing = await prisma.company.findUnique({
      where: { tenantId }
    })

    const company = await prisma.company.upsert({
      where: { tenantId },
      update: {
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
      },
      create: {
        tenantId,
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
      }
    })

    return res.json({
      ok: true,
      company: mapCompanyResponse(company, await getEffectiveAnafOauthConfig(tenantId))
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea firmei"
    })
  }
})

router.post(
  "/api/v1/company/efactura/certificate",
  requireAuth,
  certUpload.single("certificate"),
  async (req: AuthedRequest, res) => {
    const tenantId = req.auth!.tenantId

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

      const existing = await prisma.company.findUnique({
        where: { tenantId },
        select: {
          tenantId: true,
          name: true,
          efacturaCertFilename: true,
        },
      })

      if (existing?.efacturaCertFilename && existing.efacturaCertFilename !== req.file.filename) {
        deleteEfacturaCertificateFile(tenantId, existing.efacturaCertFilename)
      }

      const company = await prisma.company.upsert({
        where: { tenantId },
        update: {
          efacturaCertFilename: req.file.filename,
          efacturaCertUploadedAt: new Date(),
          efacturaCertSerial: serial,
          efacturaCertPasswordEnc: encryptSecret(password),
        },
        create: {
          tenantId,
          name: existing?.name || "Companie",
          efacturaCertFilename: req.file.filename,
          efacturaCertUploadedAt: new Date(),
          efacturaCertSerial: serial,
          efacturaCertPasswordEnc: encryptSecret(password),
        },
      })

      return res.json({
        ok: true,
        company: mapCompanyResponse(company, await getEffectiveAnafOauthConfig(tenantId)),
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
  const tenantId = req.auth!.tenantId

  try {
    const company = await prisma.company.findUnique({
      where: { tenantId },
      select: {
        efacturaCertFilename: true,
      },
    })

    deleteEfacturaCertificateFile(tenantId, company?.efacturaCertFilename)

    const updated = await prisma.company.update({
      where: { tenantId },
      data: {
        efacturaCertFilename: null,
        efacturaCertUploadedAt: null,
      },
    })

    return res.json({
      ok: true,
      company: mapCompanyResponse(updated, await getEffectiveAnafOauthConfig(tenantId)),
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "Nu am putut sterge certificatul e-Factura.",
    })
  }
})

router.get("/api/v1/company/efactura/oauth/start", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const returnTo = String(req.query.returnTo || "").trim() || "http://localhost:5173/setari/efactura"
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(tenantId)

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
  })

  console.log("ANAF OAUTH START", {
    tenantId,
    usesPlatformConfig: oauthConfig.usesPlatformConfig,
    clientIdSuffix: oauthConfig.clientId ? oauthConfig.clientId.slice(-8) : "",
    redirectUri: oauthConfig.redirectUri,
  })

  return res.json({
    ok: true,
    url: `${ANAF_AUTH_URL}?${params.toString()}`,
  })
})

router.post("/api/v1/company/efactura/oauth/test", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const company = await prisma.company.findUnique({
    where: { tenantId },
    select: {
      efacturaOauthAccessToken: true,
      efacturaOauthConnectedAt: true,
      efacturaOauthAccessTokenExpiresAt: true,
    },
  })

  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({
      ok: false,
      error: "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul cu certificatul digital.",
    })
  }

  try {
    const response = await anafHttpRequest(ANAF_TEST_URL, {
      headers: {
        Authorization: `Bearer ${company.efacturaOauthAccessToken}`,
      },
    })

    const text = response.text

    if (!response.ok) {
      await prisma.company.update({
        where: { tenantId },
        data: {
          efacturaOauthLastError: text.slice(0, 1000),
        },
      })

      return res.status(400).json({
        ok: false,
        error: "Conexiunea ANAF a raspuns cu eroare.",
        details: text,
      })
    }

    await prisma.company.update({
      where: { tenantId },
      data: {
        efacturaOauthConnectedAt: company.efacturaOauthConnectedAt ?? new Date(),
        efacturaOauthLastError: null,
      },
    })

    return res.json({
      ok: true,
      message: "Conexiunea ANAF a raspuns corect.",
      details: text,
      expiresAt: company.efacturaOauthAccessTokenExpiresAt,
    })
  } catch (error: any) {
    await prisma.company.update({
      where: { tenantId },
      data: {
        efacturaOauthLastError: error?.message || "Eroare la testarea conexiunii ANAF.",
      },
    })

    return res.status(500).json({
      ok: false,
      error: error?.message || "Eroare la testarea conexiunii ANAF.",
    })
  }
})

router.get("/api/v1/company/efactura/agent-download-info", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource()
  return res.json({
    ok: true,
    agent: source,
  })
})

router.get("/api/v1/company/efactura/agent-download", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const source = getEfacturaAgentDownloadSource()

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
    res.setHeader("Content-Disposition", `attachment; filename="${source.fileName}"`)
    return res.sendFile(source.fullPath)
  }

  return res.status(404).json({
    ok: false,
    error: "Installerul Gufo e-Factura nu este disponibil.",
  })
})

router.get("/api/v1/company/efactura/diagnostics", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  try {
    const company = await prisma.company.findUnique({
      where: { tenantId },
      select: {
        tenantId: true,
        cui: true,
        efacturaEnvironment: true,
        efacturaOauthAccessToken: true,
        efacturaCertSerial: true,
        efacturaCertFilename: true,
        efacturaCertPasswordEnc: true,
      },
    })

    return res.json({
      ok: true,
      diagnostics: getAnafCompanyDiagnostics(company),
    })
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Nu am putut incarca diagnosticul ANAF.",
    })
  }
})

router.get("/api/v1/company/document-numbering", async (req: AuthedRequest, res) => {
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
  const tenantId = req.auth!.tenantId

  try {
    const settings = normalizeNumberingPayload(req.body)

    await prisma.company.upsert({
      where: { tenantId },
      update: settings,
      create: {
        tenantId,
        name: "Companie",
        ...settings,
      },
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
  const tenantId = req.auth!.tenantId

  try {
    const company = await prisma.company.findUnique({
      where: { tenantId },
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
      error: e?.message || "Eroare la încărcarea setărilor POS"
    })
  }
})

router.post("/api/v1/company/pos-sync-config", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const interval = Number(req.body?.posSyncInterval)

  if (!ALLOWED_POS_SYNC_INTERVALS.includes(interval)) {
    return res.status(400).json({
      ok: false,
      error: "Intervalul de sync POS este invalid."
    })
  }

  try {
    const existingCompany = await prisma.company.findUnique({
      where: { tenantId }
    })

    let company = existingCompany

    if (!company) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true }
      })

      company = await prisma.company.create({
        data: {
          tenantId,
          name: tenant?.name || "Companie",
          posSyncInterval: interval
        }
      })
    } else {
      company = await prisma.company.update({
        where: { tenantId },
        data: {
          posSyncInterval: interval
        }
      })
    }

    return res.json({
      ok: true,
      posSyncInterval: company.posSyncInterval,
      allowedIntervals: ALLOWED_POS_SYNC_INTERVALS
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea setărilor POS"
    })
  }
})

export default router
