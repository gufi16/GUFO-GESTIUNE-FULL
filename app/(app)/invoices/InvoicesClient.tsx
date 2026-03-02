"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

type Customer = {
  id: string
  name: string
  vatCode?: string | null
}

type InvoiceItem = {
  id?: string
  description: string
  uom?: string
  quantity: number
  unitPrice: number
  vatRate: number
  lineNet?: string
  lineVat?: string
  lineTotal?: string
}

type Invoice = {
  id: string
  series: string
  number: number
  status: string
  currency: string
  subtotal: string
  vatTotal: string
  total: string
  createdAt: string
  customer?: Customer
  items?: InvoiceItem[]
}

function money(n: number) {
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

function parseDecimal(v: any) {
  const n = typeof v === "string" ? Number(v) : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export default function InvoicesClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const [tenantId, setTenantId] = useState("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])

  const [customerId, setCustomerId] = useState("")
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "", quantity: 1, unitPrice: 0, vatRate: 19 },
  ])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // hydrate din URL (o singură dată)
  useEffect(() => {
    const t = (sp.get("tenantId") || "").trim()
    if (t) setTenantId(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const t = useMemo(() => tenantId.trim(), [tenantId])

  // păstrează tenantId în URL (ca să nu se piardă la refresh/navigation)
  useEffect(() => {
    const current = (sp.get("tenantId") || "").trim()
    if (!t && !current) return
    if (t === current) return

    const params = new URLSearchParams(sp.toString())
    if (t) params.set("tenantId", t)
    else params.delete("tenantId")

    router.replace(`?${params.toString()}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  const preview = useMemo(() => {
    let subtotal = 0
    let vatTotal = 0
    let total = 0

    for (const it of items) {
      const q = Number(it.quantity)
      const p = Number(it.unitPrice)
      const r = Number(it.vatRate)
      if (!Number.isFinite(q) || q <= 0) continue
      if (!Number.isFinite(p) || p < 0) continue
      if (!Number.isFinite(r) || r < 0) continue

      const lineNet = q * p
      const lineVat = (lineNet * r) / 100
      const lineTotal = lineNet + lineVat
      subtotal += lineNet
      vatTotal += lineVat
      total += lineTotal
    }

    return { subtotal, vatTotal, total }
  }, [items])

  async function load() {
    setError(null)
    setOk(null)
    if (!t) {
      setCustomers([])
      setInvoices([])
      return
    }

    setLoading(true)
    try {
      const [cRes, iRes] = await Promise.all([
        fetch(`/api/customers?tenantId=${encodeURIComponent(t)}`, { cache: "no-store" }),
        fetch(`/api/invoices?tenantId=${encodeURIComponent(t)}`, { cache: "no-store" }),
      ])

      const cData = await cRes.json().catch(() => null)
      const iData = await iRes.json().catch(() => null)

      if (!cRes.ok) {
        setError(cData?.error || `Failed to load customers (${cRes.status})`)
        setCustomers([])
      } else {
        setCustomers(Array.isArray(cData) ? cData : [])
      }

      if (!iRes.ok) {
        setError((prev) => prev || iData?.error || `Failed to load invoices (${iRes.status})`)
        setInvoices([])
      } else {
        setInvoices(Array.isArray(iData) ? iData : [])
      }
    } catch (e: any) {
      setError(e?.message || "Network error")
      setCustomers([])
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }

  // auto load când se schimbă tenant (mic debounce)
  useEffect(() => {
    const timer = setTimeout(() => load(), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  function setItem(idx: number, patch: Partial<InvoiceItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function addRow() {
    setItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0, vatRate: 19 }])
  }

  function removeRow(idx: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  async function createInvoice() {
    setError(null)
    setOk(null)

    if (!t) return setError("Completează Tenant ID")
    if (!customerId) return setError("Alege clientul")

    const cleanItems = items
      .map((it) => ({
        description: String(it.description || "").trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
      }))
      .filter((it) => it.description)

    if (!cleanItems.length) return setError("Adaugă cel puțin o linie cu descriere")

    setSaving(true)
    try {
      const res = await fetch(`/api/invoices?tenantId=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, items: cleanItems }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = data?.error || `Failed to create (${res.status})`
        const details = data?.details ? ` — ${data.details}` : ""
        setError(`${msg}${details}`)
        return
      }

      setOk(`Factura creată: ${data?.series || ""}-${data?.number || ""}`)
      setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 19 }])
      await load()
    } catch (e: any) {
      setError(e?.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Facturi</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Tenant ID</div>
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="ex: REST-1"
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8, minWidth: 200 }}
          />
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Client</div>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8, minWidth: 240 }}
          >
            <option value="">— alege —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={createInvoice}
          disabled={saving}
          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #bbb", cursor: "pointer" }}
        >
          {saving ? "Se salvează…" : "Creează factură"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid #f3b", borderRadius: 10 }}>
          <b>Eroare:</b> {error}
        </div>
      )}
      {ok && (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid #9d9", borderRadius: 10 }}>
          {ok}
        </div>
      )}

      <hr style={{ margin: "18px 0" }} />

      <h2 style={{ marginTop: 0 }}>Linii</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((it, idx) => {
          const q = Number(it.quantity)
          const p = Number(it.unitPrice)
          const r = Number(it.vatRate)
          const lineNet = q * p
          const lineVat = (lineNet * r) / 100
          const lineTotal = lineNet + lineVat

          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 140px 90px 140px auto",
                gap: 10,
                alignItems: "center",
              }}
            >
              <input
                value={it.description}
                onChange={(e) => setItem(idx, { description: e.target.value })}
                placeholder="Descriere"
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
              />
              <input
                value={it.quantity}
                type="number"
                onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })}
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
              />
              <input
                value={it.unitPrice}
                type="number"
                onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value) })}
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
              />
              <input
                value={it.vatRate}
                type="number"
                onChange={(e) => setItem(idx, { vatRate: Number(e.target.value) })}
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
              />
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Net: <b>{money(parseDecimal(lineNet))}</b> | TVA: <b>{money(parseDecimal(lineVat))}</b> | Total:{" "}
                <b>{money(parseDecimal(lineTotal))}</b>
              </div>
              <button
                onClick={() => removeRow(idx)}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
              >
                Șterge
              </button>
            </div>
          )
        })}
      </div>

      <button
        onClick={addRow}
        style={{ marginTop: 12, padding: "9px 12px", borderRadius: 10, border: "1px solid #bbb", cursor: "pointer" }}
      >
        + Linie
      </button>

      <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #eee" }}>
        <div>
          Subtotal: <b>{money(preview.subtotal)}</b>
        </div>
        <div>
          TVA: <b>{money(preview.vatTotal)}</b>
        </div>
        <div>
          Total: <b>{money(preview.total)}</b>
        </div>
      </div>

      <hr style={{ margin: "18px 0" }} />

      <h2 style={{ marginTop: 0 }}>Facturi existente</h2>
      {loading ? (
        <div>Se încarcă…</div>
      ) : !t ? (
        <div style={{ opacity: 0.8 }}>Completează Tenant ID ca să vezi facturile.</div>
      ) : invoices.length === 0 ? (
        <div style={{ opacity: 0.8 }}>Nu există facturi.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {invoices.map((inv) => (
            <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
              <div style={{ fontWeight: 800 }}>
                {inv.series}-{inv.number}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Client: {inv.customer?.name || "—"} | Total: {inv.total}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
