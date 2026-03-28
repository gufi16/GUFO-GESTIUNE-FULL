const ACTIVE_LOCATION_KEY = "active_location_id"
const ACTIVE_LOCATION_EVENT = "active-location-change"

export function getActiveLocationId() {
  if (typeof window === "undefined") return ""
  return localStorage.getItem(ACTIVE_LOCATION_KEY) || ""
}

export function setActiveLocationId(locationId: string) {
  if (typeof window === "undefined") return

  const normalized = String(locationId || "").trim()
  if (normalized) {
    localStorage.setItem(ACTIVE_LOCATION_KEY, normalized)
  } else {
    localStorage.removeItem(ACTIVE_LOCATION_KEY)
  }

  window.dispatchEvent(
    new CustomEvent(ACTIVE_LOCATION_EVENT, {
      detail: { locationId: normalized },
    })
  )
}

export function subscribeToActiveLocation(listener: (locationId: string) => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const onCustomChange = (event: Event) => {
    const detail = (event as CustomEvent<{ locationId?: string }>).detail
    listener(String(detail?.locationId || ""))
  }

  const onStorageChange = (event: StorageEvent) => {
    if (event.key !== ACTIVE_LOCATION_KEY) return
    listener(String(event.newValue || ""))
  }

  window.addEventListener(ACTIVE_LOCATION_EVENT, onCustomChange)
  window.addEventListener("storage", onStorageChange)

  return () => {
    window.removeEventListener(ACTIVE_LOCATION_EVENT, onCustomChange)
    window.removeEventListener("storage", onStorageChange)
  }
}
