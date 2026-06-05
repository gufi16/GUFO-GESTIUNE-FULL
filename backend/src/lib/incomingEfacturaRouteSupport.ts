type AddressLike = {
  street?: unknown
  additionalStreet?: unknown
  city?: unknown
  postalCode?: unknown
  region?: unknown
  country?: unknown
}

export function incomingEfacturaMoney(value: unknown) {
  return Number(value || 0).toFixed(2)
}

export function incomingEfacturaMoneyRo(value: unknown) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

export function incomingEfacturaQtyRo(value: unknown) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

export function incomingEfacturaDateRo(value: unknown) {
  const date = toIncomingEfacturaDateOrNull(value)
  return date ? date.toLocaleDateString("ro-RO") : "-"
}

export function joinIncomingEfacturaAddressParts(address: AddressLike | null | undefined) {
  if (!address) return "-"
  return [
    address.street,
    address.additionalStreet,
    address.city,
    address.postalCode,
    address.region,
    address.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ")
}

export function safeIncomingEfacturaFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

export function toIncomingEfacturaDateOrNull(value: unknown) {
  if (!value) return null
  if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function incomingEfacturaNumber(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    const parsedFromString = Number(String(value))
    if (Number.isFinite(parsedFromString)) return parsedFromString
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeIncomingEfacturaCurrency(value: unknown): "RON" | "EUR" | "USD" | "HUF" {
  const current = String(value || "RON").toUpperCase()
  if (current === "EUR" || current === "USD" || current === "HUF") return current
  return "RON"
}
