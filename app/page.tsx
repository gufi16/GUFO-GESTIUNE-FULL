async function load() {
  if (!tenantId?.trim()) return
  const res = await fetch(`/api/products?tenantId=${encodeURIComponent(tenantId.trim())}`)
  const data = await res.json()
  if (!res.ok) {
    alert(data?.error || "Failed to load products")
    return
  }
  setProducts(data)
}

async function create() {
  const tid = tenantId?.trim()
  const n = name?.trim()

  if (!tid) return alert("Tenant ID lipsă")
  if (!n) return alert("Product name lipsă")

  const res = await fetch(`/api/products?tenantId=${encodeURIComponent(tid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: n, uom: "buc" })
  })

  const data = await res.json()

  if (!res.ok) {
