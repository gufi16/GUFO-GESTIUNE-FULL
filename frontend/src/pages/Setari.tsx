import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Building2, Percent, RefreshCcw } from "lucide-react"

const API = "http://localhost:3001"

const items = [
  {
    name: "Firmă",
    desc: "Date companie, identificare fiscală și informații de bază.",
    route: "/setari/firma",
    icon: Building2
  },
  {
    name: "Cote TVA",
    desc: "Gestionare cote TVA și valori utilizate în documente.",
    route: "/setari/tva",
    icon: Percent
  }
]

const allowedIntervals = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]

export default function Setari() {
  const nav = useNavigate()

  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [posSyncInterval, setPosSyncInterval] = useState<number>(5)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadPosSyncConfig()
  }, [])

  async function loadPosSyncConfig() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      setLoadingConfig(false)
      return
    }

    setLoadingConfig(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/pos-sync-config`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut încărca setarea de sync POS.")
        return
      }

      setPosSyncInterval(Number(data.posSyncInterval || 5))
    } catch {
      setError("Nu am putut încărca setarea de sync POS.")
    } finally {
      setLoadingConfig(false)
    }
  }

  async function savePosSyncConfig() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setSavingConfig(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/pos-sync-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          posSyncInterval
        })
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva setarea de sync POS.")
        return
      }

      setMessage(`Intervalul de sync POS a fost salvat: ${data.posSyncInterval} minute.`)
    } catch {
      setError("Nu am putut salva setarea de sync POS.")
    } finally {
      setSavingConfig(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="configurare"
        title="Setări"
        subtitle="Configurări generale ale aplicației, sincronizare POS și administrarea elementelor de bază."
      />

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {items.map((i) => {
          const Icon = i.icon
          return (
            <button
              key={i.name}
              type="button"
              onClick={() => nav(i.route)}
              className="group rounded-[28px] border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon size={20} />
                </span>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  modul
                </span>
              </div>

              <div className="mt-5">
                <div className="text-lg font-semibold text-slate-900">{i.name}</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  {i.desc}
                </div>
              </div>

              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                Deschide
                <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
              </div>
            </button>
          )
        })}

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">Sync POS</div>
              <div className="mt-2 text-sm leading-6 text-slate-500">
                Setezi la ce interval să se sincronizeze automat Android POS cu gestiunea.
              </div>
            </div>

            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <RefreshCcw size={20} />
            </span>
          </div>

          <div className="mt-6">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Interval autosync POS
            </label>

            <select
              value={posSyncInterval}
              onChange={(e) => setPosSyncInterval(Number(e.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              disabled={loadingConfig || savingConfig}
            >
              {allowedIntervals.map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "minut" : "minute"}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              onClick={savePosSyncConfig}
              disabled={loadingConfig || savingConfig}
            >
              {savingConfig ? "Se salvează..." : "Salvează"}
            </button>

            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              onClick={loadPosSyncConfig}
              disabled={loadingConfig || savingConfig}
            >
              Reîncarcă
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
