import { FormEvent, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, ChevronUp, Download, Mail, Plus, RefreshCw, Save, Search } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { api } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"

type AccountingConfig = {
  articleCodeSource: string
  managementAnalytic: string
  customerAccount: string
  supplierAccount: string
  salesAccount: string
  expenseAccount: string
  inventoryAccount: string
  vatCollectedAccount: string
  vatDeductibleAccount: string
  cashAccount: string
  cardAccount: string
  defaultStockTypeId?: string | null
}

type StockType = {
  id: string
  code: string
  name: string
  inventoryAccount: string
  expenseAccount: string
  salesAccount?: string | null
  analyticMode: string
  isDefault: boolean
}

type ProductAccountingItem = {
  id: string
  sku: string
  name: string
  accountingItemCode?: string | null
  accountingStockTypeId?: string | null
  accountingStockType?: {
    id: string
    code: string
    name: string
  } | null
  vatRate?: {
    rate?: number | string
    fiscalCode?: string | null
    name?: string | null
  } | null
  uom?: {
    code?: string | null
    name?: string | null
  } | null
}

type ConfigResponse = {
  item?: {
    company?: {
      id: string
      name: string
      code?: string | null
    }
    config?: AccountingConfig
    stockTypes?: StockType[]
    exportKinds?: Array<{ code: string; label: string; description?: string; partnerLabel?: string }>
    locations?: Array<{ id: string; name: string; code?: string | null }>
  }
}

type ProductsResponse = {
  items?: ProductAccountingItem[]
}

const emptyConfig: AccountingConfig = {
  articleCodeSource: "SKU",
  managementAnalytic: "LOCATION_CODE",
  customerAccount: "4111",
  supplierAccount: "401",
  salesAccount: "707",
  expenseAccount: "607",
  inventoryAccount: "371",
  vatCollectedAccount: "4427",
  vatDeductibleAccount: "4426",
  cashAccount: "5311",
  cardAccount: "5121",
  defaultStockTypeId: null,
}

const emptyStockType = {
  code: "",
  name: "",
  inventoryAccount: "",
  expenseAccount: "",
  salesAccount: "",
  analyticMode: "LOCATION_CODE",
  isDefault: false,
}

function toInputDate(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

export default function ExportContabilitatePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingStockType, setSavingStockType] = useState(false)
  const [downloadingKind, setDownloadingKind] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [companyName, setCompanyName] = useState("Firma activa")
  const [config, setConfig] = useState<AccountingConfig>(emptyConfig)
  const [stockTypes, setStockTypes] = useState<StockType[]>([])
  const [stockTypeForm, setStockTypeForm] = useState(emptyStockType)
  const [exportKinds, setExportKinds] = useState<Array<{ code: string; label: string; description?: string; partnerLabel?: string }>>([])
  const [locations, setLocations] = useState<Array<{ id: string; name: string; code?: string | null }>>([])
  const [products, setProducts] = useState<ProductAccountingItem[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [savingProductId, setSavingProductId] = useState<string | null>(null)
  const [selectedKind, setSelectedKind] = useState("")
  const [selectedValueType, setSelectedValueType] = useState("CANTITATIV_VALORIC")
  const [selectedFileFormat, setSelectedFileFormat] = useState("xml")
  const [selectedLocationId, setSelectedLocationId] = useState(getActiveLocationId())
  const [partnerSearch, setPartnerSearch] = useState("")
  const [sendEmail, setSendEmail] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showMappings, setShowMappings] = useState(false)
  const today = new Date()
  const [dateFrom, setDateFrom] = useState(toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [dateTo, setDateTo] = useState(toInputDate(today))

  async function load() {
    try {
      setLoading(true)
      setError("")
      const data = await api<ConfigResponse>("/api/v1/reports/accounting/saga/config")
      setCompanyName(data?.item?.company?.name || "Firma activa")
      setConfig({ ...emptyConfig, ...(data?.item?.config || {}) })
      setStockTypes(Array.isArray(data?.item?.stockTypes) ? data.item!.stockTypes! : [])
      setExportKinds(Array.isArray(data?.item?.exportKinds) ? data.item!.exportKinds! : [])
      const nextLocations = Array.isArray(data?.item?.locations) ? data.item!.locations! : []
      setLocations(nextLocations)
      setSelectedLocationId((current) => {
        const preferred = current || getActiveLocationId()
        if (preferred && nextLocations.some((item) => item.id === preferred)) return preferred
        if (nextLocations.length === 1) return nextLocations[0].id
        return ""
      })
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca setarile pentru exportul contabil.")
    } finally {
      setLoading(false)
    }
  }

  async function loadProducts(search = productSearch) {
    try {
      setLoadingProducts(true)
      const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""
      const data = await api<ProductsResponse>(`/api/v1/reports/accounting/saga/products${params}`)
      setProducts(Array.isArray(data?.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca produsele pentru maparea contabila.")
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    loadProducts("")
  }, [])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setSelectedLocationId(nextLocationId || "")
    })
  }, [])

  const configFields = useMemo(
    () => [
      { key: "customerAccount", label: "Cont clienti", placeholder: "4111" },
      { key: "supplierAccount", label: "Cont furnizori", placeholder: "401" },
      { key: "salesAccount", label: "Cont venituri", placeholder: "707" },
      { key: "expenseAccount", label: "Cont cheltuiala", placeholder: "607" },
      { key: "inventoryAccount", label: "Cont stoc", placeholder: "371" },
      { key: "vatCollectedAccount", label: "TVA colectata", placeholder: "4427" },
      { key: "vatDeductibleAccount", label: "TVA deductibila", placeholder: "4426" },
      { key: "cashAccount", label: "Cont casa", placeholder: "5311" },
      { key: "cardAccount", label: "Cont card", placeholder: "5121" },
    ] as Array<{ key: keyof AccountingConfig; label: string; placeholder: string }>,
    []
  )

  const selectedKindMeta = useMemo(
    () => exportKinds.find((item) => item.code === selectedKind) || null,
    [exportKinds, selectedKind]
  )

  const exportGroups = useMemo(
    () => [
      {
        label: "Nomenclatoare",
        items: exportKinds.filter((item) => ["products", "customers", "suppliers"].includes(item.code)),
      },
      {
        label: "Documente de intrare",
        items: exportKinds.filter((item) => ["purchase-receipts"].includes(item.code)),
      },
      {
        label: "Documente de iesire",
        items: exportKinds.filter((item) => ["sales-invoices"].includes(item.code)),
      },
      {
        label: "Documente operationale",
        items: exportKinds.filter((item) => ["consumption-docs", "production-docs"].includes(item.code)),
      },
    ].filter((group) => group.items.length > 0),
    [exportKinds]
  )

  const selectedKindCategory = useMemo(() => {
    if (["products", "customers", "suppliers"].includes(selectedKind)) return "catalog"
    if (["purchase-receipts", "sales-invoices", "consumption-docs", "production-docs"].includes(selectedKind)) return "documents"
    return "generic"
  }, [selectedKind])

  const needsLocationFilter = selectedKindCategory === "documents"
  const needsPartnerFilter = ["customers", "suppliers", "sales-invoices", "purchase-receipts"].includes(selectedKind)
  const supportsGlobalValueType = ["sales-invoices", "purchase-receipts"].includes(selectedKind)
  const needsValueType = selectedKindCategory === "documents"
  const contextualPartnerLabel = selectedKindMeta?.partnerLabel || "Client / partener"

  useEffect(() => {
    if (!needsValueType) {
      setSelectedValueType("CANTITATIV_VALORIC")
      return
    }

    if (!supportsGlobalValueType && selectedValueType !== "CANTITATIV_VALORIC") {
      setSelectedValueType("CANTITATIV_VALORIC")
    }
  }, [needsValueType, selectedKind, selectedValueType, supportsGlobalValueType])

  async function handleSaveConfig(event: FormEvent) {
    event.preventDefault()
    try {
      setSaving(true)
      setError("")
      await api("/api/v1/reports/accounting/saga/config", {
        method: "PATCH",
        body: JSON.stringify(config),
      })
      setMessage("Setarile contabile au fost salvate.")
      window.setTimeout(() => setMessage(""), 1800)
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva configurarea contabila.")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateStockType(event: FormEvent) {
    event.preventDefault()
    try {
      setSavingStockType(true)
      setError("")
      await api("/api/v1/reports/accounting/saga/stock-types", {
        method: "POST",
        body: JSON.stringify(stockTypeForm),
      })
      setStockTypeForm(emptyStockType)
      setMessage("Tipul de stoc a fost adaugat.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva tipul de stoc.")
    } finally {
      setSavingStockType(false)
    }
  }

  async function handleDownload(kind: string) {
    try {
      setDownloadingKind(kind)
      setError("")
      const response = await api<Response>(
        `/api/v1/reports/accounting/saga/export?kind=${encodeURIComponent(kind)}&dateFrom=${encodeURIComponent(
          dateFrom
        )}&dateTo=${encodeURIComponent(dateTo)}&locationId=${encodeURIComponent(selectedLocationId)}&partnerSearch=${encodeURIComponent(
          partnerSearch
        )}&valueType=${encodeURIComponent(selectedValueType)}&fileFormat=${encodeURIComponent(selectedFileFormat)}`,
        { raw: true }
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Nu am putut genera exportul.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const disposition = response.headers.get("content-disposition") || ""
      const match = disposition.match(/filename=\"?([^\";]+)\"?/)
      link.href = url
      link.download = match?.[1] || `export-saga-${kind}.${selectedFileFormat}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || "Nu am putut genera exportul SAGA.")
    } finally {
      setDownloadingKind(null)
    }
  }

  async function handleGenerate() {
    if (!selectedKind) {
      setError("Alege mai intai tipul de document pentru export.")
      return
    }

    setMessage("")
    await handleDownload(selectedKind)
  }

  async function handleSaveProduct(product: ProductAccountingItem) {
    try {
      setSavingProductId(product.id)
      setError("")
      await api(`/api/v1/reports/accounting/saga/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          accountingItemCode: product.accountingItemCode || null,
          accountingStockTypeId: product.accountingStockTypeId || null,
        }),
      })
      setMessage(`Maparea contabila a fost salvata pentru ${product.name}.`)
      window.setTimeout(() => setMessage(""), 1800)
      await loadProducts(productSearch)
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva maparea contabila a produsului.")
    } finally {
      setSavingProductId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        badge="rapoarte"
        title="Export contabilitate"
        subtitle="Configureaza conturile si genereaza fisiere XML, DBF, XLSX sau CSV pentru importul contabil al firmei active."
      />

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Generator export contabilitate</div>
              <div className="mt-1 text-lg font-semibold text-[#17324D]">{companyName}</div>
              <div className="mt-1 text-sm text-slate-500">Flux compact de export, separat de rapoartele generale, inspirat de structura din Freya.</div>
            </div>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              <RefreshCw size={15} />
              Reincarca datele
            </button>
          </div>

          <div className="grid gap-3 xl:grid-cols-5">
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tip export</div>
              <select className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white" value="SAGA">
                <option value="SAGA">SAGA</option>
                <option value="OMC" disabled>OMC - in curand</option>
                <option value="WINMENTOR" disabled>WinMentor - in curand</option>
                <option value="ALTSOFT" disabled>Alt soft - in curand</option>
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tip valoare</div>
              <select
                value={selectedValueType}
                onChange={(e) => setSelectedValueType(e.target.value)}
                disabled={!needsValueType}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="CANTITATIV_VALORIC">Cantitativ valoric</option>
                <option value="GLOBAL_VALORIC" disabled={!supportsGlobalValueType}>Global valoric</option>
              </select>
              {!needsValueType ? <div className="mt-1 text-xs text-slate-500">Nu este necesar pentru nomenclatoare.</div> : null}
              {needsValueType && !supportsGlobalValueType ? (
                <div className="mt-1 text-xs text-slate-500">Pentru acest tip de document folosim momentan varianta cantitativ valorica.</div>
              ) : null}
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Format fisier</div>
              <select
                value={selectedFileFormat}
                onChange={(e) => setSelectedFileFormat(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="xml">XML</option>
                <option value="dbf">DBF</option>
                <option value="xlsx">XLSX</option>
                <option value="csv">CSV</option>
              </select>
              <div className="mt-1 text-xs text-slate-500">Pentru SAGA clasic, formatele principale raman XML si DBF. XLSX sau CSV raman doar pentru ferestrele care importa tabelar.</div>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Data start</div>
              <div className="relative">
                <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </div>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Data stop</div>
              <div className="relative">
                <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </div>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tip document</div>
              <select
                value={selectedKind}
                onChange={(e) => setSelectedKind(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="">Nu ai selectat niciun tip de document</option>
                {exportGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {selectedKindMeta?.description ? (
                <div className="mt-1 text-xs text-slate-500">{selectedKindMeta.description}</div>
              ) : null}
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatie</div>
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                disabled={!needsLocationFilter}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="">Toate locatiile</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code ? `${location.code} - ${location.name}` : location.name}
                  </option>
                ))}
              </select>
              {!needsLocationFilter ? <div className="mt-1 text-xs text-slate-500">Filtrul pe locatie se aplica doar pe documente.</div> : null}
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Gestiune</div>
              <input
                value={
                  needsLocationFilter && selectedLocationId
                    ? locations.find((item) => item.id === selectedLocationId)?.name || ""
                    : needsLocationFilter
                      ? "Nu ai selectat gestiunea"
                      : "Nu se aplica pentru acest export"
                }
                readOnly
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500 outline-none"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{contextualPartnerLabel}</div>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  disabled={!needsPartnerFilter}
                  placeholder={`Cauti dupa nume, cod sau CIF ${contextualPartnerLabel.toLowerCase()}`}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </div>
              {!needsPartnerFilter ? <div className="mt-1 text-xs text-slate-500">Filtrul pe partener este disponibil unde are sens.</div> : null}
            </label>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#17324D]"
              />
              <Mail size={14} />
              Trimite pe email
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">in curand</span>
            </label>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!selectedKind || downloadingKind === selectedKind}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#2d2a5f] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={15} />
              {downloadingKind === selectedKind ? "Se genereaza..." : "Genereaza"}
            </button>
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Exportul se descarca instant in formatul ales. Pastrezi XML unde este util, dar poti folosi si XLSX sau CSV pentru ferestrele SAGA care importa tabelar.
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowConfig((value) => !value)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Configurare SAGA</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Conturi contabile si reguli implicite</div>
            </div>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              {showConfig ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {showConfig ? (
            <form onSubmit={handleSaveConfig} className="mt-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Cod articole</div>
                  <select
                    value={config.articleCodeSource}
                    onChange={(e) => setConfig((prev) => ({ ...prev, articleCodeSource: e.target.value }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  >
                    <option value="SKU">SKU produs</option>
                    <option value="ACCOUNTING_CODE">Cod contabil produs</option>
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Analitic gestiune</div>
                  <select
                    value={config.managementAnalytic}
                    onChange={(e) => setConfig((prev) => ({ ...prev, managementAnalytic: e.target.value }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  >
                    <option value="NONE">Fara analitic</option>
                    <option value="LOCATION_CODE">Cod locatie</option>
                    <option value="LOCATION_NAME">Nume locatie</option>
                  </select>
                </label>

                {configFields.map((field) => (
                  <label key={field.key} className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{field.label}</div>
                    <input
                      value={String(config[field.key] || "")}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tip de stoc implicit</div>
                  <select
                    value={config.defaultStockTypeId || ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, defaultStockTypeId: e.target.value || null }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  >
                    <option value="">Alege tipul implicit</option>
                    {stockTypes.map((stockType) => (
                      <option key={stockType.id} value={stockType.id}>
                        {stockType.name} ({stockType.code})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={saving || loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={15} />
                  {saving ? "Se salveaza..." : "Salveaza configurarea"}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 text-sm text-slate-500">Configurarile avansate sunt ascunse momentan pentru un ecran mai curat.</div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Rezumat export</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Tipurile de document pregatite pentru generator</div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Selectie curenta</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{selectedKindMeta?.label || "Niciun tip selectat"}</div>
              <div className="mt-1 text-xs text-slate-500">{selectedValueType === "GLOBAL_VALORIC" ? "Global valoric" : "Cantitativ valoric"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Filtrare locatie</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {needsLocationFilter
                  ? selectedLocationId
                    ? locations.find((item) => item.id === selectedLocationId)?.name || "Locatie selectata"
                    : "Toate locatiile"
                  : "Nu se aplica"}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {exportKinds.map((item) => (
              <div
                key={item.code}
                className={[
                  "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                  selectedKind === item.code ? "border-[#17324D] bg-slate-100" : "border-slate-200 bg-slate-50",
                ].join(" ")}
              >
                <div>
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-1 text-xs text-slate-500">Disponibil pentru export in XML, DBF, XLSX sau CSV</div>
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {selectedKind === item.code ? "selectat" : "disponibil"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <form onSubmit={handleCreateStockType} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tip de stoc nou</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Configureaza reguli contabile asemanatoare cu Freya</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input
              value={stockTypeForm.code}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="Cod tip stoc"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <input
              value={stockTypeForm.name}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Denumire"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <input
              value={stockTypeForm.inventoryAccount}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, inventoryAccount: e.target.value }))}
              placeholder="Cont stoc"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <input
              value={stockTypeForm.expenseAccount}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, expenseAccount: e.target.value }))}
              placeholder="Cont cheltuiala"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <input
              value={stockTypeForm.salesAccount}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, salesAccount: e.target.value }))}
              placeholder="Cont venit"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <select
              value={stockTypeForm.analyticMode}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, analyticMode: e.target.value }))}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            >
              <option value="NONE">Fara analitic</option>
              <option value="LOCATION_CODE">Analitic dupa cod locatie</option>
              <option value="LOCATION_NAME">Analitic dupa nume locatie</option>
            </select>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={stockTypeForm.isDefault}
              onChange={(e) => setStockTypeForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#17324D]"
            />
            Tip de stoc implicit
          </label>

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={savingStockType}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={15} />
              {savingStockType ? "Se adauga..." : "Adauga tip de stoc"}
            </button>
          </div>
        </form>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tipuri de stoc</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Baza pentru maparea contabila a produselor</div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Tip</th>
                  <th className="px-3 py-2 text-left font-semibold">Cont stoc</th>
                  <th className="px-3 py-2 text-left font-semibold">Cont cheltuiala</th>
                  <th className="px-3 py-2 text-left font-semibold">Cont venit</th>
                </tr>
              </thead>
              <tbody>
                {stockTypes.map((stockType) => (
                  <tr key={stockType.id} className="border-t border-slate-200">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{stockType.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[stockType.code, stockType.analyticMode].filter(Boolean).join(" | ")}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{stockType.inventoryAccount}</td>
                    <td className="px-3 py-3 text-slate-700">{stockType.expenseAccount}</td>
                    <td className="px-3 py-3 text-slate-700">{stockType.salesAccount || "-"}</td>
                  </tr>
                ))}
                {!stockTypes.length ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                      Nu exista tipuri de stoc configurate.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setShowMappings((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Mapare produse</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Cod contabil si tip de stoc pe fiecare produs</div>
          </div>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            {showMappings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {showMappings ? (
          <>
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="text-sm text-slate-500">Aici pregatesti articolele pentru exporturi curate in SAGA, exact unde conteaza.</div>

              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Cauta dupa nume, SKU sau cod contabil"
                  className="h-11 min-w-[280px] rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => loadProducts(productSearch)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
                >
                  <RefreshCw size={15} />
                  {loadingProducts ? "Se cauta..." : "Cauta"}
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Produs</th>
                    <th className="px-3 py-2 text-left font-semibold">Cod contabil</th>
                    <th className="px-3 py-2 text-left font-semibold">Tip stoc</th>
                    <th className="px-3 py-2 text-left font-semibold">TVA / UM</th>
                    <th className="px-3 py-2 text-right font-semibold">Actiune</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{product.name}</div>
                        <div className="mt-1 text-xs text-slate-500">SKU: {product.sku}</div>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={product.accountingItemCode || ""}
                          onChange={(e) =>
                            setProducts((prev) =>
                              prev.map((item) =>
                                item.id === product.id ? { ...item, accountingItemCode: e.target.value } : item
                              )
                            )
                          }
                          placeholder="Cod import SAGA"
                          className="h-10 w-full min-w-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={product.accountingStockTypeId || ""}
                          onChange={(e) =>
                            setProducts((prev) =>
                              prev.map((item) =>
                                item.id === product.id ? { ...item, accountingStockTypeId: e.target.value || null } : item
                              )
                            )
                          }
                          className="h-10 w-full min-w-[220px] rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                        >
                          <option value="">Tip implicit</option>
                          {stockTypes.map((stockType) => (
                            <option key={stockType.id} value={stockType.id}>
                              {stockType.name} ({stockType.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        <div>TVA: {product.vatRate?.rate ?? "-"}%</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {[product.vatRate?.fiscalCode, product.uom?.code].filter(Boolean).join(" | ") || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleSaveProduct(product)}
                          disabled={savingProductId === product.id}
                          className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Save size={14} />
                          {savingProductId === product.id ? "Se salveaza..." : "Salveaza"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!products.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                        {loadingProducts ? "Se incarca produsele..." : "Nu exista produse pentru criteriul cautat."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="mt-3 text-sm text-slate-500">Maparile pe produse sunt ascunse momentan, ca sa ramana sus generatorul cat mai clar.</div>
        )}
      </section>
    </div>
  )
}
