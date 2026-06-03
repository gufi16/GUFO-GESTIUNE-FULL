import { api, clearControlToken, setControlToken } from "./api"

type ControlLoginResponse = {
  ok: boolean
  access_token?: string
  token?: string
  csrf_token?: string
}

type ControlMeResponse = {
  ok: boolean
  access_token?: string
  csrf_token?: string
  user_id: string
  role: string
  email: string
}

export async function controlLogin(email: string, password: string) {
  const data = await api<ControlLoginResponse>("/api/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  })

  const token = data.access_token || data.token
  if (!token) {
    throw new Error("Token lipsa in raspunsul de login")
  }

  setControlToken(token)
  return data
}

export async function controlMe() {
  const data = await api<ControlMeResponse>("/api/v1/admin/me")
  if (data.access_token) {
    setControlToken(data.access_token)
  }
  return data
}

export async function controlLogout() {
  await api("/api/v1/admin/auth/logout", {
    method: "POST",
  }).catch(() => null)
  clearControlToken()
}
