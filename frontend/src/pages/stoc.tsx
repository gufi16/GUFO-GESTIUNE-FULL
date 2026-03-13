import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

export default function StocPage() {
  const navigate = useNavigate()

  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [locations, setLocations] = useState<any[]>([])
  const [locationId, setLocationId] = useState("")

  const [stock, setStock] = useState<any[]>([])
  const [globalStock, setGlobalStock] = useState<any[]>([])
  const [moves, setMoves] = useState<any[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  async function loadLocations() {
    const res = await fetch(`${API}/api/v1/meta/locations`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fă login din nou.")
    setLocations(Array.isArray(data.locations) ? data.locations : [])
  }

  async function loadGlobalStock() {
    const res = await fetch(`${API}/api/v1/stock/global`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fă login din nou.")
    setGlobalStock(Array.isArray(data.items) ? data.items : [])
  }

  async function loadMoves(selectedLocationId?: string) {
    const qs = new URLSearchParams()
    if (selectedLocationId) qs.set("locationId", selectedLocationId)
    const url = `${API}/api/v1/stock/moves${qs.toString() ? `?${qs.toString()}` : ""}`
    const res = await fetch(url, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fă login din nou.")
    setMoves(Array.isArray(data.items) ? data.items : [])
  }

  async function loadLocationStock(id: string) {
    if (!token) return
    if (!id) {
      setStock([])
      return
    }

    const qs = new URLSearchParams()
    qs.set("locationId", id)

    const res = await fetch(`${API}/api/v1/stock/by-location?${qs.toString()}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fă login din nou.")
    setStock(Array.isArray(data.items) ? data.items : [])
  }

  async function loadAll(selectedLocationId = locationId) {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      await Promise.all([loadLocations(), loadGlobalStock(), loadMoves(selectedLocationId)])

      if (selectedLocationId) {
        await loadLocationStock(selectedLocationId)
      } else {
        setStock([])
      }
    } catch (e: any) {
      setError(e?.message || "Nu pot încărca stocul.")
      setLocations([])
      setGlobalStock([])
      setMoves([])
      setStock([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll("")
  }, [])

  useEffect(() => {
    if (!token) return

    setLoading(true)
    setError("")

    Promise.all([
      loadMoves(locationId),
      locationId ? loadLocationStock(locationId) : Promise.resolve(setStock([]))
    ])
      .catch((e: any) => {
        setError(e?.message || "Nu pot încărca stocul.")
        setMoves([])
        setStock([])
      })
      .finally(() => setLoading(false))
  }, [locationId])

  return (
    <div style={{ padding: 4 }}>
      <div style={{ marginBottom: 24 }}>
        <PageHeader
          badge="gestiune"
          title="Stoc"
          subtitle="Vizualizare stoc pe locații, stoc global și mișcări de stoc într-un singur ecran."
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30, gap: 12, flexWrap: "wrap" }}>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => loadAll(locationId)} style={btnSecondary}>
            Refresh
          </button>

          <button style={btnPrimary} onClick={() => navigate("/inregistrare-document/nir/new")}>
            Intrare marfă
          </button>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <div style={{ display: "flex", gap: 20, marginBottom: 30, flexWrap: "wrap" }}>
        <Card title="Produse" value={globalStock.length} />
        <Card title="Mișcări" value={moves.length} />
        <Card title="Locații" value={locations.length} />
      </div>

      <Section title="Filtru locație">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label>Locație</label>

          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={selectStyle}>
            <option value="">Toate locațiile</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Stoc pe locație">
        {locationId === "" ? (
          <Empty text="Alege o locație ca să vezi stocul pe locația selectată." />
        ) : stock.length === 0 ? (
          <Empty text="Nu există produse pentru această locație." />
        ) : (
          <Table
            headers={["Produs", "SKU", "UM", "Stoc"]}
            rows={stock.map((s) => [s.name, s.sku, s.uom, Number(s.qty || 0).toFixed(2)])}
          />
        )}
      </Section>

      <Section title="Stoc global">
        {globalStock.length === 0 ? (
          <Empty text="Nu există produse în stoc." />
        ) : (
          <Table
            headers={["Produs", "SKU", "UM", "Stoc total"]}
            rows={globalStock.map((s) => [s.name, s.sku, s.uom, Number(s.totalQty || 0).toFixed(2)])}
          />
        )}
      </Section>

      <Section title="Mișcări stoc">
        {moves.length === 0 ? (
          <Empty text="Nu există mișcări de stoc." />
        ) : (
          <Table
            headers={["Data", "Produs", "Locație", "Tip", "Cantitate", "Document"]}
            rows={moves.map((m) => [
              new Date(m.createdAt).toLocaleString(),
              m.productName,
              m.locationName,
              m.type,
              Number(m.qty || 0).toFixed(2),
              m.note || `${m.refType || "-"} ${m.refId || ""}`.trim()
            ])}
          />
        )}
      </Section>

      {loading && <p style={{ marginTop: 20 }}>Se încarcă...</p>}
    </div>
  )
}

function Field({ label, children }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 14, color: "#555" }}>{label}</label>
      {children}
    </div>
  )
}

function Card({ title, value }: any) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 24, padding: 20, width: 200, background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
      <div style={{ fontSize: 14, color: "#64748b" }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: "#0f172a" }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: any) {
  return (
    <div style={{ marginBottom: 24, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 24, padding: 20, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
      <h2 style={{ marginBottom: 14, fontSize: 18, color: "#0f172a" }}>{title}</h2>
      {children}
    </div>
  )
}

function Table({ headers, rows }: any) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {headers.map((h: string) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i}>
              {r.map((c: any, j: number) => (
                <td key={j} style={td}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Empty({ text }: any) {
  return (
    <div style={{ padding: 20, border: "1px dashed #cbd5e1", borderRadius: 16, color: "#64748b", background: "#f8fafc" }}>
      {text}
    </div>
  )
}

const btnPrimary = {
  padding: "10px 16px",
  borderRadius: 14,
  border: "none",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: 600
}

const btnSecondary = {
  padding: "10px 16px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "white",
  cursor: "pointer",
  fontWeight: 600,
  color: "#0f172a"
}

const selectStyle = {
  padding: 12,
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  minWidth: 260,
  background: "#f8fafc"
}

const errorBox = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 12,
  marginBottom: 16
}

const tableWrap = {
  overflowX: "auto" as const,
  border: "1px solid #e2e8f0",
  borderRadius: 20,
  background: "#fff"
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  minWidth: 700
}

const th = {
  textAlign: "left" as const,
  padding: 10,
  borderBottom: "1px solid #ddd",
  background: "#f8fafc"
}

const td = {
  padding: 10,
  borderBottom: "1px solid #eee"
}