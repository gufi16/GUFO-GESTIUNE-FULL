import { FormEvent, useEffect, useMemo, useState } from "react"
import { Download, Plus, RefreshCw, Save } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { api } from "../lib/api"

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
    exportKinds?: Array<{ code: string; label: string }>
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
  const [exportKinds, setExportKinds] = useState<Array<{ code: string; label: string }>>([])
  const [products, setProducts] = useState<ProductAccountingItem[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [savingProductId, setSavingProductId] = useState<string | null>(null)
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
        )}&dateTo=${encodeURIComponent(dateTo)}`,
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
      link.download = match?.[1] || `export-saga-${kind}.xml`
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
        subtitle="Configureaza conturile si genereaza fisiere XML compatibile cu importul SAGA pentru firma activa."
      />

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Firma activa</div>
            <div className="mt-1 text-lg font-semibold text-[#17324D]">{companyName}</div>
            <div className="mt-1 text-sm text-slate-500">Exportul se genereaza pentru firma selectata acum in ERP.</div>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
          >
            <RefreshCw size={15} />
            Reincarca
          </button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={handleSaveConfig} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Configurare SAGA</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Conturi contabile si reguli implicite</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
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

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Export SAGA</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Genereaza fisiere XML pentru import</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Data inceput</div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Data sfarsit</div>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>
          </div>

          <div className="mt-4 space-y-2">
            {exportKinds.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => handleDownload(item.code)}
                disabled={downloadingKind === item.code}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-[#17324D] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-1 text-xs text-slate-500">Fisier XML pentru import SAGA</div>
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#17324D]">
                  <Download size={15} />
                  {downloadingKind === item.code ? "Se genereaza..." : "Exporta"}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Importul se face ulterior in SAGA din meniul de import date, folosind fisierele XML generate aici.
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Mapare produse</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Cod contabil si tip de stoc pe fiecare produs</div>
          </div>

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
                    <div>TVA: {product.vatRate?.rate ?? "-" }%</div>
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
      </section>
    </div>
  )
}
