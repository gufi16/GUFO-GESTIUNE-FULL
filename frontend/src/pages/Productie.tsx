import { useEffect, useMemo, useRef, useState } from "react"
import PageHeader from "../components/PageHeader"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"


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
  MATERIE_PRIMA: "materie primă",
  MARFA: "marfă",
  AMBALAJE: "ambalaje",
  CONSUMABILE: "consumabile",
  SEMIFABRICATE: "semifabricate",
  REZIDUALE: "reziduale",
  ALTE_MATERIALE: "alte materiale"
}

export default function ProductiePage() {
  const token =
    getToken() || ""

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
      setError("Nu există token de autentificare. Fă login din nou.")
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
        fetch(`${API}/api/v1/meta/locations`, { headers })
      ])

      const productsData = await productsRes.json().catch(() => ({}))
      const locationsData = await locationsRes.json().catch(() => ({}))

      if ([productsRes, locationsRes].some((r) => r.status === 401)) {
        setError("Token expirat sau invalid. Fă login din nou.")
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
      setError("Nu pot încărca produsele și locațiile.")
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
      setError("Selectează produsul.")
      return
    }

    if (!qty || Number(qty) <= 0) {
      setError("Cantitatea trebuie să fie mai mare decât 0.")
      return
    }

    const product = products.find((p) => p.id === productId)
    if (!product) {
      setError("Produsul selectat nu există.")
      return
    }

    const numericQty = Number(qty)

    const existingIndex = items.findIndex((row) => row.productId === product.id)

    if (existingIndex >= 0) {
      setItems((prev) =>
        prev.map((row, index) =>
          index === existingIndex
            ? { ...row, qty: Number(row.qty) + numericQty }
            : row
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
          uom: product.uom?.code || ""
        }
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
        i === index
          ? {
              ...row,
              qty: numericValue > 0 ? numericValue : 0
            }
          : row
      )
    )
  }

  async function submitProduction() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (!locationId) {
      setError("Selectează locația.")
      return
    }

    if (!items.length) {
      setError("Adaugă cel puțin un produs în producție.")
      return
    }

    const invalidQty = items.find((row) => Number(row.qty) <= 0)
    if (invalidQty) {
      setError("Există produse cu cantitate invalidă.")
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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          locationId,
          note: note.trim() || null,
          items: items.map((row) => ({
            productId: row.productId,
            qty: Number(row.qty)
          }))
        })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut genera producția.")
        return
      }

      setMessage("Documentul de producție a fost generat cu succes.")
      setItems([])
      setNote("")
      setQty("1")
      setProductId("")
      setProductSearch("")
    } catch {
      setError("Nu am putut genera producția.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="gestiune"
        title="Producție"
        subtitle="Creează un document de producție cu mai multe produse și actualizează automat stocurile."
      />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={topSummaryGrid}>
        <SummaryCard
          title="Locație"
          value={selectedLocation?.name || "-"}
          subtitle="destinație producție"
        />
        <SummaryCard
          title="Poziții"
          value={String(totalLines)}
          subtitle="produse în document"
        />
        <SummaryCard
          title="Cantitate totală"
          value={String(totalQty)}
          subtitle="total unități produse"
        />
        <SummaryCard
          title="Status"
          value={items.length > 0 ? "Pregătit" : "Gol"}
          subtitle={items.length > 0 ? "poți genera documentul" : "adaugă produse"}
        />
      </div>

      <div style={pageGrid}>
        <div style={leftCol}>
          <div style={card}>
            <div style={sectionHeaderRow}>
              <div>
                <div style={sectionTitle}>Adaugă produs în producție</div>
                <div style={sectionSubtitleCompact}>
                  Caută produsul după nume sau cod, setează cantitatea și adaugă-l în document.
                </div>
              </div>

              {(productId || productSearch) ? (
                <button
                  type="button"
                  onClick={resetProductPicker}
                  style={btnSoftDanger}
                  disabled={submitting}
                >
                  Resetează selecția
                </button>
              ) : null}
            </div>

            <div style={fieldWrapFull}>
              <label style={labelStyle}>Caută produs</label>

              <div style={searchWrap} ref={searchWrapRef}>
                <input
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value)
                    setProductId("")
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="scrie minim 3 litere din numele sau codul produsului..."
                  style={input}
                />

                {showSuggestions && productSearch.trim().length >= 3 && (
                  <div style={suggestionsBox}>
                    {filteredProducts.length === 0 ? (
                      <div style={suggestionEmpty}>Nu am găsit produse.</div>
                    ) : (
                      filteredProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => selectProduct(product)}
                          style={suggestionItem}
                        >
                          <div style={suggestionName}>{product.name}</div>
                          <div style={suggestionMeta}>
                            {product.sku || "-"} •{" "}
                            {PRODUCT_CLASS_LABEL[product.class || ""] || product.class || "-"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div style={formGrid}>
              <Field label="Locație">
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  style={input}
                >
                  <option value="">Selectează locația</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Cantitate">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  style={input}
                />
              </Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <Field label="Observații document">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={textarea}
                  rows={4}
                  placeholder="ex: producție dimineață / tura 1"
                />
              </Field>
            </div>

            <div style={actionBar}>
              <button onClick={() => loadAll()} style={btnSecondary} disabled={loading || submitting}>
                Refresh
              </button>

              <button
                type="button"
                onClick={addItem}
                style={btnPrimary}
                disabled={!productId || Number(qty) <= 0 || submitting}
              >
                Adaugă în document
              </button>
            </div>
          </div>

          <div style={card}>
            <div style={sectionHeaderRow}>
              <div>
                <div style={sectionTitle}>Produse în document</div>
                <div style={sectionSubtitleCompact}>
                  Poți edita cantitatea sau elimina liniile înainte de generare.
                </div>
              </div>

              <div style={pillInfo}>
                {items.length} poziții
              </div>
            </div>

            {items.length === 0 ? (
              <div style={emptyBox}>
                Nu ai adăugat produse încă.
              </div>
            ) : (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Produs</th>
                      <th style={th}>Cod</th>
                      <th style={th}>Cantitate</th>
                      <th style={th}>UM</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, index) => (
                      <tr key={`${row.productId}-${index}`}>
                        <td style={td}>{row.name}</td>
                        <td style={td}>{row.sku || "-"}</td>
                        <td style={td}>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={row.qty}
                            onChange={(e) => updateItemQty(index, e.target.value)}
                            style={qtyInput}
                          />
                        </td>
                        <td style={td}>{row.uom || "-"}</td>
                        <td style={td}>
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            style={btnSoftDangerSmall}
                          >
                            Șterge
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={rightCol}>
          <div style={card}>
            <div style={sectionTitle}>Rezumat document</div>

            <div style={summaryList}>
              <SummaryRow label="Locație selectată" value={selectedLocation?.name || "-"} />
              <SummaryRow label="Număr poziții" value={String(totalLines)} />
              <SummaryRow label="Cantitate totală" value={String(totalQty)} />
            </div>

            <div style={divider} />

            <button
              onClick={submitProduction}
              style={btnPrimaryWide}
              disabled={items.length === 0 || !locationId || submitting || loading}
            >
              {submitting ? "Se generează..." : "Generează documentul de producție"}
            </button>
          </div>

          <div style={miniChecksRow}>
            <CheckBadge ok={!!locationId} text="Locație selectată" />
            <CheckBadge ok={items.length > 0} text="Produse adăugate" />
            <CheckBadge ok={!items.some((row) => Number(row.qty) <= 0)} text="Cantități valide" />
          </div>
        </div>
      </div>

      {loading ? <div style={infoBox}>Se încarcă datele pentru producție...</div> : null}
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function SummaryCard({
  title,
  value,
  subtitle
}: {
  title: string
  value: string
  subtitle: string
}) {
  return (
    <div style={summaryCard}>
      <div style={summaryTitle}>{title}</div>
      <div style={summaryValue}>{value}</div>
      <div style={summarySubtitle}>{subtitle}</div>
    </div>
  )
}

function SummaryRow({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <div style={summaryRow}>
      <span style={summaryRowLabel}>{label}</span>
      <span style={summaryRowValue}>{value}</span>
    </div>
  )
}

function CheckBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      style={{
        ...checkBadge,
        background: ok ? "#ecfdf5" : "#f8fafc",
        borderColor: ok ? "#bbf7d0" : "#e2e8f0",
        color: ok ? "#166534" : "#64748b"
      }}
    >
      <span
        style={{
          ...checkDot,
          background: ok ? "#16a34a" : "#cbd5e1"
        }}
      />
      <span>{text}</span>
    </div>
  )
}

const topSummaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16
}

const summaryCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 20,
  padding: 18,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const summaryTitle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em"
}

const summaryValue: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "#0f172a",
  marginTop: 8
}

const summarySubtitle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 6
}

const pageGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 0.8fr",
  gap: 20,
  alignItems: "start"
}

const leftCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20
}

const rightCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const sectionHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 16,
  flexWrap: "wrap"
}

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "#0f172a"
}

const sectionSubtitleCompact: React.CSSProperties = {
  fontSize: 14,
  color: "#64748b",
  marginTop: 4
}

const fieldWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6
}

const fieldWrapFull: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 16
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#334155"
}

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box"
}

const qtyInput: React.CSSProperties = {
  width: 120,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box"
}

const textarea: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",
  resize: "vertical"
}

const searchWrap: React.CSSProperties = {
  position: "relative"
}

const suggestionsBox: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  right: 0,
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  boxShadow: "0 18px 40px rgba(15,23,42,0.12)",
  zIndex: 30,
  overflow: "hidden",
  maxHeight: 320,
  overflowY: "auto"
}

const suggestionItem: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "#ffffff",
  padding: "12px 14px",
  cursor: "pointer",
  borderBottom: "1px solid #f1f5f9"
}

const suggestionName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#0f172a"
}

const suggestionMeta: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 4
}

const suggestionEmpty: React.CSSProperties = {
  padding: 14,
  color: "#64748b",
  fontSize: 14
}

const actionBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 20,
  flexWrap: "wrap"
}

const btnPrimary: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 14,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700
}

const btnPrimaryWide: React.CSSProperties = {
  width: "100%",
  padding: "14px 18px",
  borderRadius: 14,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 800
}

const btnSecondary: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700
}

const btnSoftDanger: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 14,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700
}

const btnSoftDangerSmall: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 16,
  padding: 14
}

const successBox: React.CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 16,
  padding: 14
}

const infoBox: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  color: "#475569",
  borderRadius: 16,
  padding: 14
}

const emptyBox: React.CSSProperties = {
  padding: 16,
  border: "1px dashed #d1d5db",
  borderRadius: 16,
  color: "#6b7280",
  background: "#f8fafc"
}

const pillInfo: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#475569",
  fontSize: 12,
  fontWeight: 700
}

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  marginTop: 8
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse"
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f8fafc",
  fontSize: 13,
  color: "#334155"
}

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle",
  fontSize: 14,
  color: "#0f172a"
}

const summaryList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12
}

const summaryRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center"
}

const summaryRowLabel: React.CSSProperties = {
  fontSize: 14,
  color: "#64748b"
}

const summaryRowValue: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#0f172a"
}

const divider: React.CSSProperties = {
  height: 1,
  background: "#e2e8f0",
  margin: "18px 0"
}

const miniChecksRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap"
}

const checkBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 999,
  border: "1px solid #e2e8f0",
  fontSize: 13,
  fontWeight: 700
}

const checkDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999
}