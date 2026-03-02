"use client";

import { useEffect, useState } from "react";
import { useTenantId } from "../../../lib/useTenantId";

type Customer = {
  id: string;
  name: string;
  vatNumber?: string | null;
  address?: string | null;
  createdAt?: string;
};

export default function PartnersClient() {
  const tenantId = useTenantId();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/customers?tenantId=${encodeURIComponent(tenantId)}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `Failed to load partners (${res.status})`);
        }

        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        setError(e?.message || "Eroare la încărcarea partenerilor");
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [tenantId]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Parteneri</h1>

      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
        Tenant: <code>{tenantId || "(lipsește tenantId)"}</code>
      </div>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "#b00020", marginBottom: 16 }}>
          Lipsește tenantId în URL. Exemplu: <code>?tenantId=REST-1</code>
        </p>
      )}

      {error && (
        <div style={{ padding: 12, border: "1px solid #f3b", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#b00020" }}>Eroare</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}

      {loading && <p>Se încarcă...</p>}

      {!loading && tenantId && items.length === 0 && <p>Nu există parteneri pentru acest tenant.</p>}

      {!loading && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Nume</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>CUI</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Adresă</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{c.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{c.vatNumber || "-"}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{c.address || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}