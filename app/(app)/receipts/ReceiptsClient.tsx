"use client";

import { useEffect, useMemo, useState } from "react";
import { useTenantId } from "../../../lib/useTenantId";

type Receipt = {
  id: string;
  series: string;
  number: number;
  date: string;
  partnerId?: string | null;
  notes?: string | null;
};

export default function ReceiptsClient() {
  const tenantId = useTenantId();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Receipt[]>([]);
  const [error, setError] = useState<string | null>(null);

  // create minimal NIR
  const [creating, setCreating] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [notes, setNotes] = useState("");

  const canCreate = useMemo(() => {
    return !!tenantId && !!productId && qty > 0 && unitPrice >= 0;
  }, [tenantId, productId, qty, unitPrice]);

  async function loadReceipts() {
    if (!tenantId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/receipts?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Eroare la încărcarea NIR");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function createReceipt() {
    if (!canCreate) return;

    setCreating(true);
    setError(null);

    try {
      const payload = {
        partnerId: partnerId || null,
        notes: notes || null,
        items: [{ productId, qty: Number(qty), unitPrice: Number(unitPrice) }],
      };

      const res = await fetch(`/api/receipts?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);

      setPartnerId("");
      setProductId("");
      setQty(1);
      setUnitPrice(0);
      setNotes("");

      await loadReceipts();
    } catch (e: any) {
      setError(e?.message || "Eroare la creare NIR");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>NIR (Notă de recepție)</h1>

      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
        Tenant: <code>{tenantId || "(lipsește tenantId)"}</code>
      </div>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "#b00020", marginBottom: 16 }}>
          Lipsește tenantId în URL. Exemplu: <code>?tenantId=REST-1</code>
        </p>
      )}

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Creează NIR (test rapid)</div>

        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Partner ID (opțional)
            <input
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
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
              min={0.001}
              step="0.001"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Preț unitar (fără TVA)
            <input
              type="number"
              min={0}
              step="0.0001"
              value={unitPrice}
              onChange={(e) => setUnitPrice(Number(e.target.value))}
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Note
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="opțional"
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>

          <button
            onClick={createReceipt}
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
            {creating ? "Se creează…" : "Creează NIR"}
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
          TVA nu se folosește aici. NIR generează mișcări de stoc (IN) în StockLedger.
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, border: "1px solid #f3b", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#b00020" }}>Eroare</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}

      {loading && <p>Se încarcă...</p>}

      {!loading && tenantId && items.length === 0 && <p>Nu există NIR-uri pentru acest tenant.</p>}

      {!loading && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Serie</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Nr</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Dată</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Partner</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.series}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.number}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {new Date(r.date).toLocaleDateString()}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.partnerId || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}