import { useEffect, useMemo, useState } from "react"
import { API_BASE as API, authHeaders } from "../lib/api"
import { formatMoneyRo } from "../lib/format"

type DailyClosure = {
  id: string
  reportType: string
  reportNo?: string | null
  closedAt: string
  total: number
  cashTotal: number
  cardTotal: number
  otherTotal: number
  locationName?: string | null
  terminalLabel?: string | null
  deviceId?: string | null
  reportText?: string | null
}

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function startIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString()
}

function endIso(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString()
}

function formatDateTime(value: string) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

export default function PosClosuresView() {
  const today = useMemo(() => toInputDate(new Date()), [])
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [items, setItems] = useState<DailyClosure[]>([])
  const [totals, setTotals] = useState({ total: 0, cash: 0, card: 0, other: 0, count: 0 })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  async function loadClosures() {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        dateFrom: startIso(dateFrom),
        dateTo: endIso(dateTo),
      })
      const res = await fetch(`${API}/api/v1/finance/daily-closures?${params.toString()}`, {
        headers: authHeaders(),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Nu am putut incarca inchiderile zilnice.")
      }
      setItems(Array.isArray(data.items) ? data.items : [])
      setTotals(data.totals || { total: 0, cash: 0, card: 0, other: 0, count: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca inchiderile zilnice.")
    } finally {
      setLoading(false)
    }
  }

  async function generateFromSales() {
    setGenerating(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch(`${API}/api/v1/finance/daily-closures/generate-from-sales`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          dateFrom: startIso(dateFrom),
          dateTo: endIso(dateTo),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Nu am putut genera inchiderea zilnica.")
      }
      setSuccess(data?.created ? "Inchiderea zilnica a fost generata din vanzarile POS." : "Inchiderea zilnica a fost actualizata din vanzarile POS.")
      await loadClosures()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut genera inchiderea zilnica.")
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    void loadClosures()
  }, [])

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Inchideri zilnice POS</div>
          <div className="mt-1 text-sm text-slate-500">
            Aici apar rapoartele Z trimise din Android POS dupa inchiderea zilei fiscale.
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            De la
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Pana la
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadClosures()}
            className="rounded-xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244A7C]"
          >
            Cauta
          </button>
          <button
            type="button"
            onClick={() => void generateFromSales()}
            disabled={generating}
            className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? "Se genereaza..." : "Genereaza din vanzari"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Rapoarte Z</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{totals.count || items.length}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{formatMoneyRo(totals.total)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Cash</div>
          <div className="mt-1 text-xl font-bold text-emerald-700">{formatMoneyRo(totals.cash)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Card</div>
          <div className="mt-1 text-xl font-bold text-blue-700">{formatMoneyRo(totals.card)}</div>
        </div>
      </div>

      {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Se incarca inchiderile...</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">Nu exista rapoarte Z in intervalul selectat.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((item) => (
              <details key={item.id} className="group bg-white">
                <summary className="grid cursor-pointer grid-cols-1 gap-2 px-4 py-3 text-sm transition hover:bg-slate-50 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Raport {item.reportType || "Z"} {item.reportNo ? `#${item.reportNo}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(item.closedAt)}</div>
                  </div>
                  <div className="text-slate-600">
                    {item.locationName || "Locatie"} / {item.terminalLabel || item.deviceId || "Terminal"}
                  </div>
                  <div className="text-slate-700">
                    Cash {formatMoneyRo(item.cashTotal)} / Card {formatMoneyRo(item.cardTotal)}
                  </div>
                  <div className="text-right text-base font-bold text-slate-900">{formatMoneyRo(item.total)}</div>
                </summary>

                {item.reportText ? (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                    {item.reportText}
                  </pre>
                ) : (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                    Raportul Z a fost salvat fara text detaliat de la casa.
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
