"use client";

import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/useTenantId";

export default function ProductsClient() {
  const tenantId = useTenantId();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/products?tenantId=${tenantId}`);
        const data = await res.json();
        setProducts(data || []);
      } catch (err) {
        console.error("Error loading products", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [tenantId]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Produse</h1>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "#b00020" }}>
          Lipsește tenantId în URL. Exemplu: <code>?tenantId=REST-1</code>
        </p>
      )}

      {loading && <p>Se încarcă...</p>}

      {!loading && tenantId && products.length === 0 && <p>Nu există produse pentru acest tenant.</p>}

      {!loading && tenantId && products.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Nume</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>Preț</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" }}>TVA</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{p.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{p.price}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{p.vatRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}