import { useEffect, useState } from "react"

const API = "http://localhost:3001"

export default function NirListPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    month: ""
  })

  async function loadReceipts() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setLoading(true)
    setError("")

    const params = new URLSearchParams()

    if (filters.month) {
      params.set("month", filters.month)
    } else {
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom)
      if (filters.dateTo) params.set("dateTo", filters.dateTo)
    }

    const qs = params.toString()
    const url = `${API}/api/v1/purchase-receipts${qs ? `?${qs}` : ""}`

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setItems([])
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot încărca documentele NIR.")
        setItems([])
        return
      }

      setItems(Array.isArray(data.receipts) ? data.receipts : [])
    } catch {
      setError("Nu pot încărca documentele NIR.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReceipts()
  }, [])

  function clearFilters() {
    setFilters({
      dateFrom: "",
      dateTo: "",
      month: ""
    })
  }

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>NIR / Recepții marfă</h1>
          <p style={{ color: "#666", marginTop: 6 }}>
            Listă documente recepție
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btnSecondary} onClick={loadReceipts}>
            Refresh
          </button>

          <a href="/inregistrare-document/nir/new" style={{ textDecoration: "none" }}>
            <button style={btnPrimary}>NIR nou</button>
          </a>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <Section title="Filtre după dată">
        <div style={filtersGrid}>
          <Field label="Lună">
            <input
              type="month"
              value={filters.month}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  month: e.target.value,
                  dateFrom: "",
                  dateTo: ""
                })
              }
              style={input}
            />
          </Field>

          <Field label="De la">
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  dateFrom: e.target.value,
                  month: ""
                })
              }
              style={input}
            />
          </Field>

          <Field label="Până la">
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  dateTo: e.target.value,
                  month: ""
                })
              }
              style={input}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button style={btnPrimary} onClick={loadReceipts}>
            Aplică filtre
          </button>
          <button
            style={btnSecondary}
            onClick={() => {
              clearFilters()
              setTimeout(() => loadReceipts(), 0)
            }}
          >
            Resetează
          </button>
        </div>
      </Section>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <Card title="Documente" value={items.length} />
        <Card title="Draft" value={items.filter((x) => x.status === "DRAFT").length} />
        <Card title="Postate" value={items.filter((x) => x.status === "POSTED").length} />
      </div>

      <Section title="Listă documente NIR">
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Nr. document</th>
                <th style={th}>Data</th>
                <th style={th}>Furnizor</th>
                <th style={th}>Locație</th>
                <th style={th}>Monedă</th>
                <th style={th}>Net</th>
                <th style={th}>TVA</th>
                <th style={th}>Total</th>
                <th style={th}>Total RON</th>
                <th style={th}>Status</th>
                <th style={th}>Acțiune</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td style={td} colSpan={11}>
                    Se încarcă...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td style={td} colSpan={11}>
                    Nu există documente NIR.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.docNo}</td>
                    <td style={td}>
                      {row.docDate ? new Date(row.docDate).toLocaleDateString() : "-"}
                    </td>
                    <td style={td}>
                      {row.supplier?.name || row.supplierName || "-"}
                    </td>
                    <td style={td}>{row.location?.name || "-"}</td>
                    <td style={td}>{row.currency || "-"}</td>
                    <td style={td}>{Number(row.totalNetFc || 0).toFixed(2)}</td>
                    <td style={td}>{Number(row.totalVatFc || 0).toFixed(2)}</td>
                    <td style={td}>{Number(row.totalGrossFc || 0).toFixed(2)}</td>
                    <td style={td}>{Number(row.totalGrossRon || 0).toFixed(2)}</td>
                    <td style={td}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={td}>
                      <a
                        href={`/inregistrare-document/nir/edit?id=${row.id}`}
                        style={{ textDecoration: "none" }}
                      >
                        <button style={btnSecondarySmall}>Deschide</button>
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: any) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      {children}
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
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 10,
        padding: 14,
        minWidth: 160,
        background: "#fafafa"
      }}
    >
      <div style={{ fontSize: 13, color: "#666" }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: any = {
    DRAFT: { bg: "#fff7ed", color: "#9a3412" },
    POSTED: { bg: "#ecfdf5", color: "#166534" },
    CANCELLED: { bg: "#f3f4f6", color: "#374151" }
  }

  const s = map[status] || { bg: "#f3f4f6", color: "#111827" }

  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600
      }}
    >
      {status}
    </span>
  )
}

const filtersGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 220px))",
  gap: 12
}

const input: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
  width: "100%",
  boxSizing: "border-box"
}

const btnPrimary: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer"
}

const btnSecondary: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer"
}

const btnSecondarySmall: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontSize: 12
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 12,
  marginBottom: 16
}

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  background: "#fff"
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 1100
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 12,
  borderBottom: "1px solid #e5e5e5",
  background: "#fafafa",
  fontSize: 13
}

const td: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #f1f5f9",
  fontSize: 14
}