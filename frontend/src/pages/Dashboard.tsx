import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Clock3,
  CircleDollarSign,
  CreditCard,
  FileText,
  Receipt,
  ShoppingCart,
  TrendingUp,
  PackageSearch,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import QuickActions from "../components/QuickActions"
import PosReceiptsView from "../components/PosReceiptsView"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { getActiveTerminalId, subscribeToActiveTerminal } from "../lib/terminal"
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
  recentActivity?: RecentActivityItem[]
  updatedAt?: string
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

type RecentActivityItem = {
  type: "sale" | "purchase" | "transfer" | "consumption" | "production" | "inventory" | "minutes"
  title: string
  meta: string
  at: string
}

type MeResponse = {
  ok?: boolean
  tenant_id?: string
  user_id?: string
  role?: string
  modules?: string[]
}

const DASHBOARD_REFRESH_MS = 15000

const ACTIVITY_ICON_MAP = {
  sale: Receipt,
  purchase: ShoppingCart,
  transfer: ArrowRightLeft,
  consumption: FileText,
  production: TrendingUp,
  inventory: PackageSearch,
  minutes: AlertTriangle,
} as const

function formatRon(value: number) {
  return formatMoneyRo(value, "RON")
}

function formatDisplayDate(value: string) {
  if (!value) return "-"
  const parts = value.slice(0, 10).split("-")
  if (parts.length !== 3) return value
  return `${parts[2]}.${parts[1]}.${parts[0]}`
}

function formatRangeLabel(dateFrom: string, dateTo: string) {
  return `${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`
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

function formatRelativeTime(value: string) {
  if (!value) return "acum"

  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return "acum"

  const diffMinutes = Math.max(0, Math.round(diffMs / 60000))
  if (diffMinutes < 1) return "acum"
  if (diffMinutes < 60) return `acum ${diffMinutes} min`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `acum ${diffHours} h`

  const diffDays = Math.round(diffHours / 24)
  return `acum ${diffDays} zile`
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
    throw new Error("Nu am putut determina tenant-ul din sesiunea curenta.")
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
  loading,
}: {
  data: SalesPoint[]
  loading?: boolean
}) {
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const [hoveredIndex, setHoveredIndex] = useState<number>(data.length ? data.length - 1 : 0)
  const hovered = data[Math.min(hoveredIndex, Math.max(data.length - 1, 0))]
  const hasData = data.some((item) => item.value > 0)

  return (
    <div className="rounded-[24px] border border-[#D9E4EE] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFD_100%)] p-5 shadow-[0_22px_48px_rgba(15,23,42,0.06)]">
      <div className="mb-2.5 flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-950">
            <BarChart3 size={17} className="text-[#17324D]" />
            Vanzari pe interval
          </div>
          <div className="mt-1 text-sm text-slate-500">Evolutie zilnica pentru perioada selectata</div>
        </div>

      </div>

      <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white/80 px-4 py-4">
        {!hasData && !loading ? (
          <div className="rounded-[18px] border border-dashed border-slate-300 bg-white/90 px-4 py-5 text-center text-sm text-slate-500">
            Nu exista vanzari pentru intervalul selectat.
          </div>
        ) : null}

        {hasData ? (
          <>
            {hovered ? (
              <div className="mb-4 inline-flex rounded-[16px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_100%)] px-3 py-2 shadow-lg shadow-slate-900/10">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{hovered.label}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{formatRon(hovered.value)}</div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.map((point, index) => {
                const heightPercent = Math.max(10, Math.round((point.value / maxValue) * 100))
                const active = hoveredIndex === index
                return (
                  <button
                    key={point.date}
                    type="button"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onFocus={() => setHoveredIndex(index)}
                    onClick={() => setHoveredIndex(index)}
                    className={[
                      "rounded-[18px] border px-4 py-4 text-left transition",
                      active
                        ? "border-[#47C2B1] bg-[#F4FBFA] shadow-[0_14px_28px_rgba(71,194,177,0.12)]"
                        : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{point.label}</div>
                      <div className="text-sm font-semibold text-slate-950">{formatRon(point.value)}</div>
                    </div>

                    <div className="mt-4 h-24 rounded-[14px] bg-white/80 p-2">
                      <div className="flex h-full items-end">
                        <div
                          className="w-full rounded-[10px] bg-[linear-gradient(180deg,#47C2B1_0%,#17324D_100%)] transition-all duration-300"
                          style={{ height: `${heightPercent}%` }}
                        />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="animate-pulse rounded-[18px] border border-slate-200 bg-slate-50/70 px-4 py-4">
                <div className="h-3 w-16 rounded bg-slate-200" />
                <div className="mt-2 h-5 w-28 rounded bg-slate-200" />
                <div className="mt-4 h-24 rounded-[14px] bg-slate-200" />
              </div>
            ))}
          </div>
        ) : null}
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
    <div className="rounded-[22px] border border-[#DCE6EF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFD_100%)] p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
          <div className="mt-2 break-words text-[24px] font-semibold tracking-tight text-slate-950">{value}</div>
          <div className="mt-1 text-[13px] text-slate-500">{hint}</div>
        </div>

        <span
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]",
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
    <div className="rounded-[24px] border border-[#DCE6EF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFD_100%)] p-5 shadow-[0_22px_48px_rgba(15,23,42,0.06)]">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[15px] font-semibold tracking-[0.01em] text-slate-950">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[13px] text-slate-500">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const [searchParams] = useSearchParams()
  const token =
    getToken() || ""

  const today = new Date()
  const defaultDateTo = toInputDate(today)
  const defaultDateFrom = toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))

  const [criticalStock, setCriticalStock] = useState<GlobalStockItem[]>([])
  const [criticalLoading, setCriticalLoading] = useState(true)

  const dateFrom = searchParams.get("dateFrom") || defaultDateFrom
  const dateTo = searchParams.get("dateTo") || defaultDateTo

  const [salesSeries, setSalesSeries] = useState<SalesPoint[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState("")
  const [receiptsOpen, setReceiptsOpen] = useState(false)

  const [salesTotal, setSalesTotal] = useState(0)
  const [receiptsCount, setReceiptsCount] = useState(0)
  const [avgReceipt, setAvgReceipt] = useState(0)
  const [cashTotal, setCashTotal] = useState(0)
  const [cardTotal, setCardTotal] = useState(0)
  const [topProducts, setTopProducts] = useState<TopProductItem[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([])
  const [updatedAt, setUpdatedAt] = useState("")
  const [activeLocationId, setActiveLocationId] = useState(getActiveLocationId())
  const [activeTerminalId, setActiveTerminalId] = useState(getActiveTerminalId())

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
    void loadCriticalStock(activeLocationId)

    const intervalId = window.setInterval(() => {
      void loadCriticalStock(activeLocationId, true)
    }, DASHBOARD_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [activeLocationId])

  useEffect(() => {
    void loadDashboard(activeLocationId, activeTerminalId)

    const intervalId = window.setInterval(() => {
      void loadDashboard(activeLocationId, activeTerminalId, true)
    }, DASHBOARD_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [dateFrom, dateTo, activeLocationId, activeTerminalId])

  useEffect(() => {
    const refreshNow = () => {
      if (document.visibilityState !== "visible") return
      void loadDashboard(activeLocationId, activeTerminalId, true)
      void loadCriticalStock(activeLocationId, true)
    }

    window.addEventListener("focus", refreshNow)
    document.addEventListener("visibilitychange", refreshNow)

    return () => {
      window.removeEventListener("focus", refreshNow)
      document.removeEventListener("visibilitychange", refreshNow)
    }
  }, [dateFrom, dateTo, activeLocationId, activeTerminalId])

  async function loadCriticalStock(selectedLocationId: string, silent = false) {
    if (!token) {
      setCriticalLoading(false)
      return
    }

    if (!silent) {
      setCriticalLoading(true)
    }

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
      if (!silent) {
        setCriticalLoading(false)
      }
    }
  }

  async function loadDashboard(selectedLocationId: string, selectedTerminalId: string, silent = false) {
    if (!token) {
      setDashboardLoading(false)
      setDashboardError("Lipseste token-ul pentru dashboard.")
      return
    }

    if (!silent) {
      setDashboardLoading(true)
    }
    setDashboardError("")

    try {
      const tenantId = await getTenantIdFromSession(token)

      const params = new URLSearchParams()
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)
      if (selectedLocationId) params.set("locationId", selectedLocationId)
      if (selectedTerminalId) params.set("terminalId", selectedTerminalId)

      const res = await fetch(`${API}/api/v1/dashboard?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-tenant-id": tenantId,
        },
      })

      const data: DashboardApiResponse = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        throw new Error("Nu s-au putut incarca datele dashboard.")
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
      setRecentActivity(Array.isArray(data.recentActivity) ? data.recentActivity : [])
      setUpdatedAt(String(data.updatedAt || new Date().toISOString()))
    } catch (error) {
      console.error("Dashboard load failed", error)
      setDashboardError("Nu am putut incarca dashboardul din backend.")
      setSalesSeries([])
      setSalesTotal(0)
      setReceiptsCount(0)
      setAvgReceipt(0)
      setCashTotal(0)
      setCardTotal(0)
      setTopProducts([])
      setLowStock([])
      setRecentActivity([])
    } finally {
      if (!silent) {
        setDashboardLoading(false)
      }
    }
  }

  const filteredSales = useMemo(() => {
    const from = dateFrom || "0000-01-01"
    const to = dateTo || "9999-12-31"
    return salesSeries.filter((item) => item.date >= from && item.date <= to)
  }, [dateFrom, dateTo, salesSeries])

  const safeSales = filteredSales.length ? filteredSales : [{ date: "0000-00-00", label: "-", value: 0 }]

  const criticalStockCount = lowStock.length || criticalStock.length
  const paymentTotal = cashTotal + cardTotal
  const cashShare = paymentTotal > 0 ? (cashTotal / paymentTotal) * 100 : 0
  const cardShare = paymentTotal > 0 ? (cardTotal / paymentTotal) * 100 : 0
  const totalTopProfit = topProducts.reduce((acc, item) => acc + item.profit, 0)
  const lastUpdatedLabel = updatedAt ? formatRelativeTime(updatedAt) : "acum"
  const rangeLabel = formatRangeLabel(dateFrom, dateTo)
  const scopeLabel = activeLocationId ? "Locatie selectata" : "Toate locatiile"
  const terminalLabel = activeTerminalId ? "Terminal selectat" : "Toate terminalele"
  const appVersion = "V1.1"
  const stats = [
    {
      title: "Vanzari interval",
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
      hint: "produse de urmarit",
      icon: AlertTriangle,
      tone: "amber" as const,
    },
  ]

  return (
    <div className="w-full space-y-5">
      <div className="overflow-hidden rounded-[28px] border border-[#DCE6EF] bg-[radial-gradient(circle_at_top_right,rgba(71,194,177,0.10),transparent_28%),linear-gradient(180deg,#FFFFFF_0%,#F4F8FB_100%)] p-5 shadow-[0_28px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm">
              <Activity size={13} className="text-emerald-600" />
              Dashboard operational
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm">
                <Clock3 size={14} />
                {rangeLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm">
                <Boxes size={14} />
                {scopeLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm">
                <CreditCard size={14} />
                {terminalLabel}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[620px]">
            <div className="rounded-[20px] border border-white/70 bg-white/88 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live</div>
              <div className="mt-1 text-sm font-semibold text-emerald-700">{lastUpdatedLabel}</div>
            </div>
            <div className="rounded-[20px] border border-white/70 bg-white/88 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Cash</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{formatRon(cashTotal)}</div>
            </div>
            <div className="rounded-[20px] border border-white/70 bg-white/88 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Card</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{formatRon(cardTotal)}</div>
            </div>
            <div className="rounded-[20px] border border-white/70 bg-white/88 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Versiune</div>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                {appVersion}
              </div>
            </div>
          </div>
        </div>
      </div>

      {dashboardError ? (
        <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {dashboardError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <MetricCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <SalesChart
          data={safeSales}
          loading={dashboardLoading}
        />
      </div>

      <QuickActions onOpenReceipts={() => setReceiptsOpen(true)} />

      {receiptsOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-[24px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold text-slate-900">Vanzari / Bon</div>
                <div className="mt-1 text-sm text-slate-500">Bonuri emise in Android POS.</div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptsOpen(false)}
                className="rounded-[14px] border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Inchide
              </button>
            </div>
            <PosReceiptsView compact />
          </div>
        </div>
      ) : null}

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
              <div className="text-sm text-slate-500">Se incarca top produse...</div>
            ) : topProducts.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Nu exista produse vandute in intervalul selectat.
              </div>
            ) : (
              topProducts.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  className={[
                "grid grid-cols-1 gap-2 rounded-[18px] border px-3 py-2.5 sm:grid-cols-[minmax(150px,1.4fr)_90px_130px] sm:items-center sm:gap-3",
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
                  <div className="w-fit rounded-full bg-[#17324D] px-3 py-1 text-center text-xs font-semibold text-white sm:justify-self-center">
                    {formatQtyRo(item.qty || 0)}
                  </div>
                  <div className={["text-sm font-semibold sm:text-right", item.profit <= 0 ? "text-red-600" : "text-emerald-700"].join(" ")}>
                    {formatRon(item.profit)}
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Activitate recenta"
          action={
            <div className="rounded-full bg-[#FFF1D6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#B66A00]">
              {lastUpdatedLabel}
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {dashboardLoading ? (
              <div className="text-sm text-slate-500">Se incarca activitatea recenta...</div>
            ) : recentActivity.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Nu exista inca activitate recenta pentru locatia selectata.
              </div>
            ) : (
              recentActivity.map((item, index) => {
                const Icon = ACTIVITY_ICON_MAP[item.type] || FileText
                return (
                  <div key={`${item.type}-${item.at}-${index}`} className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-slate-900 shadow-sm">
                      <Icon size={18} />
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.meta}</div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#B66A00]">{formatRelativeTime(item.at)}</div>
                  </div>
                )
              })
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Stoc critic automat"
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {dashboardLoading || criticalLoading ? (
            <div className="text-sm text-slate-500">Se incarca produsele cu stoc mic...</div>
          ) : lowStock.length > 0 ? (
            lowStock.map((item, index) => (
              <div
                key={`${item.product}-${item.location}-${index}`}
                className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5"
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
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Nu exista suficiente date pentru alerta de stoc critic.
            </div>
          ) : (
            criticalStock.map((product, index) => (
              <div
                key={`${product.productId || product.id || index}`}
                className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{product.name || "Produs fara nume"}</div>
                  <div className="text-xs text-slate-500">{product.sku || "fara SKU"}</div>
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



