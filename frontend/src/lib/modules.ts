export function getEnabledModules() {
  try {
    const raw = localStorage.getItem("modules")
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

export function hasModule(code: string) {
  return getEnabledModules().includes(code)
}

export function firstAllowedRoute() {
  if (hasModule("dashboard")) return "/dashboard"
  if (hasModule("documents")) return "/inregistrare-document"
  if (hasModule("inventory")) return "/gestiune"
  if (hasModule("nomenclature")) return "/nomenclator"
  if (hasModule("settings")) return "/setari"
  if (hasModule("reports")) return "/rapoarte"
  return "/login"
}
