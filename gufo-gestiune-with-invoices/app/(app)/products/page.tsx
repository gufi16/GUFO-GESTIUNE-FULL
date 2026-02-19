"use client"

import { useEffect, useMemo, useState } from "react"

type Product = {
  id: string
  name: string
  uom?: string | null
  isActive?: boolean | null
  createdAt?: string
}

export default function ProductsPage() {
  const [tenantId, setTenantId] = useState("")
  const [name, setName] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const t = useMemo(() => tenantId.trim(), [tenantId])

  async function load() {
    setError(null)
    setOk(null)

    if (!t) {
      setProducts([])
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(t)}`, {
        cache: "no-store",
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || `Failed to load (${res.status})`)
        setProducts([])
        return
      }

      setProducts(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || "Network error")
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  async function addProduct() {
    setError(null)
    setOk(null)

    if (!t) return setError("Completează Tenant ID")
    if (!name.trim()) return setError("Completează numele produsului")

    setSaving(true)
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || `Failed to add (${res.status})`)
        return
      }

      setName("")
      setOk(`Adăugat: ${data?.name || "produs"}`)
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function deleteProduct(id: string) {
    setError(null)
    setOk(null)
    if (!t) return setError("Completează Tenant ID")

    const yes = confirm("Ștergi produsul?")
    if (!yes) return

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(t)}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || `Failed to delete (${res.status})`)
        return
      }

      setOk("Produs șters")
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    }
  }

  // Auto-load când se schimbă tenantId (mic debounce)
  useEffect(() => {
    const timer = setTimeout(() => load(), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Produse</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ width: 340, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <input
          placeholder="Nume produs (ex: Cola)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 260, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <button
          onClick={addProduct}
          disabled={saving}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
        >
          {saving ? "Salvez..." : "Adaugă"}
        </button>

        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
        >
          {loading ? "Încarc..." : "Reload"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <b>Eroare:</b> {error}
        </div>
      )}
      {ok && (
        <div style={{ marginTop: 12, color: "green" }}>
          <b>OK:</b> {ok}
        </div>
      )}

      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>
          Lista produse ({products.length})
        </div>

        {(!t && <div style={{ padding: 12 }}>Introdu Tenant ID ca să vezi produsele.</div>) ||
          (loading && <div style={{ padding: 12 }}>Loading...</div>) ||
          (products.length === 0 && <div style={{ padding: 12 }}>Niciun produs încă.</div>)}

        {products.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Nume</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>UM</th>
                <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #eee" }}>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{p.name}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{p.uom || "buc"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                    <button
                      onClick={() => deleteProduct(p.id)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        cursor: "pointer",
                      }}
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

      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>
        Tip: verificare directă în API: <code>/api/products?tenantId=...</code>
      </div>
    </div>
  )
}
