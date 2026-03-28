import { useState } from "react"
import { useNavigate } from "react-router-dom"

export default function ControlPanelLogin() {
  const nav = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState("")

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (email === "dev@gufo.ro" && password === "gufo1234") {
      localStorage.setItem("control_token", "DEV_CONTROL_PANEL_TOKEN")
      nav("/control-panel/clienti", { replace: true })
      return
    }

    setErr("Login invalid")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
          gufo control panel
        </div>

        <h1 className="mt-3 text-2xl font-semibold text-slate-950">
          Login developer
        </h1>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-slate-600">Email</label>
            <input
              className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dev@gufo.ro"
            />
          </div>

          <div>
            <label className="text-xs text-slate-600">Parolă</label>
            <input
              type="password"
              className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="gufo1234"
            />
          </div>

          {err ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {err}
            </div>
          ) : null}

          <button
            className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
            type="submit"
          >
            Intră în Control Panel
          </button>
        </form>
      </div>
    </div>
  )
}