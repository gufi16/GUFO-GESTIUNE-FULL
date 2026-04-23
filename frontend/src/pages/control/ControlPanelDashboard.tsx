import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Building2, CreditCard, ShieldCheck, Store } from "lucide-react"
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
}

type AdminClientsResponse = {
  ok: boolean
  items: AdminClientItem[]
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO", {
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

function statusLabel(status: AdminClientItem["status"]) {
  switch (status) {
    case "active":
      return "Activ"
    case "suspended":
      return "Suspendat"
    case "expired":
      return "Expirat"
    default:
      return "Inactiv"
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
        setItems(Array.isArray(data?.items) ? data.items : [])
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || "Nu am putut incarca dashboardul.")
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
    const mrr = items.reduce(
      (sum, item) => sum + (item.subscription?.billingCycle === "MONTHLY" ? item.subscription.price : 0),
      0
    )
    const locations = items.reduce((sum, item) => sum + item.locationsCount, 0)
    const terminals = items.reduce((sum, item) => sum + item.terminalsCount, 0)

    return { active, suspended, expired, mrr, locations, terminals }
  }, [items])

  const recentClients = useMemo(
    () => [...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 5),
    [items]
  )

  const expiringClients = useMemo(
    () =>
      items
        .filter((item) => item.license?.expiresAt)
        .sort((a, b) => +new Date(a.license!.expiresAt) - +new Date(b.license!.expiresAt))
        .slice(0, 5),
    [items]
  )

  const cards = [
    { label: "Clienti activi", value: metrics.active, icon: Building2 },
    { label: "Suspendati", value: metrics.suspended, icon: AlertTriangle },
    { label: "Locatii", value: metrics.locations, icon: Store },
    { label: "POS", value: metrics.terminals, icon: ShieldCheck },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Control Panel</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Rezumat</h1>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
                  <Icon size={16} className="text-slate-400" />
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{loading ? "…" : value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Clienti recenti</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Ultimele conturi</h2>
            </div>
            <Link
              to="/control-panel/clienti"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Clienti
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {recentClients.length === 0 && !loading ? (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Nu exista clienti.
              </div>
            ) : null}

            {recentClients.map((item) => (
              <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-slate-950">{item.company?.name || item.name}</div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadge(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {item.company?.cui || "-"} • {formatDate(item.createdAt)}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-2xl bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Useri</div>
                      <div className="mt-1 font-semibold text-slate-900">{item.usersCount}</div>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Locatii</div>
                      <div className="mt-1 font-semibold text-slate-900">{item.locationsCount}</div>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Plan</div>
                      <div className="mt-1 font-semibold text-slate-900">{item.subscription?.plan?.name || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Licente</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Expirari</h2>

            <div className="mt-5 space-y-3">
              {expiringClients.length === 0 && !loading ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nu exista expirari apropiate.
                </div>
              ) : null}

              {expiringClients.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{item.company?.name || item.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatDate(item.license?.expiresAt)}</div>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadge(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <CreditCard size={14} />
              Financiar
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm text-slate-500">MRR</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">
                  {loading ? "…" : `${metrics.mrr.toLocaleString("ro-RO")} RON`}
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm text-slate-500">Expirate</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{loading ? "…" : metrics.expired}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
