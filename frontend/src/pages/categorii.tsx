import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

type Department = {
  id: string
  name: string
}

type Category = {
  id: string
  name: string
  departmentId: string
  imageUrl?: string | null
  isVisibleInPos?: boolean
  department?: Department | null
}

export default function CategoriiPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [list, setList] = useState<Category[]>([])
  const [deps, setDeps] = useState<Department[]>([])

  const [name, setName] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [isVisibleInPos, setIsVisibleInPos] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState("")

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError("")
    setMessage("")

    try {
      const headers = { Authorization: `Bearer ${token}` }

      const [categoriesRes, depsRes] = await Promise.all([
        fetch(`${API}/api/v1/meta/categories`, { headers }),
        fetch(`${API}/api/v1/meta/departments`, { headers })
      ])

      const categoriesData = await categoriesRes.json().catch(() => ({}))
      const depsData = await depsRes.json().catch(() => ({}))

      setList(Array.isArray(categoriesData.items) ? categoriesData.items : [])
      setDeps(Array.isArray(depsData.items) ? depsData.items : [])
    } catch {
      setError("Nu pot încărca categoriile.")
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setName("")
    setDepartmentId("")
    setImageUrl("")
    setIsVisibleInPos(true)
    setEditingId("")
    setError("")
    setMessage("")
  }

  async function uploadImage(file: File) {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    const formData = new FormData()
    formData.append("image", file)

    setUploading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/categories/upload-image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut încărca imaginea.")
        return
      }

      setImageUrl(data.imageUrl || "")
    } catch {
      setError("Nu am putut încărca imaginea.")
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (!name.trim()) {
      setError("Completează numele categoriei.")
      return
    }

    if (!departmentId) {
      setError("Selectează departamentul.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const isEdit = Boolean(editingId)
      const url = isEdit
        ? `${API}/api/v1/meta/categories/${editingId}`
        : `${API}/api/v1/meta/categories`

      const method = isEdit ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name.trim(),
          departmentId,
          imageUrl: imageUrl.trim() || null,
          isVisibleInPos,
          ...(isEdit ? { isActive: true } : {})
        })
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva categoria.")
        return
      }

      setMessage(isEdit ? "Categoria a fost actualizată." : "Categoria a fost adăugată.")
      resetForm()
      await load()
    } catch {
      setError("Nu am putut salva categoria.")
    } finally {
      setSaving(false)
    }
  }

  function startEdit(item: Category) {
    setEditingId(item.id)
    setName(item.name || "")
    setDepartmentId(item.departmentId || "")
    setImageUrl(item.imageUrl || "")
    setIsVisibleInPos(item.isVisibleInPos !== false)
    setError("")
    setMessage("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function remove(id: string) {
    if (!window.confirm("Ștergi categoria?")) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut șterge categoria.")
        return
      }

      if (editingId === id) {
        resetForm()
      }

      setMessage("Categoria a fost ștearsă.")
      await load()
    } catch {
      setError("Nu am putut șterge categoria.")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categorii produse"
        subtitle="Categorii organizate pe departamente, cu poze pentru Android POS."
      />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={card}>
        <div style={formTitle}>{editingId ? "Edit categorie" : "Adaugă categorie"}</div>

        <div style={addGrid}>
          <input
            placeholder="Categorie"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={input}
          />

          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            style={input}
          >
            <option value="">Departament</option>
            {deps.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <label style={checkboxWrap}>
            <input
              type="checkbox"
              checked={isVisibleInPos}
              onChange={(e) => setIsVisibleInPos(e.target.checked)}
            />
            <span>Vizibilă în POS</span>
          </label>

          <div style={actionsRow}>
            <button onClick={save} style={btnPrimary} disabled={saving || uploading}>
              {saving ? "Se salvează..." : editingId ? "Salvează" : "Adaugă"}
            </button>

            {editingId ? (
              <button onClick={resetForm} style={btnSecondary}>
                Renunță
              </button>
            ) : null}
          </div>
        </div>

        {editingId ? (
          <>
            <div style={uploadRow}>
              <label style={uploadLabel}>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadImage(file)
                  }}
                />
                <span style={btnSecondary}>
                  {uploading ? "Se încarcă..." : "Încarcă poză categorie"}
                </span>
              </label>

              {imageUrl.trim() ? (
                <button type="button" style={btnDangerSoft} onClick={() => setImageUrl("")}>
                  Șterge poza
                </button>
              ) : null}
            </div>

            {imageUrl.trim() ? (
              <div style={previewWrap}>
                <div style={previewLabel}>Preview categorie</div>
                <img
                  src={imageUrl}
                  alt="Preview categorie"
                  style={previewImage}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = "none"
                  }}
                />
              </div>
            ) : (
              <div style={hintBox}>
                Categoria nu are încă poză. Poți încărca poza doar în modul de editare, exact cum ai cerut.
              </div>
            )}
          </>
        ) : (
          <div style={hintBox}>
            Salvează mai întâi categoria, apoi intră pe Edit ca să încarci poza.
          </div>
        )}

        {loading ? (
          <div>Se încarcă...</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Poză</th>
                <th style={th}>Categorie</th>
                <th style={th}>Departament</th>
                <th style={th}>Vizibilă POS</th>
                <th style={th}>Acțiuni</th>
              </tr>
            </thead>

            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td style={td}>
                    {c.imageUrl ? (
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        style={thumb}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display = "none"
                        }}
                      />
                    ) : (
                      <span style={{ color: "#888" }}>-</span>
                    )}
                  </td>

                  <td style={td}>{c.name}</td>
                  <td style={td}>{c.department?.name || "-"}</td>
                  <td style={td}>{c.isVisibleInPos !== false ? "Da" : "Nu"}</td>

                  <td style={td}>
                    <div style={rowActions}>
                      <button onClick={() => startEdit(c)} style={btnEdit}>
                        Edit
                      </button>

                      <button onClick={() => remove(c.id)} style={btnDanger}>
                        Șterge
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 24
}

const formTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 14
}

const addGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto",
  gap: 10,
  marginBottom: 16,
  alignItems: "center"
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  width: "100%"
}

const actionsRow: React.CSSProperties = {
  display: "flex",
  gap: 10
}

const uploadRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginBottom: 16
}

const uploadLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center"
}

const btnPrimary: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer"
}

const btnSecondary: React.CSSProperties = {
  background: "#fff",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center"
}

const btnEdit: React.CSSProperties = {
  background: "#fff",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer"
}

const btnDanger: React.CSSProperties = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer"
}

const btnDangerSoft: React.CSSProperties = {
  background: "#fff1f2",
  color: "#991b1b",
  border: "1px solid #fecdd3",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer"
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse"
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb"
}

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle"
}

const rowActions: React.CSSProperties = {
  display: "flex",
  gap: 8
}

const thumb: React.CSSProperties = {
  width: 56,
  height: 56,
  objectFit: "cover",
  borderRadius: 10,
  border: "1px solid #e5e7eb"
}

const previewWrap: React.CSSProperties = {
  marginBottom: 16
}

const previewLabel: React.CSSProperties = {
  fontSize: 13,
  color: "#666",
  marginBottom: 8
}

const previewImage: React.CSSProperties = {
  width: 120,
  height: 120,
  objectFit: "cover",
  borderRadius: 14,
  border: "1px solid #e5e7eb"
}

const hintBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 12,
  border: "1px dashed #d1d5db",
  background: "#f9fafb",
  color: "#4b5563"
}

const checkboxWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  minHeight: 42,
  background: "#fff"
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 12
}

const successBox: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
  borderRadius: 12,
  padding: 12
}