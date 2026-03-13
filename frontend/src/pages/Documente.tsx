import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  FileCheck2,
  FilePlus2,
  PackageSearch,
  Repeat2,
  X,
  Printer,
  Factory,
} from "lucide-react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

type ConsumptionDocListItem = {
  id: string
  docNo: string
  docDate: string
  note: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code: string
  }
  sale: {
    id: string
    receiptNo: string | null
    soldAt: string
    total: number
    paymentType: string
    operatorName: string | null
  } | null
  itemsCount: number
  totalQty: number
  finishedProducts: Array<{
    id: string
    name: string
    sku: string
  }>
}

type ConsumptionDocDetail = {
  id: string
  docNo: string
  docDate: string
  note: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code: string
  }
  sale: {
    id: string
    receiptNo: string | null
    soldAt: string
    total: number
    paymentType: string
    cashAmount: number | null
    cardAmount: number | null
    operatorName: string | null
    createdAt: string
    items: Array<{
      id: string
      qty: number
      unitPrice: number
      vatRate: number
      product: {
        id: string
        name: string
        sku: string
      }
    }>
  } | null
  itemsCount: number
  totalQty: number
  items: Array<{
    id: string
    qty: number
    note: string | null
    createdAt: string
    updatedAt: string
    finishedProduct: {
      id: string
      name: string
      sku: string
    } | null
    ingredient: {
      id: string
      name: string
      sku: string
    }
  }>
}

type ProductionDocListItem = {
  id: string
  docNo: string
  docDate: string
  note: string
  locationId: string
  locationName: string
  itemsCount: number
  totalQty: number
  products: Array<{
    productId: string
    sku: string
    name: string
    uom: string
    qty: number
  }>
}

type ProductionDocDetail = {
  id: string
  docNo: string
  docDate: string
  note: string
  locationId: string
  locationName: string
  itemsCount: number
  totalQty: number
  items: Array<{
    id: string
    productId: string
    sku: string
    name: string
    uom: string
    qty: number
    ingredients: Array<{
      ingredientId: string
      sku: string
      name: string
      uom: string
      qty: number
    }>
  }>
}

type ConsumptionListResponse = {
  ok: boolean
  items: ConsumptionDocListItem[]
}

type ConsumptionDetailResponse = {
  ok: boolean
  item: ConsumptionDocDetail
}

type ProductionListResponse = {
  ok: boolean
  items: ProductionDocListItem[]
}

type ProductionDetailResponse = {
  ok: boolean
  item: ProductionDocDetail
}

type ActiveTab = "consumption" | "production"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("ro-RO")
}

function formatNumber(value?: number | null, digits = 2) {
  return Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatRon(value?: number | null) {
  return `${formatNumber(value)} RON`
}

function statusClass(status: string) {
  if (status === "Generat") return "bg-emerald-100 text-emerald-700"
  if (status === "Produs") return "bg-blue-100 text-blue-700"
  return "bg-amber-100 text-amber-700"
}

export default function Documente() {
  const token =
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    ""

  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const [activeTab, setActiveTab] = useState<ActiveTab>("consumption")
  const [dateFrom, setDateFrom] = useState(
    `${monthStart.getFullYear()}-${`${monthStart.getMonth() + 1}`.padStart(2, "0")}-${`${monthStart.getDate()}`.padStart(2, "0")}`
  )
  const [dateTo, setDateTo] = useState(
    `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`
  )
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [consumptionDocs, setConsumptionDocs] = useState<ConsumptionDocListItem[]>([])
  const [productionDocs, setProductionDocs] = useState<ProductionDocListItem[]>([])

  const [selectedConsumptionDocId, setSelectedConsumptionDocId] = useState<string | null>(null)
  const [selectedConsumptionDoc, setSelectedConsumptionDoc] = useState<ConsumptionDocDetail | null>(null)

  const [selectedProductionDocId, setSelectedProductionDocId] = useState<string | null>(null)
  const [selectedProductionDoc, setSelectedProductionDoc] = useState<ProductionDocDetail | null>(null)

  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (activeTab === "consumption") {
      loadConsumptionDocs()
    } else {
      loadProductionDocs()
    }
  }, [activeTab, dateFrom, dateTo])

  async function loadConsumptionDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipsește sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set("dateFrom", `${dateFrom}T00:00:00.000Z`)
      if (dateTo) params.set("dateTo", `${dateTo}T23:59:59.999Z`)
      if (search.trim()) params.set("q", search.trim())

      const res = await fetch(`${API}/api/v1/consumption-docs?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: ConsumptionListResponse = await res.json().catch(() => ({
        ok: false,
        items: [],
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut încărca bonurile de consum.")
      }

      setConsumptionDocs(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error("LOAD CONSUMPTION DOCS ERROR", err)
      setConsumptionDocs([])
      setError("Nu am putut încărca bonurile de consum.")
    } finally {
      setLoading(false)
    }
  }

  async function loadProductionDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipsește sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set("q", search.trim())

      const res = await fetch(`${API}/api/v1/production-docs?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: ProductionListResponse = await res.json().catch(() => ({
        ok: false,
        items: [],
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut încărca documentele de producție.")
      }

      let items = Array.isArray(data.items) ? data.items : []

      if (dateFrom || dateTo) {
        items = items.filter((doc) => {
          const docDate = String(doc.docDate || "").slice(0, 10)
          const fromOk = !dateFrom || docDate >= dateFrom
          const toOk = !dateTo || docDate <= dateTo
          return fromOk && toOk
        })
      }

      setProductionDocs(items)
    } catch (err) {
      console.error("LOAD PRODUCTION DOCS ERROR", err)
      setProductionDocs([])
      setError("Nu am putut încărca documentele de producție.")
    } finally {
      setLoading(false)
    }
  }

  async function openConsumptionDetail(id: string) {
    if (!token) return

    setSelectedConsumptionDocId(id)
    setSelectedProductionDocId(null)
    setDetailLoading(true)
    setSelectedConsumptionDoc(null)

    try {
      const res = await fetch(`${API}/api/v1/consumption-docs/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: ConsumptionDetailResponse = await res.json().catch(() => ({
        ok: false,
        item: null as never,
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut încărca detaliul bonului de consum.")
      }

      setSelectedConsumptionDoc(data.item)
    } catch (err) {
      console.error("LOAD CONSUMPTION DOC DETAIL ERROR", err)
      setSelectedConsumptionDoc(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function openProductionDetail(id: string) {
    if (!token) return

    setSelectedProductionDocId(id)
    setSelectedConsumptionDocId(null)
    setDetailLoading(true)
    setSelectedProductionDoc(null)

    try {
      const res = await fetch(`${API}/api/v1/production-docs/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: ProductionDetailResponse = await res.json().catch(() => ({
        ok: false,
        item: null as never,
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut încărca documentul de producție.")
      }

      setSelectedProductionDoc(data.item)
    } catch (err) {
      console.error("LOAD PRODUCTION DOC DETAIL ERROR", err)
      setSelectedProductionDoc(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function openPdf(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/consumption-docs/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      window.open(url, "_blank")
    } catch (err) {
      console.error("PDF ERROR", err)
      alert("Nu am putut genera PDF-ul.")
    }
  }

  const filteredConsumptionDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return consumptionDocs

    return consumptionDocs.filter((doc) => {
      const values = [
        doc.docNo,
        doc.note || "",
        doc.location?.name || "",
        doc.location?.code || "",
        doc.sale?.receiptNo || "",
        ...doc.finishedProducts.map((p) => p.name),
      ].join(" ").toLowerCase()

      return values.includes(q)
    })
  }, [consumptionDocs, search])

  const filteredProductionDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return productionDocs

    return productionDocs.filter((doc) => {
      const values = [
        doc.docNo,
        doc.note || "",
        doc.locationName || "",
        ...doc.products.map((p) => p.name),
      ].join(" ").toLowerCase()

      return values.includes(q)
    })
  }, [productionDocs, search])

  const quickCards =
    activeTab === "consumption"
      ? [
          {
            title: "Bonuri de consum",
            value: String(filteredConsumptionDocs.length),
            hint: "Documente generate automat din vânzări",
            icon: FilePlus2,
            tone: "blue",
          },
          {
            title: "Poziții consum",
            value: String(filteredConsumptionDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
            hint: "Ingrediente consumate în documentele filtrate",
            icon: Repeat2,
            tone: "slate",
          },
          {
            title: "Cantitate totală",
            value: formatNumber(filteredConsumptionDocs.reduce((sum, doc) => sum + doc.totalQty, 0)),
            hint: "Total cantități consumate",
            icon: FileCheck2,
            tone: "emerald",
          },
        ]
      : [
          {
            title: "Documente producție",
            value: String(filteredProductionDocs.length),
            hint: "Documente generate la producție",
            icon: Factory,
            tone: "blue",
          },
          {
            title: "Poziții produse",
            value: String(filteredProductionDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
            hint: "Produse finite produse",
            icon: FilePlus2,
            tone: "slate",
          },
          {
            title: "Cantitate totală",
            value: formatNumber(filteredProductionDocs.reduce((sum, doc) => sum + doc.totalQty, 0)),
            hint: "Total cantități produse",
            icon: FileCheck2,
            tone: "emerald",
          },
        ]

  return (
    <div className="space-y-6">
      <PageHeader
        badge="documente"
        title="Documente"
        subtitle="Consum și producție în același loc, cu istoric și detalii complete."
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("consumption")}
          className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === "consumption"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Repeat2 size={16} />
          Bonuri de consum
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("production")}
          className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === "production"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Factory size={16} />
          Producție
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {quickCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-500">{card.title}</div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</div>
                  <div className="mt-2 text-sm text-slate-500">{card.hint}</div>
                </div>

                <span
                  className={[
                    "flex h-12 w-12 items-center justify-center rounded-2xl",
                    card.tone === "blue" && "bg-blue-50 text-blue-700",
                    card.tone === "slate" && "bg-slate-900 text-white",
                    card.tone === "emerald" && "bg-emerald-100 text-emerald-700",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Icon size={20} />
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">
                {activeTab === "consumption" ? "Istoric bonuri de consum" : "Istoric documente producție"}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {activeTab === "consumption"
                  ? "Vizualizezi documentele generate automat la consumul din rețetar."
                  : "Vizualizezi documentele de producție și produsele finite realizate."}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (activeTab === "consumption") {
                  loadConsumptionDocs()
                } else {
                  loadProductionDocs()
                }
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <PackageSearch size={18} />
              Reîncarcă
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                De la
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Până la
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Caută
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  activeTab === "consumption"
                    ? "Nr document, bon POS, produs, notă..."
                    : "Nr document, produs, notă..."
                }
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white"
              />
            </div>
          </div>
        </div>

        {activeTab === "consumption" ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Tip</th>
                  <th className="px-4 py-3 text-left font-medium">Număr</th>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Locație</th>
                  <th className="px-4 py-3 text-left font-medium">Bon POS</th>
                  <th className="px-4 py-3 text-left font-medium">Produse</th>
                  <th className="px-4 py-3 text-left font-medium">Cantitate</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Acțiune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Se încarcă bonurile de consum...
                    </td>
                  </tr>
                ) : filteredConsumptionDocs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Nu există bonuri de consum în intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredConsumptionDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-4 py-4 text-slate-700">Consum</td>
                      <td className="px-4 py-4 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-4 py-4 text-slate-600">{doc.location?.name || "-"}</td>
                      <td className="px-4 py-4 text-slate-600">{doc.sale?.receiptNo || "-"}</td>
                      <td className="px-4 py-4 text-slate-600">
                        {doc.finishedProducts.length > 0
                          ? doc.finishedProducts.map((p) => p.name).join(", ")
                          : "-"}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{formatNumber(doc.totalQty)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass("Generat")}`}>
                          Generat
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openPdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={16} />
                            PDF
                          </button>

                          <button
                            type="button"
                            onClick={() => openConsumptionDetail(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                          >
                            Deschide
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Tip</th>
                  <th className="px-4 py-3 text-left font-medium">Număr</th>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Locație</th>
                  <th className="px-4 py-3 text-left font-medium">Produse</th>
                  <th className="px-4 py-3 text-left font-medium">Cantitate</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Acțiune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Se încarcă documentele de producție...
                    </td>
                  </tr>
                ) : filteredProductionDocs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Nu există documente de producție în intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredProductionDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-4 py-4 text-slate-700">Producție</td>
                      <td className="px-4 py-4 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-4 py-4 text-slate-600">{doc.locationName || "-"}</td>
                      <td className="px-4 py-4 text-slate-600">
                        {doc.products.length > 0
                          ? doc.products.map((p) => p.name).join(", ")
                          : "-"}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{formatNumber(doc.totalQty)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass("Produs")}`}>
                          Produs
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openProductionDetail(doc.id)}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                          Deschide
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedConsumptionDocId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 md:p-8">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedConsumptionDoc ? `Detaliu bon de consum ${selectedConsumptionDoc.docNo}` : "Detaliu bon de consum"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Vizualizezi consumul generat automat din vânzare și rețetar.
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectedConsumptionDoc && openPdf(selectedConsumptionDoc.id)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Printer size={16} />
                  PDF
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedConsumptionDocId(null)
                    setSelectedConsumptionDoc(null)
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <X size={16} />
                  Închide
                </button>
              </div>
            </div>

            {detailLoading || !selectedConsumptionDoc ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Se încarcă detaliul documentului...
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Număr</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedConsumptionDoc.docNo}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(selectedConsumptionDoc.docDate)}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Locație</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedConsumptionDoc.location?.name || "-"}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Cantitate totală</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatNumber(selectedConsumptionDoc.totalQty)}</div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 text-lg font-semibold text-slate-900">Bon POS sursă</div>

                  {selectedConsumptionDoc.sale ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Bon</div>
                        <div className="mt-2 font-semibold text-slate-900">{selectedConsumptionDoc.sale.receiptNo || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data vânzării</div>
                        <div className="mt-2 text-slate-700">{formatDateTime(selectedConsumptionDoc.sale.soldAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</div>
                        <div className="mt-2 text-slate-700">{formatRon(selectedConsumptionDoc.sale.total)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Plată</div>
                        <div className="mt-2 text-slate-700">{selectedConsumptionDoc.sale.paymentType}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Operator</div>
                        <div className="mt-2 text-slate-700">{selectedConsumptionDoc.sale.operatorName || "-"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Document fără legătură la vânzare.</div>
                  )}
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 text-lg font-semibold text-slate-900">Linii de consum</div>

                  <div className="overflow-hidden rounded-[22px] border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Produs finit</th>
                          <th className="px-4 py-3 text-left font-medium">Ingredient</th>
                          <th className="px-4 py-3 text-left font-medium">Cantitate</th>
                          <th className="px-4 py-3 text-left font-medium">Notă</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedConsumptionDoc.items.map((item) => (
                          <tr key={item.id} className="border-t border-slate-200">
                            <td className="px-4 py-4 text-slate-700">
                              {item.finishedProduct ? item.finishedProduct.name : "-"}
                            </td>
                            <td className="px-4 py-4 font-semibold text-slate-900">
                              {item.ingredient.name}
                            </td>
                            <td className="px-4 py-4 text-slate-600">{formatNumber(item.qty)}</td>
                            <td className="px-4 py-4 text-slate-600">{item.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedConsumptionDoc.sale?.items?.length ? (
                  <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 text-lg font-semibold text-slate-900">Linii vânzare</div>

                    <div className="overflow-hidden rounded-[22px] border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">Produs</th>
                            <th className="px-4 py-3 text-left font-medium">Cantitate</th>
                            <th className="px-4 py-3 text-left font-medium">Preț</th>
                            <th className="px-4 py-3 text-left font-medium">TVA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedConsumptionDoc.sale.items.map((item) => (
                            <tr key={item.id} className="border-t border-slate-200">
                              <td className="px-4 py-4 font-semibold text-slate-900">{item.product.name}</td>
                              <td className="px-4 py-4 text-slate-600">{formatNumber(item.qty)}</td>
                              <td className="px-4 py-4 text-slate-600">{formatRon(item.unitPrice)}</td>
                              <td className="px-4 py-4 text-slate-600">{item.vatRate}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedProductionDocId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 md:p-8">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedProductionDoc ? `Detaliu producție ${selectedProductionDoc.docNo}` : "Detaliu producție"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Vizualizezi produsele finite realizate și ingredientele consumate.
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedProductionDocId(null)
                  setSelectedProductionDoc(null)
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <X size={16} />
                Închide
              </button>
            </div>

            {detailLoading || !selectedProductionDoc ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Se încarcă detaliul documentului...
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Număr</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedProductionDoc.docNo}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(selectedProductionDoc.docDate)}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Locație</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedProductionDoc.locationName || "-"}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Cantitate totală</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatNumber(selectedProductionDoc.totalQty)}</div>
                  </div>
                </div>

                {selectedProductionDoc.items.map((row) => (
                  <div key={row.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{row.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          {row.sku} • {formatNumber(row.qty)} {row.uom}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[22px] border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">Ingredient</th>
                            <th className="px-4 py-3 text-left font-medium">SKU</th>
                            <th className="px-4 py-3 text-left font-medium">UM</th>
                            <th className="px-4 py-3 text-left font-medium">Cantitate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.ingredients.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                                Nu există ingrediente.
                              </td>
                            </tr>
                          ) : (
                            row.ingredients.map((ingredient) => (
                              <tr key={ingredient.ingredientId} className="border-t border-slate-200">
                                <td className="px-4 py-4 font-semibold text-slate-900">{ingredient.name}</td>
                                <td className="px-4 py-4 text-slate-600">{ingredient.sku}</td>
                                <td className="px-4 py-4 text-slate-600">{ingredient.uom}</td>
                                <td className="px-4 py-4 text-slate-600">{formatNumber(ingredient.qty)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}