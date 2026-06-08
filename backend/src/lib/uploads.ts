import fs from "fs"
import path from "path"

function normalizeAbsolutePath(value?: string | null) {
  const text = String(value || "").trim()
  if (!text) return ""
  return path.resolve(text)
}

export function getUploadsRoot() {
  const configured = normalizeAbsolutePath(process.env.UPLOADS_DIR)
  return configured || path.resolve(process.cwd(), "uploads")
}

export function getUploadsConfig() {
  const configuredRoot = normalizeAbsolutePath(process.env.UPLOADS_DIR)
  const effectiveRoot = configuredRoot || path.resolve(process.cwd(), "uploads")
  const usingFallbackRoot = !configuredRoot
  const allowEphemeralUploads = process.env.ALLOW_EPHEMERAL_UPLOADS === "true"
  const isProduction = process.env.NODE_ENV === "production"
  const localFallbackAllowed = !isProduction && usingFallbackRoot
  const persistentStorageSatisfied = !usingFallbackRoot || allowEphemeralUploads || localFallbackAllowed

  return {
    configuredRoot,
    effectiveRoot,
    usingFallbackRoot,
    allowEphemeralUploads,
    isProduction,
    localFallbackAllowed,
    persistentStorageSatisfied,
  }
}

export function assertPersistentUploadsConfig() {
  const config = getUploadsConfig()

  if (config.isProduction && config.usingFallbackRoot && !config.allowEphemeralUploads) {
    throw new Error(
      `UPLOADS_DIR is required in production. ` +
        `Refusing to start with ephemeral uploads at ${config.effectiveRoot}. ` +
        `Set UPLOADS_DIR to a persistent mounted path or explicitly set ALLOW_EPHEMERAL_UPLOADS=true only for temporary use.`
    )
  }

  return config
}

export function ensureUploadsRoot() {
  const root = getUploadsRoot()
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function ensureUploadSubdir(name: string) {
  const dir = path.join(ensureUploadsRoot(), name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function buildPublicUploadUrl(folder: string, filename: string) {
  return `/uploads/${folder}/${filename}`
}

export function normalizeStoredUploadUrl(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null

  const lowered = text.toLowerCase()
  if (
    lowered === "null" ||
    lowered === "undefined" ||
    lowered === "false" ||
    lowered === "about:blank" ||
    lowered === "n/a" ||
    lowered === "na" ||
    lowered === "-"
  ) {
    return null
  }

  if (text.startsWith("/uploads/")) {
    return text
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      if (parsed.pathname.startsWith("/uploads/")) {
        return parsed.pathname
      }
    } catch {
      return text
    }
  }

  return text
}
