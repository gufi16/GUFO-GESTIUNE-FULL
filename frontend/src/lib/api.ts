import { repairDeepStrings, repairText } from "./textRepair"

const envApiBase = (import.meta as any)?.env?.VITE_API_URL?.replace(/\/+$/, "")
const hostname = typeof window !== "undefined" ? window.location.hostname || "" : ""
const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(hostname)

function resolveHostedApiBase() {
  if (!hostname) return "https://api.gufo.ink"

  if (hostname === "app.gufo.ink" || hostname.endsWith(".gufo.ink")) {
    return "https://api.gufo.ink"
  }

  return "https://api.gufo.ink"
}

export const API_BASE = envApiBase || (isLocalHost ? "http://localhost:3001" : resolveHostedApiBase())

export function resolvePublicAssetUrl(value?: string | null): string {
  const text = String(value || "").trim()
  if (!text) return ""

  if (/^https?:\/\//i.test(text) || text.startsWith("data:") || text.startsWith("blob:")) {
    return text
  }

  if (text.startsWith("/")) {
    return `${API_BASE}${text}`
  }

  return `${API_BASE}/${text.replace(/^\/+/, "")}`
}

function resolveTokenByPath(path?: string): string {
  const normalizedPath = String(path || "").trim()
  const isPublicAuthRoute =
    normalizedPath.startsWith("/api/v1/auth/login") ||
    normalizedPath.startsWith("/api/v1/auth/forgot-password") ||
    normalizedPath.startsWith("/api/v1/auth/reset-password") ||
    normalizedPath.startsWith("/api/v1/public/")

  if (isPublicAuthRoute) {
    return ""
  }

  const isAdminApi = normalizedPath.startsWith("/api/v1/admin/")
  if (isAdminApi) {
    return localStorage.getItem("control_token") || ""
  }

  const pathname =
    typeof window !== "undefined" ? window.location.pathname || "" : ""
  const isControlPanelRoute =
    pathname.startsWith("/control-panel") || pathname.startsWith("/cp")

  if (isControlPanelRoute && normalizedPath) {
    return localStorage.getItem("access_token") || localStorage.getItem("token") || ""
  }

  if (isControlPanelRoute) {
    return localStorage.getItem("control_token") || ""
  }

  return localStorage.getItem("access_token") || localStorage.getItem("token") || ""
}

export function getToken(path?: string): string {
  return resolveTokenByPath(path)
}

export function setToken(token: string) {
  localStorage.setItem("access_token", token)
  localStorage.setItem("token", token)
}

export function clearErpToken() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("token")
}

export function clearControlToken() {
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
  const token = getToken(path)
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
    cache: "no-store",
  })

  if (options.raw) {
    return response as unknown as T
  }

  const contentType = response.headers.get("content-type") || ""
  const isJson = contentType.includes("application/json")
  const payload = isJson
    ? repairDeepStrings(await response.json().catch(() => ({})))
    : repairText(await response.text())

  if (!response.ok) {
    if (isJson && payload && typeof payload === "object") {
      throw new Error(repairText((payload as any).error || "Request failed"))
    }

    throw new Error(typeof payload === "string" ? repairText(payload) : "Request failed")
  }

  return payload as T
}

export default api
