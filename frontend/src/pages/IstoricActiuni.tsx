import { useEffect, useMemo, useState } from "react"
import { Filter, RefreshCw, Search } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { api } from "../lib/api"
import { me } from "../lib/auth"

type AuditLogItem = {
  id: string
  actorType?: string
  actorId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  actorRole?: string | null
  action: string
  entityType: string
  entityId?: string | null
  payload?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
}

type MeResponse = {
  role?: string
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatAction(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/^./, (char) => char.toUpperCase())
}

export default function IstoricActiuni() {
  const [items, setItems] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [role, setRole] = useState("")

  async function load() {
    setLoading(true)
    setError("")

    try {
      const profile = (await me()) as MeResponse
      setRole(profile?.role || "")

      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString())
      if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59.999`).toISOString())
      params.set("limit", "150")

      const data = await api<{ ok: boolean; items?: AuditLogItem[] }>(`/api/v1/audit-logs?${params.toString()}`)
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca istoricul de actiuni.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const summary = useMemo(
    () => ({
      total: items.length,
      users: new Set(items.map((item) => item.actorId).filter(Boolean)).size,
      today: items.filter((item) => {
        const now = new Date()
        const date = new Date(item.createdAt)
        return (
          date.getDate() === now.getDate() &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        )
      }).length,
    }),
    [items],
  )

  const canView = role === "OWNER" || role === "ADMIN"

  return (
    <div className="space-y-3">
      <PageHeader badge="control" title="Istoric actiuni ERP" />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Evenimente" value={summary.total} tone="slate" />
        <DocumentMetric title="Utilizatori" value={summary.users} tone="blue" />
        <DocumentMetric title="Astazi" value={summary.today} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!loading && !canView ? (
        <InlineNotice tone="error">Doar owner-ul sau administratorul pot vedea istoricul actiunilor.</InlineNotice>
      ) : null}

      <DocumentSection
        title="Filtre"
        actions={
          <button className={documentButtonSecondaryClass} onClick={load} disabled={loading}>
            <RefreshCw size={16} className="mr-2" />
            Reincarca
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px_130px]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={`${documentInputClass} pl-10`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cauta actiune sau entitate"
            />
          </div>

          <input className={documentInputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className={documentInputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />

          <button className={documentButtonSecondaryClass} onClick={load} disabled={loading}>
            <Filter size={16} className="mr-2" />
            Filtreaza
          </button>
        </div>
      </DocumentSection>

      <DocumentSection title="Istoric">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">Utilizator</th>
                <th className="px-3 py-2">Actiune</th>
                <th className="px-3 py-2">Entitate</th>
                <th className="px-3 py-2">Detalii</th>
                <th className="px-3 py-2">Moment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">Se incarca...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nu exista inca evenimente.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">
                        {item.actorName || item.actorEmail || (item.actorType === "SYSTEM" ? "Sistem" : "Utilizator")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[item.actorRole, item.ipAddress].filter(Boolean).join(" | ") || item.actorType || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium text-[#17324D]">{formatAction(item.action)}</td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{item.entityType}</div>
                      <div className="text-xs text-slate-500">{item.entityId || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      {item.payload ? (
                        <pre className="max-w-[420px] overflow-x-auto rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DocumentSection>
    </div>
  )
}
