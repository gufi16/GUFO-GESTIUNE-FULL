export function parseLocaleNumber(value: unknown): number {
  if (value && typeof value === "object" && "toString" in (value as Record<string, unknown>)) {
    const stringValue = String(value).trim()
    if (stringValue) {
      const normalizedObject = stringValue.replace(/\s/g, "").replace(",", ".")
      const parsedObject = Number(normalizedObject)
      if (Number.isFinite(parsedObject)) return parsedObject
    }
  }
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".").trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatNumberRo(value: unknown, digits = 2) {
  return parseLocaleNumber(value).toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatMoneyRo(value: unknown, currency = "RON", digits = 2) {
  return `${formatNumberRo(value, digits)} ${currency}`
}

export function formatQtyRo(value: unknown, digits = 3) {
  return formatNumberRo(value, digits)
}

export function formatFactorRo(value: unknown, digits = 3) {
  return formatNumberRo(value, digits)
}
