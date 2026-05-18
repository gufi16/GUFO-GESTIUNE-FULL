export type WarehouseConfig = {
  multiWarehouseEnabled: boolean
  warehouseFilterEnabled: boolean
  requireWarehouseOnDocuments: boolean
  autoSelectSingleWarehouse: boolean
  warehouseLabel: string
}

const STORAGE_KEY = "warehouse_config"
const EVENT_NAME = "warehouse-config-change"

const defaultWarehouseConfig: WarehouseConfig = {
  multiWarehouseEnabled: false,
  warehouseFilterEnabled: false,
  requireWarehouseOnDocuments: false,
  autoSelectSingleWarehouse: true,
  warehouseLabel: "Gestiune",
}

function normalizeWarehouseConfig(value: any): WarehouseConfig {
  return {
    multiWarehouseEnabled: Boolean(value?.multiWarehouseEnabled),
    warehouseFilterEnabled: Boolean(value?.warehouseFilterEnabled),
    requireWarehouseOnDocuments: Boolean(value?.requireWarehouseOnDocuments),
    autoSelectSingleWarehouse: value?.autoSelectSingleWarehouse !== false,
    warehouseLabel: String(value?.warehouseLabel || "Gestiune"),
  }
}

export function getDefaultWarehouseConfig() {
  return defaultWarehouseConfig
}

export function getWarehouseConfig(): WarehouseConfig {
  if (typeof window === "undefined") return defaultWarehouseConfig

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultWarehouseConfig
    return normalizeWarehouseConfig(JSON.parse(raw))
  } catch {
    return defaultWarehouseConfig
  }
}

export function setWarehouseConfig(nextConfig: WarehouseConfig) {
  if (typeof window === "undefined") return

  const normalized = normalizeWarehouseConfig(nextConfig)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }))
}

export function subscribeToWarehouseConfig(listener: (config: WarehouseConfig) => void) {
  if (typeof window === "undefined") return () => {}

  const handleChange = (event: Event) => {
    const customEvent = event as CustomEvent<WarehouseConfig>
    listener(normalizeWarehouseConfig(customEvent.detail))
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener(getWarehouseConfig())
    }
  }

  window.addEventListener(EVENT_NAME, handleChange as EventListener)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(EVENT_NAME, handleChange as EventListener)
    window.removeEventListener("storage", handleStorage)
  }
}
