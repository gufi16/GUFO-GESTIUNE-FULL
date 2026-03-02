"use client";

import { useEffect, useMemo, useState } from "react";
import { useTenantId } from "../../../lib/useTenantId";

type Invoice = {
  id: string;
  tenantId: string;
  series: string;
  number: number;
  customerId: string;
  customerName?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  createdAt?: string;
};

export default function InvoicesClient() {
  const tenantId = useTenantId();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // create minimal
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState<number>(1);

  const canCreate = useMemo(() => {
    return !!tenantId && !!customerId && !!productId && qty > 0;
  }, [tenantId, customerId, productId, qty]);

  async function loadInvoices() {
    if (!tenantId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/invoices?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed to load invoices (${res.status})`);
      }

      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Eroare la încărcarea facturilor");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function createInvoice() {
    if (!canCreate) return;

    setCreating(true);
    setError(null);

    try {
      const payload = {
        customerId,
        items: [{ productId, qty: Number(qty) }],
      };

      const res = await fetch(`/api/invoices?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed to create invoice (${res.status})`);
      }

      // reset
      setCustomerId("");
      setProductId("");
      setQty(1);

      await loadInvoices();
    } catch (e: any) {
      setError(e?.message || "Eroare la creare factură");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Facturi</h1>

      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
        Tenant: <code>{tenantId || "(lipsește tenantId)"}</code>
      </div>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "#b00020", marginBottom: 16 }}>
          Lipsește tenantId în URL. Exemplu: <code>?tenantId=REST-1</code>
        </p>
      )}

      {/* Create (minimal) */}
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Creează factură (test rapid)</div>

        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Customer ID
            <input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="ex: cus_..."
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Product ID
            <input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="ex: prod_..."
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Cantitate
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <button
            onClick={createInvoice}
            disabled={!canCreate || creating}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #222",
              background: creating ? "#eee" : "#fff",
              cursor: !canCreate || creating ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {creating ? "Se creează…" : "Creează factură"}
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
          Notă: form minim (ID-uri). Următorul pas: dropdown-uri pe Customers/Products + editor linii.
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, border: "1px solid #f3b", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#b00020" }}>Eroare</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}

      {loading && <p>Se încarcă...</p>}

      {!loading && tenantId && items.length === 0 && <p>Nu există facturi pentru acest tenant.</p>}

      {!loading && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Serie</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Nr</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Client</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Subtotal</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>TVA</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => (
              <tr key={inv.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{inv.series}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{inv.number}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {inv.customerName || inv.customerId}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{inv.subtotal}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{inv.vat}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee", fontWeight: 700 }}>{inv.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}