import PageHeader from "../components/PageHeader"
import { useEffect, useState } from "react"

const API = "http://localhost:3001"

type LocationItem = {
  id: string
  name: string
  code: string
}

export default function LocatiiPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<LocationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [form, setForm] = useState({
    name: "",
    code: ""
  })

  async function loadLocations() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations`, {
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
        setError(data.error || "Nu pot încărca locațiile.")
        setItems([])
        return
      }

      setItems(Array.isArray(data.locations) ? data.locations : [])
    } catch {
      setError("Nu pot încărca locațiile.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function saveLocation() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completează numele locației.")
      return
    }

    if (!form.code.trim()) {
      setError("Completează codul locației.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(form)
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot salva locația.")
        return
      }

      setSuccess("Locația a fost salvată.")
      setForm({ name: "", code: "" })
      loadLocations()
    } catch {
      setError("Nu pot salva locația.")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadLocations()
  }, [])

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
        <PageHeader
          badge="nomenclator"
          title="Locații"
          subtitle="Gestionare locații și depozite utilizate în stoc."
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={loadLocations} style={btnSecondary}>
            Refresh
          </button>

          <button onClick={saveLocation} style={btnPrimary} disabled={saving}>
            {saving ? "Se salvează..." : "Salvează locația"}
          </button>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}
      {success ? <div style={successBox}>{success}</div> : null}

      <div style={card}>
        <div style={grid2}>
          <Field label="Nume locație">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={input}
              placeholder="Ex: Depozit principal"
            />
          </Field>

          <Field label="Cod locație">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              style={input}
              placeholder="Ex: DEP01"
            />
          </Field>
        </div>
      </div>

      <div style={{ ...card, marginTop: 20 }}>
        <div style={sectionTitle}>Locații existente</div>

        {loading ? (
          <div style={infoText}>Se încarcă locațiile...</div>
        ) : items.length === 0 ? (
          <div style={emptyBox}>Nu există locații salvate.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Nume</th>
                  <th style={th}>Cod</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>{item.name}</td>
                    <td style={td}>{item.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: any) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16
}

const fieldWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: "#374151"
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box"
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600
}

const btnSecondary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16
}

const successBox: React.CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16
}

const infoText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 14
}

const emptyBox: React.CSSProperties = {
  padding: 16,
  border: "1px dashed #d1d5db",
  borderRadius: 12,
  color: "#6b7280"
}

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700
}

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  marginTop: 18
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse"
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f8fafc"
}

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle"
}
