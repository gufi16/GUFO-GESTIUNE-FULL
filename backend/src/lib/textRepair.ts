const MOJIBAKE_PATTERN = /(Ã.|â€|â€“|â€”|â€¢|ï¿½|ÅŸ|Å£|Äƒ|Ä‚|Ã¢|Ã®|Ãș|Ãţ|È™|È›)/

const MANUAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/È™/g, "ș"],
  [/È˜/g, "Ș"],
  [/È›/g, "ț"],
  [/Èš/g, "Ț"],
  [/Äƒ/g, "ă"],
  [/Ä‚/g, "Ă"],
  [/Ã¢/g, "â"],
  [/Ã‚/g, "Â"],
  [/Ã®/g, "î"],
  [/ÃŽ/g, "Î"],
  [/Ãș/g, "ș"],
  [/ÃȘ/g, "Ș"],
  [/Ãţ/g, "ț"],
  [/ÃŢ/g, "Ț"],
  [/ÅŸ/g, "ș"],
  [/Åž/g, "Ș"],
  [/Å£/g, "ț"],
  [/Å¢/g, "Ț"],
  [/â€“/g, "–"],
  [/â€”/g, "—"],
  [/â€¢/g, "•"],
  [/â€ž/g, "„"],
  [/â€œ/g, "“"],
  [/â€/g, "”"],
  [/Â /g, " "],
]

function suspiciousScore(text: string) {
  return (text.match(new RegExp(MOJIBAKE_PATTERN.source, "g")) || []).length
}

function applyManualReplacements(text: string) {
  return MANUAL_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)
}

export function repairText(value: unknown) {
  const raw = String(value ?? "")
  if (!raw) return ""

  let repaired = applyManualReplacements(raw)

  if (MOJIBAKE_PATTERN.test(repaired)) {
    try {
      const candidate = Buffer.from(repaired, "latin1").toString("utf8")
      const normalizedCandidate = applyManualReplacements(candidate)
      if (normalizedCandidate && suspiciousScore(normalizedCandidate) < suspiciousScore(repaired)) {
        repaired = normalizedCandidate
      }
    } catch {
      // keep original repaired text
    }
  }

  return repaired
}

export function repairDeepStrings<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => repairDeepStrings(item)) as T
  }

  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Buffer)) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, repairDeepStrings(item)])
    return Object.fromEntries(entries) as T
  }

  if (typeof value === "string") {
    return repairText(value) as T
  }

  return value
}
