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

export default function InvoicesPage() {
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Tenant ID (ex: REST-1)"
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

        <div style={{ fontSize: 12, opacity: 0.75 }}>
          API: <code>/api/invoices?tenantId=...</code>
        </div>
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

      {/* Creare */}
      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>Emitere factură</div>

        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              style={{ width: 360, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
              disabled={!t || customers.length === 0}
            >
              <option value="">Selectează client...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.vatCode ? ` (${c.vatCode})` : ""}
                </option>
              ))}
            </select>

            <button
              onClick={addRow}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
              type="button"
            >
              + Linie
            </button>

            <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85 }}>
              <b>Preview:</b> Subtotal {money(preview.subtotal)} | TVA {money(preview.vatTotal)} | Total {money(preview.total)}
            </div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Descriere</th>
                  <th style={{ width: 120, textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Cant.</th>
                  <th style={{ width: 160, textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Preț</th>
                  <th style={{ width: 120, textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>TVA %</th>
                  <th style={{ width: 110, textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      <input
                        value={it.description}
                        onChange={(e) => setItem(idx, { description: e.target.value })}
                        placeholder="ex: Test serviciu"
                        style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                      />
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      <input
                        value={it.quantity}
                        onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })}
                        type="number"
                        min={0}
                        step={0.01}
                        style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      <input
                        value={it.unitPrice}
                        onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value) })}
                        type="number"
                        min={0}
                        step={0.01}
                        style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      <input
                        value={it.vatRate}
                        onChange={(e) => setItem(idx, { vatRate: Number(e.target.value) })}
                        type="number"
                        min={0}
                        step={1}
                        style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                      <button
                        onClick={() => removeRow(idx)}
                        type="button"
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
                        title="Șterge linia"
                      >
                        Șterge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={createInvoice}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {saving ? "Creez..." : "Emite factură"}
            </button>
          </div>
        </div>
      </div>

      {/* Listare */}
      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>
          Lista facturi ({invoices.length})
        </div>

        {(!t && <div style={{ padding: 12 }}>Introdu Tenant ID ca să vezi facturile.</div>) ||
          (loading && <div style={{ padding: 12 }}>Loading...</div>) ||
          (invoices.length === 0 && <div style={{ padding: 12 }}>Nicio factură încă.</div>)}

        {invoices.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Nr</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Client</th>
                <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #eee" }}>Data</th>
                <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #eee" }}>Subtotal</th>
                <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #eee" }}>TVA</th>
                <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #eee" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const dt = inv.createdAt ? new Date(inv.createdAt) : null
                const dateLabel = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleString() : ""

                return (
                  <tr key={inv.id}>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>
                      <b>
                        {inv.series}-{inv.number}
                      </b>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{inv.status}</div>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{inv.customer?.name || "—"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2" }}>{dateLabel}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                      {money(parseDecimal(inv.subtotal))}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                      {money(parseDecimal(inv.vatTotal))}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                      <b>{money(parseDecimal(inv.total))}</b>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
