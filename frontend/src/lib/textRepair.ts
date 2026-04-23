const MOJIBAKE_PATTERN = /(Ãƒ.|Ã¢â‚¬|Ã¢â‚¬â€œ|Ã¢â‚¬â€|Ã¢â‚¬Â¢|Ã¯Â¿Â½|Ã…Å¸|Ã…Â£|Ã„Æ’|Ã„â€š|ÃƒÂ¢|ÃƒÂ®|ÃƒÈ™|ÃƒÅ£|Ãˆâ„¢|Ãˆâ€º)/

const MANUAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Ãˆâ„¢/g, "s"],
  [/ÃˆËœ/g, "S"],
  [/Ãˆâ€º/g, "t"],
  [/ÃˆÅ¡/g, "T"],
  [/Ã„Æ’/g, "a"],
  [/Ã„â€š/g, "A"],
  [/ÃƒÂ¢/g, "a"],
  [/Ãƒâ€š/g, "A"],
  [/ÃƒÂ®/g, "i"],
  [/ÃƒÅ½/g, "I"],
  [/ÃƒÈ™/g, "s"],
  [/ÃƒÈ˜/g, "S"],
  [/ÃƒÅ£/g, "t"],
  [/ÃƒÅ¢/g, "T"],
  [/Ã…Å¸/g, "s"],
  [/Ã…Å¾/g, "S"],
  [/Ã…Â£/g, "t"],
  [/Ã…Â¢/g, "T"],
  [/Ã¢â‚¬â€œ/g, "-"],
  [/Ã¢â‚¬â€/g, "-"],
  [/Ã¢â‚¬Â¢/g, "-"],
  [/Ã¢â‚¬Å¾/g, '"'],
  [/Ã¢â‚¬Å“/g, '"'],
  [/Ã¢â‚¬Â/g, '"'],
  [/Ã‚ /g, " "],
]

const ASCII_REPLACEMENTS: Array<[RegExp, string]> = [
  [/ă/g, "a"],
  [/Ă/g, "A"],
  [/â/g, "a"],
  [/Â/g, "A"],
  [/î/g, "i"],
  [/Î/g, "I"],
  [/ș/g, "s"],
  [/Ș/g, "S"],
  [/ş/g, "s"],
  [/Ş/g, "S"],
  [/ț/g, "t"],
  [/Ț/g, "T"],
  [/ţ/g, "t"],
  [/Ţ/g, "T"],
]

function suspiciousScore(text: string) {
  return (text.match(new RegExp(MOJIBAKE_PATTERN.source, "g")) || []).length
}

function applyManualReplacements(text: string) {
  return MANUAL_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)
}

function toAsciiRomanian(text: string) {
  return ASCII_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)
}

export function repairText(value: unknown) {
  const raw = String(value ?? "")
  if (!raw) return ""

  let repaired = applyManualReplacements(raw)

  if (MOJIBAKE_PATTERN.test(repaired)) {
    try {
      const candidate = decodeURIComponent(escape(repaired))
      const normalizedCandidate = applyManualReplacements(candidate)
      if (normalizedCandidate && suspiciousScore(normalizedCandidate) < suspiciousScore(repaired)) {
        repaired = normalizedCandidate
      }
    } catch {
      // keep repaired text
    }
  }

  return toAsciiRomanian(repaired)
}

export function repairDeepStrings<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => repairDeepStrings(item)) as T
  }

  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Blob) && !(value instanceof File)) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, repairDeepStrings(item)])
    return Object.fromEntries(entries) as T
  }

  if (typeof value === "string") {
    return repairText(value) as T
  }

  return value
}
