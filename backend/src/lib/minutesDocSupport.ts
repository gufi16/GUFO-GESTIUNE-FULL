import { MinutesDocType } from "@prisma/client"

export function minutesDocNumber(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function minutesDocText(value: unknown) {
  const t = String(value ?? "").trim()
  return t || null
}

export function parseMinutesDocDate(value: unknown) {
  if (!value) return null
  const d = new Date(value as string | number | Date)
  return Number.isNaN(d.getTime()) ? null : d
}

export function safeMinutesDocFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

export function minutesReasonLabel(code?: string | null) {
  if (code === "EXPIRED") return "Expirat"
  if (code === "DAMAGE") return "Deteriorat"
  if (code === "LOSS") return "Pierdere"
  if (code === "PRICE_UPDATE") return "Schimbare pret"
  return "Alt motiv"
}

export function minutesFindingLabel(code?: string | null, reasonCode?: string | null) {
  if (code === "DAMAGE_PARTIAL") return "S-a constatat deteriorarea partiala a produselor mentionate in prezentul document."
  if (code === "DAMAGE_TOTAL") return "S-a constatat deteriorarea totala a produselor mentionate in prezentul document."
  if (code === "EXPIRED_FOUND") return "S-a constatat expirarea produselor mentionate in prezentul document, fara posibilitatea mentinerii lor la vanzare."
  if (code === "LOSS_FOUND") return "S-a constatat lipsa in gestiune pentru produsele mentionate in prezentul document."
  if (reasonCode === "EXPIRED") return "S-a constatat expirarea produselor mentionate in prezentul document."
  if (reasonCode === "LOSS") return "S-a constatat lipsa in gestiune pentru produsele mentionate in prezentul document."
  return "S-a constatat deprecierea produselor mentionate in prezentul document."
}

export function minutesDocTypeLabel(type: MinutesDocType) {
  return type === "PRICE_CHANGE" ? "PROCES VERBAL DE SCHIMBARE PRET" : "PROCES VERBAL DE DETERIORARE"
}

export function minutesDocTypeShortLabel(type: MinutesDocType) {
  return type === "PRICE_CHANGE" ? "Schimbare pret" : "Deteriorare"
}

export function formatMinutesQty(value: unknown) {
  return minutesDocNumber(value).toLocaleString("ro-RO", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

export function formatMinutesMoney(value: unknown) {
  return minutesDocNumber(value).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
