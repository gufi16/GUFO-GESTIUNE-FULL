import { useEffect, useMemo, useState } from "react"
import { ImagePlus, Layers3, MonitorSmartphone, Tags } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"

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
  const token = getToken() || ""

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
  const [previewImageFailed, setPreviewImageFailed] = useState(false)

  const stats = useMemo(
    () => ({
      total: list.length,
      withImage: list.filter((item) => Boolean(item.imageUrl)).length,
      visibleInPos: list.filter((item) => item.isVisibleInPos !== false).length,
      departments: new Set(list.map((item) => item.department?.name || item.departmentId).filter(Boolean)).size,
    }),
    [list]
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setError("")
    setMessage("")

    try {
      const headers = { Authorization: `Bearer ${token}` }

      const [categoriesRes, depsRes] = await Promise.all([
        fetch(`${API}/api/v1/meta/categories`, { headers }),
        fetch(`${API}/api/v1/meta/departments`, { headers }),
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
    setPreviewImageFailed(false)
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
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut încărca imaginea.")
        return
      }

      setImageUrl(data.imageUrl || "")
      setPreviewImageFailed(false)
      setMessage("Imaginea categoriei a fost încărcată.")
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
      const url = isEdit ? `${API}/api/v1/meta/categories/${editingId}` : `${API}/api/v1/meta/categories`
      const method = isEdit ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          departmentId,
          imageUrl: imageUrl.trim() || null,
          isVisibleInPos,
          ...(isEdit ? { isActive: true } : {}),
        }),
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
    setPreviewImageFailed(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function remove(id: string) {
    if (!window.confirm("Ștergi categoria?")) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
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
        badge="nomenclator"
        title="Categorii produse"
        subtitle="Categorii organizate pe departamente, cu imagine și vizibilitate pentru Android POS."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <DocumentMetric title="Categorii" value={stats.total} tone="slate" />
        <DocumentMetric title="Cu imagine" value={stats.withImage} tone="blue" />
        <DocumentMetric title="Vizibile in POS" value={stats.visibleInPos} tone="emerald" />
        <DocumentMetric title="Departamente active" value={stats.departments} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title={editingId ? "Edit categorie" : "Adaugă categorie"}
        description="Salvezi categoria, apoi poți încărca poza și o vezi imediat în preview."
        actions={
          <>
            {editingId ? (
              <button type="button" onClick={resetForm} className={documentButtonSecondaryClass}>
                Renunță
              </button>
            ) : null}
            <button type="button" onClick={save} className={documentButtonPrimaryClass} disabled={saving || uploading}>
              {saving ? "Se salvează..." : editingId ? "Salvează" : "Adaugă"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DocumentField label="Categorie">
            <input placeholder="Categorie" value={name} onChange={(e) => setName(e.target.value)} className={documentInputClass} />
          </DocumentField>

          <DocumentField label="Departament">
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={documentInputClass}>
              <option value="">Departament</option>
              {deps.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </DocumentField>

          <DocumentField label="Vizibilitate POS">
            <label className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700">
              <input type="checkbox" checked={isVisibleInPos} onChange={(e) => setIsVisibleInPos(e.target.checked)} />
              <span>Vizibilă în POS</span>
            </label>
          </DocumentField>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Imagine categorie</div>

            {editingId ? (
              <div className="flex flex-wrap gap-3">
                <label className={documentButtonSecondaryClass}>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadImage(file)
                    }}
                  />
                  <ImagePlus size={16} className="mr-2" />
                  {uploading ? "Se încarcă..." : "Încarcă poză categorie"}
                </label>

                {imageUrl.trim() ? (
                  <button
                    type="button"
                    className={documentButtonDangerClass}
                    onClick={() => {
                      setImageUrl("")
                      setPreviewImageFailed(false)
                    }}
                  >
                    Șterge poza
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                Salvează mai întâi categoria, apoi intră pe edit ca să încarci poza.
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Preview categorie</div>
            {imageUrl.trim() && !previewImageFailed ? (
              <img
                key={imageUrl}
                src={imageUrl}
                alt="Preview categorie"
                className="h-36 w-36 rounded-2xl border border-slate-200 object-cover"
                onError={() => setPreviewImageFailed(true)}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Categoria nu are încă poză.
              </div>
            )}
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Categorii existente" description="Le vezi pe toate, cu departamentul, vizibilitatea în POS și imaginea asociată.">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se încarcă...
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Poză</th>
                  <th className="px-4 py-3 text-left font-medium">Categorie</th>
                  <th className="px-4 py-3 text-left font-medium">Departament</th>
                  <th className="px-4 py-3 text-left font-medium">Vizibilă POS</th>
                  <th className="px-4 py-3 text-right font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {list.map((category) => (
                  <tr key={category.id} className="border-t border-slate-200">
                    <td className="px-4 py-4">
                      {category.imageUrl ? (
                        <img
                          src={category.imageUrl}
                          alt={category.name}
                          className="h-14 w-14 rounded-2xl border border-slate-200 object-cover"
                          onError={(e) => {
                            ;(e.currentTarget as HTMLImageElement).style.display = "none"
                          }}
                        />
                      ) : (
                        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <ImagePlus size={18} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{category.name}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{category.department?.name || "-"}</td>
                    <td className="px-4 py-4">
                      <span
                        className={
                          category.isVisibleInPos !== false
                            ? "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : "inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                        }
                      >
                        {category.isVisibleInPos !== false ? "Da" : "Nu"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => startEdit(category)} className={documentButtonSecondaryClass}>
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(category.id)} className={documentButtonDangerClass}>
                          Șterge
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DocumentSection>
    </div>
  )
}
