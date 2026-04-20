import { useEffect, useMemo, useState } from "react"
import { API_BASE as API, authHeaders } from "../lib/api"
import { formatMoneyRo, formatQtyRo } from "../lib/format"

type PosReceiptLine = {
  id: string
  sku: string
  name: string
  uom: string
  qty: number
  unitPrice: number
  vatRate: number
  total: number
  isSgr?: boolean
}

type PosReceipt = {
  id: string
  receiptNo: string
  soldAt: string
  total: number
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

function paymentLabel(item: PosReceipt) {
  if (item.paymentType === "MIXED") return `Mixt: cash ${formatMoneyRo(item.cashAmount)} / card ${formatMoneyRo(item.cardAmount)}`
  if (item.paymentType === "CARD") return `Card ${formatMoneyRo(item.cardAmount || item.total)}`
  return `Cash ${formatMoneyRo(item.cashAmount || item.total)}`
}

export default function PosReceiptsView({ compact = false }: Props) {
  const today = useMemo(() => toInputDate(new Date()), [])
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [items, setItems] = useState<PosReceipt[]>([])
  const [totals, setTotals] = useState({ total: 0, cash: 0, card: 0, count: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function loadReceipts() {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        dateFrom: startIso(dateFrom),
        dateTo: endIso(dateTo),
      })
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca bonurile POS.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReceipts()
  }, [])

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
            {items.map((item) => (
              <details key={item.id} className="group bg-white">
                <summary className="grid cursor-pointer grid-cols-1 gap-2 px-4 py-3 text-sm transition hover:bg-slate-50 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-900">{item.receiptNo}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(item.soldAt)}</div>
                  </div>
                  <div className="text-slate-600">
                    {item.location?.name || "Locatie"} / {item.terminal?.label || item.terminal?.deviceId || "Terminal"}
                  </div>
                  <div className="font-medium text-slate-700">{paymentLabel(item)}</div>
                  <div className="text-right text-base font-bold text-slate-900">{formatMoneyRo(item.total)}</div>
                </summary>

                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
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
                            <td className="px-2 py-2 font-medium text-slate-800">{line.name}</td>
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
        )}
      </div>
    </div>
  )
}
