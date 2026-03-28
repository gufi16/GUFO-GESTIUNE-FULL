import {
  AlertTriangle,
  ArrowRightLeft,
  CircleDollarSign,
  CreditCard,
  FileText,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
  PackageSearch,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import QuickActions from "../components/QuickActions"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { formatMoneyRo, formatQtyRo } from "../lib/format"


type GlobalStockItem = {
  productId?: string
  id?: string
  name?: string
  sku?: string
  uom?: string
  totalQty?: number
  qty?: number
}

type SalesPoint = {
  date: string
  label: string
  value: number
}

type DashboardApiResponse = {
  ok?: boolean
  sales?: number
  receipts?: number
  avgReceipt?: number
  cash?: number
  card?: number
  salesPerDay?: Array<{
    day: string
    total: number | string
  }>
  topProducts?: Array<{
    name: string
    qty: number | string
    profit?: number | string
  }>
  lowStock?: Array<{
    product: string
    location: string
    qty: number
  }>
}

type LowStockItem = {
  product: string
  location: string
  qty: number
}

type TopProductItem = {
  name: string
  qty: number
  profit: number
}

type MeResponse = {
  ok?: boolean
  tenant_id?: string
  user_id?: string
  role?: string
  modules?: string[]
}

const recentDocs = [
  { icon: Receipt, title: "Recepție NIR #000128", meta: "Furnizor Aqua Distribution • acum 18 minute" },
  { icon: ArrowRightLeft, title: "Transfer către locația Central", meta: "42 produse mutate • acum 43 minute" },
  { icon: FileText, title: "Sincronizare POS finalizată", meta: "4 terminale actualizate • acum 1 oră" },
]

function formatRon(value: number) {
  return formatMoneyRo(value, "RON")
}

function toInputDate(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toChartLabel(dateString: string) {
  if (!dateString) return "-"
  const raw = dateString.slice(0, 10)
  const parts = raw.split("-")
  if (parts.length !== 3) return raw
  return `${parts[2]}.${parts[1]}`
}

function normalizeSalesPerDay(data: DashboardApiResponse["salesPerDay"]): SalesPoint[] {
  if (!Array.isArray(data)) return []

  return data.map((item) => {
    const rawDate = String(item.day || "").slice(0, 10)
    return {
      date: rawDate,
      label: toChartLabel(rawDate),
      value: Number(item.total || 0),
    }
  })
}

async function getTenantIdFromSession(token: string): Promise<string> {
  const storedTenantId =
    localStorage.getItem("tenant_id") ||
    localStorage.getItem("tenantId") ||
    ""

  if (storedTenantId) {
    return storedTenantId
  }

  const res = await fetch(`${API}/api/v1/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const data: MeResponse = await res.json().catch(() => ({}))

  if (!res.ok || !data?.ok || !data?.tenant_id) {
    throw new Error("Nu am putut determina tenant-ul din sesiunea curentă.")
  }

  localStorage.setItem("tenant_id", data.tenant_id)

  if (data.user_id) localStorage.setItem("user_id", data.user_id)
  if (data.role) localStorage.setItem("role", data.role)
  if (Array.isArray(data.modules)) {
    localStorage.setItem("modules", JSON.stringify(data.modules))
  }

  return data.tenant_id
}

function SalesChart({
  data,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onReset,
}: {
  data: SalesPoint[]
  dateFrom: string
  dateTo: string
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onReset: () => void
}) {
  const width = 760
  const height = 250
  const padding = 28
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0
  const [hoveredIndex, setHoveredIndex] = useState<number>(data.length ? data.length - 1 : 0)

  const points = data.map((d, i) => {
    const x = padding + i * stepX
    const y = height - padding - (d.value / maxValue) * (height - padding * 2)
    return { ...d, x, y }
  })

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ")
  const areaPoints = `${padding},${height - padding} ${linePoints} ${width - padding},${height - padding}`
  const hovered = points[Math.min(hoveredIndex, Math.max(points.length - 1, 0))]

  return (
    <div className="rounded-[18px] border border-[#E8E3DA] bg-white p-3.5 shadow-sm shadow-[#17324D]/[0.04]">
      <div className="mb-2.5 flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Vânzări pe interval</div>
          <div className="mt-1 text-sm text-slate-500">
            Grafic compact cu filtrare rapidă și focus pe evoluția zilnică.
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              De la
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="h-9 rounded-xl border border-[#E8E3DA] bg-[#FCFBF8] px-3 text-sm text-[#17324D] outline-none transition focus:border-[#F39C12] focus:bg-white focus:ring-2 focus:ring-[#FFF1D6]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Până la
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="h-9 rounded-xl border border-[#E8E3DA] bg-[#FCFBF8] px-3 text-sm text-[#17324D] outline-none transition focus:border-[#F39C12] focus:bg-white focus:ring-2 focus:ring-[#FFF1D6]"
            />
          </div>

          <button
            type="button"
            onClick={onReset}
            className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-[#B66A00] transition hover:bg-white"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B66A00]">
          {hovered ? hovered.label : "-"}
        </div>
        <div className="mt-1 text-xl font-semibold text-slate-900">
          {hovered ? formatRon(hovered.value) : "—"}
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {hovered ? `Vânzări înregistrate la data de ${hovered.date}` : "Nu există puncte în intervalul ales."}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] min-w-[640px] w-full">
          <defs>
            <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#F39C12" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#F39C12" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3].map((line) => {
            const y = padding + ((height - padding * 2) / 3) * line
            return (
              <line
                key={line}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
            )
          })}

          {points.length > 1 ? <polygon points={areaPoints} fill="url(#salesFill)" /> : null}
          {points.length > 1 ? (
            <polyline
              points={linePoints}
              fill="none"
              stroke="#F39C12"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {points.map((point, index) => (
            <g
              key={point.date}
              onMouseEnter={() => setHoveredIndex(index)}
              onClick={() => setHoveredIndex(index)}
              style={{ cursor: "pointer" }}
            >
              {hoveredIndex === index ? (
                <circle cx={point.x} cy={point.y} r="14" fill="#F39C12" opacity="0.18" />
              ) : null}
              <circle cx={point.x} cy={point.y} r={hoveredIndex === index ? "6.5" : "5"} fill="#F39C12" />
              <text x={point.x} y={height - 4} textAnchor="middle" fontSize="12" fill="#64748b">
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  title: string
  value: string
  hint: string
  tone: "blue" | "slate" | "amber" | "blue-soft" | "emerald"
  icon: any
}) {
  return (
    <div className="rounded-[16px] border border-[#E8E3DA] bg-white p-3 shadow-sm shadow-[#17324D]/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-1.5 break-words text-[22px] font-semibold tracking-tight text-slate-900">{value}</div>
          <div className="mt-1 text-[12px] text-slate-500">{hint}</div>
        </div>

        <span
          className={[
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]",
            tone === "blue" && "bg-[#17324D] text-white",
            tone === "slate" && "bg-[#17324D] text-white",
            tone === "amber" && "bg-[#F39C12] text-white",
            tone === "blue-soft" && "bg-slate-100 text-slate-700",
            tone === "emerald" && "bg-emerald-500 text-white",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Icon size={20} />
        </span>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[18px] border border-[#E8E3DA] bg-white p-3.5 shadow-sm shadow-[#17324D]/[0.04]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[13px] text-slate-500">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const token =
    getToken() || ""

  const today = new Date()
  const defaultDateTo = toInputDate(today)
  const defaultDateFrom = toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))

  const [criticalStock, setCriticalStock] = useState<GlobalStockItem[]>([])
  const [criticalLoading, setCriticalLoading] = useState(true)

  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)

  const [salesSeries, setSalesSeries] = useState<SalesPoint[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState("")

  const [salesTotal, setSalesTotal] = useState(0)
  const [receiptsCount, setReceiptsCount] = useState(0)
  const [avgReceipt, setAvgReceipt] = useState(0)
  const [cashTotal, setCashTotal] = useState(0)
  const [cardTotal, setCardTotal] = useState(0)
  const [topProducts, setTopProducts] = useState<TopProductItem[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [activeLocationId, setActiveLocationId] = useState(getActiveLocationId())

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setActiveLocationId(nextLocationId)
    })
  }, [])

  useEffect(() => {
    loadCriticalStock(activeLocationId)
  }, [activeLocationId])

  useEffect(() => {
    loadDashboard(activeLocationId)
  }, [dateFrom, dateTo, activeLocationId])

  async function loadCriticalStock(selectedLocationId: string) {
    if (!token) {
      setCriticalLoading(false)
      return
    }

    setCriticalLoading(true)

    try {
      const endpoint = selectedLocationId
        ? `${API}/api/v1/stock/by-location?locationId=${encodeURIComponent(selectedLocationId)}`
        : `${API}/api/v1/stock/global`

      const res = await fetch(endpoint, {
        headers: authHeaders(),
      })

      const data = await res.json().catch(() => ({}))
      const items = Array.isArray(data.items) ? data.items : []

      const sorted = [...items]
        .filter((item) => Number(selectedLocationId ? item.qty : item.totalQty || 0) >= 0)
        .sort((a, b) => Number(selectedLocationId ? a.qty : a.totalQty || 0) - Number(selectedLocationId ? b.qty : b.totalQty || 0))
        .slice(0, 6)

      setCriticalStock(sorted)
    } catch {
      setCriticalStock([])
    } finally {
      setCriticalLoading(false)
    }
  }

  async function loadDashboard(selectedLocationId: string) {
    if (!token) {
      setDashboardLoading(false)
      setDashboardError("Lipsește token-ul pentru dashboard.")
      return
    }

    setDashboardLoading(true)
    setDashboardError("")

    try {
      const tenantId = await getTenantIdFromSession(token)

      const params = new URLSearchParams()
      if (dateFrom) params.set("dateFrom", `${dateFrom}T00:00:00.000Z`)
      if (dateTo) params.set("dateTo", `${dateTo}T23:59:59.999Z`)
      if (selectedLocationId) params.set("locationId", selectedLocationId)

      const res = await fetch(`${API}/api/v1/dashboard?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-tenant-id": tenantId,
        },
      })

      const data: DashboardApiResponse = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        throw new Error("Nu s-au putut încărca datele dashboard.")
      }

      const normalizedSeries = normalizeSalesPerDay(data.salesPerDay)

      setSalesSeries(normalizedSeries)
      setSalesTotal(Number(data.sales || 0))
      setReceiptsCount(Number(data.receipts || 0))
      setAvgReceipt(Number(data.avgReceipt || 0))
      setCashTotal(Number(data.cash || 0))
      setCardTotal(Number(data.card || 0))
      setTopProducts(
        Array.isArray(data.topProducts)
          ? data.topProducts.map((item) => ({
              name: item.name,
              qty: Number(item.qty || 0),
              profit: Number(item.profit || 0),
            }))
          : []
      )
      setLowStock(Array.isArray(data.lowStock) ? data.lowStock : [])
    } catch (error) {
      console.error("Dashboard load failed", error)
      setDashboardError("Nu am putut încărca dashboard-ul real din backend.")
      setSalesSeries([])
      setSalesTotal(0)
      setReceiptsCount(0)
      setAvgReceipt(0)
      setCashTotal(0)
      setCardTotal(0)
      setTopProducts([])
      setLowStock([])
    } finally {
      setDashboardLoading(false)
    }
  }

  const filteredSales = useMemo(() => {
    const from = dateFrom || "0000-01-01"
    const to = dateTo || "9999-12-31"
    return salesSeries.filter((item) => item.date >= from && item.date <= to)
  }, [dateFrom, dateTo, salesSeries])

  const safeSales = filteredSales.length ? filteredSales : [{ date: "0000-00-00", label: "-", value: 0 }]

  const bestDay = useMemo(() => {
    if (!filteredSales.length) return "-"
    const top = [...filteredSales].sort((a, b) => b.value - a.value)[0]
    return `${top.label} • ${formatRon(top.value)}`
  }, [filteredSales])

  const criticalStockCount = lowStock.length || criticalStock.length
  const paymentTotal = cashTotal + cardTotal
  const cashShare = paymentTotal > 0 ? (cashTotal / paymentTotal) * 100 : 0
  const cardShare = paymentTotal > 0 ? (cardTotal / paymentTotal) * 100 : 0
  const totalTopProfit = topProducts.reduce((acc, item) => acc + item.profit, 0)

  const stats = [
    {
      title: "Vânzări interval",
      value: formatRon(salesTotal),
      hint: `${filteredSales.length} zile selectate`,
      icon: CircleDollarSign,
      tone: "blue" as const,
    },
    {
      title: "Bonuri",
      value: receiptsCount.toString(),
      hint: `Medie bon ${formatRon(avgReceipt)}`,
      icon: ShoppingCart,
      tone: "slate" as const,
    },
    {
      title: "Cash / Card",
      value: `${cashShare.toFixed(0)}% / ${cardShare.toFixed(0)}%`,
      hint: `${formatRon(cashTotal)} / ${formatRon(cardTotal)}`,
      icon: CreditCard,
      tone: "blue-soft" as const,
    },
    {
      title: "Profit top produse",
      value: formatRon(totalTopProfit),
      hint: "sumat din produsele de top",
      icon: TrendingUp,
      tone: "emerald" as const,
    },
    {
      title: "Stoc critic",
      value: `${criticalStockCount}`,
      hint: "produse de urmărit",
      icon: AlertTriangle,
      tone: "amber" as const,
    },
  ]

  return (
    <div className="w-full space-y-4">
      <PageHeader
        badge="ceo dashboard"
        title="Dashboard ERP"
      />

      {dashboardError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {dashboardError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-5">
        {stats.map((stat) => (
          <MetricCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <SalesChart
          data={safeSales}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onReset={() => {
            setDateFrom(defaultDateFrom)
            setDateTo(defaultDateTo)
          }}
        />

        <SectionCard
          title="Pulse business"
          action={
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              live
            </span>
          }
        >
          <div className="space-y-2.5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                  <TrendingUp size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Cea mai bună zi</div>
                  <div className="mt-1 text-sm text-slate-500">{bestDay}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#17324D] text-white">
                  <Wallet size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Total încasări urmărite</div>
                  <div className="mt-1 text-sm text-slate-500">{formatRon(paymentTotal)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F39C12] text-white">
                  <PackageSearch size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Alerte stoc</div>
                  <div className="mt-1 text-sm text-slate-500">{criticalStockCount} produse necesită atenție</div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <QuickActions />

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.1fr)]">
        <SectionCard
          title="Top produse"
          action={
            <div className="rounded-full bg-[#FFF1D6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#B66A00]">
              top 5
            </div>
          }
        >
          <div className="space-y-2.5">
            {dashboardLoading ? (
              <div className="text-sm text-slate-500">Se încarcă top produse...</div>
            ) : topProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Nu există încă produse vândute în intervalul selectat.
              </div>
            ) : (
              topProducts.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  className={[
                "grid grid-cols-[minmax(150px,1.4fr)_90px_130px] items-center gap-3 rounded-xl border px-3 py-2.5",
                    item.profit <= 0
                      ? "border-red-200 bg-red-50"
                      : "border-slate-200 bg-slate-50",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="truncate pr-3 text-sm font-semibold text-slate-800">{item.name}</div>
                    {item.profit <= 0 ? (
                      <div className="mt-1 text-xs font-semibold text-red-600">neprofitabil</div>
                    ) : null}
                  </div>
                  <div className="rounded-full bg-[#17324D] px-3 py-1 text-center text-xs font-semibold text-white">
                    {formatQtyRo(item.qty || 0)}
                  </div>
                  <div className={["text-sm font-semibold text-right", item.profit <= 0 ? "text-red-600" : "text-emerald-700"].join(" ")}>
                    {formatRon(item.profit)}
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Activitate recentă"
          action={
            <div className="rounded-full bg-[#FFF1D6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#B66A00]">
              live
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {recentDocs.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-2 text-sm text-slate-500">{item.meta}</div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Stoc critic automat"
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {dashboardLoading || criticalLoading ? (
            <div className="text-sm text-slate-500">Se încarcă produsele cu stoc mic...</div>
          ) : lowStock.length > 0 ? (
            lowStock.map((item, index) => (
              <div
                key={`${item.product}-${item.location}-${index}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{item.product}</div>
                  <div className="text-xs text-slate-500">{item.location}</div>
                </div>
                <div className="ml-3 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                  {formatQtyRo(item.qty || 0)}
                </div>
              </div>
            ))
          ) : criticalStock.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Nu există suficiente date pentru alertă stoc critic.
            </div>
          ) : (
            criticalStock.map((product, index) => (
              <div
                key={`${product.productId || product.id || index}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{product.name || "Produs fără nume"}</div>
                  <div className="text-xs text-slate-500">{product.sku || "fără SKU"}</div>
                </div>
                <div className="ml-3 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                  {formatQtyRo(activeLocationId ? product.qty : product.totalQty || 0)} {product.uom || ""}
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  )
}
