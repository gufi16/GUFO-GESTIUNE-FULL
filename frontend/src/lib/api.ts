export const API_BASE =
  (import.meta as any)?.env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://localhost:3001"

export function getToken(): string {
  const pathname =
    typeof window !== "undefined" ? window.location.pathname || "" : ""
  const isControlPanelRoute =
    pathname.startsWith("/control-panel") || pathname.startsWith("/cp")

  if (isControlPanelRoute) {
    return (
      localStorage.getItem("control_token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("token") ||
      ""
    )
  }

  return (
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("control_token") ||
    ""
  )
}

export function setToken(token: string) {
  localStorage.setItem("access_token", token)
  localStorage.setItem("token", token)
}

export function clearToken() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("token")
  localStorage.removeItem("control_token")
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken()

  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

type ApiOptions = RequestInit & {
  raw?: boolean
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers || {})

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (options.raw) {
    return response as unknown as T
  }

  const contentType = response.headers.get("content-type") || ""
  const isJson = contentType.includes("application/json")
  const payload = isJson ? await response.json().catch(() => ({})) : await response.text()

  if (!response.ok) {
    if (isJson && payload && typeof payload === "object") {
      throw new Error((payload as any).error || "Request failed")
    }

    throw new Error(typeof payload === "string" ? payload : "Request failed")
  }

  return payload as T
}

export default api
