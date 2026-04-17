import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { login } from "../lib/auth"

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await login(email, password)
      nav("/dashboard")
    } catch (error: any) {
      const message =
        typeof error?.message === "string" && error.message.trim()
          ? error.message
          : "Login esuat. Verifica emailul si parola."
      setErr(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#f4fbfc,_#eef3f8_48%,_#ffffff_100%)] p-6">
      <div className="card w-full max-w-md rounded-[28px] border border-slate-200/80 bg-white/95 p-7 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#ffffff_0%,#f5fbfb_55%,#eef7f8_100%)] shadow-[0_14px_32px_rgba(30,157,176,0.12)]">
            <img src="/gufo-logo.png?v=20260417-6" alt="Gufo" className="h-16 w-16 object-contain" />
          </div>
          <p className="mt-3 max-w-[270px] text-sm font-medium leading-6 text-neutral-500">
            A system behind every sound decision
          </p>
        </div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-neutral-600">Email</label>
            <input
              className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              placeholder="Email"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-600">Parola</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Parola"
            />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <button
            className="w-full rounded-xl bg-[#17324D] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1f466d]"
            type="submit"
            disabled={loading}
          >
            {loading ? "Se conecteaza..." : "Intra"}
          </button>
        </form>

        <div className="mt-4 text-sm text-neutral-600">
          <Link to="/forgot-password" className="font-medium text-[#17324D] hover:underline">
            Ai uitat parola?
          </Link>
        </div>
      </div>
    </div>
  )
}
