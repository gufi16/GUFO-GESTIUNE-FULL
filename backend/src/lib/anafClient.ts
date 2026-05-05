// @ts-nocheck
import { prisma } from "./prisma"
import { resolveCompanyWithAnafCredential } from "./companyAnafCredentials"
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
  cui: true,
  efacturaEnvironment: true,
  efacturaOauthClientId: true,
  efacturaOauthClientSecret: true,
  efacturaOauthRedirectUri: true,
  efacturaOauthAccessToken: true,
  efacturaOauthLastError: true,
  efacturaCertSerial: true,
  efacturaCertFilename: true,
  efacturaCertPasswordEnc: true,
}

export async function loadAnafCompanyContext(tenantId: string, activeCompanyId?: string | null) {
  const company = await resolveCompanyWithAnafCredential(prisma as any, tenantId, activeCompanyId, {
    select: COMPANY_ANAF_SELECT,
  })

  if (!company) return company

  const platform = await prisma.platformConfig.findUnique({
    where: { key: "global" },
    select: { efacturaEnvironment: true },
  })

  const usesOwnOauthConfig = Boolean(
    company?.efacturaOauthClientId &&
      company?.efacturaOauthClientSecret &&
      company?.efacturaOauthRedirectUri
  )

  return {
    ...company,
    efacturaUsesPlatformConfig: !usesOwnOauthConfig,
    efacturaEnvironment: usesOwnOauthConfig
      ? String(company?.efacturaEnvironment || "test").trim() || "test"
      : String(platform?.efacturaEnvironment || company?.efacturaEnvironment || "test").trim() || "test",
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
  const tokenDiagnostics = getAnafTokenDiagnostics(String(company?.efacturaOauthAccessToken || ""))
  const certOptions = getAnafCertificateOptions(company)
  const certSerialConfigured = company?.efacturaCertSerial || null
  const tokenSerial = tokenDiagnostics.tokenSerial || null
  const certSerialNormalized = normalizeCertificateSerial(certSerialConfigured)
  const tokenSerialNormalized = normalizeCertificateSerial(tokenSerial)

  return {
    tenantId: company?.tenantId || null,
    environment: company?.efacturaEnvironment || "test",
    cif: normalizeCompanyCui(company?.cui),
    hasAccessToken: Boolean(company?.efacturaOauthAccessToken),
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
    credentialId: company?.anafCredentialId || null,
    credentialLabel: company?.anafCredentialLabel || null,
  }
}

export function requireAnafReadyCompany(company: any, actionLabel = "operatiunea ANAF") {
  const cif = normalizeCompanyCui(company?.cui)
  if (!cif) {
    throw new Error(`Firma nu are CUI valid pentru ${actionLabel}.`)
  }
  if (!company?.efacturaOauthAccessToken) {
    throw new Error(`Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul ANAF pentru ${actionLabel}.`)
  }

  return {
    cif,
    certOptions: getAnafCertificateOptions(company),
    baseUrl: getEfacturaBaseUrl(company?.efacturaEnvironment),
    accessToken: String(company.efacturaOauthAccessToken),
  }
}

export function buildAnafAuthHeaders(accessToken: string, extraHeaders: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  }
}

function getEtransportBaseUrls(environment: string | null | undefined) {
  const env = String(environment || "test").toLowerCase() === "prod" ? "prod" : "test"
  return [
    `https://webserviceapl.anaf.ro/${env}/ETRANSPORT/ws/v1`,
    `https://api.anaf.ro/${env}/ETRANSPORT/ws/v1`,
  ]
}

function isTlsHandshakeError(error: unknown) {
  return /SSL\/TLS|handshake/i.test(String((error as any)?.message || ""))
}

function isEtransportSchemaDeclarationError(summary: unknown, rawText: unknown) {
  const blob = `${String(summary || "")} ${String(rawText || "")}`.toLowerCase()
  return (
    blob.includes("cannot find the declaration of element 'etrtransport'") ||
    blob.includes("cannot find the declaration of element 'etransport'") ||
    blob.includes("cannot find the declaration of element 'etrtransport'".replace("etrtransport", "etransport"))
  )
}

function stripEtransportSchemaHints(xmlText: string) {
  return String(xmlText || "")
    .replace(/\s+xmlns:xsi="[^"]*"/i, "")
    .replace(/\s+xsi:schemaLocation="[^"]*"/i, "")
}

async function anafEtransportRequest(
  company: any,
  pathBuilder: (baseUrl: string) => string,
  requestOptions: (url: string, accessToken: string) => any,
  logLabel: string,
  startDetails: Record<string, unknown>,
) {
  const ready = requireAnafReadyCompany(company, "operatiunea RO e-Transport")
  const baseUrls = getEtransportBaseUrls(company?.efacturaEnvironment)
  let lastError: any = null

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index]
    const url = pathBuilder(baseUrl)
    try {
      logAnafRequestStart(logLabel, {
        ...startDetails,
        tenantId: company?.tenantId || null,
        environment: company?.efacturaEnvironment || "test",
        url,
        fallbackIndex: index,
      })
      const response = await anafHttpRequest(url, requestOptions(url, ready.accessToken))
      return { response, url, accessToken: ready.accessToken, fallbackIndex: index }
    } catch (error) {
      lastError = error
      logAnafRouteError("ETRANSPORT HTTP ERROR", {
        tenantId: company?.tenantId || null,
        label: logLabel,
        url,
        fallbackIndex: index,
        message: (error as any)?.message || String(error),
      })
      if (!isTlsHandshakeError(error) || index === baseUrls.length - 1) {
        throw error
      }
    }
  }

  throw lastError || new Error("Nu am putut comunica cu ANAF pentru RO e-Transport.")
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
  const tokenDiagnostics = getAnafTokenDiagnostics(ready.accessToken)
  const baseUrls = getEtransportBaseUrls(company?.efacturaEnvironment)
  const uploadStandards = ["ETRANSP"]
  const xmlVariants = [
    { key: "plain", body: xmlText },
    { key: "no-schema-hints", body: stripEtransportSchemaHints(xmlText) },
  ]
  let lastResult: any = null
  let lastError: any = null

  for (let baseIndex = 0; baseIndex < baseUrls.length; baseIndex += 1) {
    const baseUrl = baseUrls[baseIndex]
    for (const uploadStandard of uploadStandards) {
      for (const xmlVariant of xmlVariants) {
        const url = `${baseUrl}/upload/${uploadStandard}/${encodeURIComponent(ready.cif)}/2`
        try {
          logAnafRequestStart("etrtransport-upload", {
            tenantId: company?.tenantId || null,
            environment: company?.efacturaEnvironment || "test",
            cif: ready.cif,
            xmlSize: Buffer.byteLength(xmlVariant.body, "utf8"),
            tokenSerial: tokenDiagnostics.tokenSerial,
            tokenScopes: tokenDiagnostics.tokenScopes,
            tokenRoles: tokenDiagnostics.tokenRoles,
            tokenExp: tokenDiagnostics.tokenExp,
            url,
            fallbackIndex: baseIndex,
            uploadStandard,
            xmlVariant: xmlVariant.key,
          })
          const response = await anafHttpRequest(url, {
            method: "POST",
            headers: buildAnafAuthHeaders(ready.accessToken, {
              "Content-Type": "application/xml; charset=utf-8",
            }),
            body: xmlVariant.body,
          })
          const rawText = response.text
          const payload = parseAnafPayload(rawText)
          const uploadIndex = extractUploadIndex(payload, rawText)
          const summary = summarizeAnafResponse(payload, rawText)

          logAnafRequestFinish("etrtransport-upload", {
            tenantId: company?.tenantId || null,
            status: response.status,
            ok: response.ok,
            url,
            fallbackIndex: baseIndex,
            uploadStandard,
            xmlVariant: xmlVariant.key,
            uploadIndex,
            summary,
          })

          lastResult = {
            url,
            response,
            rawText,
            payload,
            uploadIndex,
            summary,
            fallbackIndex: baseIndex,
            xmlVariant: xmlVariant.key,
          }

          if (response.ok && uploadIndex) {
            return lastResult
          }

          if (!isEtransportSchemaDeclarationError(summary, rawText)) {
            return lastResult
          }
        } catch (error) {
          lastError = error
          logAnafRouteError("ETRANSPORT HTTP ERROR", {
            tenantId: company?.tenantId || null,
            label: "etrtransport-upload",
            url,
            fallbackIndex: baseIndex,
            uploadStandard,
            xmlVariant: xmlVariant.key,
            message: (error as any)?.message || String(error),
          })
          if (!isTlsHandshakeError(error)) {
            throw error
          }
        }
      }
    }
  }

  if (lastResult) return lastResult
  throw lastError || new Error("Nu am putut comunica cu ANAF pentru upload-ul RO e-Transport.")
}

export async function anafCheckEtransportStatus(company: any, uploadIndex: string) {
  const { response, url, fallbackIndex } = await anafEtransportRequest(
    company,
    (baseUrl) => `${baseUrl}/stareMesaj/${encodeURIComponent(uploadIndex)}`,
    (_url, accessToken) => ({
      headers: buildAnafAuthHeaders(accessToken),
    }),
    "etrtransport-stareMesaj",
    {
      uploadIndex,
    },
  )
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  const downloadId = extractDownloadId(payload, rawText)
  logAnafRequestFinish("etrtransport-stareMesaj", {
    tenantId: company?.tenantId || null,
    uploadIndex,
    status: response.status,
    ok: response.ok,
    url,
    fallbackIndex,
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

export async function anafListEtransportMessages(company: any, options: { days?: number; cif?: string } = {}) {
  const ready = requireAnafReadyCompany(company, "sincronizarea RO e-Transport")
  const cif = options.cif || ready.cif
  const days = Math.min(60, Math.max(1, Number(options.days || 30)))
  const { response, url, fallbackIndex } = await anafEtransportRequest(
    company,
    (baseUrl) => `${baseUrl}/lista/${days}/${encodeURIComponent(cif)}`,
    (_url, accessToken) => ({
      headers: buildAnafAuthHeaders(accessToken),
    }),
    "etrtransport-lista",
    {
      cif,
      days,
    },
  )
  const rawText = response.text
  const payload = parseAnafPayload(rawText)
  logAnafRequestFinish("etrtransport-lista", {
    tenantId: company?.tenantId || null,
    status: response.status,
    ok: response.ok,
    url,
    fallbackIndex,
    itemCount: collectMessageItems(payload).length,
    summary: summarizeAnafResponse(payload, rawText),
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

export async function anafDownloadEtransportById(company: any, downloadId: string) {
  const { response, url, fallbackIndex } = await anafEtransportRequest(
    company,
    (baseUrl) => `${baseUrl}/descarcare/${encodeURIComponent(downloadId)}`,
    (_url, accessToken) => ({
      headers: buildAnafAuthHeaders(accessToken),
    }),
    "etrtransport-descarcare",
    {
      downloadId,
    },
  )
  const rawText = response.buffer.toString("utf8")
  const payload = parseAnafPayload(rawText)
  logAnafRequestFinish("etrtransport-descarcare", {
    tenantId: company?.tenantId || null,
    downloadId,
    status: response.status,
    ok: response.ok,
    url,
    fallbackIndex,
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

export function logAnafRouteError(label: string, details: Record<string, unknown>) {
  console.error(label, {
    ...details,
    at: new Date().toISOString(),
  })
}
