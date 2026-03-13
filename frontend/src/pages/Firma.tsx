import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

type CompanyForm = {
  name: string
  cui: string
  regNo: string
  address: string
  bank: string
  iban: string
  email: string
  phone: string
}

const emptyForm: CompanyForm = {
  name: "",
  cui: "",
  regNo: "",
  address: "",
  bank: "",
  iban: "",
  email: "",
  phone: ""
}

export default function FirmaPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [form, setForm] = useState<CompanyForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadCompany()
  }, [])

  async function loadCompany() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setLoading(false)
        return
      }

      if (data?.company) {
        setForm({
          name: data.company.name || "",
          cui: data.company.cui || "",
          regNo: data.company.regNo || "",
          address: data.company.address || "",
          bank: data.company.bank || "",
          iban: data.company.iban || "",
          email: data.company.email || "",
          phone: data.company.phone || ""
        })
      } else {
        setForm(emptyForm)
      }
    } catch {
      setError("Nu pot încărca datele firmei.")
    } finally {
      setLoading(false)
    }
  }

  async function saveCompany() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company`, {
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
        setSaving(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Eroare la salvarea firmei.")
        setSaving(false)
        return
      }

      setMessage("Datele firmei au fost salvate.")
    } catch {
      setError("Eroare la salvarea firmei.")
    } finally {
      setSaving(false)
    }
  }

  function updateField<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value
    }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="configurare"
        title="Firmă"
        subtitle="Datele companiei folosite în documente, print și PDF."
      />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={card}>
        <div style={cardHeader}>
          <div>
            <div style={cardTitle}>Date firmă</div>
            <div style={cardSubtitle}>
              Completează informațiile care apar în documentele generate din aplicație.
            </div>
          </div>
        </div>

        {loading ? (
          <div style={infoText}>Se încarcă datele firmei...</div>
        ) : (
          <>
            <div style={grid}>
              <Field label="Denumire firmă">
                <input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  style={input}
                  placeholder="Ex: POSHARD IMPEX SRL"
                />
              </Field>

              <Field label="CUI">
                <input
                  value={form.cui}
                  onChange={(e) => updateField("cui", e.target.value)}
                  style={input}
                  placeholder="Ex: RO12345678"
                />
              </Field>

              <Field label="Nr. Registru Comerț">
                <input
                  value={form.regNo}
                  onChange={(e) => updateField("regNo", e.target.value)}
                  style={input}
                  placeholder="Ex: J40/1234/2010"
                />
              </Field>

              <Field label="Bancă">
                <input
                  value={form.bank}
                  onChange={(e) => updateField("bank", e.target.value)}
                  style={input}
                  placeholder="Ex: Banca Transilvania"
                />
              </Field>

              <Field label="IBAN">
                <input
                  value={form.iban}
                  onChange={(e) => updateField("iban", e.target.value)}
                  style={input}
                  placeholder="Ex: RO49AAAA1B31007593840000"
                />
              </Field>

              <Field label="Email">
                <input
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  style={input}
                  placeholder="Ex: office@firma.ro"
                />
              </Field>

              <Field label="Telefon">
                <input
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  style={input}
                  placeholder="Ex: 0722000000"
                />
              </Field>

              <Field label="Adresă" full>
                <input
                  value={form.address}
                  onChange={(e) => updateField("address", e.target.value)}
                  style={input}
                  placeholder="Ex: Str. Exemplu nr. 10, București"
                />
              </Field>
            </div>

            <div style={actionsRow}>
              <button onClick={saveCompany} disabled={saving} style={btnPrimary}>
                {saving ? "Se salvează..." : "Salvează"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  full = false
}: {
  label: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <div style={{ ...fieldWrap, gridColumn: full ? "1 / -1" : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
}

const cardHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 20
}

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "#111827"
}

const cardSubtitle: React.CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
  marginTop: 4
}

const grid: React.CSSProperties = {
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

const actionsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 22
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "#111111",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 12
}

const successBox: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 12,
  padding: 12
}

const infoText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 14
}