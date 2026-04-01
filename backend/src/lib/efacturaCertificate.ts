import crypto from "crypto"
import fs from "fs"
import path from "path"

const CERT_DIR = path.join(process.cwd(), "uploads", "efactura-certificates")

function getCryptoSecret() {
  const seed =
    process.env.EFACTURA_CERT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.CONTROL_PANEL_PASSWORD ||
    "gufo-efactura-cert-secret"

  return crypto.createHash("sha256").update(String(seed)).digest()
}

export function ensureEfacturaCertDir() {
  fs.mkdirSync(CERT_DIR, { recursive: true })
  return CERT_DIR
}

export function getEfacturaCertPath(tenantId: string, originalName?: string | null) {
  const ext = String(path.extname(originalName || "").toLowerCase() || ".p12")
  const normalizedExt = ext === ".pfx" || ext === ".p12" ? ext : ".p12"
  return path.join(ensureEfacturaCertDir(), `${tenantId}${normalizedExt}`)
}

export function hasEfacturaCertificateFile(tenantId: string, filename?: string | null) {
  if (!filename) return false
  return fs.existsSync(getEfacturaCertPath(tenantId, filename))
}

export function readEfacturaCertificateFile(tenantId: string, filename?: string | null) {
  if (!filename) return null
  const filePath = getEfacturaCertPath(tenantId, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}

export function deleteEfacturaCertificateFile(tenantId: string, filename?: string | null) {
  if (!filename) return
  const filePath = getEfacturaCertPath(tenantId, filename)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12)
  const key = getCryptoSecret()
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decryptSecret(value?: string | null) {
  if (!value) return ""

  const [ivBase64, tagBase64, encryptedBase64] = String(value).split(".")
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    return ""
  }

  try {
    const key = getCryptoSecret()
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivBase64, "base64")
    )
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final(),
    ])
    return decrypted.toString("utf8")
  } catch {
    return ""
  }
}

export function getAnafCertificateOptions(company: {
  tenantId?: string | null
  efacturaCertFilename?: string | null
  efacturaCertPasswordEnc?: string | null
}) {
  const tenantId = String(company?.tenantId || "").trim()
  if (!tenantId) {
    throw new Error("Tenant invalid pentru certificatul e-Factura.")
  }

  const pfx = readEfacturaCertificateFile(tenantId, company?.efacturaCertFilename)
  if (!pfx) {
    throw new Error("Nu exista certificat e-Factura incarcat pentru aceasta firma.")
  }

  const passphrase = decryptSecret(company?.efacturaCertPasswordEnc)
  if (!passphrase) {
    throw new Error("Parola certificatului e-Factura lipseste sau nu poate fi decriptata.")
  }

  return {
    pfx,
    passphrase,
  }
}
