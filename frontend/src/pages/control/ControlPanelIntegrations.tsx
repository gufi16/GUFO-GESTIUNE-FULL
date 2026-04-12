import { useEffect, useState } from "react"
import { PlugZap, ShieldCheck } from "lucide-react"
import { api } from "../../lib/api"

type PlatformEFacturaResponse = {
  ok?: boolean
  item?: {
    efacturaOauthClientId?: string
    efacturaOauthClientSecret?: string
    efacturaOauthRedirectUri?: string
    efacturaEnvironment?: string
    configured?: boolean
  }
}

type FormState = {
  efacturaOauthClientId: string
  efacturaOauthClientSecret: string
  efacturaOauthRedirectUri: string
  efacturaEnvironment: string
}

const emptyForm: FormState = {
  efacturaOauthClientId: "",
  efacturaOauthClientSecret: "",
  efacturaOauthRedirectUri: "",
  efacturaEnvironment: "test",
}

export default function ControlPanelIntegrations() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const data = await api<PlatformEFacturaResponse>("/api/v1/admin/platform/efactura")
      setForm({
        efacturaOauthClientId: data?.item?.efacturaOauthClientId || "",
        efacturaOauthClientSecret: data?.item?.efacturaOauthClientSecret || "",
        efacturaOauthRedirectUri: data?.item?.efacturaOauthRedirectUri || "",
        efacturaEnvironment: data?.item?.efacturaEnvironment || "test",
      })
      setConfigured(Boolean(data?.item?.configured))
    } catch (err: any) {
      setError(err?.message || "Nu am putut încărca integrarea ANAF.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function save() {
    try {
      setSaving(true)
      setError(null)
      setMessage(null)
      const data = await api<PlatformEFacturaResponse>("/api/v1/admin/platform/efactura", {
        method: "POST",
        body: JSON.stringify(form),
      })
      setConfigured(Boolean(data?.item?.configured))
      setMessage("Setările au fost salvate.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva setările.")
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              <PlugZap size={14} />
              Integrări
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">ANAF e-Factura</h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Status: <span className="font-semibold text-slate-950">{configured ? "Configurat" : "Neconfigurat"}</span>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Mediu: <span className="font-semibold text-slate-950">{form.efacturaEnvironment === "prod" ? "Producție" : "Test"}</span>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <ShieldCheck size={14} />
            Configurare
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading || saving}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              Reîncarcă
            </button>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Se salvează..." : "Salvează"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-700">
            <span className="font-medium">Client ID</span>
            <input
              value={form.efacturaOauthClientId}
              onChange={(e) => update("efacturaOauthClientId", e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              placeholder="Client ID"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-700">
            <span className="font-medium">Client Secret</span>
            <input
              value={form.efacturaOauthClientSecret}
              onChange={(e) => update("efacturaOauthClientSecret", e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              placeholder="Client Secret"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-700 xl:col-span-2">
            <span className="font-medium">Redirect URI</span>
            <input
              value={form.efacturaOauthRedirectUri}
              onChange={(e) => update("efacturaOauthRedirectUri", e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              placeholder="https://api.gufo.ink/api/v1/company/efactura/oauth/callback"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-700">
            <span className="font-medium">Mediu</span>
            <select
              value={form.efacturaEnvironment}
              onChange={(e) => update("efacturaEnvironment", e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            >
              <option value="test">Test</option>
              <option value="prod">Producție</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  )
}
