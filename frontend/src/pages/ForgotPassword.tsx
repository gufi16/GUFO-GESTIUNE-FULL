import { FormEvent, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../lib/api"

export default function ForgotPassword() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const response = await api<{ ok: boolean; message?: string }>("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
      setMessage(response.message || "Daca exista un cont pe acest email, am trimis instructiunile.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut trimite resetarea parolei.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Resetare parola</h1>
        <p className="mt-1 text-sm text-neutral-600">Introdu emailul si iti trimitem linkul de resetare.</p>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-neutral-600">Email</label>
            <input
              className="mt-1 w-full px-3 py-2 rounded-xl border border-neutral-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="Email"
            />
          </div>

          {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <button
            className="w-full px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium"
            type="submit"
            disabled={loading}
          >
            {loading ? "Se trimite..." : "Trimite link de resetare"}
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
