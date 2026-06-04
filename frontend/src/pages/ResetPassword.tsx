import { FormEvent, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { api } from "../lib/api"

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => searchParams.get("token") || "", [searchParams])
  const requiresPasswordChange = useMemo(() => searchParams.get("required") === "1", [searchParams])
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!token) {
      setError("Linkul de resetare este invalid.")
      return
    }

    if (password.length < 6) {
      setError("Parola trebuie sa aiba cel putin 6 caractere.")
      return
    }

    if (password !== confirmPassword) {
      setError("Parolele nu coincid.")
      return
    }

    setLoading(true)
    try {
      const response = await api<{ ok: boolean; message?: string }>("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      })
      setMessage(response.message || "Parola a fost actualizata.")
      setTimeout(() => navigate("/login"), 1200)
    } catch (err: any) {
      setError(err?.message || "Nu am putut reseta parola.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Seteaza parola noua</h1>
        <p className="mt-1 text-sm text-neutral-600">Alege o parola noua pentru contul tau.</p>
        {requiresPasswordChange ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Contul tau foloseste o parola temporara. Inainte de continuare trebuie sa setezi una noua.
          </div>
        ) : null}

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-neutral-600">Parola noua</label>
            <input
              type="password"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-neutral-200"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Parola noua"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-600">Confirma parola</label>
            <input
              type="password"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-neutral-200"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirma parola"
            />
          </div>

          {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <button
            className="w-full px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium"
            type="submit"
            disabled={loading}
          >
            {loading ? "Se salveaza..." : "Actualizeaza parola"}
          </button>
        </form>

        <div className="mt-4 text-sm text-neutral-600">
          <Link to="/login" className="font-medium text-[#17324D] hover:underline">
            Inapoi la login
          </Link>
        </div>
      </div>
    </div>
  )
}
