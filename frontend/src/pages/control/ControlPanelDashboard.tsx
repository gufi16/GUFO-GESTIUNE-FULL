import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CreditCard,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react"
import { Link } from "react-router-dom"
import { api } from "../../lib/api"

type AdminClientItem = {
  id: string
  name: string
  slug: string
  status: "active" | "suspended" | "expired" | "inactive"
  createdAt: string
  usersCount: number
  locationsCount: number
  terminalsCount: number
  company: {
    id: string
    name: string
    cui?: string | null
    email?: string | null
    phone?: string | null
  } | null
  license: {
    id: string
    expiresAt: string
    isSuspended: boolean
    limits: {
      locations: number
      terminals: number
    }
    modules: Record<string, boolean>
  } | null
  subscription: {
    id: string
    status: string
    billingStatus: string
    billingCycle: string
    price: number
    currency: string
    nextBillingDate?: string | null
    plan?: {
      id: string
      code: string
      name: string
    } | null
  } | null
  activeModules: Array<{
    code: string
    name: string
    limitValue?: number | null
  }>
}

type AdminClientsResponse = {
  ok: boolean
  items: AdminClientItem[]
}

function formatDate(value?: string | null) {
  if (!value) return "—"

  return new Date(value).toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function statusBadge(status: AdminClientItem["status"]) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "suspended":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "expired":
      return "border-rose-200 bg-rose-50 text-rose-700"
    default:
      return "border-slate-200 bg-slate-50 text-slate-600"
  }
}

export default function ControlPanelDashboard() {
  const [items, setItems] = useState<AdminClientItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const data = await api<AdminClientsResponse>("/api/v1/admin/clients")
        if (!mounted) return
        setItems(data.items || [])
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || "Nu am putut încărca control panel-ul.")
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const metrics = useMemo(() => {
    const active = items.filter((item) => item.status === "active").length
    const suspended = items.filter((item) => item.status === "suspended").length
    const expired = items.filter((item) => item.status === "expired").length
    const mrr = items.reduce((sum, item) => sum + (item.subscription?.billingCycle === "MONTHLY" ? item.subscription.price : 0), 0)
    const locations = items.reduce((sum, item) => sum + item.locationsCount, 0)
    const terminals = items.reduce((sum, item) => sum + item.terminalsCount, 0)

    return { active, suspended, expired, mrr, locations, terminals }
  }, [items])

  const recentClients = useMemo(
    () => [...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6),
    [items]
  )

  const expiringClients = useMemo(
    () => items.filter((item) => item.license?.expiresAt).sort((a, b) => +new Date(a.license!.expiresAt) - +new Date(b.license!.expiresAt)).slice(0, 6),
    [items]
  )

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eef2ff_100%)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] md:p-8">
        <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">
              <Sparkles size={14} />
              gufo owner console
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              Controlezi clienți, licențe, activări și billing dintr-un singur loc.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
              Aici este nucleul comercial pentru GUFO Gestiune și Android POS. Vezi rapid cine este activ, ce module sunt vândute și unde ai risc de expirare.
            </p>
          </div>

          <div className="grid w-full max-w-xl grid-cols-2 gap-3 xl:w-[460px]">
            <div className="rounded-[26px] border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">clienți activi</div>
              <div className="mt-2 text-3xl font-semibold text-slate-950">{loading ? "…" : metrics.active}</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">MRR estimat</div>
              <div className="mt-2 text-3xl font-semibold text-slate-950">{loading ? "…" : `${metrics.mrr.toLocaleString("ro-RO")} RON`}</div>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Clienți activi", value: metrics.active, icon: Building2 },
          { label: "Suspendați", value: metrics.suspended, icon: AlertTriangle },
          { label: "Locații active", value: metrics.locations, icon: Store },
          { label: "Terminale POS", value: metrics.terminals, icon: ShieldCheck },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</div>
                <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{loading ? "…" : value}</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Icon size={20} />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">clienți recenți</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Ultimele conturi create</h2>
            </div>
            <Link
              to="/control-panel/clienti"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Vezi toți clienții
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="mt-6 space-y-3">
            {recentClients.length === 0 && !loading ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Nu există încă clienți creați în Control Panel.
              </div>
            ) : null}

            {recentClients.map((item) => (
              <div key={item.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-950">{item.company?.name || item.name}</h3>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadge(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {item.company?.cui || "fără CUI"} • creat la {formatDate(item.createdAt)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 sm:grid-cols-3 lg:min-w-[360px]">
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">utilizatori</div>
                    <div className="mt-1 font-semibold text-slate-900">{item.usersCount}</div>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">locații</div>
                    <div className="mt-1 font-semibold text-slate-900">{item.locationsCount}</div>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">plan</div>
                    <div className="mt-1 font-semibold text-slate-900">{item.subscription?.plan?.name || "neconfigurat"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">expirări apropiate</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Atenție la licențe</h2>

            <div className="mt-5 space-y-3">
              {expiringClients.length === 0 && !loading ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nicio licență înregistrată momentan.
                </div>
              ) : null}

              {expiringClients.map((item) => (
                <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{item.company?.name || item.name}</div>
                      <div className="mt-1 text-sm text-slate-500">Expiră la {formatDate(item.license?.expiresAt)}</div>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadge(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <CreditCard size={14} />
              roadmap imediat
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">Urmează billing și onboarding automat</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
              <div>• checkout website → Viva → client nou → licență activă</div>
              <div>• email automat cu acces GUFO Gestiune + pairing POS</div>
              <div>• suspendare automată dacă plata eșuează după grace period</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          <Activity size={14} />
          pulsul ecosistemului
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-sm text-slate-500">Licențe expirate</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{loading ? "…" : metrics.expired}</div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-sm text-slate-500">Billing lunar estimat</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{loading ? "…" : `${metrics.mrr.toLocaleString("ro-RO")} RON`}</div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-sm text-slate-500">Stare sistem</div>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Ready pentru integrare website + billing
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
