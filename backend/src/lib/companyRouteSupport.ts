import fs from "fs"
import jwt from "jsonwebtoken"
import path from "path"
import type { AuthedRequest } from "../middleware/requireAuth"
import type { prisma } from "./prisma"
import { hasEfacturaCertificateFile } from "./efacturaCertificate"
import { ensureTenantCompany, listTenantCompaniesForAuth, resolveTenantCompanyForAuth, updateOrCreateTenantCompany } from "./companyResolver"
import { getCompanyAnafCredentialById, getDefaultCompanyAnafCredential, resolveCompanyWithAnafCredential } from "./companyAnafCredentials"

type EfacturaAgentFile = {
  fileName: string
  fullPath: string
  size: number
  updatedAt: string
  mtimeMs: number
}

type CompanyRouteWarehouseConfigSource = {
  multiWarehouseEnabled?: unknown
  warehouseFilterEnabled?: unknown
  requireWarehouseOnDocuments?: unknown
  autoSelectSingleWarehouse?: unknown
  warehouseLabel?: unknown
}

type CompanyRouteOauthConfig = {
  environment?: string | null
  platformConfigured?: boolean
  usesPlatformConfig?: boolean
}

type CompanyRouteCompanyResponseSource = CompanyRouteWarehouseConfigSource & {
  id?: string | null
  tenantId?: string | null
  efacturaEnvironment?: string | null
  efacturaCertFilename?: string | null
  anafCredentialId?: string | null
  efacturaCertPasswordEnc?: string | null
}

type AnafRegistrationPayload = {
  scpTVA?: unknown
}

type AnafHeadquartersPayload = {
  sdenumire_Judet?: unknown
  sdenumire_Localitate?: unknown
  scod_Postal?: unknown
  sdenumire_Strada?: unknown
  snumar_Strada?: unknown
}

type AnafGeneralPayload = {
  denumire?: unknown
  cui?: unknown
  nrRegCom?: unknown
  nr_reg_com?: unknown
  judet?: unknown
  denumire_Judet?: unknown
  localitate?: unknown
  denumire_Localitate?: unknown
  codPostal?: unknown
  cod_postal?: unknown
  adresa_domiciliu_fiscal?: unknown
  adresa?: unknown
  adresa_completa?: unknown
  scpTVA?: unknown
}

type AnafCompanyLookupEntry = {
  date_generale?: AnafGeneralPayload | null
  adresa_sediu_social?: AnafHeadquartersPayload | null
  inregistrare_RTVAI?: AnafRegistrationPayload | null
  inregistrare_scop_Tva?: AnafRegistrationPayload | null
}

type PrismaClientLike = typeof prisma

type MinimalCompanyContext = {
  id: string
  name: string
  isDefault: boolean
}

type EffectiveAnafOauthCompanyConfig = {
  efacturaEnvironment?: string | null
  efacturaOauthClientId?: string | null
  efacturaOauthClientSecret?: string | null
  efacturaOauthRedirectUri?: string | null
}

export function normalizeOptionalText(value: unknown) {
  const text = String(value || "").trim()
  return text || null
}

export async function requireExplicitAnafCompanyContext(
  prismaClient: PrismaClientLike,
  tenantId: string,
  activeCompanyId?: string | null,
  requestedCompanyId?: string | null,
) {
  const companies = await prismaClient.company.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  })

  if (!companies.length) {
    throw new Error("Nu exista nicio firma configurata pentru acest tenant.")
  }

  return selectExplicitAnafCompany(companies, requestedCompanyId || activeCompanyId || null, {
    missingSelectionMessage: "Selecteaza mai intai firma activa din ERP, apoi genereaza tokenul ANAF.",
    inaccessibleMessage: "Firma activa selectata nu mai exista. Reincarca pagina si selecteaza firma din nou.",
  })
}

export async function requireExplicitAnafCompanyContextForAuth(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
  requestedCompanyId?: string | null,
) {
  const companies = await listTenantCompaniesForAuth(prismaClient, req.auth!, {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  })

  if (!companies.length) {
    throw new Error("Nu exista nicio firma accesibila pentru acest cont.")
  }

  return selectExplicitAnafCompany(companies, requestedCompanyId || getActiveCompanyId(req) || null, {
    missingSelectionMessage: "Selecteaza mai intai firma activa din ERP, apoi genereaza tokenul ANAF.",
    inaccessibleMessage: "Firma selectata nu este accesibila pentru acest cont.",
  })
}

export function mapCompanyResponse(
  company: CompanyRouteCompanyResponseSource | null | undefined,
  oauthConfig: CompanyRouteOauthConfig,
) {
  const tenantId = String(company?.tenantId || "").trim()
  const hasStoredCertificate = tenantId
    ? hasEfacturaCertificateFile(
        tenantId,
        company?.id,
        company?.efacturaCertFilename,
        company?.anafCredentialId || null,
      )
    : false

  return {
    ...company,
    warehouseConfig: {
      multiWarehouseEnabled: Boolean(company?.multiWarehouseEnabled),
      warehouseFilterEnabled: Boolean(company?.warehouseFilterEnabled),
      requireWarehouseOnDocuments: Boolean(company?.requireWarehouseOnDocuments),
      autoSelectSingleWarehouse: company?.autoSelectSingleWarehouse !== false,
      warehouseLabel: String(company?.warehouseLabel || "Gestiune"),
    },
    efacturaEnvironment: oauthConfig.environment || company?.efacturaEnvironment || "test",
    efacturaPlatformConfigured: oauthConfig.platformConfigured,
    efacturaUsesPlatformConfig: oauthConfig.usesPlatformConfig,
    efacturaCertHasFile: hasStoredCertificate,
    efacturaCertPasswordConfigured: Boolean(company?.efacturaCertPasswordEnc),
  }
}

export function getLatestEfacturaAgentFile(efacturaAgentDownloadDirs: string[]) {
  const files: EfacturaAgentFile[] = efacturaAgentDownloadDirs.flatMap((dirPath) => {
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

export function getEfacturaAgentDownloadSource(efacturaAgentDownloadDirs: string[]) {
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

  const latestFile = getLatestEfacturaAgentFile(efacturaAgentDownloadDirs)
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

export function getEfacturaAgentDownloadFileName(source: {
  fileName?: string | null
  updatedAt?: string | null
}) {
  const originalName = String(source.fileName || "Gufo-eFactura-Setup.exe").trim() || "Gufo-eFactura-Setup.exe"
  const extension = path.extname(originalName) || ".exe"
  const baseName = path.basename(originalName, extension) || "Gufo-eFactura-Setup"
  const updatedAt = String(source.updatedAt || "").trim()

  if (!updatedAt) {
    return `${baseName}${extension}`
  }

  const compactStamp = updatedAt
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "")

  return `${baseName}-${compactStamp}${extension}`
}

export function createEfacturaAgentDownloadTicket(tenantId: string, jwtSecret: string) {
  return jwt.sign(
    {
      tenantId,
      purpose: "efactura-agent-download",
    },
    jwtSecret,
    { expiresIn: "10m" },
  )
}

export function getDefaultEfacturaAppUrl() {
  return String(process.env.GUFO_EFACTURA_APP_URL || process.env.CORS_ORIGIN || "https://app.gufo.ink")
    .trim()
    .replace(/\/+$/, "")
}

export function createEfacturaAgentPairingCode(
  payload: {
    tenantId: string
    companyId: string
    credentialId: string | null
    erpUrl: string
    certSerial: string | null
  },
  jwtSecret: string
) {
  return jwt.sign(
    {
      sub: payload.tenantId,
      p: "efactura-agent-pairing",
      companyId: payload.companyId,
      credentialId: payload.credentialId,
      erpUrl: payload.erpUrl,
      certSerial: payload.certSerial,
    },
    jwtSecret,
    { expiresIn: "7d" },
  )
}

export function getActiveCompanyId(req: AuthedRequest) {
  return req.auth?.activeCompanyId || null
}

export function getRequestedCredentialId(req: AuthedRequest) {
  const bodyValue = String(req.body?.credentialId || "").trim()
  if (bodyValue) return bodyValue
  const queryValue = String(req.query?.credentialId || "").trim()
  if (queryValue) return queryValue
  return null
}

export function getRequestedCompanyId(req: AuthedRequest) {
  const bodyValue = String(req.body?.companyId || "").trim()
  if (bodyValue) return bodyValue
  const queryValue = String(req.query?.companyId || "").trim()
  if (queryValue) return queryValue
  return null
}

export async function getRequestCompany(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
  extra: Record<string, any> = {},
) {
  const tenantId = String(req.auth!.tenantId || "").trim()
  const activeCompanyId = getActiveCompanyId(req) || null
  const includeCredentialList = Boolean(extra?.includeCredentialList)
  const select =
    extra && typeof extra === "object" && "select" in extra
      ? extra.select || {}
      : Object.fromEntries(
          Object.entries(extra || {}).filter(([key]) => key !== "includeCredentialList"),
        )

  return resolveCompanyWithAnafCredential(prismaClient as never, tenantId, activeCompanyId, {
    select,
    includeCredentialList,
    auth: req.auth!,
  })
}

export async function ensureRequestCompany(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
  seedData: Record<string, any> = {},
) {
  const tenantId = String(req.auth!.tenantId || "").trim()
  return ensureTenantCompany(prismaClient, tenantId, getActiveCompanyId(req) || null, seedData)
}

export async function getRequestCompanyCertificateState(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
) {
  return getRequestCompany(prismaClient, req, {
    select: {
      id: true,
      tenantId: true,
      name: true,
      efacturaCertFilename: true,
      efacturaCertPasswordEnc: true,
      efacturaCertSerial: true,
      anafCredentialId: true,
      anafCredentialLabel: true,
    },
  })
}

export async function getRequestAnafCredential(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
  explicitCredentialId?: string | null,
) {
  const tenantId = String(req.auth!.tenantId || "").trim()
  const company = await resolveTenantCompanyForAuth(prismaClient, req.auth!, {
    select: {
      id: true,
      tenantId: true,
      name: true,
      efacturaCertSerial: true,
      efacturaCertPasswordEnc: true,
      efacturaCertFilename: true,
      efacturaCertUploadedAt: true,
      efacturaOauthAccessToken: true,
      efacturaOauthRefreshToken: true,
      efacturaOauthAccessTokenExpiresAt: true,
      efacturaOauthRefreshTokenExpiresAt: true,
      efacturaOauthConnectedAt: true,
      efacturaOauthLastError: true,
      etransportOauthAccessToken: true,
      etransportOauthRefreshToken: true,
      etransportOauthAccessTokenExpiresAt: true,
      etransportOauthRefreshTokenExpiresAt: true,
      etransportOauthConnectedAt: true,
      etransportOauthLastError: true,
    },
  })

  if (!company?.id) {
    throw new Error("Firma activa nu este disponibila.")
  }

  const companyId = company.id
  const companyTenantId = company.tenantId
  const companyName = company.name

  const requestedCredentialId = explicitCredentialId || getRequestedCredentialId(req)
  const credential = requestedCredentialId
    ? await getCompanyAnafCredentialById(prismaClient as never, tenantId, companyId, requestedCredentialId)
    : await getDefaultCompanyAnafCredential(prismaClient as never, tenantId, companyId, company)

  if (!credential) {
    return {
      company,
      credential: null,
    }
  }

  return {
    company,
    credential: {
      ...credential,
      tenantId: companyTenantId,
      companyId,
      name: companyName,
      anafCredentialId: credential.id,
      anafCredentialLabel: credential.label,
      efacturaCertSerial: credential.certSerial,
      efacturaCertPasswordEnc: credential.certPasswordEnc,
      efacturaCertFilename: credential.certFilename,
      efacturaCertUploadedAt: credential.certUploadedAt,
      efacturaOauthAccessToken: credential.efacturaOauthAccessToken,
      efacturaOauthRefreshToken: credential.efacturaOauthRefreshToken,
      efacturaOauthAccessTokenExpiresAt: credential.efacturaOauthAccessTokenExpiresAt,
      efacturaOauthRefreshTokenExpiresAt: credential.efacturaOauthRefreshTokenExpiresAt,
      efacturaOauthConnectedAt: credential.efacturaOauthConnectedAt,
      efacturaOauthLastError: credential.efacturaOauthLastError,
      etransportOauthAccessToken: credential.etransportOauthAccessToken,
      etransportOauthRefreshToken: credential.etransportOauthRefreshToken,
      etransportOauthAccessTokenExpiresAt: credential.etransportOauthAccessTokenExpiresAt,
      etransportOauthRefreshTokenExpiresAt: credential.etransportOauthRefreshTokenExpiresAt,
      etransportOauthConnectedAt: credential.etransportOauthConnectedAt,
      etransportOauthLastError: credential.etransportOauthLastError,
    },
  }
}

export async function updateRequestCompany(
  prismaClient: PrismaClientLike,
  req: AuthedRequest,
  updateData: Record<string, any>,
  createData: Record<string, any> = {},
) {
  const tenantId = String(req.auth!.tenantId || "").trim()
  return updateOrCreateTenantCompany(
    prismaClient,
    tenantId,
    getActiveCompanyId(req) || null,
    updateData,
    createData,
  )
}

export function decodeTokenExpiry(token: string | null | undefined) {
  if (!token) return null
  const decoded = jwt.decode(token) as { exp?: number } | null
  if (!decoded?.exp) return null
  return new Date(decoded.exp * 1000)
}

export function normalizeRomanianCounty(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return ""
  return text
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

export function extractAnafCompanyPayload(entry: AnafCompanyLookupEntry | null | undefined) {
  const general = entry?.date_generale || {}
  const headquarters = entry?.adresa_sediu_social || {}
  const registration = entry?.inregistrare_RTVAI || entry?.inregistrare_scop_Tva || {}

  const county =
    headquarters.sdenumire_Judet ||
    general.judet ||
    general.denumire_Judet ||
    ""
  const city =
    headquarters.sdenumire_Localitate ||
    general.localitate ||
    general.denumire_Localitate ||
    ""
  const postalCode =
    headquarters.scod_Postal ||
    general.codPostal ||
    general.cod_postal ||
    ""
  const address =
    headquarters.sdenumire_Strada && headquarters.snumar_Strada
      ? `${headquarters.sdenumire_Strada} ${headquarters.snumar_Strada}`.trim()
      : headquarters.sdenumire_Strada ||
        general.adresa_domiciliu_fiscal ||
        general.adresa ||
        general.adresa_completa ||
        ""

  return {
    name: String(general.denumire || "").trim(),
    cui: String(general.cui || "").trim(),
    regNo: String(general.nrRegCom || general.nr_reg_com || "").trim(),
    address: String(address || "").trim(),
    city: String(city || "").trim(),
    county: normalizeRomanianCounty(county),
    postalCode: String(postalCode || "").trim(),
    country: "RO",
    isVatPayer:
      registration.scpTVA !== undefined
        ? Boolean(registration.scpTVA)
        : general.scpTVA !== undefined
          ? Boolean(general.scpTVA)
          : true,
  }
}

export async function getEffectiveAnafOauthConfig(
  prismaClient: PrismaClientLike,
  tenantId: string,
  activeCompanyId: string | null = null,
) {
  const [companyRaw, platform] = await Promise.all([
    resolveCompanyWithAnafCredential(prismaClient as never, tenantId, activeCompanyId, {
      select: {
        efacturaEnvironment: true,
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
    prismaClient.platformConfig.findUnique({
      where: { key: "global" },
      select: {
        efacturaEnvironment: true,
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
  ])

  const company = companyRaw as EffectiveAnafOauthCompanyConfig | null

  const usesCompanyConfig = Boolean(
    company?.efacturaOauthClientId &&
      company?.efacturaOauthClientSecret &&
      company?.efacturaOauthRedirectUri,
  )

  return {
    clientId: usesCompanyConfig
      ? company?.efacturaOauthClientId || ""
      : platform?.efacturaOauthClientId || "",
    clientSecret: usesCompanyConfig
      ? company?.efacturaOauthClientSecret || ""
      : platform?.efacturaOauthClientSecret || "",
    redirectUri: usesCompanyConfig
      ? company?.efacturaOauthRedirectUri || ""
      : platform?.efacturaOauthRedirectUri || "",
    environment: usesCompanyConfig
      ? String(company?.efacturaEnvironment || "test").trim() || "test"
      : String(platform?.efacturaEnvironment || company?.efacturaEnvironment || "test").trim() || "test",
    platformConfigured: Boolean(
      platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
    usesPlatformConfig: Boolean(
      !usesCompanyConfig &&
        platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
  }
}

function selectExplicitAnafCompany(
  companies: MinimalCompanyContext[],
  effectiveCompanyId: string | null,
  messages: {
    missingSelectionMessage: string
    inaccessibleMessage: string
  },
) {
  if (!effectiveCompanyId) {
    if (companies.length > 1) {
      throw new Error(messages.missingSelectionMessage)
    }
    return companies[0]
  }

  const company = companies.find((item) => item.id === effectiveCompanyId)
  if (!company) {
    throw new Error(messages.inaccessibleMessage)
  }

  return company
}
