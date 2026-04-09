import { useEffect, useMemo, useRef, useState } from "react"
import { PackageMinus, Search, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import { api } from "../lib/api"
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
    if (locationId) {
      loadStockForLocation(locationId)
    }
  }, [locationId])

  async function loadLocations() {
    try {
      const data = await api<any>("/api/v1/meta/locations")
      const normalized = normalizeLocations(data)
      setLocations(normalized)
      if (normalized.length) {
        const preferredLocationId = normalized.find((location) => location.id === getActiveLocationId())?.id || normalized[0].id
        setLocationIdState((current) => current || preferredLocationId)
      }
    } catch {
      setLocations([])
    }
  }

  async function loadProducts() {
    try {
      setLoadingProducts(true)
      const data = await api<any>("/api/v1/products")
      setProducts(normalizeProducts(data))
    } catch {
      setProducts([])
    } finally {
      setLoadingProducts(false)
    }
  }

  async function loadStockForLocation(selectedLocationId: string) {
    try {
      const data = await api<any>(`/api/v1/stock/by-location?locationId=${encodeURIComponent(selectedLocationId)}`)
      const nextMap = buildStockMap(data)
      setStockMap(nextMap)
      setItems((prev) => prev.map((item) => ({ ...item, stock: nextMap[item.productId] ?? 0 })))
    } catch {
      setStockMap({})
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
    }, 60)
  }

  function addProduct(product: ProductOption) {
    setError("")
    setMessage("")
    if (!product.id) return

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
    const qty = value === "" ? 0 : toNumber(value)
    setItems((prev) => prev.map((item) => item.productId === productId ? { ...item, qty } : item))
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((item) => item.productId !== productId))
  }

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 40)
    return products.filter((product) => {
      const haystack = `${product.name} ${product.code || ""} ${product.sku || ""} ${product.barcode || ""}`.toLowerCase()
      return haystack.includes(q)
    }).slice(0, 40)
  }, [products, query])

  async function saveDoc() {
    if (!locationId) {
      setError("Selecteaza locatia pentru bonul de consum.")
      return
    }

    const lines = items.filter((item) => item.qty > 0).map((item) => ({
      productId: item.productId,
      qty: item.qty,
    }))

    if (!lines.length) {
      setError("Adauga produse in bonul de consum.")
      return
    }

    try {
      setSaving(true)
      setError("")
      setMessage("")
      const data = await api<any>("/api/v1/consumption-docs", {
        method: "POST",
        body: JSON.stringify({
          locationId,
          note,
          items: lines,
        }),
      })
      setMessage(`Bon de consum salvat: ${data?.item?.docNo || "OK"}`)
      setTimeout(() => navigate("/documente?tab=consumption"), 600)
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva bonul de consum.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader badge="documente" title="Bon de consum" />

      <div className="grid gap-4 xl:grid-cols-[1.25fr,0.95fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr,1fr]">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Locatie</span>
              <select
                value={locationId}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
              >
                <option value="">Selecteaza locatia</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Observatii</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Consum manual materii prime"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
              />
            </label>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Search size={16} />
              Adauga produse in bon
            </div>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={loadingProducts ? "Se incarca produsele..." : "Cauta dupa nume, cod sau barcode"}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
            />

            <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-amber-300 hover:bg-amber-50"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{product.code || product.sku || product.barcode || "fara cod"}</div>
                  </div>
                  <span className="rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{pickUnit(product)}</span>
                </button>
              ))}

              {!filteredProducts.length ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">
                  Nu am gasit produse dupa cautarea ta.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">Linii bon de consum</div>
              <div className="mt-1 text-sm text-slate-500">Adauga materiile prime si completeaza cantitatile.</div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
              <PackageMinus size={16} />
              {items.length} pozitii
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                Aici vor aparea produsele din bonul de consum.
              </div>
            ) : items.map((item) => (
              <div key={item.productId} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.code || "fara cod"} · stoc {item.stock} {item.um}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="rounded-xl border border-red-200 bg-white p-2 text-red-600 transition hover:bg-red-50"
                    aria-label={`Sterge ${item.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[140px,1fr]">
                  <label className="space-y-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <span>Cantitate</span>
                    <input
                      ref={(el) => { qtyRefs.current[item.productId] = el }}
                      value={String(item.qty)}
                      onChange={(e) => updateQty(item.productId, e.target.value)}
                      inputMode="decimal"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
                    />
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
                    U.M.: <span className="font-semibold text-slate-900">{item.um}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate("/inregistrare-document")}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Inapoi
            </button>
            <button
              type="button"
              onClick={saveDoc}
              disabled={saving}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Se salveaza..." : "Salveaza bonul de consum"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
