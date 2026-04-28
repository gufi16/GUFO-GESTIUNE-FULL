import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Search, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"

type LocationOption = {
  id: string
  name: string
}

type ProductOption = {
  id: string
  name: string
  code?: string
  sku?: string
  barcode?: string
  uom?: { code?: string; name?: string } | string | null
  unit?: string
}

type ConsumptionItem = {
  productId: string
  name: string
  code: string
  stock: number
  qty: number
  um: string
}

function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pickUnit(product: ProductOption) {
  if (typeof product.uom === "string" && product.uom.trim()) return product.uom
  if (product.uom && typeof product.uom === "object") {
    if (product.uom.code) return product.uom.code
    if (product.uom.name) return product.uom.name
  }
  if (product.unit) return product.unit
  return "buc"
}

function normalizeProducts(payload: any): ProductOption[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.products)
        ? payload.products
        : []

  return rows.map((item: any) => ({
    id: String(item.id || ""),
    name: String(item.name || item.label || "Produs"),
    code: String(item.code || item.sku || item.barcode || ""),
    sku: item.sku,
    barcode: item.barcode,
    uom: item.uom ?? item.unit ?? null,
    unit: item.unit,
  }))
}

function normalizeLocations(payload: any): LocationOption[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.locations)
        ? payload.locations
        : []

  return rows.map((item: any) => ({
    id: String(item.id || item.locationId || ""),
    name: String(item.name || item.label || "Locatie"),
  }))
}

function buildStockMap(payload: any) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : []

  const map: Record<string, number> = {}
  for (const row of rows) {
    const productId = String(row.productId || "")
    if (!productId) continue
    map[productId] = toNumber(row.qty)
  }
  return map
}

export default function BonConsumNou() {
  const navigate = useNavigate()
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [locationId, setLocationIdState] = useState(getActiveLocationId())
  const [note, setNote] = useState("")
  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<ProductOption[]>([])
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  const [items, setItems] = useState<ConsumptionItem[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    loadLocations()
    loadProducts()
    const unsubscribe = subscribeToActiveLocation((nextLocationId) => {
      setLocationIdState((current) => current || nextLocationId)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (locationId) loadStockForLocation(locationId)
  }, [locationId])

  async function loadLocations() {
    try {
      const token = getToken() || ""
      const res = await fetch(`${API}/api/v1/meta/locations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      const normalized = normalizeLocations(json)
      setLocations(normalized)
      if (normalized.length) {
        const preferred = normalized.find((location) => location.id === getActiveLocationId())?.id || normalized[0].id
        setLocationIdState((current) => current || preferred)
      }
    } catch {
      setLocations([])
    }
  }

  async function loadProducts() {
    try {
      setLoadingProducts(true)
      const token = getToken() || ""
      const res = await fetch(`${API}/api/v1/products`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      setProducts(normalizeProducts(json))
    } catch {
      setProducts([])
    } finally {
      setLoadingProducts(false)
    }
  }

  async function loadStockForLocation(selectedLocationId: string) {
    try {
      const token = getToken() || ""
      const res = await fetch(`${API}/api/v1/stock/by-location?locationId=${encodeURIComponent(selectedLocationId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      const nextMap = buildStockMap(json)
      setStockMap(nextMap)
      setItems((prev) => prev.map((item) => ({ ...item, stock: nextMap[item.productId] ?? 0 })))
    } catch {
      setStockMap({})
      setItems((prev) => prev.map((item) => ({ ...item, stock: 0 })))
    }
  }

  function setLocation(nextLocationId: string) {
    setLocationIdState(nextLocationId)
    setActiveLocationId(nextLocationId)
  }

  function focusQty(productId: string) {
    setTimeout(() => {
      qtyRefs.current[productId]?.focus()
      qtyRefs.current[productId]?.select()
    }, 50)
  }

  function addProduct(product: ProductOption) {
    setError("")
    setMessage("")
    const existing = items.find((item) => item.productId === product.id)
    if (existing) {
      focusQty(product.id)
      setQuery("")
      return
    }

    const realStock = stockMap[product.id] ?? 0
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        code: product.code || product.sku || product.barcode || "",
        stock: realStock,
        qty: 1,
        um: pickUnit(product),
      },
    ])
    setQuery("")
    focusQty(product.id)
  }

  function updateQty(productId: string, value: string) {
    const qty = value === "" ? 0 : toNumber(String(value).replace(",", "."))
    setItems((prev) => prev.map((item) => item.productId === productId ? { ...item, qty } : item))
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((item) => item.productId !== productId))
  }

  async function saveDoc() {
    if (!locationId) {
      setError("Selecteaza locatia.")
      return
    }

    const lines = items.filter((item) => item.qty > 0).map((item) => ({
      productId: item.productId,
      qty: item.qty,
    }))

    if (!lines.length) {
      setError("Adauga cel putin un produs in bonul de consum.")
      return
    }

    try {
      setSaving(true)
      setError("")
      setMessage("")
      const token = getToken() || ""
      const res = await fetch(`${API}/api/v1/consumption-docs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ locationId, note, items: lines }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error || "Nu am putut salva bonul de consum.")
        return
      }
      setMessage(`Bon de consum salvat: ${json?.item?.docNo || "OK"}`)
      setItems([])
      setQuery("")
      setNote("")
      searchInputRef.current?.focus()
      setTimeout(() => navigate("/documente?tab=consumption"), 700)
    } catch {
      setError("Nu am putut salva bonul de consum.")
    } finally {
      setSaving(false)
    }
  }

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return products
      .filter((product) => [product.name, product.code || "", product.sku || "", product.barcode || ""].join(" ").toLowerCase().includes(term))
      .slice(0, 10)
  }, [products, query])

  const selectedLocationName = locations.find((location) => location.id === locationId)?.name || "Locatia selectata"
  const totalProducts = items.length
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0)
  const lowStockItems = items.filter((item) => item.qty > item.stock).length

  return (
    <div className="w-full space-y-4">
      <PageHeader badge="document" title="Bon de consum" subtitle="Consum manual rapid, fara retetar." />

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DocumentMetric title="Pozitii" value={totalProducts} tone="slate" />
        <DocumentMetric title="Cantitate" value={totalQty.toLocaleString("ro-RO")} tone="blue" />
        <DocumentMetric title="Peste stoc" value={lowStockItems} tone="amber" />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <DocumentSection title="Adauga produse">
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={loadingProducts ? "Se incarca produsele..." : "Cauta dupa nume, cod sau cod de bare"}
                className={`${documentInputClass} pl-11`}
              />
            </div>

            {query ? (
              <div className="mt-2 max-h-[180px] overflow-y-auto rounded-[14px] border border-slate-200 bg-slate-50 p-2">
                {loadingProducts ? (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">Se incarca produsele...</div>
                ) : filteredProducts.length ? (
                  <div className="space-y-2">
                    {filteredProducts.map((product) => {
                      const realStock = stockMap[product.id] ?? 0
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addProduct(product)}
                          className="flex w-full items-center justify-between rounded-[14px] border border-transparent bg-white px-4 py-2.5 text-left transition hover:border-slate-200 hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {product.code || product.sku || product.barcode || "fara cod"} · stoc {realStock} {pickUnit(product)}
                            </div>
                          </div>
                          <span className="ml-3 inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                            adauga
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">Nu am gasit produse pentru cautarea ta.</div>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Incepe sa scrii si produsele apar aici, fara sa impinga pagina in jos.
              </div>
            )}
          </DocumentSection>

          <DocumentSection title="Pozitii bon de consum">
            <div>
              {items.length ? (
                <div className="space-y-2">
                  <div className="hidden items-center rounded-[14px] bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,1.8fr)_110px_130px_110px_110px] lg:gap-3">
                    <div>Produs</div>
                    <div>Stoc</div>
                    <div>Cantitate</div>
                    <div>UM</div>
                    <div>Actiune</div>
                  </div>

                  {items.map((item) => (
                    <div key={item.productId} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.8fr)_110px_130px_110px_110px] lg:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{item.code || "fara cod"}</div>
                        </div>

                        <div className="rounded-[12px] bg-white px-3 py-2.5 text-sm font-semibold text-slate-900">
                          {item.stock} {item.um}
                        </div>

                        <div>
                          <input
                            ref={(el) => {
                              qtyRefs.current[item.productId] = el
                            }}
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.qty}
                            onChange={(e) => updateQty(item.productId, e.target.value)}
                            className={documentInputClass}
                          />
                        </div>

                        <div className="flex items-center">
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                            {item.um}
                          </span>
                        </div>

                        <div>
                          <button type="button" onClick={() => removeItem(item.productId)} className={documentButtonDangerClass}>
                            <Trash2 size={16} className="mr-2" />
                            Sterge
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <div className="text-sm font-semibold text-slate-700">Nu ai produse in document</div>
                  <div className="mt-1 text-sm text-slate-500">Cauta un produs sus si apasa direct pe el pentru adaugare.</div>
                </div>
              )}
            </div>
          </DocumentSection>
        </div>

        <DocumentSection title="Detalii document">
          <div className="space-y-3">
            <DocumentField label="Locatie">
              <select value={locationId} onChange={(e) => setLocation(e.target.value)} className={documentInputClass}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </DocumentField>

            <DocumentField label="Observatii">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Poti nota explicatii pentru consumul manual."
                className={documentTextareaClass}
              />
            </DocumentField>

            <InlineNotice>
              Locatie activa: <span className="font-semibold">{selectedLocationName}</span>
            </InlineNotice>

            <div className="flex flex-col gap-2">
              <button type="button" onClick={saveDoc} disabled={saving} className={documentButtonPrimaryClass}>
                <Check size={16} className="mr-2" />
                {saving ? "Se salveaza..." : "Salveaza bonul de consum"}
              </button>
              <button type="button" onClick={() => navigate("/inregistrare-document")} className={documentButtonSecondaryClass}>
                Inapoi la documente
              </button>
            </div>
          </div>
        </DocumentSection>
      </div>
    </div>
  )
}
