import fs from "fs"
import jwt from "jsonwebtoken"
import path from "path"
import type { AuthedRequest } from "../middleware/requireAuth"

type EfacturaAgentFile = {
  fileName: string
  fullPath: string
  size: number
  updatedAt: string
  mtimeMs: number
}

export function normalizeOptionalText(value: unknown) {
  const text = String(value || "").trim()
  return text || null
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
