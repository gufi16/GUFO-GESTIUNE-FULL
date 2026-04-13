import { useEffect, useMemo, useState } from "react"
import {
  BarChart3,
  Building2,
  ChartNoAxesCombined,
  CircleDollarSign,
  Layers3,
  PackageSearch,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import PageHeader from "../components/PageHeader"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { getActiveTerminalId, subscribeToActiveTerminal } from "../lib/terminal"

const BAR_COLORS = ["#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9"]
const PIE_COLORS = ["#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9"]

type TabKey = "CEO" | "SALES" | "PRODUCTS" | "OPERATIONS"

type LocationOption = {
  id: string
  name: string
}

type LocationRow = {
  id?: string
  name: string
  sales: number
  profit: number
  margin: number
}

type TrendRow = {
  name: string
  sales: number
  profit: number
}

type TopProductRow = {
  name: string
  qty: number
  sales: number
  profit: number
}

type RawConsumptionRow = {
  name: string
  qty: number
  um: string
}

type StockAlertRow = {
  name: string
  stock: number
  um: string
  status: string
}

type PieRow = {
  name: string
  value: number
}

type AdvancedReportsResponse = {
  salesByLocation?: any[]
  salesTrend?: any[]
  monthlyTrend?: any[]
  topProducts?: any[]
  rawConsumption?: any[]
  consumptionRawMaterials?: any[]
  stockAlerts?: any[]
  negativeStockProducts?: any[]
  pieData?: any[]
  productMix?: any[]
  totalSales?: number
  estimatedProfit?: number
  averageMargin?: number
  activeLocations?: number
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} lei`
}

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pickName(item: any, keys: string[], fallback: string) {
  for (const key of keys) {
    if (item?.[key] !== undefined && item?.[key] !== null && String(item[key]).trim()) {
      return String(item[key])
    }
  }
  return fallback
}

function toInputDate(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function normalizeLocationRows(data: any[]): LocationRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => {
    const sales =
      toNumber(item.sales) ||
      toNumber(item.totalSales) ||
      toNumber(item.total) ||
      toNumber(item.value)

    const profit = toNumber(item.profit) || toNumber(item.estimatedProfit)

    const margin = toNumber(item.margin) || (sales > 0 ? (profit / sales) * 100 : 0)

    return {
      id: String(item.locationId || item.id || item.location?.id || ""),
      name: pickName(item, ["name", "location", "label"], "Necunoscut"),
      sales,
      profit,
      margin,
    }
  })
}

function normalizeTrendRows(data: any[]): TrendRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    name: pickName(item, ["name", "label", "day", "date"], "-"),
    sales: toNumber(item.sales || item.totalSales || item.total || item.value),
    profit: toNumber(item.profit || item.estimatedProfit),
  }))
}

function normalizeTopProducts(data: any[]): TopProductRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    name: pickName(item, ["name", "product"], "Produs"),
    qty: toNumber(item.qty || item.quantity),
    sales: toNumber(item.sales || item.totalSales || item.total || item.value || item.profit),
    profit: toNumber(item.profit || item.estimatedProfit),
  }))
}

function normalizeRawConsumption(data: any[]): RawConsumptionRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    name: pickName(item, ["name", "product", "material"], "Materie primă"),
    qty: toNumber(item.qty || item.quantity || item.consumedQty),
    um: pickName(item, ["um", "uom", "unit"], "buc"),
  }))
}

function normalizeStockAlerts(data: any[]): StockAlertRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => {
    const stock = toNumber(item.stock || item.qty || item.quantity)
    return {
      name: pickName(item, ["name", "product"], "Produs"),
      stock,
      um: pickName(item, ["um", "uom", "unit"], "buc"),
      status: String(item.status || (stock <= 5 ? "critic" : "scăzut")).toLowerCase(),
    }
  })
}

function normalizePieData(data: any[]): PieRow[] {
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    name: pickName(item, ["name", "label"], "Categorie"),
    value: toNumber(item.value || item.qty || item.percent),
  }))
}

function numeSerieRaport(key: string) {
  if (key === "sales") return "Vânzări"
  if (key === "profit") return "Profit"
  if (key === "qty") return "Cantitate"
  if (key === "stock") return "Stoc"
  if (key === "value") return "Valoare"
  return key
}

function TooltipGraficBani({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
      <div className="space-y-1.5 text-sm">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry.dataKey}-${index}`} className="flex items-center justify-between gap-4">
            <span className="text-slate-600">{numeSerieRaport(String(entry.dataKey || ""))}</span>
            <span className="font-semibold text-slate-900">{money(Number(entry.value || 0))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TooltipGraficCantitate({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
      <div className="space-y-1.5 text-sm">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry.dataKey}-${index}`} className="flex items-center justify-between gap-4">
            <span className="text-slate-600">{numeSerieRaport(String(entry.dataKey || ""))}</span>
            <span className="font-semibold text-slate-900">{Number(entry.value || 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TooltipGraficProcent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
      <div className="space-y-1.5 text-sm">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry.dataKey}-${index}`} className="flex items-center justify-between gap-4">
            <span className="text-slate-600">{numeSerieRaport(String(entry.name || entry.dataKey || ""))}</span>
            <span className="font-semibold text-slate-900">{Number(entry.value || 0).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KPI({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string
  value: string
  subtitle: string
  icon: any
}) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-2 text-[24px] font-semibold tracking-tight text-slate-900">{value}</div>
          <div className="mt-1 text-[13px] text-slate-500">{subtitle}</div>
        </div>

        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Icon size={20} />
        </span>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {text}
    </div>
  )
}

export default function RapoartePage() {
  const [tab, setTab] = useState<TabKey>("CEO")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [data, setData] = useState<AdvancedReportsResponse | null>(null)
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState(getActiveLocationId() || "ALL")
  const [selectedTerminalId, setSelectedTerminalId] = useState(getActiveTerminalId() || "ALL")

  const today = new Date()
  const defaultDateTo = toInputDate(today)
  const defaultDateFrom = toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)

  useEffect(() => {
    loadLocations()
  }, [])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setSelectedLocationId(nextLocationId || "ALL")
    })
  }, [])

  useEffect(() => {
    return subscribeToActiveTerminal((nextTerminalId) => {
      setSelectedTerminalId(nextTerminalId || "ALL")
    })
  }, [])

  useEffect(() => {
    loadReports(selectedLocationId, selectedTerminalId, dateFrom, dateTo)
  }, [selectedLocationId, selectedTerminalId, dateFrom, dateTo])

  async function loadLocations() {
    try {
      const token = getToken() || ""

      const res = await fetch(`${API}/api/v1/meta/locations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      const json = await res.json().catch(() => ({}))
      const items = Array.isArray(json)
        ? json
        : Array.isArray(json?.items)
          ? json.items
          : Array.isArray(json?.locations)
            ? json.locations
            : []

      const normalized = items.map((item: any) => ({
        id: String(item.id || item.locationId || ""),
        name: String(item.name || item.label || "Locație"),
      }))

      setLocations(normalized)
    } catch {
      setLocations([])
    }
  }

  async function loadReports(locationId: string, terminalId: string, from: string, to: string) {
    try {
      setLoading(true)
      setError("")

      const token = getToken() || ""

      const params = new URLSearchParams()
      if (locationId && locationId !== "ALL") params.set("locationId", locationId)
      if (terminalId && terminalId !== "ALL") params.set("terminalId", terminalId)
      if (from) params.set("dateFrom", `${from}T00:00:00.000Z`)
      if (to) params.set("dateTo", `${to}T23:59:59.999Z`)

      const res = await fetch(
        `${API}/api/v1/reports/advanced${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      )

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(json?.error || "Nu am putut încărca rapoartele.")
        setData(null)
        return
      }

      setData(json)
    } catch (e) {
      console.error("reports error", e)
      setError("Nu am putut încărca rapoartele.")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const salesByLocation = useMemo(() => normalizeLocationRows(data?.salesByLocation || []), [data])
  const monthlyTrend = useMemo(() => normalizeTrendRows(data?.salesTrend || data?.monthlyTrend || []), [data])
  const topProducts = useMemo(() => normalizeTopProducts(data?.topProducts || []), [data])
  const rawConsumption = useMemo(() => normalizeRawConsumption(data?.rawConsumption || data?.consumptionRawMaterials || []), [data])
  const stockAlerts = useMemo(() => normalizeStockAlerts(data?.stockAlerts || data?.negativeStockProducts || []), [data])
  const pieData = useMemo(() => normalizePieData(data?.pieData || data?.productMix || []), [data])

  const totals = useMemo(() => {
    const sales = toNumber(data?.totalSales) || salesByLocation.reduce((acc, item) => acc + item.sales, 0)
    const profit = toNumber(data?.estimatedProfit) || salesByLocation.reduce((acc, item) => acc + item.profit, 0)
    const margin = toNumber(data?.averageMargin) || (sales > 0 ? (profit / sales) * 100 : 0)
    const activeLocations = toNumber(data?.activeLocations) || salesByLocation.filter((item) => item.sales > 0).length
    return { sales, profit, margin, activeLocations }
  }, [data, salesByLocation])

  const locationLabel =
    selectedLocationId === "ALL"
      ? "toate locațiile"
      : locations.find((l) => l.id === selectedLocationId)?.name || "locația selectată"

  const criticeCount = stockAlerts.filter((x) => x.status.includes("critic")).length
  const faraCostCount = stockAlerts.filter((x) => x.status.includes("fără cost")).length
  const diferenteCount = stockAlerts.filter((x) => x.status.includes("diferen")).length

  const filterActions = (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          De la
        </label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
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
          onChange={(e) => setDateTo(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          setDateFrom(defaultDateFrom)
          setDateTo(defaultDateTo)
        }}
        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        Resetare
      </button>
    </div>
  )

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <PageHeader badge="raportare" title="Rapoarte" subtitle="Se încarcă rapoartele..." />
        <div className="rounded-[20px] border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          Se încarcă rapoartele...
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-3">
      <PageHeader
        badge="raportare"
        title="Rapoarte"
        subtitle="Taburi curate, indicatori clari și secțiuni aerisite, pe date live."
      />

      {error ? (
        <div className="rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-[18px] border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "CEO", label: "Tablou executiv", icon: ChartNoAxesCombined },
              { key: "SALES", label: "Vânzări și profit", icon: CircleDollarSign },
              { key: "PRODUCTS", label: "Produse", icon: ShoppingBag },
              { key: "OPERATIONS", label: "Operațional", icon: Layers3 },
            ].map((item) => {
              const active = tab === item.key
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key as TabKey)}
                  className={[
                    "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition",
                    active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  ].join(" ")}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {tab === "CEO" ? (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <KPI title="Vânzări totale" value={money(totals.sales)} subtitle={locationLabel} icon={CircleDollarSign} />
            <KPI title="Profit estimat" value={money(totals.profit)} subtitle="calculat din costuri" icon={BarChart3} />
            <KPI title="Marjă medie" value={`${totals.margin.toFixed(1)}%`} subtitle="profit raportat la vânzări" icon={ChartNoAxesCombined} />
            <KPI title="Locații active" value={String(totals.activeLocations)} subtitle="cu vânzări în interval" icon={Building2} />
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
            <SectionCard title="Performanță pe locații" subtitle="Vânzări și profit pe locațiile tale" actions={filterActions}>
              {salesByLocation.length ? (
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesByLocation} barCategoryGap={18}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={80} />
                      <Tooltip content={<TooltipGraficBani />} />
                      <Bar dataKey="sales" radius={[8, 8, 0, 0]} barSize={24} name="Vânzări">
                        {salesByLocation.map((_, index) => (
                          <Cell key={`sales-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                        ))}
                      </Bar>
                      <Bar dataKey="profit" radius={[8, 8, 0, 0]} barSize={24} fill="#0f172a" name="Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState text="Nu există date pentru locații în intervalul selectat." />
              )}
            </SectionCard>

            <SectionCard title="Structură nomenclator" subtitle="Distribuția categoriilor de produse">
              {pieData.length ? (
                <>
                  <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={86} paddingAngle={4}>
                          {pieData.map((_, index) => (
                            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<TooltipGraficProcent />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {pieData.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                          <span className="text-sm font-medium text-slate-700">{item.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-slate-900">{item.value}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState text="Nu există structură de produse disponibilă pentru afișare." />
              )}
            </SectionCard>
          </div>
        </>
      ) : null}

      {tab === "SALES" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <SectionCard title="Evoluție vânzări și profit" subtitle="Trend pe intervalul selectat" actions={filterActions}>
            {monthlyTrend.length ? (
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend} barCategoryGap={22}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<TooltipGraficBani />} />
                    <Bar dataKey="sales" radius={[8, 8, 0, 0]} barSize={22} fill="#2563eb" name="Vânzări" />
                    <Bar dataKey="profit" radius={[8, 8, 0, 0]} barSize={22} fill="#14b8a6" name="Profit" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="Nu există evoluție de vânzări pentru intervalul selectat." />
            )}
          </SectionCard>

          <SectionCard title="Performanță pe locații" subtitle="Marjă și rezultate pe fiecare locație">
            {salesByLocation.length ? (
              <div className="space-y-3">
                {salesByLocation.map((item) => (
                  <div key={item.name} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                      <div className="text-sm font-semibold text-slate-900">{item.margin.toFixed(1)}%</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-slate-500">Vânzări</div>
                        <div className="mt-1 font-semibold text-slate-900">{money(item.sales)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Profit</div>
                        <div className="mt-1 font-semibold text-emerald-700">{money(item.profit)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="Nu există locații cu date în intervalul ales." />
            )}
          </SectionCard>
        </div>
      ) : null}

      {tab === "PRODUCTS" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <SectionCard title="Top produse" subtitle="Vânzări și profit pe produs" actions={filterActions}>
            {topProducts.length ? (
              <div className="space-y-3">
                {topProducts.map((product) => (
                  <div key={product.name} className="grid grid-cols-[minmax(180px,1.5fr)_100px_130px_130px] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{product.qty} bucăți</div>
                    </div>
                    <div className="text-sm text-slate-700">{product.qty}</div>
                    <div className="text-sm text-slate-700">{money(product.sales)}</div>
                    <div className="text-sm font-semibold text-emerald-700">{money(product.profit)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="Nu există produse de afișat pentru intervalul selectat." />
            )}
          </SectionCard>

          <SectionCard title="Consum materii prime" subtitle="Cantitățile consumate în interval" actions={filterActions}>
            {rawConsumption.length ? (
              <>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rawConsumption.map((item) => ({ name: item.name, qty: item.qty }))} barCategoryGap={22}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={70} />
                      <Tooltip content={<TooltipGraficCantitate />} />
                      <Bar dataKey="qty" radius={[8, 8, 0, 0]} barSize={22} name="Cantitate">
                        {rawConsumption.map((_, index) => (
                          <Cell key={`cons-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 space-y-3">
                  {rawConsumption.map((item) => (
                    <div key={item.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-500">consum total în interval</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-900">
                        {item.qty} {item.um}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState text="Nu există consum de materii prime în intervalul selectat." />
            )}
          </SectionCard>
        </div>
      ) : null}

      {tab === "OPERATIONS" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <SectionCard title="Alerte operaționale" subtitle="Zone care cer atenție în fluxul zilnic" actions={filterActions}>
            <div className="space-y-3">
              {[
                { label: "Produse cu stoc critic", value: String(criticeCount), icon: TriangleAlert },
                { label: "Produse fără cost setat", value: String(faraCostCount), icon: PackageSearch },
                { label: "Diferențe de inventar", value: String(diferenteCount), icon: Layers3 },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                        <Icon size={18} />
                      </span>
                      <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    </div>
                    <div className="text-xl font-semibold text-slate-900">{item.value}</div>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard title="Situație stocuri" subtitle="Vizualizare rapidă pentru produsele semnalate" actions={filterActions}>
            {stockAlerts.length ? (
              <>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stockAlerts.map((item) => ({ name: item.name, stock: item.stock }))} barCategoryGap={24}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={70} />
                      <Tooltip content={<TooltipGraficCantitate />} />
                      <Bar dataKey="stock" radius={[8, 8, 0, 0]} barSize={24} fill="#f59e0b" name="Stoc" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {stockAlerts.map((item) => {
                    const isCritic = item.status.includes("critic")
                    const isNoCost = item.status.includes("fără cost")
                    const isDiff = item.status.includes("diferen")

                    return (
                      <div key={`${item.name}-${item.status}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            stoc rămas: {item.stock} {item.um}
                          </div>
                        </div>
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                            isCritic
                              ? "bg-red-50 text-red-700"
                              : isNoCost
                                ? "bg-violet-50 text-violet-700"
                                : isDiff
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-amber-50 text-amber-700",
                          ].join(" ")}
                        >
                          {item.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <EmptyState text="Nu există alerte operaționale în intervalul selectat." />
            )}
          </SectionCard>
        </div>
      ) : null}
    </div>
  )
}

