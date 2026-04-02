// @ts-nocheck
import { prisma } from "./prisma"
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
  efacturaOauthAccessToken: true,
  efacturaOauthLastError: true,
  efacturaCertSerial: true,
  efacturaCertFilename: true,
  efacturaCertPasswordEnc: true,
}

export async function loadAnafCompanyContext(tenantId: string) {
  return prisma.company.findUnique({
    where: { tenantId },
    select: COMPANY_ANAF_SELECT,
  })
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

export async function anafListMessages(company: any, options: { days?: number; cif?: string } = {}) {
  const ready = requireAnafReadyCompany(company, "sincronizarea SPV")
  const cif = options.cif || ready.cif
  const days = Math.min(60, Math.max(1, Number(options.days || 30)))
  const url = `${ready.baseUrl}/listaMesajeFactura?zile=${days}&cif=${encodeURIComponent(cif)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
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

export async function anafDownloadById(company: any, downloadId: string) {
  const ready = requireAnafReadyCompany(company, "descarcarea documentului ANAF")
  const url = `${ready.baseUrl}/descarcare?id=${encodeURIComponent(downloadId)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
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

export async function anafUploadXml(company: any, xmlText: string) {
  const ready = requireAnafReadyCompany(company, "trimiterea e-Facturii")
  const url = `${ready.baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(ready.cif)}`
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

  return {
    url,
    response,
    rawText,
    payload,
    uploadIndex: extractUploadIndex(payload, rawText),
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export async function anafCheckUploadStatus(company: any, uploadIndex: string) {
  const ready = requireAnafReadyCompany(company, "verificarea starii la ANAF")
  const url = `${ready.baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(uploadIndex)}`
  const response = await anafHttpRequest(url, {
    headers: buildAnafAuthHeaders(ready.accessToken),
    ...ready.certOptions,
  })
  const rawText = response.text
  const payload = parseAnafPayload(rawText)

  return {
    url,
    response,
    rawText,
    payload,
    downloadId: extractDownloadId(payload, rawText),
    summary: summarizeAnafResponse(payload, rawText),
  }
}

export function logAnafRouteError(label: string, details: Record<string, unknown>) {
  console.error(label, {
    ...details,
    at: new Date().toISOString(),
  })
}
