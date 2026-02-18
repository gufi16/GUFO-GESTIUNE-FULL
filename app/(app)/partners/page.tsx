"use client"

import { useEffect, useMemo, useState } from "react"

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  vatCode?: string | null
  address?: string | null
  city?: string | null
  createdAt?: string
}

export default function PartnersPage() {
  const [tenantId, setTenantId] = useState("")
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    vatCode: "",
    regNo: "",
    address: "",
    city: "",
    country: "RO",
    notes: "",
  })

  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const t = useMemo(() => tenantId.trim(), [tenantId])

  async function load() {
    setError(null)
    setOk(null)
    if (!t) {
      setRows([])
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/customers?tenantId=${encodeURIComponent(t)}`, { cache: "no-store" })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || `Failed (${res.status})`)
        setRows([])
        return
      }
      setRows(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || "Network error")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function addCustomer() {
    setError(null)
    setOk(null)
    if (!t) return setError("Completează Tenant ID")
    if (!form.name.trim()) return setError("Completează nume client")

    setSaving(true)
    try {
      const res = await fetch(`/api/customers?tenantId=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || `Failed (${res.status})`)
        return
      }

      setForm({
        name: "",
        email: "",
        phone: "",
        vatCode: "",
        regNo: "",
        address: "",
        city: "",
        country: "RO",
        notes: "",
      })

      setOk(`Adăugat: ${data?.name || "client"}`)
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function del(id: string) {
    setError(null)
    setOk(null)
    if (!t) return setError("Completează Tenant ID")

    if (!confirm("Ștergi clientul?")) return

    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(t)}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || `Failed (${res.status})`)
        return
      }
      setOk("Client șters")
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => load(), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Clienți</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ width: 340, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
        >
          {loading ? "Încarc..." : "Reload"}
        </button>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Adaugă client</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          <input placeholder="Nume *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />

          <input placeholder="CUI" value={form.vatCode} onChange={(e) => setForm({ ...form, vatCode: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Nr. Reg. Com" value={form.regNo} onChange={(e) => setForm({ ...form, regNo: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Oraș" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />

          <input placeholder="Adresă" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Țară" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
          <input placeholder="Note" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            onClick={addCustomer}
            disabled={saving}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
          >
            {saving ? "Salvez..." : "Adaugă client"}
          </button>
        </div>

        {error && <div style={{ marginTop: 10, color: "crimson" }}><b>Eroare:</b> {error}</div>}
        {ok && <div style={{ marginTop: 10, color: "green" }}><b>OK:</b> {ok}</div>}
      </div>

      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>
          Lista clienți ({rows.length})
        </div>

        {(!t && <div style={{ padding: 12 }}>Introdu Tenant ID ca să vezi clienții.</div>) ||
          (loading && <div style={{ padding: 12 }}>Loading...</div>) ||
          (rows.length === 0 && <div style={{ padding: 12 }}>Niciun client încă.</div>)}

        {rows.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Nume</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Telefon</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Email</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>CUI</th>
                <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #eee" }}>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{c.name}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{c.phone || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{c.email || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{c.vatCode || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                    <button
                      onClick={() => del(c.id)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
                    >
                      Șterge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
