import { api, setToken, clearErpToken } from "./api"

type LoginResponse = {
  ok: boolean
  access_token?: string
  token?: string
}

type MeResponse = {
  ok: boolean
  tenant_id: string
  user_id: string
  role: string
  name?: string
  email?: string
  modules: string[]
  license: {
    expiresAt: string
    limits: {
      locations: number
      terminals: number
    }
  } | null
}

export async function login(email: string, password: string) {
  const hostname = typeof window !== "undefined" ? window.location.hostname || "" : ""
  const tenantSubdomain =
    hostname &&
    hostname.endsWith(".gufo.ink") &&
    hostname !== "app.gufo.ink" &&
    hostname !== "api.gufo.ink"
      ? hostname.split(".")[0]
      : undefined

  const data = await api<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, tenantSubdomain }),
  })

  const token = data.access_token || data.token

  if (!token) {
    throw new Error("Token lipsă în răspunsul de login")
  }

  setToken(token)
  return data
}

export async function me() {
  return await api<MeResponse>("/api/v1/me")
}

export function logout() {
  clearErpToken()
}
