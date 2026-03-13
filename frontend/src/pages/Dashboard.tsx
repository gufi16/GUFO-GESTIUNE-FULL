import {
  AlertTriangle,
  ArrowRightLeft,
  CircleDollarSign,
  CreditCard,
  FileText,
  Receipt,
  ShoppingCart,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import QuickActions from "../components/QuickActions"

const API = "http://localhost:3001"

type GlobalStockItem = {
  productId?: string
  id?: string
  name?: string
  sku?: string
  uom?: string
  totalQty?: number
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
  return `${value.toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} RON`
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
  const height = 280
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
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Vânzări pe interval</div>
          <div className="mt-1 text-sm text-slate-500">
            Filtrul este aici în grafic, iar la hover sau click vezi vânzările pe zi.
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
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
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
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <button
            type="button"
            onClick={onReset}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
          {hovered ? hovered.label : "-"}
        </div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">
          {hovered ? formatRon(hovered.value) : "—"}
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {hovered ? `Vânzări înregistrate la data de ${hovered.date}` : "Nu există puncte în intervalul ales."}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-[280px] w-full">
        <defs>
          <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
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
            stroke="#2563eb"
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
              <circle cx={point.x} cy={point.y} r="14" fill="#2563eb" opacity="0.14" />
            ) : null}
            <circle cx={point.x} cy={point.y} r={hoveredIndex === index ? "6.5" : "5"} fill="#2563eb" />
            <text x={point.x} y={height - 4} textAnchor="middle" fontSize="12" fill="#64748b">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function StatCard({
  title,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  title: string
  value: string
  hint: string
  tone: "blue" | "slate" | "amber" | "blue-soft"
  icon: any
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
          <div className="mt-2 text-sm text-slate-500">{hint}</div>
        </div>

        <span
          className={[
            "flex h-12 w-12 items-center justify-center rounded-2xl",
            tone === "blue" && "bg-blue-600 text-white",
            tone === "slate" && "bg-slate-900 text-white",
            tone === "amber" && "bg-amber-500 text-white",
            tone === "blue-soft" && "bg-blue-50 text-blue-700",
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

export default function Dashboard() {
  const token =
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    ""

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
  const [topProducts, setTopProducts] = useState<Array<{ name: string; qty: number }>>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])

  useEffect(() => {
    loadCriticalStock()
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [dateFrom, dateTo])

  async function loadCriticalStock() {
    if (!token) {
      setCriticalLoading(false)
      return
    }

    setCriticalLoading(true)

    try {
      const res = await fetch(`${API}/api/v1/stock/global`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))
      const items = Array.isArray(data.items) ? data.items : []

      const sorted = [...items]
        .filter((item) => Number(item.totalQty || 0) >= 0)
        .sort((a, b) => Number(a.totalQty || 0) - Number(b.totalQty || 0))
        .slice(0, 6)

      setCriticalStock(sorted)
    } catch {
      setCriticalStock([])
    } finally {
      setCriticalLoading(false)
    }
  }

  async function loadDashboard() {
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
      title: "Stoc critic",
      value: `${criticalStockCount}`,
      hint: "produse de urmărit",
      icon: AlertTriangle,
      tone: "amber" as const,
    },
    {
      title: "Cash / Card",
      value: `${formatRon(cashTotal)} / ${formatRon(cardTotal)}`,
      hint: bestDay,
      icon: CreditCard,
      tone: "blue-soft" as const,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        badge="GuFo GesTiuNe"
        title="Dashboard ERP"
        subtitle="Tablou de control curat și util, cu focus pe indicatori, grafice și alerte reale."
      />

      {dashboardError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {dashboardError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
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

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <div className="text-lg font-semibold text-slate-900">Stoc critic automat</div>
            <div className="mt-1 text-sm text-slate-500">
              Produsele cu cele mai mici cantități existente în stoc.
            </div>
          </div>

          <div className="space-y-3">
            {dashboardLoading || criticalLoading ? (
              <div className="text-sm text-slate-500">Se încarcă produsele cu stoc mic...</div>
            ) : lowStock.length > 0 ? (
              lowStock.map((item, index) => (
                <div
                  key={`${item.product}-${item.location}-${index}`}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.product}</div>
                    <div className="text-xs text-slate-500">{item.location}</div>
                  </div>
                  <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                    {Number(item.qty || 0).toFixed(2)}
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
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{product.name || "Produs fără nume"}</div>
                    <div className="text-xs text-slate-500">{product.sku || "fără SKU"}</div>
                  </div>
                  <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                    {Number(product.totalQty || 0).toFixed(2)} {product.uom || ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <QuickActions />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">Top produse</div>
              <div className="mt-1 text-sm text-slate-500">Cele mai vândute produse în intervalul selectat</div>
            </div>
            <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
              top 5
            </div>
          </div>

          <div className="space-y-3">
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
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                  <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                    {Number(item.qty || 0).toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">Activitate recentă</div>
              <div className="mt-1 text-sm text-slate-500">Cele mai noi acțiuni din sistem</div>
            </div>
            <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
              live
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {recentDocs.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-2 text-sm text-slate-500">{item.meta}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}