import { api } from "./api"

type ControlLoginResponse = {
  ok: boolean
  access_token?: string
  token?: string
}

type ControlMeResponse = {
  ok: boolean
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

  localStorage.removeItem("access_token")
  localStorage.removeItem("token")
  localStorage.setItem("control_token", token)
  return data
}

export async function controlMe() {
  return await api<ControlMeResponse>("/api/v1/admin/me")
}

export function controlLogout() {
  localStorage.removeItem("control_token")
}
