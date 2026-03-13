import { api, setToken, clearToken } from "./api";

export type MeResponse = {
  ok: boolean;
  tenant_id: string;
  user_id: string;
  role: string;
  modules: string[];
  license: any;
};

type LoginResponse = {
  ok: boolean;
  access_token: string;
};

export async function login(email: string, password: string) {
  const r = await api<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  setToken(r.access_token);

  const meData = await api<MeResponse>("/api/v1/me");

  localStorage.setItem("tenant_id", meData.tenant_id);
  localStorage.setItem("user_id", meData.user_id);
  localStorage.setItem("role", meData.role);
  localStorage.setItem("modules", JSON.stringify(meData.modules || []));

  return {
    ...r,
    me: meData,
  };
}

export async function me() {
  return api<MeResponse>("/api/v1/me");
}

export function logout() {
  clearToken();
  localStorage.removeItem("tenant_id");
  localStorage.removeItem("user_id");
  localStorage.removeItem("role");
  localStorage.removeItem("modules");
}