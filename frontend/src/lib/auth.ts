import { api, clearErpToken, setToken } from "./api"

type CompanyChoice = {
  id: string
  name: string
  code?: string | null
  cui?: string | null
  isDefault?: boolean
}

type LoginResponse = {
  ok: boolean
  access_token?: string
  token?: string
  active_company_id?: string | null
  requires_company_selection?: boolean
  companies?: CompanyChoice[]
}

type MeResponse = {
  ok: boolean
  tenant_id: string
  user_id: string
  role: string
  name?: string
  email?: string
  active_company_id?: string | null
  requires_company_selection?: boolean
  companies?: CompanyChoice[]
  modules: string[]
  license: {
    expiresAt: string
    limits: {
      locations: number
      terminals: number
    }
  } | null
}

type SelectCompanyResponse = {
  ok: boolean
  access_token?: string
  active_company_id?: string | null
  company?: CompanyChoice
}

export async function login(email: string, password: string) {
  const hostname = typeof window !== "undefined" ? window.location.hostname || "" : ""
  const tenantSubdomain =
    hostname &&
    hostname.endsWith(".gufo.ink") &&
    hostname !== "app.gufo.ink" &&
    hostname !== "test.gufo.ink" &&
    hostname !== "api.gufo.ink"
      ? hostname.split(".")[0]
      : undefined

  const data = await api<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, tenantSubdomain }),
  })

  const token = data.access_token || data.token

  if (!token) {
    throw new Error("Token lipsa in raspunsul de login")
  }

  setToken(token)
  if (data.active_company_id) localStorage.setItem("active_company_id", data.active_company_id)
  else localStorage.removeItem("active_company_id")

  return data
}

export async function me() {
  return await api<MeResponse>("/api/v1/me")
}

export async function selectCompany(companyId: string) {
  const data = await api<SelectCompanyResponse>("/api/v1/auth/select-company", {
    method: "POST",
    body: JSON.stringify({ companyId }),
  })

  const token = data.access_token
  if (!token) {
    throw new Error("Token lipsa in raspunsul pentru selectia firmei")
  }

  setToken(token)
  if (data.active_company_id) localStorage.setItem("active_company_id", data.active_company_id)
  else localStorage.removeItem("active_company_id")

  return data
}

export function logout() {
  localStorage.removeItem("active_company_id")
  clearErpToken()
}
