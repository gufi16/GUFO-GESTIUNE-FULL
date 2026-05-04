// @ts-nocheck
import { prisma } from "./prisma"
import { resolveTenantCompany } from "./companyResolver"
import { anafHttpRequest } from "./anafHttp"
import { getAnafCertificateOptions } from "./efacturaCertificate"
import {
  collectMessageItems,
  extractDownloadId,
  extractUploadIndex,
  getEfacturaBaseUrl,
  normalizeCompanyCui,
  parseAnafPayload,
  summarizeAnafResponse,
} from "./incomingEfactura"

const COMPANY_ANAF_SELECT = {
  tenantId: true,
  cui: true,
  efacturaEnvironment: true,
  efacturaOauthClientId: true,
  efacturaOauthClientSecret: true,
  efacturaOauthRedirectUri: true,
  efacturaOauthAccessToken: true,
  efacturaOauthLastError: true,
  etransportOauthClientId: true,
  etransportOauthClientSecret: true,
  etransportOauthRedirectUri: true,
  etransportOauthAccessToken: true,
  etransportOauthRefreshToken: true,
  etransportOauthAccessTokenExpiresAt: true,
  etransportOauthRefreshTokenExpiresAt: true,
  etransportOauthConnectedAt: true,
  etransportOauthLastError: true,
  efacturaCertSerial: true,
  efacturaCertFilename: true,
  efacturaCertPasswordEnc: true,
}

export async function loadAnafCompanyContext(
  tenantId: string,
  activeCompanyId?: string | null,
  service: "efactura" | "etrtransport" = "efactura"
) {
  const [company, primaryCompany] = await Promise.all([
    resolveTenantCompany(prisma, tenantId, activeCompanyId, {
      select: {
        id: true,
        ...COMPANY_ANAF_SELECT,
      },
    }),
    activeCompanyId
      ? resolveTenantCompany(prisma, tenantId, null, {
          select: {
            id: true,
            ...COMPANY_ANAF_SELECT,
          },
        })
      : Promise.resolve(null),
  ])

  if (!company) return company

  const fallbackCompany = primaryCompany && primaryCompany.id !== company.id ? primaryCompany : null

  const mergedCompany = fallbackCompany
    ? {
        ...fallbackCompany,
        ...company,
        efacturaOauthClientId: company?.efacturaOauthClientId || fallbackCompany?.efacturaOauthClientId || null,
        efacturaOauthClientSecret:
          company?.efacturaOauthClientSecret || fallbackCompany?.efacturaOauthClientSecret || null,
        efacturaOauthRedirectUri:
          company?.efacturaOauthRedirectUri || fallbackCompany?.efacturaOauthRedirectUri || null,
        efacturaOauthAccessToken:
          company?.efacturaOauthAccessToken || fallbackCompany?.efacturaOauthAccessToken || null,
        efacturaOauthRefreshToken:
          company?.efacturaOauthRefreshToken || fallbackCompany?.efacturaOauthRefreshToken || null,
        efacturaOauthAccessTokenExpiresAt:
          company?.efacturaOauthAccessTokenExpiresAt || fallbackCompany?.efacturaOauthAccessTokenExpiresAt || null,
        efacturaOauthRefreshTokenExpiresAt:
          company?.efacturaOauthRefreshTokenExpiresAt || fallbackCompany?.efacturaOauthRefreshTokenExpiresAt || null,
        efacturaOauthConnectedAt:
          company?.efacturaOauthConnectedAt || fallbackCompany?.efacturaOauthConnectedAt || null,
        efacturaOauthLastError:
          company?.efacturaOauthLastError || fallbackCompany?.efacturaOauthLastError || null,
        etransportOauthClientId:
          company?.etrtransportOauthClientId || fallbackCompany?.etrtransportOauthClientId || null,
        etransportOauthClientSecret:
          company?.etrtransportOauthClientSecret || fallbackCompany?.etrtransportOauthClientSecret || null,
        etransportOauthRedirectUri:
          company?.etrtransportOauthRedirectUri || fallbackCompany?.etrtransportOauthRedirectUri || null,
        etransportOauthAccessToken:
          company?.etrtransportOauthAccessToken || fallbackCompany?.etrtransportOauthAccessToken || null,
        etransportOauthRefreshToken:
          company?.etrtransportOauthRefreshToken || fallbackCompany?.etrtransportOauthRefreshToken || null,
        etransportOauthAccessTokenExpiresAt:
          company?.etrtransportOauthAccessTokenExpiresAt ||
          fallbackCompany?.etrtransportOauthAccessTokenExpiresAt ||
          null,
        etransportOauthRefreshTokenExpiresAt:
          company?.etrtransportOauthRefreshTokenExpiresAt ||
          fallbackCompany?.etrtransportOauthRefreshTokenExpiresAt ||
          null,
        etransportOauthConnectedAt:
          company?.etrtransportOauthConnectedAt || fallbackCompany?.etrtransportOauthConnectedAt || null,
        etransportOauthLastError:
          company?.etrtransportOauthLastError || fallbackCompany?.etrtransportOauthLastError || null,
        efacturaCertSerial: company?.efacturaCertSerial || fallbackCompany?.efacturaCertSerial || null,
        efacturaCertFilename: company?.efacturaCertFilename || fallbackCompany?.efacturaCertFilename || null,
        efacturaCertPasswordEnc:
          company?.efacturaCertPasswordEnc || fallbackCompany?.efacturaCertPasswordEnc || null,
      }
    : company

  const platform = await prisma.platformConfig.findUnique({
    where: { key: "global" },
    select: { efacturaEnvironment: true },
  })

  const usesOwnOauthConfig = Boolean(
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthClientId &&
        mergedCompany?.etrtransportOauthClientSecret &&
        mergedCompany?.etrtransportOauthRedirectUri
      : mergedCompany?.efacturaOauthClientId &&
        mergedCompany?.efacturaOauthClientSecret &&
        mergedCompany?.efacturaOauthRedirectUri
  )

  const ownClientId =
    service === "etrtransport" ? mergedCompany?.etrtransportOauthClientId : mergedCompany?.efacturaOauthClientId
  const ownClientSecret =
    service === "etrtransport" ? mergedCompany?.etrtransportOauthClientSecret : mergedCompany?.efacturaOauthClientSecret
  const ownRedirectUri =
    service === "etrtransport" ? mergedCompany?.etrtransportOauthRedirectUri : mergedCompany?.efacturaOauthRedirectUri
  const ownAccessToken =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthAccessToken || mergedCompany?.efacturaOauthAccessToken
      : mergedCompany?.efacturaOauthAccessToken
  const ownRefreshToken =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthRefreshToken || mergedCompany?.efacturaOauthRefreshToken
      : mergedCompany?.efacturaOauthRefreshToken
  const ownAccessTokenExpiresAt =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthAccessTokenExpiresAt || mergedCompany?.efacturaOauthAccessTokenExpiresAt
      : mergedCompany?.efacturaOauthAccessTokenExpiresAt
  const ownRefreshTokenExpiresAt =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthRefreshTokenExpiresAt || mergedCompany?.efacturaOauthRefreshTokenExpiresAt
      : mergedCompany?.efacturaOauthRefreshTokenExpiresAt
  const ownConnectedAt =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthConnectedAt || mergedCompany?.efacturaOauthConnectedAt
      : mergedCompany?.efacturaOauthConnectedAt
  const ownLastError =
    service === "etrtransport"
      ? mergedCompany?.etrtransportOauthLastError || mergedCompany?.efacturaOauthLastError
      : mergedCompany?.efacturaOauthLastError

  return {
    ...mergedCompany,
    anafService: service,
    efacturaUsesPlatformConfig: !usesOwnOauthConfig,
    efacturaEnvironment: usesOwnOauthConfig
      ? String(mergedCompany?.efacturaEnvironment || "test").trim() || "test"
      : String(platform?.efacturaEnvironment || mergedCompany?.efacturaEnvironment || "test").trim() || "test",
    anafOauthClientId: ownClientId || (!usesOwnOauthConfig ? platform?.efacturaOauthClientId || "" : ""),
    anafOauthClientSecret: ownClientSecret || (!usesOwnOauthConfig ? platform?.efacturaOauthClientSecret || "" : ""),
    anafOauthRedirectUri: ownRedirectUri || (!usesOwnOauthConfig ? platform?.efacturaOauthRedirectUri || "" : ""),
    anafOauthAccessToken: ownAccessToken || "",
    anafOauthRefreshToken: ownRefreshToken || null,
    anafOauthAccessTokenExpiresAt: ownAccessTokenExpiresAt || null,
    anafOauthRefreshTokenExpiresAt: ownRefreshTokenExpiresAt || null,
    anafOauthConnectedAt: ownConnectedAt || null,
    anafOauthLastError: ownLastError || null,
  }
}

function decodeJwtPayload(token: string) {
  try {
    const parts = String(token || "").split(".")
    if (parts.length < 2) return null
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
  } catch {
    return null
  }
}

function normalizeCertificateSerial(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[:\s]/g, "")
    .toUpperCase()
}

export function getAnafTokenDiagnostics(accessToken: string) {
  const payload = decodeJwtPayload(accessToken)
  if (!payload) {
    return {
      tokenPresent: Boolean(accessToken),
      tokenExp: null,
      tokenIssuer: null,
      tokenClientAppId: null,
      tokenSerial: null,
      tokenScopes: [],
      tokenRoles: [],
    }
  }

  const scopeData = Array.isArray(payload.scope_data) ? payload.scope_data : []
  const scopeMap = Object.fromEntries(
    scopeData
      .filter((entry: any) => entry && typeof entry.id === "string")
      .map((entry: any) => [entry.id, entry.value])
  )

  return {
    tokenPresent: true,
    tokenExp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    tokenIssuer: payload.iss || null,
    tokenClientAppId: payload.clientappid || scopeMap.clientappid || null,
    tokenSerial: payload.serial || scopeMap.serial || null,
    tokenScopes: String(payload.scope || "").split(/\s+/).filter(Boolean),
    tokenRoles: String(payload.roles || scopeMap.role || "")
      .split(/[,@]/)
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  }
}

export function getAnafCompanyDiagnostics(company: any) {
  const tokenDiagnostics = getAnafTokenDiagnostics(String(company?.anafOauthAccessToken || company?.efacturaOauthAccessToken || ""))
  const certOptions = getAnafCertificateOptions(company)
  const certSerialConfigured = company?.efacturaCertSerial || null
  const tokenSerial = tokenDiagnostics.tokenSerial || null
  const certSerialNormalized = normalizeCertificateSerial(certSerialConfigured)
  const tokenSerialNormalized = normalizeCertificateSerial(tokenSerial)

  return {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    cif: normalizeCompanyCui(company?.cui),
    hasAccessToken: Boolean(company?.anafOauthAccessToken || company?.efacturaOauthAccessToken),
    hasCertificateFile: Boolean(company?.efacturaCertFilename),
    usingClientCertificate: Boolean(certOptions?.pfx),
    certSerialConfigured,
    certSerialNormalized: certSerialNormalized || null,
    tokenIssuer: tokenDiagnostics.tokenIssuer,
    tokenClientAppId: tokenDiagnostics.tokenClientAppId,
    tokenSerial,
    tokenSerialNormalized: tokenSerialNormalized || null,
    serialsMatch: Boolean(certSerialNormalized && tokenSerialNormalized && certSerialNormalized === tokenSerialNormalized),
    tokenScopes: tokenDiagnostics.tokenScopes,
    tokenRoles: tokenDiagnostics.tokenRoles,
    tokenExp: tokenDiagnostics.tokenExp,
  }
}

export function requireAnafReadyCompany(company: any, actionLabel = "operatiunea ANAF") {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    throw new Error(`Firma nu are CUI valid pentru ${actionLabel}.`)
  }
  if (!company?.anafOauthAccessToken && !company?.efacturaOauthAccessToken) {
    throw new Error(`Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul ANAF pentru ${actionLabel}.`)
  }

  return {
    cif,
    certOptions: getAnafCertificateOptions(company),
    baseUrl: getEfacturaBaseUrl(company?.efacturaEnvironment),
    accessToken: String(company.anafOauthAccessToken || company.efacturaOauthAccessToken),
  }
}

export function buildAnafAuthHeaders(accessToken: string, extraHeaders: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  }
}

function getEtransportBaseUrl(environment: string | null | undefined) {
  return String(environment || "test").toLowerCase() === "prod"
    ? "https://api.anaf.ro/prod/ETRANSPORT/ws/v1"
    : "https://api.anaf.ro/test/ETRANSPORT/ws/v1"
}

function logAnafRequestStart(label: string, details: Record<string, unknown>) {
  console.log("ANAF REQUEST START", {
    label,
    ...details,
    at: new Date().toISOString(),
  })
}

function logAnafRequestFinish(label: string, details: Record<string, unknown>) {
  console.log("ANAF REQUEST FINISH", {
    label,
    ...details,
    at: new Date().toISOString(),
  })
}

export async function anafListMessages(company: any, options: { days?: number; cif?: string } = {}) {
  const ready = requireAnafReadyCompany(company, "sincronizarea SPV")
  const cif = options.cif || ready.cif
  const days = Math.min(60, Math.max(1, Number(options.days || 30)))
  const url = `${ready.baseUrl}/listaMesajeFactura?zile=${days}&cif=${encodeURIComponent(cif)}`
  const tokenDiagnostics = getAnafTokenDiagnostics(ready.accessToken)
  logAnafRequestStart("listaMesajeFactura", {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    cif,
    days,
    url,
    hasCertificateFile: Boolean(company?.efacturaCertFilename),
    usingClientCertificate: Boolean(ready.certOptions?.pfx),
    certSerialConfigured: company?.efacturaCertSerial || null,
    tokenSerial: tokenDiagnostics.tokenSerial,
    tokenScopes: tokenDiagnostics.tokenScopes,
    tokenRoles: tokenDiagnostics.tokenRoles,
    tokenExp: tokenDiagnostics.tokenExp,
  })
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  logAnafRequestFinish("listaMesajeFactura", {
    tenantId: company?.tenantId || null,
    status: response.status,
    ok: response.ok,
    summary: summarizeAnafResponse(payload, rawText),
    itemCount: collectMessageItems(payload).length,
  })

  return {
    url,
    response,
    rawText,
    payload,
    items: collectMessageItems(payload),
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafDownloadById(company: any, downloadId: string) {
  const ready = requireAnafReadyCompany(company, "descarcarea documentului ANAF")
  const url = `${ready.baseUrl}/descarcare?id=${encodeURIComponent(downloadId)}`
  logAnafRequestStart("descarcare", {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    downloadId,
    url,
    usingClientCertificate: Boolean(ready.certOptions?.pfx),
  })
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
  })
  const rawText = response.buffer.toString("utf8")
  const payload = parseAnafPayload(rawText)
  logAnafRequestFinish("descarcare", {
    tenantId: company?.tenantId || null,
    downloadId,
    status: response.status,
    ok: response.ok,
    summary: summarizeAnafResponse(payload, rawText),
  })

  return {
    url,
    response,
    rawText,
    payload,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafUploadXml(company: any, xmlText: string) {
  const ready = requireAnafReadyCompany(company, "trimiterea e-Facturii")
  const url = `${ready.baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(ready.cif)}`
  logAnafRequestStart("upload", {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    cif: ready.cif,
    url,
    xmlSize: Buffer.byteLength(xmlText, "utf8"),
    usingClientCertificate: Boolean(ready.certOptions?.pfx),
  })
  const response = await anafHttpRequest(url, {
    method: "POST",
    headers: buildAnafAuthHeaders(ready.accessToken, {
      "Content-Type": "application/xml; charset=utf-8",
    }),
    body: xmlText,
    ...ready.certOptions,
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  const uploadIndex = extractUploadIndex(payload, rawText)
  logAnafRequestFinish("upload", {
    tenantId: company?.tenantId || null,
    status: response.status,
    ok: response.ok,
    uploadIndex,
    summary: summarizeAnafResponse(payload, rawText),
  })

  return {
    url,
    response,
    rawText,
    payload,
    uploadIndex,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafCheckUploadStatus(company: any, uploadIndex: string) {
  const ready = requireAnafReadyCompany(company, "verificarea starii la ANAF")
  const url = `${ready.baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(uploadIndex)}`
  logAnafRequestStart("stareMesaj", {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    uploadIndex,
    url,
    usingClientCertificate: Boolean(ready.certOptions?.pfx),
  })
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  const downloadId = extractDownloadId(payload, rawText)
  logAnafRequestFinish("stareMesaj", {
    tenantId: company?.tenantId || null,
    uploadIndex,
    status: response.status,
    ok: response.ok,
    downloadId,
    summary: summarizeAnafResponse(payload, rawText),
  })

  return {
    url,
    response,
    rawText,
    payload,
    downloadId,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafUploadEtransportXml(company: any, xmlText: string) {
  const ready = requireAnafReadyCompany(company, "trimiterea RO e-Transport")
  const url = `${getEtransportBaseUrl(company?.efacturaEnvironment)}/upload/ETRANSPORT/${encodeURIComponent(ready.cif)}`
  const response = await anafHttpRequest(url, {
    method: "POST",
    headers: buildAnafAuthHeaders(ready.accessToken, {
      "Content-Type": "application/xml; charset=utf-8",
    }),
    body: xmlText,
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  const uploadIndex = extractUploadIndex(payload, rawText)

  return {
    url,
    response,
    rawText,
    payload,
    uploadIndex,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafCheckEtransportStatus(company: any, uploadIndex: string) {
  const ready = requireAnafReadyCompany(company, "verificarea starii RO e-Transport")
  const url = `${getEtransportBaseUrl(company?.efacturaEnvironment)}/stareMesaj/${encodeURIComponent(uploadIndex)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  const downloadId = extractDownloadId(payload, rawText)

  return {
    url,
    response,
    rawText,
    payload,
    downloadId,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafListEtransportMessages(company: any, options: { days?: number; cif?: string } = {}) {
  const ready = requireAnafReadyCompany(company, "sincronizarea RO e-Transport")
  const cif = options.cif || ready.cif
  const days = Math.min(60, Math.max(1, Number(options.days || 30)))
  const url = `${getEtransportBaseUrl(company?.efacturaEnvironment)}/lista/${days}/${encodeURIComponent(cif)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)

  return {
    url,
    response,
    rawText,
    payload,
    items: collectMessageItems(payload),
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafDownloadEtransportById(company: any, downloadId: string) {
  const ready = requireAnafReadyCompany(company, "descarcarea raspunsului RO e-Transport")
  const url = `${getEtransportBaseUrl(company?.efacturaEnvironment)}/descarcare/${encodeURIComponent(downloadId)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
  })
  const rawText = response.buffer.toString("utf8")
  const payload = parseAnafPayload(rawText)

  return {
    url,
    response,
    rawText,
    payload,
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export function logAnafRouteError(label: string, details: Record<string, unknown>) {
  console.error(label, {
    ...details,
    at: new Date().toISOString(),
  })
}
