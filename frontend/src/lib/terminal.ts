const ACTIVE_TERMINAL_KEY = "active_terminal_id"
const ACTIVE_TERMINAL_EVENT = "active-terminal-change"

export function getActiveTerminalId() {
  if (typeof window === "undefined") return ""
  return localStorage.getItem(ACTIVE_TERMINAL_KEY) || ""
}

export function setActiveTerminalId(terminalId: string) {
  if (typeof window === "undefined") return

  const normalized = String(terminalId || "").trim()
  if (normalized) {
    localStorage.setItem(ACTIVE_TERMINAL_KEY, normalized)
  } else {
    localStorage.removeItem(ACTIVE_TERMINAL_KEY)
  }

  window.dispatchEvent(
    new CustomEvent(ACTIVE_TERMINAL_EVENT, {
      detail: { terminalId: normalized },
    })
  )
}

export function subscribeToActiveTerminal(listener: (terminalId: string) => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const onCustomChange = (event: Event) => {
    const detail = (event as CustomEvent<{ terminalId?: string }>).detail
    listener(String(detail?.terminalId || ""))
  }

  const onStorageChange = (event: StorageEvent) => {
    if (event.key !== ACTIVE_TERMINAL_KEY) return
    listener(String(event.newValue || ""))
  }

  window.addEventListener(ACTIVE_TERMINAL_EVENT, onCustomChange)
  window.addEventListener("storage", onStorageChange)

  return () => {
    window.removeEventListener(ACTIVE_TERMINAL_EVENT, onCustomChange)
    window.removeEventListener("storage", onStorageChange)
  }
}
