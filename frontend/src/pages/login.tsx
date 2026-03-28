import { useState } from "react";
import { login } from "../lib/auth";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email, password);
      nav("/dashboard");
    } catch {
      setErr("Login eșuat. Verifică email/parolă.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Gufo ERP</h1>
        <p className="text-sm text-neutral-600 mt-1">Autentificare admin</p>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-neutral-600">Email</label>
            <input
              className="mt-1 w-full px-3 py-2 rounded-xl border border-neutral-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="Email"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-600">Parolă</label>
            <input
              type="password"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-neutral-200"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Parola"
            />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <button
            className="w-full px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium"
            type="submit"
            disabled={loading}
          >
            {loading ? "Se conectează..." : "Intră"}
          </button>
        </form>
      </div>
    </div>
  );
}
