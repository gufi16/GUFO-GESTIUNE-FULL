import PageHeader from "../components/PageHeader"
import { useEffect, useMemo, useState } from "react"

const API = "http://localhost:3001"

type Supplier = {
  id: string
  name: string
  code?: string | null
  cif?: string | null
  regCom?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  isActive?: boolean
}

function emptyForm() {
  return {
    name: "",
    code: "",
    cif: "",
    regCom: "",
    address: "",
    city: "",
    country: "România",
    phone: "",
    email: ""
  }
}

export default function FurnizoriPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [form, setForm] = useState(emptyForm())

  useEffect(() => {
    loadSuppliers()
  }, [])

  async function loadSuppliers(search = "") {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(
        `${API}/api/v1/meta/suppliers${search ? `?q=${encodeURIComponent(search)}` : ""}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setItems([])
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot încărca furnizorii.")
        setItems([])
        return
      }

      setItems(Array.isArray(data.suppliers) ? data.suppliers : [])
    } catch {
      setError("Nu pot încărca furnizorii.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function saveSupplier() {
    setSuccess("")
    setError("")

    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completează denumirea furnizorului.")
      return
    }

    setSaving(true)

    try {
      const res = await fetch(`${API}/api/v1/meta/suppliers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || null,
          cif: form.cif.trim() || null,
          regCom: form.regCom.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          country: form.country.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null
        })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut salva furnizorul.")
        return
      }

      setForm(emptyForm())
      setSuccess("Furnizorul a fost salvat.")
      await loadSuppliers(query.trim())
    } catch {
      setError("Nu am putut salva furnizorul.")
    } finally {
      setSaving(false)
    }
  }

  const filteredCount = useMemo(() => items.length, [items])

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
        <PageHeader badge="nomenclator" title="Furnizori" subtitle="Administrare furnizori utilizați în recepții și documente." />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/nomenclator" style={{ textDecoration: "none" }}>
            <button style={btnSecondary}>Înapoi la nomenclator</button>
          </a>
          <button style={btnSecondary} onClick={() => loadSuppliers(query.trim())}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}
      {success ? <div style={successBox}>{success}</div> : null}

      <Section title="Adaugă furnizor">
        <div style={grid2}>
          <Field label="Denumire *">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Cod">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="CIF">
            <input
              value={form.cif}
              onChange={(e) => setForm({ ...form, cif: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Reg. Com.">
            <input
              value={form.regCom}
              onChange={(e) => setForm({ ...form, regCom: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Adresă">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Oraș">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Țară">
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Telefon">
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Email">
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={input}
            />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <button style={btnPrimary} onClick={saveSupplier} disabled={saving}>
            {saving ? "Se salvează..." : "Salvează furnizor"}
          </button>
        </div>
      </Section>

      <Section title="Listă furnizori">
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută după denumire, cod sau CIF..."
            style={{ ...input, maxWidth: 380 }}
          />
          <button style={btnSecondary} onClick={() => loadSuppliers(query.trim())}>
            Caută
          </button>
          <div style={{ alignSelf: "center", color: "#666", fontSize: 14 }}>
            Rezultate: <b>{filteredCount}</b>
          </div>
        </div>

        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Denumire</th>
                <th style={th}>Cod</th>
                <th style={th}>CIF</th>
                <th style={th}>Reg. Com.</th>
                <th style={th}>Oraș</th>
                <th style={th}>Telefon</th>
                <th style={th}>Email</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={td} colSpan={7}>Se încarcă...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td style={td} colSpan={7}>Nu există furnizori.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>{item.name}</td>
                    <td style={td}>{item.code || "-"}</td>
                    <td style={td}>{item.cif || "-"}</td>
                    <td style={td}>{item.regCom || "-"}</td>
                    <td style={td}>{item.city || "-"}</td>
                    <td style={td}>{item.phone || "-"}</td>
                    <td style={td}>{item.email || "-"}</td>
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
    <div style={{ marginBottom: 28 }}>
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

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14
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

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 12,
  marginBottom: 16
}

const successBox: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
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
  minWidth: 900
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