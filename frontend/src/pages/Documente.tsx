import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowRight,
  FileCheck2,
  FilePlus2,
  Filter,
  PackageSearch,
  Repeat2,
  Search,
  X,
  Printer,
  Factory,
  ClipboardList,
  FileText,
} from "lucide-react"
import PageHeader from "../components/PageHeader"
import { DocumentMetric, InlineNotice, documentInputClass } from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { openPdfInNewTab } from "../lib/pdf"
import { hasModule } from "../lib/modules"
import { formatMoneyRo, formatNumberRo, formatQtyRo } from "../lib/format"


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

type InventoryDocListItem = {
  id: string
  docNo: string
  docDate: string
  note?: string | null
  status?: "DRAFT" | "FINALIZED" | "CANCELLED"
  finalizedAt?: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code?: string
  }
  itemsCount: number
  totalSystemQty: number
  totalCountedQty: number
  totalDifferenceQty: number
  positiveItems: number
  negativeItems: number
  zeroItems: number
}

type InventoryDocDetail = {
  id: string
  docNo: string
  docDate: string
  note?: string | null
  status?: "DRAFT" | "FINALIZED" | "CANCELLED"
  finalizedAt?: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code?: string
  }
  items: Array<{
    id: string
    product: {
      id: string
      sku: string
      name: string
      class?: string
      price?: number
      uom?: {
        id: string
        code: string
        name: string
      } | null
    }
    systemQty: number
    countedQty: number
    differenceQty: number
  }>
  summary: {
    itemsCount: number
    totalSystemQty: number
    totalCountedQty: number
    totalDifferenceQty: number
  }
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

type InventoryListResponse = {
  ok: boolean
  items: InventoryDocListItem[]
}

type InventoryDetailResponse = {
  ok: boolean
  item: InventoryDocDetail
}

type SalesInvoiceListItem = {
  id: string
  docNo: string
  docDate: string
  dueDate?: string | null
  customerName: string
  customerCif?: string | null
  location?: {
    id: string
    name: string
  } | null
  currency: string
  totalGrossFc: number
  status: string
  efacturaStatus?: string
  efacturaUploadIndex?: string | null
  efacturaDownloadedAt?: string | null
  itemsCount: number
}

type ReceiptListItem = {
  id: string
  docNo?: string
  number?: string
  docDate?: string
  date?: string
  note?: string | null
  series?: string | null
  status?: string
  currency?: string
  totalGrossRon?: number
  totalRon?: number
  grandTotal?: number
  total?: number
  itemsCount?: number
  linesCount?: number
  itemCount?: number
  supplier?: {
    name?: string
    code?: string
    cif?: string
  } | null
  supplierName?: string
  supplierCode?: string
  vendor?: {
    name?: string
  } | null
  location?: {
    id?: string
    name?: string
  } | null
  warehouse?: {
    id?: string
    name?: string
  } | null
}

type MinutesDocListItem = {
  id: string
  docNo: string
  docDate: string
  type: "DETERIORATION" | "PRICE_CHANGE"
  status: "DRAFT" | "POSTED" | "CANCELLED"
  reasonCode?: string | null
  note?: string | null
  totalQty: number
  totalValue: number
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code?: string
  }
  itemsCount: number
}

type ActiveTab = "consumption" | "production" | "inventory" | "invoice" | "receipt" | "minutes"

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
  return digits >= 3 ? formatQtyRo(value, digits) : formatNumberRo(value, digits)
}

function formatRon(value?: number | null) {
  return formatMoneyRo(value, "RON")
}

function statusClass(status: string) {
  if (status === "Generat") return "bg-[#E5F3E8] text-[#215D2A]"
  if (status === "Produs") return "bg-slate-100 text-slate-700"
  if (status === "Finalizat") return "bg-[#E5F3E8] text-[#215D2A]"
  if (status === "Anulat") return "bg-red-100 text-red-700"
  return "bg-[#F8F5EF] text-[#17324D]"
}

function inventoryStatusText(status?: string) {
  if (status === "FINALIZED") return "Finalizat"
  if (status === "CANCELLED") return "Anulat"
  return "?n lucru"
}

function diffClass(value: number) {
  if (value < 0) return "text-red-600 font-semibold"
  if (value > 0) return "text-emerald-600 font-semibold"
  return "text-slate-600"
}

function efacturaStatusClass(status?: string) {
  if (status === "ACCEPTED") return "bg-[#E5F3E8] text-[#215D2A]"
  if (status === "SENT") return "bg-[#E8F0FB] text-[#244A7C]"
  if (status === "PREPARED" || status === "READY_TO_SEND") return "bg-slate-100 text-slate-700"
  if (status === "REJECTED" || status === "ERROR") return "bg-red-100 text-red-700"
  return "bg-[#F8F5EF] text-[#17324D]"
}

function minutesTypeLabel(type?: string) {
  return type === "PRICE_CHANGE" ? "Schimbare pret" : "Deteriorare"
}

function minutesReasonLabel(code?: string | null) {
  if (code === "EXPIRED") return "Expirat"
  if (code === "DAMAGE") return "Deteriorat"
  if (code === "LOSS") return "Pierdere"
  if (code === "PRICE_UPDATE") return "Schimbare pret"
  return code || "-"
}

function MobileTable({
  children,
  minWidthClass = "min-w-[680px]",
}: {
  children: React.ReactNode
  minWidthClass?: string
}) {
  return (
    <div className="overflow-x-auto rounded-[22px] border border-slate-200">
      <div className={minWidthClass}>{children}</div>
    </div>
  )
}

export default function Documente() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialTab = (
    searchParams.get("tab") === "inventory"
      ? "inventory"
      : searchParams.get("tab") === "production"
        ? "production"
        : searchParams.get("tab") === "invoice"
          ? "invoice"
      : searchParams.get("tab") === "receipt"
            ? "receipt"
            : searchParams.get("tab") === "minutes"
              ? "minutes"
          : "consumption"
  ) as ActiveTab
  const token =
    getToken() || ""
  const efacturaEnabled = hasModule("efactura")

  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab)
  const [dateFrom, setDateFrom] = useState(
    `${monthStart.getFullYear()}-${`${monthStart.getMonth() + 1}`.padStart(2, "0")}-${`${monthStart.getDate()}`.padStart(2, "0")}`
  )
  const [dateTo, setDateTo] = useState(
    `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`
  )
  const [search, setSearch] = useState("")
  const [efacturaFilter, setEfacturaFilter] = useState("all")
  const [minutesFilter, setMinutesFilter] = useState<"all" | "DETERIORATION" | "PRICE_CHANGE">("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [locations] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [selectedLocationId, setSelectedLocationId] = useState(getActiveLocationId())

  const [consumptionDocs, setConsumptionDocs] = useState<ConsumptionDocListItem[]>([])
  const [productionDocs, setProductionDocs] = useState<ProductionDocListItem[]>([])
  const [inventoryDocs, setInventoryDocs] = useState<InventoryDocListItem[]>([])
  const [invoiceDocs, setInvoiceDocs] = useState<SalesInvoiceListItem[]>([])
  const [receiptDocs, setReceiptDocs] = useState<ReceiptListItem[]>([])
  const [minutesDocs, setMinutesDocs] = useState<MinutesDocListItem[]>([])

  const [selectedConsumptionDocId, setSelectedConsumptionDocId] = useState<string | null>(null)
  const [selectedConsumptionDoc, setSelectedConsumptionDoc] = useState<ConsumptionDocDetail | null>(null)

  const [selectedProductionDocId, setSelectedProductionDocId] = useState<string | null>(null)
  const [selectedProductionDoc, setSelectedProductionDoc] = useState<ProductionDocDetail | null>(null)

  const [selectedInventoryDocId, setSelectedInventoryDocId] = useState<string | null>(null)
  const [selectedInventoryDoc, setSelectedInventoryDoc] = useState<InventoryDocDetail | null>(null)

  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "inventory" || tab === "production" || tab === "consumption" || tab === "invoice" || tab === "receipt" || tab === "minutes") {
      setActiveTab(tab as ActiveTab)
    }
  }, [searchParams])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setSelectedLocationId(nextLocationId)
    })
  }, [])

  useEffect(() => {
    if (activeTab === "consumption") {
      loadConsumptionDocs()
    } else if (activeTab === "production") {
      loadProductionDocs()
    } else if (activeTab === "invoice") {
      loadInvoiceDocs()
    } else if (activeTab === "receipt") {
      loadReceiptDocs()
    } else if (activeTab === "minutes") {
      loadMinutesDocs()
    } else {
      loadInventoryDocs()
    }
  }, [activeTab, dateFrom, dateTo, selectedLocationId])

  async function loadMinutesDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/minutes-docs`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut ?nc?rca procesele verbale.")
      }

      let items: MinutesDocListItem[] = Array.isArray(data?.items) ? data.items : []

      if (selectedLocationId) {
        items = items.filter((doc) => String(doc.location?.id || "") === selectedLocationId)
      }

      if (dateFrom || dateTo) {
        items = items.filter((doc) => {
          const value = String(doc.docDate || "").slice(0, 10)
          const fromOk = !dateFrom || value >= dateFrom
          const toOk = !dateTo || value <= dateTo
          return fromOk && toOk
        })
      }

      setMinutesDocs(items)
    } catch (err) {
      console.error("LOAD MINUTES DOCS ERROR", err)
      setMinutesDocs([])
      setError("Nu am putut ?nc?rca procesele verbale.")
    } finally {
      setLoading(false)
    }
  }

  async function loadReceiptDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Nu am putut ?nc?rca recep?iile NIR.")
      }

      let items: ReceiptListItem[] = Array.isArray(data?.receipts)
        ? data.receipts
        : Array.isArray(data?.items)
          ? data.items
        : Array.isArray(data)
          ? data
          : []

      if (selectedLocationId) {
        items = items.filter((doc) => String(doc?.location?.id || doc?.warehouse?.id || "") === selectedLocationId)
      }

      if (dateFrom || dateTo) {
        items = items.filter((doc) => {
          const value = String(doc.docDate || doc.date || "").slice(0, 10)
          const fromOk = !dateFrom || value >= dateFrom
          const toOk = !dateTo || value <= dateTo
          return fromOk && toOk
        })
      }

      setReceiptDocs(items)
    } catch (err) {
      console.error("LOAD RECEIPTS ERROR", err)
      setReceiptDocs([])
      setError("Nu am putut ?nc?rca recep?iile NIR.")
    } finally {
      setLoading(false)
    }
  }

  async function loadInvoiceDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/sales-invoices`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut ?nc?rca facturile.")
      }

      let items = Array.isArray(data.invoices) ? data.invoices : []

      if (selectedLocationId) {
        items = items.filter((doc: SalesInvoiceListItem) => doc.location?.id === selectedLocationId)
      }

      if (dateFrom || dateTo) {
        items = items.filter((doc: SalesInvoiceListItem) => {
          const value = String(doc.docDate || "").slice(0, 10)
          const fromOk = !dateFrom || value >= dateFrom
          const toOk = !dateTo || value <= dateTo
          return fromOk && toOk
        })
      }

      setInvoiceDocs(items)
    } catch (err) {
      console.error("LOAD SALES INVOICES ERROR", err)
      setInvoiceDocs([])
      setError("Nu am putut ?nc?rca facturile.")
    } finally {
      setLoading(false)
    }
  }

  async function loadConsumptionDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set("dateFrom", `${dateFrom}T00:00:00.000Z`)
      if (dateTo) params.set("dateTo", `${dateTo}T23:59:59.999Z`)
      if (selectedLocationId) params.set("locationId", selectedLocationId)
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
        throw new Error("Nu am putut ?nc?rca bonurile de consum.")
      }

      setConsumptionDocs(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error("LOAD CONSUMPTION DOCS ERROR", err)
      setConsumptionDocs([])
      setError("Nu am putut ?nc?rca bonurile de consum.")
    } finally {
      setLoading(false)
    }
  }

  async function loadProductionDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams()
      if (selectedLocationId) params.set("locationId", selectedLocationId)
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
        throw new Error("Nu am putut ?nc?rca documentele de produc?ie.")
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
      setError("Nu am putut ?nc?rca documentele de produc?ie.")
    } finally {
      setLoading(false)
    }
  }

  async function loadInventoryDocs() {
    if (!token) {
      setLoading(false)
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams()
      if (selectedLocationId) params.set("locationId", selectedLocationId)
      if (search.trim()) params.set("q", search.trim())
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)

      const res = await fetch(`${API}/api/v1/inventory-docs?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: InventoryListResponse = await res.json().catch(() => ({
        ok: false,
        items: [],
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut ?nc?rca documentele de inventar.")
      }

      setInventoryDocs(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error("LOAD INVENTORY DOCS ERROR", err)
      setInventoryDocs([])
      setError("Nu am putut ?nc?rca documentele de inventar.")
    } finally {
      setLoading(false)
    }
  }

  async function openConsumptionDetail(id: string) {
    if (!token) return

    setSelectedConsumptionDocId(id)
    setSelectedProductionDocId(null)
    setSelectedInventoryDocId(null)
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
        throw new Error("Nu am putut ?nc?rca detaliul bonului de consum.")
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
    setSelectedInventoryDocId(null)
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
        throw new Error("Nu am putut ?nc?rca documentul de produc?ie.")
      }

      setSelectedProductionDoc(data.item)
    } catch (err) {
      console.error("LOAD PRODUCTION DOC DETAIL ERROR", err)
      setSelectedProductionDoc(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function openInventoryDetail(id: string) {
    if (!token) return

    setSelectedInventoryDocId(id)
    setSelectedConsumptionDocId(null)
    setSelectedProductionDocId(null)
    setDetailLoading(true)
    setSelectedInventoryDoc(null)

    try {
      const res = await fetch(`${API}/api/v1/inventory-docs/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data: InventoryDetailResponse = await res.json().catch(() => ({
        ok: false,
        item: null as never,
      }))

      if (!res.ok || !data.ok) {
        throw new Error("Nu am putut ?nc?rca documentul de inventar.")
      }

      setSelectedInventoryDoc(data.item)
    } catch (err) {
      console.error("LOAD INVENTORY DOC DETAIL ERROR", err)
      setSelectedInventoryDoc(null)
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

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF ERROR", err)
      alert("Nu am putut genera PDF-ul.")
    }
  }

  async function openProductionPdf(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/production-docs/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF PRODUCTION ERROR", err)
      alert("Nu am putut genera PDF-ul documentului de produc?ie.")
    }
  }

  async function openInventoryPdf(id: string) {
    const authToken = getToken()
    if (!authToken) return

    try {
      const res = await fetch(`${API}/api/v1/inventory-docs/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF INVENTORY ERROR", err)
      alert("Nu am putut genera PDF-ul inventarului.")
    }
  }

  async function openInvoicePdf(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/sales-invoices/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF INVOICE ERROR", err)
      alert("Nu am putut genera PDF-ul facturii.")
    }
  }

  async function openReceiptPdf(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF RECEIPT ERROR", err)
      alert("Nu am putut genera PDF-ul receptiei.")
    }
  }

  async function openMinutesPdf(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/minutes-docs/${id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error("Nu am putut genera PDF.")
      }

      await openPdfInNewTab(res)
    } catch (err) {
      console.error("PDF MINUTES ERROR", err)
      alert("Nu am putut genera PDF-ul procesului verbal.")
    }
  }

  async function sendInvoiceEfactura(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/sales-invoices/${id}/efactura/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut trimite factura la ANAF.")
      }

      setMessage(data?.message || "Factura a fost transmisa la ANAF.")
      await loadInvoiceDocs()
    } catch (err: any) {
      setError(err?.message || "Nu am putut trimite factura la ANAF.")
    }
  }

  async function checkInvoiceEfacturaStatus(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/sales-invoices/${id}/efactura/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut verifica starea la ANAF.")
      }

      setMessage(data?.message || "Starea facturii a fost actualizata.")
      await loadInvoiceDocs()
    } catch (err: any) {
      setError(err?.message || "Nu am putut verifica starea la ANAF.")
    }
  }

  async function openInvoiceReceipt(id: string) {
    if (!token) return

    try {
      const res = await fetch(`${API}/api/v1/sales-invoices/${id}/efactura/receipt`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Nu am putut descarca recipisa ANAF.")
      }

      await openPdfInNewTab(res)
      setMessage("Recipisa ANAF a fost descarcata.")
      await loadInvoiceDocs()
    } catch (err: any) {
      setError(err?.message || "Nu am putut descarca recipisa ANAF.")
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

  const filteredInventoryDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return inventoryDocs

    return inventoryDocs.filter((doc) => {
      const values = [
        doc.docNo,
        doc.note || "",
        doc.location?.name || "",
        doc.location?.code || "",
        doc.status || "",
      ].join(" ").toLowerCase()

      return values.includes(q)
    })
  }, [inventoryDocs, search])

  const filteredInvoiceDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    let items = invoiceDocs

    if (efacturaEnabled && efacturaFilter !== "all") {
      items = items.filter((doc) => {
        const status = String(doc.efacturaStatus || "NOT_READY").toUpperCase()
        return status === efacturaFilter
      })
    }

    if (!q) return items

    return items.filter((doc) => {
      const values = [
        doc.docNo,
        doc.customerName || "",
        doc.customerCif || "",
        doc.location?.name || "",
        doc.status || "",
        doc.efacturaStatus || "",
      ]
        .join(" ")
        .toLowerCase()

      return values.includes(q)
    })
  }, [invoiceDocs, search, efacturaEnabled, efacturaFilter])

  const filteredReceiptDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return receiptDocs

    return receiptDocs.filter((doc) => {
      const values = [
        doc.docNo,
        doc.number,
        doc.supplier?.name,
        doc.supplierName,
        doc.supplier?.code,
        doc.supplierCode,
        doc.supplier?.cif,
        doc.location?.name,
        doc.warehouse?.name,
        doc.note,
        doc.series,
        doc.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return values.includes(q)
    })
  }, [receiptDocs, search])

  const filteredMinutesDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    let items = minutesDocs

    if (minutesFilter !== "all") {
      items = items.filter((doc) => doc.type === minutesFilter)
    }

    if (!q) return items

    return items.filter((doc) => {
      const values = [
        doc.docNo,
        doc.location?.name,
        doc.location?.code,
        doc.reasonCode,
        doc.note,
        doc.status,
        minutesTypeLabel(doc.type),
        minutesReasonLabel(doc.reasonCode),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return values.includes(q)
    })
  }, [minutesDocs, search, minutesFilter])

  const activeTabMeta =
    activeTab === "consumption"
      ? {
          title: "Istoric bonuri de consum",
          subtitle: "Vizualizezi documentele generate automat la consumul din retetar.",
          placeholder: "Nr document, bon POS, produs, nota...",
          resultCount: filteredConsumptionDocs.length,
        }
      : activeTab === "production"
        ? {
            title: "Istoric documente productie",
            subtitle: "Vizualizezi documentele de productie si produsele finite realizate.",
            placeholder: "Nr document, produs, nota...",
            resultCount: filteredProductionDocs.length,
          }
        : activeTab === "invoice"
          ? {
              title: "Istoric facturi",
              subtitle: "Urmaresti facturile comerciale, clientii si valorile emise in ERP.",
              placeholder: "Nr factura, client, CIF, locatie...",
              resultCount: filteredInvoiceDocs.length,
            }
          : activeTab === "receipt"
            ? {
                title: "Istoric receptii NIR",
                subtitle: "Urm?re?ti notele de recep?ie ?i furnizorii din documente.",
                placeholder: "Nr document, furnizor, CIF, locatie...",
                resultCount: filteredReceiptDocs.length,
              }
            : activeTab === "minutes"
              ? {
                  title: "Procese verbale",
                  subtitle: "Urm?re?ti deterior?rile ?i schimb?rile de pre?.",
                  placeholder: "Nr document, tip, motiv, locatie...",
                  resultCount: filteredMinutesDocs.length,
                }
          : {
              title: "Istoric documente inventar",
              subtitle: "Vizualizezi inventarele, diferentele si statusul lor.",
              placeholder: "Nr document, locatie, status, nota...",
              resultCount: filteredInventoryDocs.length,
            }

  const quickCards =
    activeTab === "consumption"
      ? [
          {
            title: "Bonuri de consum",
            value: String(filteredConsumptionDocs.length),
            hint: "Documente generate automat din v?nz?ri",
            icon: FilePlus2,
            tone: "blue",
          },
          {
            title: "Pozi?ii consum",
            value: String(filteredConsumptionDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
            hint: "Ingrediente consumate ?n documentele filtrate",
            icon: Repeat2,
            tone: "slate",
          },
          {
            title: "Cantitate total?",
            value: formatNumber(filteredConsumptionDocs.reduce((sum, doc) => sum + doc.totalQty, 0)),
            hint: "Total cantit??i consumate",
            icon: FileCheck2,
            tone: "emerald",
          },
        ]
      : activeTab === "production"
        ? [
            {
              title: "Documente produc?ie",
              value: String(filteredProductionDocs.length),
              hint: "Documente generate la produc?ie",
              icon: Factory,
              tone: "blue",
            },
            {
              title: "Pozi?ii produse",
              value: String(filteredProductionDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
              hint: "Produse finite produse",
              icon: FilePlus2,
              tone: "slate",
            },
            {
              title: "Cantitate total?",
              value: formatNumber(filteredProductionDocs.reduce((sum, doc) => sum + doc.totalQty, 0)),
              hint: "Total cantit??i produse",
              icon: FileCheck2,
              tone: "emerald",
            },
          ]
        : activeTab === "invoice"
          ? [
              {
                title: "Facturi",
                value: String(filteredInvoiceDocs.length),
                hint: "Facturi comerciale create ?n ERP",
                icon: FilePlus2,
                tone: "blue",
              },
              {
                title: "Pozi?ii facturate",
                value: String(filteredInvoiceDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
                hint: "Linii de produse din facturile filtrate",
                icon: ClipboardList,
                tone: "slate",
              },
              {
                title: "Valoare total?",
                value: formatRon(filteredInvoiceDocs.reduce((sum, doc) => sum + Number(doc.totalGrossFc || 0), 0)),
                hint: "Total facturat pe interval",
                icon: FileCheck2,
                tone: "emerald",
              },
              ...(efacturaEnabled
                ? [
                    {
                      title: "e-Factura trimise",
                      value: String(filteredInvoiceDocs.filter((doc) => doc.efacturaStatus === "SENT" || doc.efacturaStatus === "ACCEPTED").length),
                      hint: "Facturi deja urcate in ANAF",
                      icon: FileText,
                      tone: "amber",
                    },
                  ]
                : []),
            ]
        : activeTab === "receipt"
          ? [
              {
                title: "Receptii NIR",
                value: String(filteredReceiptDocs.length),
                hint: "Documente de recep?ie",
                icon: PackageSearch,
                tone: "blue",
              },
              {
                title: "Pozitii",
                value: String(filteredReceiptDocs.reduce((sum, doc) => sum + Number(doc.itemsCount || doc.linesCount || doc.itemCount || 0), 0)),
                hint: "Linii recep?ionate",
                icon: FilePlus2,
                tone: "slate",
              },
              {
                title: "Valoare total?",
                value: formatRon(filteredReceiptDocs.reduce((sum, doc) => sum + Number(doc.totalGrossRon || doc.totalRon || doc.grandTotal || doc.total || 0), 0)),
                hint: "Total recep?ionat",
                icon: FileCheck2,
                tone: "emerald",
              },
            ]
          : activeTab === "minutes"
            ? [
                {
                  title: "Procese verbale",
                  value: String(filteredMinutesDocs.length),
                  hint: "Documente filtrate",
                  icon: FileText,
                  tone: "blue",
                },
                {
                  title: "Pozitii",
                  value: String(filteredMinutesDocs.reduce((sum, doc) => sum + Number(doc.itemsCount || 0), 0)),
                  hint: "Produse afectate",
                  icon: FilePlus2,
                  tone: "slate",
                },
                {
                  title: "Valoare total?",
                  value: formatRon(filteredMinutesDocs.reduce((sum, doc) => sum + Number(doc.totalValue || 0), 0)),
                  hint: "Valoare documente",
                  icon: FileCheck2,
                  tone: "emerald",
                },
              ]
        : [
            {
              title: "Documente inventar",
              value: String(filteredInventoryDocs.length),
              hint: "Inventare create ?n intervalul selectat",
              icon: ClipboardList,
              tone: "blue",
            },
            {
              title: "Pozi?ii inventariate",
              value: String(filteredInventoryDocs.reduce((sum, doc) => sum + doc.itemsCount, 0)),
              hint: "Total produse din inventarele filtrate",
              icon: FilePlus2,
              tone: "slate",
            },
            {
              title: "Diferen?? total?",
              value: formatNumber(filteredInventoryDocs.reduce((sum, doc) => sum + doc.totalDifferenceQty, 0), 3),
              hint: "Diferen?? total? dintre scriptic ?i num?rat",
              icon: FileCheck2,
              tone: "emerald",
            },
          ]

  return (
    <div className="space-y-3">
      <PageHeader
        badge="documente"
        title="Documente"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("consumption")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "consumption"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Repeat2 size={15} />
          Bonuri de consum
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("production")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "production"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Factory size={15} />
          Produc?ie
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("invoice")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "invoice"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <FileText size={15} />
          Facturi
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "inventory"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <ClipboardList size={15} />
          Inventare
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("receipt")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "receipt"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <PackageSearch size={15} />
          Note de recep?ie
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("minutes")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeTab === "minutes"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <FileText size={15} />
          Procese verbale
        </button>

        {efacturaEnabled ? (
          <button
            type="button"
            onClick={() => navigate("/documente/facturi-primite-spv")}
            className="inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <FileText size={15} />
            Facturi primite SPV
          </button>
        ) : null}
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {quickCards.map((card) => (
          <DocumentMetric
            key={card.title}
            title={card.title}
            value={
              <div>
                <div>{card.value}</div>
                <div className="mt-1 text-[12px] font-normal text-slate-500">{card.hint}</div>
              </div>
            }
            tone={card.tone as "blue" | "slate" | "emerald" | "amber"}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[15px] font-semibold text-slate-900">{activeTabMeta.title}</div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (activeTab === "consumption") {
                  loadConsumptionDocs()
                } else if (activeTab === "production") {
                  loadProductionDocs()
                } else if (activeTab === "invoice") {
                  loadInvoiceDocs()
                } else if (activeTab === "receipt") {
                  loadReceiptDocs()
                } else if (activeTab === "minutes") {
                  loadMinutesDocs()
                } else {
                  loadInventoryDocs()
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:bg-white"
            >
              <PackageSearch size={15} />
              Re?ncarc?
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div>
              <select
                value={selectedLocationId}
                onChange={(e) => {
                  const nextLocationId = e.target.value
                  setSelectedLocationId(nextLocationId)
                  setActiveLocationId(nextLocationId)
                }}
                className="hidden"
              >
                <option value="">Toate locațiile</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code ? `${location.name} (${location.code})` : location.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={documentInputClass}
              />
            </div>

            <div>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={documentInputClass}
              />
            </div>

            <div className="md:col-span-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTabMeta.placeholder}
                className={documentInputClass}
              />
            </div>
          </div>

          {activeTab === "invoice" && efacturaEnabled ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {[
                { value: "all", label: "Toate" },
                { value: "NOT_READY", label: "Nepregatite" },
                { value: "PREPARED", label: "Pregatite" },
                { value: "SENT", label: "Trimise" },
                { value: "ACCEPTED", label: "Acceptate" },
                { value: "REJECTED", label: "Respinse" },
                { value: "ERROR", label: "Erori" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setEfacturaFilter(item.value)}
                  className={`inline-flex items-center rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
                    efacturaFilter === item.value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === "minutes" ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {[
                { value: "all", label: "Toate" },
                { value: "DETERIORATION", label: "Deteriorare" },
                { value: "PRICE_CHANGE", label: "Schimbare pret" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setMinutesFilter(item.value as typeof minutesFilter)}
                  className={`inline-flex items-center rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
                    minutesFilter === item.value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700">
              <Filter size={14} />
              {selectedLocationId ? "Filtrare din topbar" : "Toate locatiile"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700">
              <Search size={14} />
              {activeTabMeta.resultCount} documente
            </span>
            {search.trim() ? <span className="text-slate-500">Cautare: {search.trim()}</span> : null}
          </div>
        </div>

        {activeTab === "consumption" ? (
          <div className="overflow-hidden rounded-[16px] border border-slate-200">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Tip</th>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bon POS</th>
                  <th className="px-3 py-2.5 text-left font-medium">Produse</th>
                  <th className="px-3 py-2.5 text-left font-medium">Cantitate</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? bonurile de consum...
                    </td>
                  </tr>
                ) : filteredConsumptionDocs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? bonuri de consum ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredConsumptionDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-700">Consum</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.location?.name || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.sale?.receiptNo || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {doc.finishedProducts.length > 0
                          ? doc.finishedProducts.map((p) => p.name).join(", ")
                          : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{formatNumber(doc.totalQty)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass("Generat")}`}>
                          Generat
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
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
        ) : activeTab === "production" ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Tip</th>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Produse</th>
                  <th className="px-3 py-2.5 text-left font-medium">Cantitate</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={efacturaEnabled ? 9 : 8} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? documentele de produc?ie...
                    </td>
                  </tr>
                ) : filteredProductionDocs.length === 0 ? (
                  <tr>
                    <td colSpan={efacturaEnabled ? 9 : 8} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? documente de produc?ie ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredProductionDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-700">Produc?ie</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.locationName || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {doc.products.length > 0
                          ? doc.products.map((p) => p.name).join(", ")
                          : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{formatNumber(doc.totalQty)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass("Produs")}`}>
                          Produs
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openProductionPdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={16} />
                            PDF
                          </button>

                          <button
                            type="button"
                            onClick={() => openProductionDetail(doc.id)}
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
        ) : activeTab === "invoice" ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Client</th>
                  <th className="px-3 py-2.5 text-left font-medium">CIF</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  {efacturaEnabled ? <th className="px-3 py-2.5 text-left font-medium">e-Factura</th> : null}
                  <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? facturile...
                    </td>
                  </tr>
                ) : filteredInvoiceDocs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? facturi ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredInvoiceDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.customerName || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.customerCif || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.location?.name || "-"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(doc.status === "ISSUED" ? "Generat" : doc.status === "CANCELLED" ? "Anulat" : "Produs")}`}>
                          {doc.status}
                        </span>
                      </td>
                      {efacturaEnabled ? (
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${efacturaStatusClass(doc.efacturaStatus)}`}>
                              {doc.efacturaStatus || "NOT_READY"}
                            </span>
                            {doc.efacturaUploadIndex ? <span className="text-[11px] text-slate-500">ID {doc.efacturaUploadIndex}</span> : null}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 text-slate-600">{formatNumber(doc.totalGrossFc)} {doc.currency}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openInvoicePdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={16} />
                            PDF
                          </button>
                          {efacturaEnabled ? (
                            <button
                              type="button"
                              onClick={() => sendInvoiceEfactura(doc.id)}
                              disabled={doc.status !== "ISSUED" || (doc.efacturaStatus !== "PREPARED" && doc.efacturaStatus !== "READY_TO_SEND" && doc.efacturaStatus !== "ERROR" && doc.efacturaStatus !== "REJECTED")}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              ANAF
                            </button>
                          ) : null}
                          {efacturaEnabled ? (
                            <button
                              type="button"
                              onClick={() => checkInvoiceEfacturaStatus(doc.id)}
                              disabled={!doc.efacturaUploadIndex}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Status
                            </button>
                          ) : null}
                          {efacturaEnabled ? (
                            <button
                              type="button"
                              onClick={() => openInvoiceReceipt(doc.id)}
                              disabled={!doc.efacturaUploadIndex}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Recipisa
                            </button>
                          ) : null}
                          <a
                            href={`/inregistrare-document/factura/edit?id=${doc.id}`}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                          >
                            Deschide
                            <ArrowRight size={16} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "receipt" ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Furnizor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? recep?iile NIR...
                    </td>
                  </tr>
                ) : filteredReceiptDocs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? note de recep?ie ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredReceiptDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo || doc.number || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate || doc.date)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.supplier?.name || doc.supplierName || doc.vendor?.name || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.location?.name || doc.warehouse?.name || "-"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass((doc.status || "Draft") === "POSTED" ? "Generat" : doc.status || "Draft")}`}>
                          {doc.status || "DRAFT"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {formatRon(Number(doc.totalGrossRon || doc.totalRon || doc.grandTotal || doc.total || 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openReceiptPdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={16} />
                            PDF
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/inregistrare-document/nir/edit?id=${doc.id}`)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
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
        ) : activeTab === "minutes" ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Tip</th>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Motiv</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? procesele verbale...
                    </td>
                  </tr>
                ) : filteredMinutesDocs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? procese verbale ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredMinutesDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-600">{minutesTypeLabel(doc.type)}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.location?.name || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{minutesReasonLabel(doc.reasonCode)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(doc.status === "POSTED" ? "Generat" : doc.status === "CANCELLED" ? "Anulat" : "Draft")}`}>
                          {doc.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{formatRon(Number(doc.totalValue || 0))}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openMinutesPdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={15} />
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                doc.type === "PRICE_CHANGE"
                                  ? `/inregistrare-document/pv-schimbare-pret/edit?id=${doc.id}`
                                  : `/inregistrare-document/pv-deteriorare/edit?id=${doc.id}`
                              )
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                          >
                            Deschide
                            <ArrowRight size={15} />
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
                  <th className="px-3 py-2.5 text-left font-medium">Tip</th>
                  <th className="px-3 py-2.5 text-left font-medium">Num?r</th>
                  <th className="px-3 py-2.5 text-left font-medium">Data</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loca?ie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Pozi?ii</th>
                  <th className="px-3 py-2.5 text-left font-medium">Diferen??</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ac?iune</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Se ?ncarc? documentele de inventar...
                    </td>
                  </tr>
                ) : filteredInventoryDocs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Nu exist? documente de inventar ?n intervalul selectat.
                    </td>
                  </tr>
                ) : (
                  filteredInventoryDocs.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-700">Inventar</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{doc.docNo}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDate(doc.docDate)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.location?.name || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{doc.itemsCount}</td>
                      <td className={`px-3 py-2.5 ${diffClass(doc.totalDifferenceQty)}`}>
                        {formatNumber(doc.totalDifferenceQty, 3)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(inventoryStatusText(doc.status))}`}>
                          {inventoryStatusText(doc.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openInventoryPdf(doc.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Printer size={16} />
                            PDF
                          </button>

                          <button
                            type="button"
                            onClick={() => openInventoryDetail(doc.id)}
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
        )}
      </div>

      {selectedConsumptionDocId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 md:p-8">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedConsumptionDoc ? `Detaliu bon de consum ${selectedConsumptionDoc.docNo}` : "Detaliu bon de consum"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Vizualizezi consumul generat automat din v?nzare ?i re?etar.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectedConsumptionDoc && openPdf(selectedConsumptionDoc.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-white"
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
                  className="inline-flex items-center gap-1.5 rounded-[14px] border border-[#E8E3DA] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#17324D] hover:bg-[#FCFBF8]"
                >
                  <X size={16} />
                  ?nchide
                </button>
              </div>
            </div>

            {detailLoading || !selectedConsumptionDoc ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Se ?ncarc? detaliul documentului...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Num?r</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedConsumptionDoc.docNo}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(selectedConsumptionDoc.docDate)}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Loca?ie</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedConsumptionDoc.location?.name || "-"}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Cantitate total?</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatNumber(selectedConsumptionDoc.totalQty)}</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-4 text-lg font-semibold text-slate-900">Bon POS surs?</div>

                  {selectedConsumptionDoc.sale ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Bon</div>
                        <div className="mt-2 font-semibold text-slate-900">{selectedConsumptionDoc.sale.receiptNo || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data v?nz?rii</div>
                        <div className="mt-2 text-slate-700">{formatDateTime(selectedConsumptionDoc.sale.soldAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</div>
                        <div className="mt-2 text-slate-700">{formatRon(selectedConsumptionDoc.sale.total)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Plat?</div>
                        <div className="mt-2 text-slate-700">{selectedConsumptionDoc.sale.paymentType}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Operator</div>
                        <div className="mt-2 text-slate-700">{selectedConsumptionDoc.sale.operatorName || "-"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Document f?r? leg?tur? la v?nzare.</div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-4 text-lg font-semibold text-slate-900">Linii de consum</div>

                  <MobileTable minWidthClass="min-w-[720px]">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-medium">Produs finit</th>
                          <th className="px-3 py-2.5 text-left font-medium">Ingredient</th>
                          <th className="px-3 py-2.5 text-left font-medium">Cantitate</th>
                          <th className="px-3 py-2.5 text-left font-medium">Not?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedConsumptionDoc.items.map((item) => (
                          <tr key={item.id} className="border-t border-slate-200">
                            <td className="px-3 py-2.5 text-slate-700">
                              {item.finishedProduct ? item.finishedProduct.name : "-"}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-slate-900">
                              {item.ingredient.name}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">{formatNumber(item.qty)}</td>
                            <td className="px-3 py-2.5 text-slate-600">{item.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </MobileTable>
                </div>

                {selectedConsumptionDoc.sale?.items?.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-4 text-lg font-semibold text-slate-900">Linii v?nzare</div>

                    <MobileTable minWidthClass="min-w-[640px]">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-medium">Produs</th>
                            <th className="px-3 py-2.5 text-left font-medium">Cantitate</th>
                            <th className="px-3 py-2.5 text-left font-medium">Pre?</th>
                            <th className="px-3 py-2.5 text-left font-medium">TVA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedConsumptionDoc.sale.items.map((item) => (
                            <tr key={item.id} className="border-t border-slate-200">
                              <td className="px-3 py-2.5 font-semibold text-slate-900">{item.product.name}</td>
                              <td className="px-3 py-2.5 text-slate-600">{formatNumber(item.qty)}</td>
                              <td className="px-3 py-2.5 text-slate-600">{formatRon(item.unitPrice)}</td>
                              <td className="px-3 py-2.5 text-slate-600">{item.vatRate}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </MobileTable>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedProductionDocId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 md:p-8">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedProductionDoc ? `Detaliu produc?ie ${selectedProductionDoc.docNo}` : "Detaliu produc?ie"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Vizualizezi produsele finite realizate ?i ingredientele consumate.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectedProductionDoc && openProductionPdf(selectedProductionDoc.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-white"
                >
                  <Printer size={16} />
                  PDF
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedProductionDocId(null)
                    setSelectedProductionDoc(null)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[14px] border border-[#E8E3DA] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#17324D] hover:bg-[#FCFBF8]"
                >
                  <X size={16} />
                  ?nchide
                </button>
              </div>
            </div>

            {detailLoading || !selectedProductionDoc ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Se ?ncarc? detaliul documentului...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Num?r</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedProductionDoc.docNo}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(selectedProductionDoc.docDate)}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Loca?ie</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedProductionDoc.locationName || "-"}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Cantitate total?</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatNumber(selectedProductionDoc.totalQty)}</div>
                  </div>
                </div>

                {selectedProductionDoc.items.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{row.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                                  {row.sku} - {formatNumber(row.qty)} {row.uom}
                        </div>
                      </div>
                    </div>

                    <MobileTable minWidthClass="min-w-[620px]">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-medium">Ingredient</th>
                            <th className="px-3 py-2.5 text-left font-medium">SKU</th>
                            <th className="px-3 py-2.5 text-left font-medium">UM</th>
                            <th className="px-3 py-2.5 text-left font-medium">Cantitate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.ingredients.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                                Nu exist? ingrediente.
                              </td>
                            </tr>
                          ) : (
                            row.ingredients.map((ingredient) => (
                              <tr key={ingredient.ingredientId} className="border-t border-slate-200">
                                <td className="px-3 py-2.5 font-semibold text-slate-900">{ingredient.name}</td>
                                <td className="px-3 py-2.5 text-slate-600">{ingredient.sku}</td>
                                <td className="px-3 py-2.5 text-slate-600">{ingredient.uom}</td>
                                <td className="px-3 py-2.5 text-slate-600">{formatNumber(ingredient.qty)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </MobileTable>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedInventoryDocId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 md:p-8">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {selectedInventoryDoc ? `Detaliu inventar ${selectedInventoryDoc.docNo}` : "Detaliu inventar"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Vizualizezi pozi?iile inventariate, cantit??ile scriptice ?i diferen?ele.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectedInventoryDoc && openInventoryPdf(selectedInventoryDoc.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-white"
                >
                  <Printer size={16} />
                  PDF
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedInventoryDocId(null)
                    setSelectedInventoryDoc(null)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[14px] border border-[#E8E3DA] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#17324D] hover:bg-[#FCFBF8]"
                >
                  <X size={16} />
                  ?nchide
                </button>
              </div>
            </div>

            {detailLoading || !selectedInventoryDoc ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Se ?ncarc? detaliul documentului...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Num?r</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedInventoryDoc.docNo}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(selectedInventoryDoc.docDate)}</div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Loca?ie</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedInventoryDoc.location?.name || "-"}</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">
                      {inventoryStatusText(selectedInventoryDoc.status)}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Pozi?ii</div>
                    <div className="mt-2 text-base font-semibold text-slate-900">{selectedInventoryDoc.summary.itemsCount}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total scriptic</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">
                      {formatNumber(selectedInventoryDoc.summary.totalSystemQty, 3)}
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Total num?rat</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">
                      {formatNumber(selectedInventoryDoc.summary.totalCountedQty, 3)}
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Diferen?? total?</div>
                    <div className={`mt-2 text-lg font-semibold ${diffClass(selectedInventoryDoc.summary.totalDifferenceQty)}`}>
                      {formatNumber(selectedInventoryDoc.summary.totalDifferenceQty, 3)}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-4 text-lg font-semibold text-slate-900">Pozi?ii inventar</div>

                  <MobileTable minWidthClass="min-w-[760px]">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-medium">Produs</th>
                          <th className="px-3 py-2.5 text-left font-medium">SKU</th>
                          <th className="px-3 py-2.5 text-left font-medium">UM</th>
                          <th className="px-3 py-2.5 text-left font-medium">Scriptic</th>
                          <th className="px-3 py-2.5 text-left font-medium">Num?rat</th>
                          <th className="px-3 py-2.5 text-left font-medium">Diferen??</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInventoryDoc.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                              Nu exist? pozi?ii ?n inventar.
                            </td>
                          </tr>
                        ) : (
                          selectedInventoryDoc.items.map((item) => (
                            <tr key={item.id} className="border-t border-slate-200">
                              <td className="px-3 py-2.5 font-semibold text-slate-900">{item.product.name}</td>
                              <td className="px-3 py-2.5 text-slate-600">{item.product.sku || "-"}</td>
                              <td className="px-3 py-2.5 text-slate-600">{item.product.uom?.code || "-"}</td>
                              <td className="px-3 py-2.5 text-slate-600">{formatNumber(item.systemQty, 3)}</td>
                              <td className="px-3 py-2.5 text-slate-600">{formatNumber(item.countedQty, 3)}</td>
                              <td className={`px-3 py-2.5 ${diffClass(item.differenceQty)}`}>
                                {formatNumber(item.differenceQty, 3)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </MobileTable>
                </div>

                {selectedInventoryDoc.note ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 text-lg font-semibold text-slate-900">Observa?ii</div>
                    <div className="text-sm text-slate-600">{selectedInventoryDoc.note}</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
