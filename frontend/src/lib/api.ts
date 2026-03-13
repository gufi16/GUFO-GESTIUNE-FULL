const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function setToken(token: string) {
  localStorage.setItem("access_token", token);
}
export function getToken() {
  return localStorage.getItem("access_token");
}
export function clearToken() {
  localStorage.removeItem("access_token");
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(opts.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}