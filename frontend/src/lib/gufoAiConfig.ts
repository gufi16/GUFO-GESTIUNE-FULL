export type GufoAiMode = "observer" | "copilot" | "action"

export type GufoAiConfig = {
  enabled: boolean
  mode: GufoAiMode
  watchCurrentPage: boolean
  proactiveWarnings: boolean
  conversationalHelp: boolean
  suggestFixes: boolean
  prepareDrafts: boolean
  requireConfirmation: boolean
  allowNomenclatureDrafts: boolean
  allowInventoryDrafts: boolean
  allowFinancialDrafts: boolean
  allowSettingsGuidance: boolean
  roleAccess: {
    owner: boolean
    admin: boolean
    manager: boolean
    operator: boolean
    cashier: boolean
  }
}

const STORAGE_EVENT = "gufo-ai-config-changed"

export const defaultGufoAiConfig: GufoAiConfig = {
  enabled: true,
  mode: "copilot",
  watchCurrentPage: true,
  proactiveWarnings: true,
  conversationalHelp: true,
  suggestFixes: true,
  prepareDrafts: true,
  requireConfirmation: true,
  allowNomenclatureDrafts: true,
  allowInventoryDrafts: true,
  allowFinancialDrafts: false,
  allowSettingsGuidance: true,
  roleAccess: {
    owner: true,
    admin: true,
    manager: true,
    operator: true,
    cashier: false,
  },
}

function storageKey() {
  if (typeof window === "undefined") return "gufo-ai-config"
  const host = window.location.hostname || "local"
  return `gufo-ai-config:${host}`
}

function isRoleAccess(value: unknown): value is GufoAiConfig["roleAccess"] {
  if (!value || typeof value !== "object") return false
  const raw = value as Record<string, unknown>
  return ["owner", "admin", "manager", "operator", "cashier"].every((key) => typeof raw[key] === "boolean")
}

export function normalizeGufoAiConfig(value: unknown): GufoAiConfig {
  if (!value || typeof value !== "object") {
    return {
      ...defaultGufoAiConfig,
      roleAccess: { ...defaultGufoAiConfig.roleAccess },
    }
  }

  const raw = value as Record<string, unknown>
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaultGufoAiConfig.enabled,
    mode: raw.mode === "observer" || raw.mode === "copilot" || raw.mode === "action" ? raw.mode : defaultGufoAiConfig.mode,
    watchCurrentPage: typeof raw.watchCurrentPage === "boolean" ? raw.watchCurrentPage : defaultGufoAiConfig.watchCurrentPage,
    proactiveWarnings: typeof raw.proactiveWarnings === "boolean" ? raw.proactiveWarnings : defaultGufoAiConfig.proactiveWarnings,
    conversationalHelp: typeof raw.conversationalHelp === "boolean" ? raw.conversationalHelp : defaultGufoAiConfig.conversationalHelp,
    suggestFixes: typeof raw.suggestFixes === "boolean" ? raw.suggestFixes : defaultGufoAiConfig.suggestFixes,
    prepareDrafts: typeof raw.prepareDrafts === "boolean" ? raw.prepareDrafts : defaultGufoAiConfig.prepareDrafts,
    requireConfirmation: typeof raw.requireConfirmation === "boolean" ? raw.requireConfirmation : defaultGufoAiConfig.requireConfirmation,
    allowNomenclatureDrafts: typeof raw.allowNomenclatureDrafts === "boolean" ? raw.allowNomenclatureDrafts : defaultGufoAiConfig.allowNomenclatureDrafts,
    allowInventoryDrafts: typeof raw.allowInventoryDrafts === "boolean" ? raw.allowInventoryDrafts : defaultGufoAiConfig.allowInventoryDrafts,
    allowFinancialDrafts: typeof raw.allowFinancialDrafts === "boolean" ? raw.allowFinancialDrafts : defaultGufoAiConfig.allowFinancialDrafts,
    allowSettingsGuidance: typeof raw.allowSettingsGuidance === "boolean" ? raw.allowSettingsGuidance : defaultGufoAiConfig.allowSettingsGuidance,
    roleAccess: isRoleAccess(raw.roleAccess) ? raw.roleAccess : { ...defaultGufoAiConfig.roleAccess },
  }
}

export function readGufoAiConfig(): GufoAiConfig {
  if (typeof window === "undefined") {
    return {
      ...defaultGufoAiConfig,
      roleAccess: { ...defaultGufoAiConfig.roleAccess },
    }
  }

  const saved = window.localStorage.getItem(storageKey())
  if (!saved) {
    return {
      ...defaultGufoAiConfig,
      roleAccess: { ...defaultGufoAiConfig.roleAccess },
    }
  }

  try {
    return normalizeGufoAiConfig(JSON.parse(saved))
  } catch {
    return {
      ...defaultGufoAiConfig,
      roleAccess: { ...defaultGufoAiConfig.roleAccess },
    }
  }
}

export function saveGufoAiConfig(config: GufoAiConfig) {
  if (typeof window === "undefined") return
  const normalized = normalizeGufoAiConfig(config)
  window.localStorage.setItem(storageKey(), JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: normalized }))
}

export function subscribeGufoAiConfig(listener: (config: GufoAiConfig) => void) {
  if (typeof window === "undefined") return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== storageKey()) return
    listener(readGufoAiConfig())
  }

  const handleCustom = () => {
    listener(readGufoAiConfig())
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(STORAGE_EVENT, handleCustom as EventListener)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(STORAGE_EVENT, handleCustom as EventListener)
  }
}
