import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Search, Trash2 } from "lucide-react"
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

type Product = {
  id: string
  name: string
  sku?: string
  class?: string
  imageUrl?: string | null
  isActive?: boolean
  recipe?: {
    id: string
    status?: string
    items?: any[]
    yieldQty?: number
  } | null
  uom?: {
    id: string
    code: string
    name: string
  } | null
}

type Location = {
  id: string
  name: string
}

type ProductionItem = {
  productId: string
  name: string
  sku?: string
  qty: number
  uom?: string
}

const PRODUCT_CLASS_LABEL: Record<string, string> = {
  PRODUS_FIN: "produs finit",
  MATERIE_PRIMA: "materie prima",
  MARFA: "marfa",
  AMBALAJE: "ambalaje",
  AMBALAJ_SGR: "ambalaj SGR",
  CONSUMABILE: "consumabile",
  SEMIFABRICATE: "semifabricate",
  REZIDUALE: "reziduale",
  ALTE_MATERIALE: "alte materiale",
  SERVICIU_VANDUT: "serviciu vandut",
  DISCOUNT_FINANCIAR_IESIRI: "discount financiar iesiri",
  DISCOUNT_COMERCIAL_IESIRI: "discount comercial iesiri",
  TAXA_VERDE: "taxa verde",
}

export default function ProductiePage() {
  const token = getToken() || ""

  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [productId, setProductId] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [locationId, setLocationId] = useState("")
  const [qty, setQty] = useState("1")
  const [note, setNote] = useState("")
  const [items, setItems] = useState<ProductionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const searchWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!searchWrapRef.current) return
      if (!searchWrapRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function loadAll() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [productsRes, locationsRes] = await Promise.all([
        fetch(`${API}/api/v1/products`, { headers }),
        fetch(`${API}/api/v1/meta/locations`, { headers }),
      ])

      const productsData = await productsRes.json().catch(() => ({}))
      const locationsData = await locationsRes.json().catch(() => ({}))

      if ([productsRes, locationsRes].some((r) => r.status === 401)) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setLoading(false)
        return
      }

      const rawProducts = Array.isArray(productsData.items) ? productsData.items : []
      const rawLocations = Array.isArray(locationsData.locations) ? locationsData.locations : []

      const productionProducts = rawProducts.filter((p: Product) => {
        const validClass = ["PRODUS_FIN", "SEMIFABRICATE"].includes(String(p.class || ""))
        const active = p.isActive !== false
        return validClass && active
      })

      setProducts(productionProducts)
      setLocations(rawLocations)

      if (!locationId && rawLocations.length === 1) {
        setLocationId(rawLocations[0].id)
      }
    } catch {
      setError("Nu pot incarca produsele si locatiile.")
    } finally {
      setLoading(false)
    }
  }

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) || null,
    [locations, locationId]
  )

  const searchTerm = productSearch.trim().toLowerCase()

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products.slice(0, 12)
    return products
      .filter((item) => {
        const name = String(item.name || "").toLowerCase()
        const sku = String(item.sku || "").toLowerCase()
        return name.includes(searchTerm) || sku.includes(searchTerm)
      })
      .slice(0, 12)
  }, [products, searchTerm])

  const totalLines = items.length
  const totalQty = items.reduce((sum, row) => sum + Number(row.qty || 0), 0)

  function selectProduct(product: Product) {
    setProductId(product.id)
    setProductSearch(product.name + (product.sku ? ` (${product.sku})` : ""))
    setShowSuggestions(false)
    setError("")
  }

  function resetProductPicker() {
    setProductId("")
    setProductSearch("")
    setShowSuggestions(false)
  }

  function addItem() {
    setError("")
    setMessage("")

    if (!productId) {
      setError("Selecteaza produsul.")
      return
    }

    if (!qty || Number(qty) <= 0) {
      setError("Cantitatea trebuie sa fie mai mare decat 0.")
      return
    }

    const product = products.find((p) => p.id === productId)
    if (!product) {
      setError("Produsul selectat nu exista.")
      return
    }

    const numericQty = Number(qty)
    const existingIndex = items.findIndex((row) => row.productId === product.id)

    if (existingIndex >= 0) {
      setItems((prev) =>
        prev.map((row, index) =>
          index === existingIndex ? { ...row, qty: Number(row.qty) + numericQty } : row
        )
      )
    } else {
      setItems((prev) => [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku || "",
          qty: numericQty,
          uom: product.uom?.code || "",
        },
      ])
    }

    setProductId("")
    setProductSearch("")
    setQty("1")
    setShowSuggestions(false)
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function updateItemQty(index: number, value: string) {
    const numericValue = Number(value || 0)
    setItems((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, qty: numericValue > 0 ? numericValue : 0 } : row
      )
    )
  }

  async function submitProduction() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!locationId) {
      setError("Selecteaza locatia.")
      return
    }

    if (!items.length) {
      setError("Adauga cel putin un produs in productie.")
      return
    }

    const invalidQty = items.find((row) => Number(row.qty) <= 0)
    if (invalidQty) {
      setError("Exista produse cu cantitate invalida.")
      return
    }

    setSubmitting(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/production`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          locationId,
          note: note.trim() || null,
          items: items.map((row) => ({
            productId: row.productId,
            qty: Number(row.qty),
          })),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut genera productia.")
        return
      }

      setMessage("Documentul de productie a fost generat cu succes.")
      setItems([])
      setNote("")
      setQty("1")
      setProductId("")
      setProductSearch("")
    } catch {
      setError("Nu am putut genera productia.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader badge="document" title="Productie" />

      {loading ? <InlineNotice>Se incarca datele pentru productie...</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <DocumentMetric title="Locatie" value={selectedLocation?.name || "-"} tone="slate" />
        <DocumentMetric title="Pozitii" value={String(totalLines)} tone="blue" />
        <DocumentMetric title="Cantitate totala" value={String(totalQty)} tone="emerald" />
        <DocumentMetric title="Status" value={items.length > 0 ? "Pregatit" : "Gol"} tone="amber" />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <DocumentSection title="Adauga produs in productie">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-500">Cauta produsul dupa nume sau cod si adauga-l rapid in document.</div>
              {(productId || productSearch) ? (
                <button type="button" onClick={resetProductPicker} className={documentButtonSecondaryClass} disabled={submitting}>
                  Reseteaza selectia
                </button>
              ) : null}
            </div>

            <div className="mt-2" ref={searchWrapRef}>
              <div className="relative">
                <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value)
                    setProductId("")
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Scrie minim 3 litere din nume sau cod"
                  className={`${documentInputClass} pl-11`}
                />
              </div>

              {showSuggestions && productSearch.trim().length >= 3 ? (
                <div className="mt-2 max-h-[180px] overflow-y-auto rounded-[14px] border border-slate-200 bg-slate-50 p-2">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-slate-500">Nu am gasit produse.</div>
                  ) : (
                    <div className="space-y-2">
                      {filteredProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => selectProduct(product)}
                          className="flex w-full items-center justify-between rounded-[14px] border border-transparent bg-white px-4 py-2.5 text-left transition hover:border-slate-200 hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {product.sku || "fara cod"} - {PRODUCT_CLASS_LABEL[product.class || ""] || product.class || "-"}
                            </div>
                          </div>
                          <span className="ml-3 inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                            adauga
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DocumentField label="Locatie">
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={documentInputClass}>
                  <option value="">Selecteaza locatia</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </DocumentField>

              <DocumentField label="Cantitate">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={documentInputClass}
                />
              </DocumentField>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadAll} className={documentButtonSecondaryClass} disabled={loading || submitting}>
                Reincarca
              </button>
              <button
                type="button"
                onClick={addItem}
                className={documentButtonPrimaryClass}
                disabled={!productId || Number(qty) <= 0 || submitting}
              >
                Adauga in document
              </button>
            </div>
          </DocumentSection>

          <DocumentSection title="Pozitii productie">
            <div>
              {items.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <div className="text-sm font-semibold text-slate-700">Nu ai adaugat produse inca</div>
                  <div className="mt-1 text-sm text-slate-500">Cauta un produs sus si adauga-l in document.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="hidden items-center rounded-[14px] bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,1.8fr)_120px_120px_110px] lg:gap-3">
                    <div>Produs</div>
                    <div>Cantitate</div>
                    <div>UM</div>
                    <div>Actiune</div>
                  </div>

                  {items.map((row, index) => (
                    <div key={`${row.productId}-${index}`} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.8fr)_120px_120px_110px] lg:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{row.name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{row.sku || "fara cod"}</div>
                        </div>

                        <div>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={row.qty}
                            onChange={(e) => updateItemQty(index, e.target.value)}
                            className={documentInputClass}
                          />
                        </div>

                        <div className="flex items-center">
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                            {row.uom || "-"}
                          </span>
                        </div>

                        <div>
                          <button type="button" onClick={() => removeItem(index)} className={documentButtonDangerClass}>
                            <Trash2 size={16} className="mr-2" />
                            Sterge
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DocumentSection>
        </div>

        <DocumentSection title="Detalii document">
          <div className="space-y-3">
            <DocumentField label="Observatii document">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="ex: productie dimineata / tura 1"
                className={documentTextareaClass}
              />
            </DocumentField>

            <InlineNotice>
              Locatie selectata: <span className="font-semibold">{selectedLocation?.name || "-"}</span>
            </InlineNotice>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={submitProduction}
                className={documentButtonPrimaryClass}
                disabled={items.length === 0 || !locationId || submitting || loading}
              >
                <Check size={16} className="mr-2" />
                {submitting ? "Se genereaza..." : "Genereaza documentul de productie"}
              </button>
            </div>
          </div>
        </DocumentSection>
      </div>
    </div>
  )
}



