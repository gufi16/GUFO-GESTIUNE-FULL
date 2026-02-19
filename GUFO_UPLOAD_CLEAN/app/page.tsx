"use client"

import { useEffect, useState } from "react"

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
  const [info, setInfo] = useState<string | null>(null)

  const normalizedTenantId = tenantId.trim()

  async function load() {
    setError(null)
    setInfo(null)

    if (!normalizedTenantId) {
      setProducts([])
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(normalizedTenantId)}`, {
        cache: "no-store",
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const msg = data?.error || `Failed to load products (${res.status})`
        setError(msg)
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
    setInfo(null)

    if (!normalizedTenantId) {
      setError("Missing tenantId")
      return
    }
    if (!name.trim()) {
      setError("Missing product name")
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(normalizedTenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const msg = data?.error || `Failed to add product (${res.status})`
        setError(msg)
        return
      }

      setName("")
      setInfo(`Added: ${data?.name || "product"}`)
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  // Optional: auto-load when tenantId changes (debounce simplu)
  useEffect(() => {
    const t = setTimeout(() => {
      load()
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTenantId])

  return (
    <main style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>Products</h1>

      <div style={{ marginTop: 16 }}>
        <input
          placeholder="Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ width: 360 }}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <input
          placeholder="Product name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 260, marginRight: 8 }}
        />
        <button onClick={addProduct} disabled={saving}>
          {saving ? "Adding..." : "Add"}
        </button>

        <button onClick={load} disabled={loading} style={{ marginLeft: 8 }}>
          {loading ? "Loading..." : "Reload"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <b>Error:</b> {error}
        </div>
      )}

      {info && (
        <div style={{ marginTop: 12, color: "green" }}>
          <b>OK:</b> {info}
        </div>
      )}

      <hr style={{ marginTop: 16 }} />

      {!normalizedTenantId ? (
        <p>Introduce Tenant ID ca să vezi produsele.</p>
      ) : loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <h3 style={{ marginTop: 0 }}>List ({products.length})</h3>

          {products.length === 0 ? (
            <p>No products yet.</p>
          ) : (
            <ul>
              {products.map((p) => (
                <li key={p.id}>
                  <b>{p.name}</b> {p.uom ? `(${p.uom})` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
