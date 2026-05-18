const ACTIVE_WAREHOUSE_KEY = "active_warehouse_id"
const ACTIVE_WAREHOUSE_EVENT = "active-warehouse-change"

export function getActiveWarehouseId() {
  if (typeof window === "undefined") return ""
  return localStorage.getItem(ACTIVE_WAREHOUSE_KEY) || ""
}

export function setActiveWarehouseId(warehouseId: string) {
  if (typeof window === "undefined") return

  const normalized = String(warehouseId || "").trim()
  if (normalized) {
    localStorage.setItem(ACTIVE_WAREHOUSE_KEY, normalized)
  } else {
    localStorage.removeItem(ACTIVE_WAREHOUSE_KEY)
  }

  window.dispatchEvent(
    new CustomEvent(ACTIVE_WAREHOUSE_EVENT, {
      detail: { warehouseId: normalized },
    }),
  )
}

export function subscribeToActiveWarehouse(listener: (warehouseId: string) => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const onCustomChange = (event: Event) => {
    const detail = (event as CustomEvent<{ warehouseId?: string }>).detail
    listener(String(detail?.warehouseId || ""))
  }

  const onStorageChange = (event: StorageEvent) => {
    if (event.key !== ACTIVE_WAREHOUSE_KEY) return
    listener(String(event.newValue || ""))
  }

  window.addEventListener(ACTIVE_WAREHOUSE_EVENT, onCustomChange)
  window.addEventListener("storage", onStorageChange)

  return () => {
    window.removeEventListener(ACTIVE_WAREHOUSE_EVENT, onCustomChange)
    window.removeEventListener("storage", onStorageChange)
  }
}
