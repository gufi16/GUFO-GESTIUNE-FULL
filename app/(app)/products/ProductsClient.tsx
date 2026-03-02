"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTenantId } from "../../../lib/useTenantId";

type Product = {
  id: string;
  name: string;
  uom: string;
  isActive: boolean;
  createdAt?: string;
};

function fmtBool(v: boolean) {
  return v ? "Da" : "Nu";
}

export default function ProductsClient() {
  const tenantId = useTenantId();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");

  const [form, setForm] = useState<{ name: string; uom: string; isActive: boolean }>({
    name: "",
    uom: "buc",
    isActive: true,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; uom: string; isActive: boolean } | null>(
    null
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return products;
    return products.filter((p) => p.name.toLowerCase().includes(qq));
  }, [products, q]);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Eroare la încărcare produse");
      setProducts(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error("Error loading products", err);
      setError(err?.message || "Eroare la încărcare produse");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tenantId]);

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    const name = form.name.trim();
    if (!name) {
      setError("Completează numele produsului.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          uom: form.uom,
          isActive: form.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Eroare la creare produs");

      setForm({ name: "", uom: "buc", isActive: true });
      await load();
    } catch (err: any) {
      console.error("Create product error", err);
      setError(err?.message || "Eroare la creare produs");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p: Product) {
    setEditing(p);
    setEditForm({ name: p.name, uom: p.uom || "buc", isActive: !!p.isActive });
    setError(null);
  }

  async function saveEdit() {
    if (!tenantId || !editing || !editForm) return;
    const name = editForm.name.trim();
    if (!name) {
      setError("Completează numele produsului.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(editing.id)}?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...editForm, name }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Eroare la salvare");
      setEditing(null);
      setEditForm(null);
      await load();
    } catch (err: any) {
      console.error("Update product error", err);
      setError(err?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    if (!tenantId) return;
    const ok = confirm(`Ștergi produsul „${p.name}”?`);
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(p.id)}?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Eroare la ștergere");
      await load();
    } catch (err: any) {
      console.error("Delete product error", err);
      setError(err?.message || "Eroare la ștergere");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Produse</h1>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Caută produs…"
          style={{
            width: 280,
            maxWidth: "45vw",
            padding: "10px 12px",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            outline: "none",
          }}
        />
      </div>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "#b00020", marginBottom: 16 }}>
          Lipsește tenantId în URL. Exemplu: <code>?tenantId=REST-1</code>
        </p>
      )}

      {error && (
        <div
          style={{
            background: "#fff5f5",
            border: "1px solid #fed7d7",
            color: "#b00020",
            padding: 12,
            borderRadius: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {tenantId && (
        <form
          onSubmit={createProduct}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700 }}>Adaugă produs</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 120px 120px 140px",
              gap: 10,
              alignItems: "center",
            }}
          >
            <input
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="Nume produs"
              style={{
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                outline: "none",
              }}
            />

            <input
              value={form.uom}
              onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))}
              placeholder="UM"
              style={{
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                outline: "none",
              }}
            />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
              />
              Activ
            </label>

            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111827",
                background: "#111827",
                color: "white",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Se salvează…" : "Adaugă"}
            </button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Notă: prețurile nu sunt încă în modelul Product din acest repo; dacă vrei purchasePrice / salePrice,
            le adăugăm în Prisma și apoi extindem UI.
          </div>
        </form>
      )}

      {loading && <p>Se încarcă...</p>}

      {!loading && tenantId && products.length === 0 && <p>Nu există produse pentru acest tenant.</p>}

      {!loading && tenantId && products.length > 0 && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left" }}>Nume</th>
                <th style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left", width: 120 }}>
                  UM
                </th>
                <th style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left", width: 120 }}>
                  Activ
                </th>
                <th style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "right", width: 240 }}>
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{p.name}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{p.uom || "buc"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{fmtBool(!!p.isActive)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                    <button
                      onClick={() => startEdit(p)}
                      disabled={saving}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                        background: "white",
                        cursor: saving ? "not-allowed" : "pointer",
                        marginRight: 8,
                      }}
                    >
                      Editează
                    </button>
                    <button
                      onClick={() => deleteProduct(p)}
                      disabled={saving}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #fecaca",
                        background: "#fff5f5",
                        cursor: saving ? "not-allowed" : "pointer",
                      }}
                    >
                      Șterge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && editForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => {
            setEditing(null);
            setEditForm(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 96vw)",
              background: "white",
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              padding: 16,
              boxShadow: "0 30px 80px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Editează produs</div>
              <button
                onClick={() => {
                  setEditing(null);
                  setEditForm(null);
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Închide
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 120px 120px",
                gap: 10,
                alignItems: "center",
                marginTop: 12,
              }}
            >
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((s) => (s ? { ...s, name: e.target.value } : s))}
                placeholder="Nume produs"
                style={{
                  padding: "10px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  outline: "none",
                }}
              />
              <input
                value={editForm.uom}
                onChange={(e) => setEditForm((s) => (s ? { ...s, uom: e.target.value } : s))}
                placeholder="UM"
                style={{
                  padding: "10px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  outline: "none",
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm((s) => (s ? { ...s, isActive: e.target.checked } : s))}
                />
                Activ
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => {
                  setEditing(null);
                  setEditForm(null);
                }}
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                Renunță
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "white",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Se salvează…" : "Salvează"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
