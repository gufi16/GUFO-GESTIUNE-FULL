import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ClipboardList, MapPin, PackageSearch, Search, Trash2 } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
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

type InventoryItem = {
  productId: string
  name: string
  code: string
  stock: number
  counted: number
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
    name: String(item.name || item.label || "Locație"),
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

function diffTone(value: number) {
  if (value < 0) return "bg-red-50 text-red-700"
  if (value > 0) return "bg-emerald-50 text-emerald-700"
  return "bg-slate-100 text-slate-700"
}

export default function InventarNou() {
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [locationId, setLocationId] = useState(getActiveLocationId())
  const [note, setNote] = useState("")
  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<ProductOption[]>([])
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  const [items, setItems] = useState<InventoryItem[]>([])
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
      setLocationId((current) => current || nextLocationId)
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
      const token =
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        ""

      const res = await fetch(`${API}/api/v1/meta/locations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      const json = await res.json().catch(() => ({}))
      const normalized = normalizeLocations(json)
      setLocations(normalized)

      if (normalized.length) {
        const preferredLocationId =
          normalized.find((location) => location.id === getActiveLocationId())?.id || normalized[0].id

        setLocationId((current) => current || preferredLocationId)
      }
    } catch {
      setLocations([])
    }
  }

  async function loadProducts() {
    try {
      setLoadingProducts(true)

      const token =
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        ""

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
      const token =
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        ""

      const res = await fetch(
        `${API}/api/v1/stock/by-location?locationId=${encodeURIComponent(selectedLocationId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      )

      const json = await res.json().catch(() => ({}))
      const nextMap = buildStockMap(json)

      setStockMap(nextMap)

      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          stock: nextMap[item.productId] ?? 0,
        }))
      )
    } catch {
      setStockMap({})
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          stock: 0,
        }))
      )
    }
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
        counted: realStock,
        um: pickUnit(product),
      },
    ])

    setQuery("")
    focusQty(product.id)
  }

  function updateCounted(productId: string, value: string) {
    const counted = value === "" ? 0 : toNumber(value)
    setItems((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? { ...item, counted }
          : item
      )
    )
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((item) => item.productId !== productId))
  }

  async function saveInventory() {
    if (!locationId) {
      setError("Selectează locația.")
      return
    }

    if (!items.length) {
      setError("Adaugă cel puțin un produs.")
      return
    }

    try {
      setSaving(true)
      setError("")
      setMessage("")

      const token =
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        ""

      const payload = {
        locationId,
        note,
        items: items.map((item) => ({
          productId: item.productId,
          countedQty: item.counted,
        })),
      }

      const res = await fetch(`${API}/api/v1/inventory`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(json?.error || "Inventarul nu a putut fi salvat.")
        return
      }

      setMessage("Inventarul a fost salvat.")
      setItems([])
      setQuery("")
      setNote("")
      searchInputRef.current?.focus()
    } catch {
      setError("Inventarul nu a putut fi salvat.")
    } finally {
      setSaving(false)
    }
  }

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []

    return products
      .filter((product) => {
        const fields = [
          product.name,
          product.code || "",
          product.sku || "",
          product.barcode || "",
        ]
          .join(" ")
          .toLowerCase()

        return fields.includes(term)
      })
      .slice(0, 12)
  }, [products, query])

  const selectedLocationName =
    locations.find((location) => location.id === locationId)?.name || "Locația selectată"

  const totalProducts = items.length
  const withDifferences = items.filter((item) => item.counted !== item.stock).length
  const totalNegative = items.filter((item) => item.counted - item.stock < 0).length

  return (
    <div className="w-full space-y-6">
      <PageHeader
        badge="document"
        title="Inventar nou"
        subtitle="Înregistrează rapid inventarul, în același stil cu restul aplicației."
      />

      {error ? (
        <div className="rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-500">Produse în inventar</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{totalProducts}</div>
              <div className="mt-2 text-sm text-slate-500">poziții adăugate în document</div>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <ClipboardList size={20} />
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-500">Poziții cu diferențe</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{withDifferences}</div>
              <div className="mt-2 text-sm text-slate-500">unde număratul diferă de stocul scriptic</div>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <PackageSearch size={20} />
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-500">Diferențe negative</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{totalNegative}</div>
              <div className="mt-2 text-sm text-slate-500">{selectedLocationName}</div>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <MapPin size={20} />
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <div className="text-lg font-semibold text-slate-900">Adaugă produse</div>
            <div className="mt-1 text-sm text-slate-500">
              Caută și apasă direct pe produs. Cardul este sus, la îndemână.
            </div>
          </div>

          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Caută după nume, cod sau cod de bare"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          {query ? (
            <div className="mt-3 max-h-[320px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2">
              {loadingProducts ? (
                <div className="px-3 py-8 text-center text-sm text-slate-500">Se încarcă produsele...</div>
              ) : filteredProducts.length ? (
                <div className="space-y-2">
                  {filteredProducts.map((product) => {
                    const realStock = stockMap[product.id] ?? 0

                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProduct(product)}
                        className="flex w-full items-center justify-between rounded-2xl border border-transparent bg-white px-4 py-3 text-left transition hover:border-slate-200 hover:bg-slate-100"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {product.code || product.sku || product.barcode || "fără cod"} · stoc {realStock} {pickUnit(product)}
                          </div>
                        </div>
                        <span className="ml-3 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          click pentru adăugare
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-3 py-8 text-center text-sm text-slate-500">Nu am găsit produse pentru căutarea ta.</div>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Începe să scrii și lista de produse apare imediat aici.
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <div className="text-lg font-semibold text-slate-900">Detalii document</div>
            <div className="mt-1 text-sm text-slate-500">Alege locația și adaugă observații înainte de salvare.</div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Locație</label>
              <select
                value={locationId}
                onChange={(e) => {
                  const nextLocationId = e.target.value
                  setLocationId(nextLocationId)
                  setActiveLocationId(nextLocationId)
                }}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Observații</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder="Poți nota detalii despre inventar."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <button
              type="button"
              onClick={saveInventory}
              disabled={saving}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check size={16} />
              {saving ? "Se salvează..." : "Salvează inventar"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <div className="text-lg font-semibold text-slate-900">Poziții inventar</div>
          <div className="mt-1 text-sm text-slate-500">
            Totul este aliniat pe coloane fixe: produs, scriptic, numărat, diferență și acțiune.
          </div>
        </div>

        {items.length ? (
          <div className="max-h-[460px] overflow-y-auto pr-1">
            <div className="space-y-3">
            <div className="hidden items-center rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,1.8fr)_120px_140px_140px_110px] lg:gap-3">
              <div>Produs</div>
              <div>Scriptic</div>
              <div>Numărat</div>
              <div>Diferență</div>
              <div>Acțiune</div>
            </div>

            {items.map((item) => {
              const diff = item.counted - item.stock

              return (
                <div
                  key={item.productId}
                  className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.8fr)_120px_140px_140px_110px] lg:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.code || "fără cod"} · UM {item.um}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
                      {item.stock} {item.um}
                    </div>

                    <div>
                      <input
                        ref={(el) => {
                          qtyRefs.current[item.productId] = el
                        }}
                        type="number"
                        step="0.01"
                        value={item.counted}
                        onChange={(e) => updateCounted(item.productId, e.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                    </div>

                    <div>
                      <span className={`inline-flex rounded-full px-3 py-2 text-sm font-semibold ${diffTone(diff)}`}>
                        {diff > 0 ? "+" : ""}
                        {diff} {item.um}
                      </span>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.productId)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                        Șterge
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
            <div className="text-sm font-semibold text-slate-700">Nu ai produse în inventar</div>
            <div className="mt-1 text-sm text-slate-500">
              Caută un produs sus și apasă direct pe el pentru adăugare.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
