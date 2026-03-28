export function parseLocaleNumber(value: unknown): number {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".").trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatNumberRo(value: unknown, digits = 2) {
  return Number(value || 0).toLocaleString("ro-RO", {
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
