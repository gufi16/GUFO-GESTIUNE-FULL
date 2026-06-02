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
import {
  formatAuditDateTime,
  getAuditActionLabel,
  getAuditActorLabel,
  getAuditArea,
  matchesAuditSearch,
} from "../lib/auditFormat"

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
  const filteredItems = useMemo(
    () => items.filter((item) => matchesAuditSearch(item, query)),
    [items, query],
  )

  return (
    <div className="space-y-3">
      <PageHeader
        badge="control"
        title="Istoric actiuni ERP"
        subtitle="Verifici rapid cine a lucrat in ERP, ce a schimbat si in ce zona, cu filtre simple pentru audit operational si urmarirea activitatii."
      />

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
        description="Foloseste cautarea si intervalul pentru a restrange rapid istoricul la utilizatorii, actiunile sau zonele care te intereseaza."
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
              placeholder="Cauta dupa nume, actiune sau zona"
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

      <DocumentSection title="Istoric activitate" description="Registrul de mai jos aduna evenimentele relevante din ERP si le afiseaza in ordinea in care au fost inregistrate.">
        <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-slate-200 bg-white text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">Utilizator</th>
                <th className="px-3 py-2">Ce a facut</th>
                <th className="px-3 py-2">Unde</th>
                <th className="px-3 py-2">Data si ora</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">Se incarca...</td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nu exista evenimente pentru filtrele alese.</td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{getAuditActorLabel(item)}</div>
                    </td>
                    <td className="px-3 py-3 font-medium text-[#17324D]">{getAuditActionLabel(item)}</td>
                    <td className="px-3 py-3 text-slate-700">{getAuditArea(item)}</td>
                    <td className="px-3 py-3 text-slate-500">{formatAuditDateTime(item.createdAt)}</td>
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
