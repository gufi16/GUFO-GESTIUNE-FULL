import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { API_BASE as API, authHeaders } from "../lib/api"
import { formatMoneyRo, formatQtyRo } from "../lib/format"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { getActiveTerminalId, subscribeToActiveTerminal } from "../lib/terminal"

type PosReceiptLine = {
  id: string
  sku: string
  name: string
  uom: string
  qty: number
  unitPrice: number
  vatRate: number
  total: number
  lineTotalBeforeDiscount?: number
  discountPercent?: number
  lineDiscountTotal?: number
  isSgr?: boolean
}

type PosReceipt = {
  id: string
  receiptNo?: string | null
  soldAt: string
  total: number
  subtotal?: number
  merchandiseSubtotal?: number
  sgrTotal?: number
  discountTotal?: number
  lineDiscountTotal?: number
  cartDiscountTotal?: number
  cartDiscountPercent?: number
  paymentType: string
  cashAmount: number
  cardAmount: number
  operatorName?: string | null
  location?: { name?: string | null } | null
  terminal?: { label?: string | null; deviceId?: string | null } | null
  lines: PosReceiptLine[]
}

type Props = {
  compact?: boolean
}

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function startIso(date: string) {
  return date
}

function endIso(date: string) {
  return date
}

function formatDateTime(value: string) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function paymentLabel(item: PosReceipt) {
  if (item.paymentType === "MIXED") return `Mixt: cash ${formatMoneyRo(item.cashAmount)} / card ${formatMoneyRo(item.cardAmount)}`
  if (item.paymentType === "CARD") return `Card ${formatMoneyRo(item.cardAmount || item.total)}`
  return `Cash ${formatMoneyRo(item.cashAmount || item.total)}`
}

function receiptTitle(item: PosReceipt) {
  return "Bon fiscal"
}

export default function PosReceiptsView({ compact = false }: Props) {
  const today = useMemo(() => toInputDate(new Date()), [])
  const [searchParams, setSearchParams] = useSearchParams()
  const dateFrom = searchParams.get("dateFrom") || today
  const dateTo = searchParams.get("dateTo") || today
  const [activeLocationId, setActiveLocationId] = useState(getActiveLocationId())
  const [activeTerminalId, setActiveTerminalId] = useState(getActiveTerminalId())
  const [items, setItems] = useState<PosReceipt[]>([])
  const [totals, setTotals] = useState({ total: 0, cash: 0, card: 0, count: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [page, setPage] = useState(1)

  const pageSize = compact ? 6 : 10

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  function updateDateRange(next: { dateFrom?: string; dateTo?: string }) {
    const nextParams = new URLSearchParams(searchParams)
    if (typeof next.dateFrom === "string") nextParams.set("dateFrom", next.dateFrom)
    if (typeof next.dateTo === "string") nextParams.set("dateTo", next.dateTo)
    setSearchParams(nextParams, { replace: true })
  }

  async function loadReceipts() {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        dateFrom: startIso(dateFrom),
        dateTo: endIso(dateTo),
      })
      if (activeLocationId) params.set("locationId", activeLocationId)
      if (activeTerminalId) params.set("terminalId", activeTerminalId)
      const res = await fetch(`${API}/api/v1/finance/pos-receipts?${params.toString()}`, {
        headers: authHeaders(),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Nu am putut incarca bonurile POS.")
      }
      setItems(Array.isArray(data.items) ? data.items : [])
      setTotals(data.totals || { total: 0, cash: 0, card: 0, count: 0 })
      setPage(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca bonurile POS.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setActiveLocationId(nextLocationId)
    })
  }, [])

  useEffect(() => {
    return subscribeToActiveTerminal((nextTerminalId) => {
      setActiveTerminalId(nextTerminalId)
    })
  }, [])

  useEffect(() => {
    void loadReceipts()
  }, [dateFrom, dateTo, activeLocationId, activeTerminalId])

  return (
    <div className={compact ? "space-y-4" : "rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Bonuri emise in Android POS</div>
          <div className="mt-1 text-sm text-slate-500">
            Vezi produsele vandute, metoda de plata si totalurile pe interval.
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            De la
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => updateDateRange({ dateFrom: event.target.value })}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Pana la
            <input
              type="date"
              value={dateTo}
              onChange={(event) => updateDateRange({ dateTo: event.target.value })}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadReceipts()}
            className="rounded-xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244A7C]"
          >
            Cauta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Bonuri</div>
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

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Se incarca bonurile...</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">Nu exista bonuri POS in intervalul selectat.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            <div className={compact ? "max-h-[55vh] overflow-y-auto" : "max-h-[70vh] overflow-y-auto"}>
            {pagedItems.map((item) => (
              <details key={item.id} className="group bg-white">
                <summary className="grid cursor-pointer grid-cols-1 gap-2 px-4 py-3 text-sm transition hover:bg-slate-50 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-900">{receiptTitle(item)}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(item.soldAt)}</div>
                    {Number(item.discountTotal || 0) > 0 ? (
                      <div className="mt-1 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                        Discount -{formatMoneyRo(Number(item.discountTotal || 0))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-slate-600">
                    {item.location?.name || "Locatie"} / {item.terminal?.label || "Terminal"}
                  </div>
                  <div className="font-medium text-slate-700">{paymentLabel(item)}</div>
                  <div className="text-right text-base font-bold text-slate-900">{formatMoneyRo(item.total)}</div>
                </summary>

                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  {(Number(item.discountTotal || 0) > 0 || Number(item.sgrTotal || 0) > 0) ? (
                    <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
                      {Number(item.discountTotal || 0) > 0 ? (
                        <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-700">
                          Discount: -{formatMoneyRo(Number(item.discountTotal || 0))}
                        </span>
                      ) : null}
                      {Number(item.sgrTotal || 0) > 0 ? (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                          SGR: {formatMoneyRo(Number(item.sgrTotal || 0))}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase tracking-[0.14em] text-slate-400">
                        <tr>
                          <th className="px-2 py-2 text-left">Cod</th>
                          <th className="px-2 py-2 text-left">Produs</th>
                          <th className="px-2 py-2 text-right">Cantitate</th>
                          <th className="px-2 py-2 text-right">Pret</th>
                          <th className="px-2 py-2 text-right">TVA</th>
                          <th className="px-2 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {item.lines.map((line) => (
                          <tr key={line.id}>
                            <td className="px-2 py-2 text-slate-500">{line.sku || "-"}</td>
                            <td className="px-2 py-2 font-medium text-slate-800">
                              <div>{line.name}</div>
                              {Number(line.lineDiscountTotal || 0) > 0 ? (
                                <div className="mt-0.5 text-xs font-semibold text-violet-700">
                                  Discount {formatQtyRo(Number(line.discountPercent || 0))}%: -{formatMoneyRo(Number(line.lineDiscountTotal || 0))}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 text-right text-slate-600">
                              {formatQtyRo(line.qty)} {line.uom}
                            </td>
                            <td className="px-2 py-2 text-right text-slate-600">{formatMoneyRo(line.unitPrice)}</td>
                            <td className="px-2 py-2 text-right text-slate-600">{line.vatRate}%</td>
                            <td className="px-2 py-2 text-right font-semibold text-slate-900">{formatMoneyRo(line.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                Pagina {page} din {totalPages} · afisate {pagedItems.length} din {items.length} bonuri
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Inapoi
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Urmator
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
