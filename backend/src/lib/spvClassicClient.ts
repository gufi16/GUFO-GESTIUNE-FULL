import { anafHttpRequest } from "./anafHttp"
import { getAnafCertificateOptions } from "./efacturaCertificate"

export const SPV_CLASSIC_LIST_MESSAGES_URL = "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje"
export const SPV_CLASSIC_DOWNLOAD_URL = "https://webserviced.anaf.ro/SPVWS2/rest/descarcare"

function normalizeSerial(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
}

export function getSpvClassicCompanyDiagnostics(company: {
  tenantId?: string | null
  cui?: string | null
  efacturaCertFilename?: string | null
  efacturaCertPasswordEnc?: string | null
  efacturaCertSerial?: string | null
}) {
  const certificate = getAnafCertificateOptions(company)
  const certSerialNormalized = normalizeSerial(company?.efacturaCertSerial)
  const hasCertificateFile = Boolean(certificate?.pfx?.length)
  const hasCertificatePassword = Boolean(certificate?.passphrase)

  return {
    tenantId: company?.tenantId || null,
    cui: company?.cui || null,
    authType: "qualified_certificate",
    endpoints: {
      listMessages: SPV_CLASSIC_LIST_MESSAGES_URL,
      download: SPV_CLASSIC_DOWNLOAD_URL,
    },
    certSerialConfigured: company?.efacturaCertSerial || null,
    certSerialNormalized: certSerialNormalized || null,
    hasCertificateFile,
    hasCertificatePassword,
    canUseServerCertificate: hasCertificateFile && hasCertificatePassword,
  }
}

export function requireSpvClassicReadyCompany(
  company: {
    tenantId?: string | null
    cui?: string | null
    efacturaCertFilename?: string | null
    efacturaCertPasswordEnc?: string | null
    efacturaCertSerial?: string | null
  },
  actionLabel: string
) {
  const diagnostics = getSpvClassicCompanyDiagnostics(company)
  const cui = String(company?.cui || "").trim()

  if (!cui) {
    throw new Error(`Firma nu are CUI completat pentru ${actionLabel}.`)
  }

  if (!diagnostics.hasCertificateFile || !diagnostics.hasCertificatePassword) {
    throw new Error(
      `Fluxul SPV clasic pentru ${actionLabel} cere certificat client calificat disponibil pe server.`
    )
  }

  const certificate = getAnafCertificateOptions(company)

  return {
    ...diagnostics,
    cui,
    certificate,
  }
}

function parseSpvClassicJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function spvClassicListMessages(
  company: {
    tenantId?: string | null
    cui?: string | null
    efacturaCertFilename?: string | null
    efacturaCertPasswordEnc?: string | null
    efacturaCertSerial?: string | null
  },
  options?: { days?: number }
) {
  const ready = requireSpvClassicReadyCompany(company, "lista de mesaje SPV")
  const days = Math.max(1, Math.min(365, Number(options?.days || 30)))
  const url = `${SPV_CLASSIC_LIST_MESSAGES_URL}?zile=${days}`
  const response = await anafHttpRequest(url, {
    method: "GET",
    timeoutMs: 20_000,
    pfx: ready.certificate.pfx,
    passphrase: ready.certificate.passphrase,
  })
  const payload = parseSpvClassicJson(response.text)

  return {
    url,
    days,
    response,
    payload,
    messages: Array.isArray(payload?.mesaje) ? payload.mesaje : [],
  }
}

export async function spvClassicDownloadMessage(
  company: {
    tenantId?: string | null
    cui?: string | null
    efacturaCertFilename?: string | null
    efacturaCertPasswordEnc?: string | null
    efacturaCertSerial?: string | null
  },
  downloadId: string
) {
  const ready = requireSpvClassicReadyCompany(company, "descarcarea mesajului SPV")
  const id = String(downloadId || "").trim()
  if (!id) {
    throw new Error("Lipseste ID-ul mesajului SPV.")
  }

  const url = `${SPV_CLASSIC_DOWNLOAD_URL}?id=${encodeURIComponent(id)}`
  const response = await anafHttpRequest(url, {
    method: "GET",
    timeoutMs: 20_000,
    pfx: ready.certificate.pfx,
    passphrase: ready.certificate.passphrase,
  })

  return {
    url,
    response,
  }
}
