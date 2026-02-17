
"use client"

import { useEffect, useState } from "react"

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([])
  const [name, setName] = useState("")
  const [tenantId, setTenantId] = useState("")

  async function load() {
    if (!tenantId) return
    const res = await fetch(`/api/products?tenantId=${tenantId}`)
    const data = await res.json()
    setProducts(data)
  }

  async function create() {
    await fetch(`/api/products?tenantId=${tenantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, uom: "buc" })
    })
    setName("")
    load()
  }

  async function remove(id: string) {
    await fetch(`/api/products/${id}?tenantId=${tenantId}`, {
      method: "DELETE"
    })
    load()
  }

  useEffect(() => { load() }, [tenantId])

  return (
    <div style={{ padding: 40 }}>
      <h1>Products</h1>

      <input
        placeholder="Tenant ID"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
      />

      <hr />

      <input
        placeholder="Product name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={create}>Add</button>

      <ul>
        {products.map(p => (
          <li key={p.id}>
            {p.name} ({p.uom})
            <button onClick={() => remove(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
