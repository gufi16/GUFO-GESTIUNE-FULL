import { useEffect, useMemo, useState } from "react"
import { ImagePlus, MonitorSmartphone } from "lucide-react"
import { useSearchParams } from "react-router-dom"
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
} from "../components/DocumentUi"
import { API_BASE as API, getToken, resolvePublicAssetUrl } from "../lib/api"

type Department = {
  id: string
  name: string
}

type PosTerminal = {
  id: string
  label: string
  deviceId?: string | null
  location?: { id: string; name: string; code?: string | null } | null
}

type Category = {
  id: string
  name: string
  departmentId: string
  imageUrl?: string | null
  parentCategoryId?: string | null
  parentCategory?: { id: string; name: string } | null
  posSortOrder?: number | null
  isVisibleInPos?: boolean
  terminalIds?: string[]
  department?: Department | null
}

function normalizeHostedImageUrl(value: any) {
  const text = String(value || "").trim()
  if (!text) return ""

  if (/^(data:|blob:)/i.test(text)) {
    return text
  }

  if (/^\/(?!\/)/.test(text)) {
    return `${API}${text}`
  }

  if (!/^https?:\/\//i.test(text)) {
    return `${API}/${text.replace(/^\/+/, "")}`
  }

  if (typeof window !== "undefined" && window.location.protocol === "https:" && text.startsWith("http://")) {
    return text.replace(/^http:\/\//i, "https://")
  }

  return text
}

export default function SubcategoriiPage() {
  const token = getToken() || ""
  const [searchParams] = useSearchParams()
  const initialParentId = searchParams.get("parent") || ""

  const [list, setList] = useState<Category[]>([])
  const [terminals, setTerminals] = useState<PosTerminal[]>([])

  const [name, setName] = useState("")
  const [parentCategoryId, setParentCategoryId] = useState(initialParentId)
  const [imageUrl, setImageUrl] = useState("")
  const [posSortOrderInput, setPosSortOrderInput] = useState("")
  const [isVisibleInPos, setIsVisibleInPos] = useState(true)
  const [selectedTerminalIds, setSelectedTerminalIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState("")
  const [previewImageFailed, setPreviewImageFailed] = useState(false)

  const topLevelCategories = useMemo(() => list.filter((item) => !item.parentCategoryId), [list])
  const subcategories = useMemo(() => list.filter((item) => Boolean(item.parentCategoryId)), [list])
  const selectedParentCategory = useMemo(
    () => topLevelCategories.find((item) => item.id === parentCategoryId) || null,
    [topLevelCategories, parentCategoryId]
  )
  const filteredSubcategories = useMemo(() => {
    if (!parentCategoryId) return subcategories
    return subcategories.filter((item) => item.parentCategoryId === parentCategoryId)
  }, [parentCategoryId, subcategories])

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

      const [categoriesRes, terminalsRes] = await Promise.all([
        fetch(`${API}/api/v1/meta/categories`, { headers }),
        fetch(`${API}/api/v1/meta/terminals?deviceType=POS`, { headers }),
      ])

      const categoriesData = await categoriesRes.json().catch(() => ({}))
      const terminalsData = await terminalsRes.json().catch(() => ({}))

      setList(
        Array.isArray(categoriesData.items)
          ? categoriesData.items.map((item: Category) => ({
              ...item,
              imageUrl: normalizeHostedImageUrl(item?.imageUrl || ""),
              terminalIds: Array.isArray(item?.terminalIds) ? item.terminalIds.map((value) => String(value)) : [],
            }))
          : []
      )
      setTerminals(
        Array.isArray(terminalsData.terminals)
          ? terminalsData.terminals
          : Array.isArray(terminalsData.items)
            ? terminalsData.items
            : []
      )
    } catch {
      setError("Nu pot incarca subcategoriile.")
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setName("")
    setImageUrl("")
    setPosSortOrderInput("")
    setIsVisibleInPos(true)
    setSelectedTerminalIds([])
    setEditingId("")
    setError("")
    setMessage("")
    setPreviewImageFailed(false)
  }

  async function uploadImage(file: File) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
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
        setError(data.error || "Nu am putut incarca imaginea.")
        return
      }

      setImageUrl(normalizeHostedImageUrl(data.imageUrl || ""))
      setPreviewImageFailed(false)
      setMessage("Imaginea subcategoriei a fost incarcata.")
    } catch {
      setError("Nu am putut incarca imaginea.")
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!parentCategoryId) {
      setError("Alege categoria principala.")
      return
    }

    if (!name.trim()) {
      setError("Completeaza numele subcategoriei.")
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
          departmentId: selectedParentCategory?.departmentId || "",
          parentCategoryId,
          imageUrl: normalizeHostedImageUrl(imageUrl.trim()) || null,
          posSortOrder: parsePosSortOrderInput(posSortOrderInput),
          isVisibleInPos,
          terminalIds: selectedTerminalIds,
          ...(isEdit ? { isActive: true } : {}),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva subcategoria.")
        return
      }

      setMessage(isEdit ? "Subcategoria a fost actualizata." : "Subcategoria a fost adaugata.")
      resetForm()
      await load()
    } catch {
      setError("Nu am putut salva subcategoria.")
    } finally {
      setSaving(false)
    }
  }

  function startEdit(item: Category) {
    setEditingId(item.id)
    setName(item.name || "")
    setParentCategoryId(item.parentCategoryId || "")
    setImageUrl(normalizeHostedImageUrl(item.imageUrl || ""))
    setPosSortOrderInput(item.posSortOrder && item.posSortOrder > 0 ? String(item.posSortOrder) : "")
    setIsVisibleInPos(item.isVisibleInPos !== false)
    setSelectedTerminalIds(Array.isArray(item.terminalIds) ? item.terminalIds : [])
    setError("")
    setMessage("")
    setPreviewImageFailed(false)
  }

  async function remove(id: string) {
    if (!window.confirm("Stergi subcategoria?")) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut sterge subcategoria.")
        return
      }

      if (editingId === id) {
        resetForm()
      }

      setMessage("Subcategoria a fost stearsa.")
      await load()
    } catch {
      setError("Nu am putut sterge subcategoria.")
    }
  }

  function toggleTerminal(terminalId: string) {
    setSelectedTerminalIds((prev) =>
      prev.includes(terminalId) ? prev.filter((item) => item !== terminalId) : [...prev, terminalId]
    )
  }

  function parsePosSortOrderInput(value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.round(parsed))
  }

  function renderForm() {
    return (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DocumentField label="Categorie principala">
            <select
              value={parentCategoryId}
              onChange={(e) => setParentCategoryId(e.target.value)}
              className={documentInputClass}
            >
              <option value="">Alege categoria principala</option>
              {topLevelCategories
                .filter((item) => item.id !== editingId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </DocumentField>

          <DocumentField label="Nume subcategorie">
            <input
              placeholder="Ex: Lipie"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={documentInputClass}
            />
          </DocumentField>

          <DocumentField label="Pozitie Gufo POS">
            <input
              type="number"
              min={0}
              step={1}
              placeholder="Ex: 1"
              value={posSortOrderInput}
              onChange={(e) => setPosSortOrderInput(e.target.value)}
              className={documentInputClass}
            />
          </DocumentField>

          <DocumentField label="Vizibilitate POS">
            <label className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700">
              <input type="checkbox" checked={isVisibleInPos} onChange={(e) => setIsVisibleInPos(e.target.checked)} />
              <span>Vizibila in POS</span>
            </label>
          </DocumentField>
        </div>

        {selectedParentCategory ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Subcategoria va sta sub <strong>{selectedParentCategory.name}</strong>
            {selectedParentCategory.department?.name ? ` in departamentul ${selectedParentCategory.department.name}` : ""}.
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Imagine subcategorie</div>

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
                {uploading ? "Se incarca..." : "Incarca poza subcategorie"}
              </label>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Preview subcategorie</div>
            {imageUrl.trim() && !previewImageFailed ? (
              <img
                key={imageUrl}
                src={imageUrl}
                alt="Preview subcategorie"
                className="h-36 w-36 rounded-2xl border border-slate-200 object-cover"
                onError={() => setPreviewImageFailed(true)}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Subcategoria nu are inca poza. Pentru schimbare, incarca alta imagine.
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Vizibilitate pe device POS</div>
              <div className="mt-1 text-xs text-slate-500">
                Daca nu alegi niciun POS, subcategoria ramane vizibila pe toate device-urile POS ale firmei.
              </div>
            </div>
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {selectedTerminalIds.length ? `${selectedTerminalIds.length} selectate` : "Toate POS-urile"}
            </span>
          </div>

          {terminals.length ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {terminals.map((terminal) => {
                const active = selectedTerminalIds.includes(terminal.id)
                return (
                  <label
                    key={terminal.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                      active
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleTerminal(terminal.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <MonitorSmartphone size={14} className="text-slate-500" />
                        <span>{terminal.label}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[terminal.deviceId, terminal.location?.name].filter(Boolean).join(" · ") || "POS fara locatie"}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Nu exista inca device-uri POS pe care sa filtrezi subcategoria.
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Subcategorii produse"
        subtitle="Aici legi variantele sub categoriile principale, ca sa ai structura curata pentru produse si Gufo POS."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <DocumentMetric title="Subcategorii" value={subcategories.length} tone="amber" />
        <DocumentMetric title="Categorii principale" value={topLevelCategories.length} tone="slate" />
        <DocumentMetric title="Cu imagine" value={subcategories.filter((item) => Boolean(item.imageUrl)).length} tone="blue" />
        <DocumentMetric title="Vizibile in POS" value={subcategories.filter((item) => item.isVisibleInPos !== false).length} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Adauga subcategorie"
        description="Fiecare subcategorie sta sub o categorie principala. Exemplu: Shaorma -> Lipie, Farfurie, Chifla."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="/nomenclator/categorii" className={documentButtonSecondaryClass}>
              Inapoi la categorii
            </a>
            <button type="button" onClick={save} className={documentButtonPrimaryClass} disabled={saving || uploading}>
              {saving ? "Se salveaza..." : "Adauga subcategorie"}
            </button>
          </div>
        }
      >
        {renderForm()}
      </DocumentSection>

      <DocumentSection title="Subcategorii existente" description="Vezi toate subcategoriile si categoria parinte din care fac parte.">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se incarca...
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Poza</th>
                  <th className="px-4 py-3 text-left font-medium">Subcategorie</th>
                  <th className="px-4 py-3 text-left font-medium">Categorie</th>
                  <th className="px-4 py-3 text-left font-medium">Pozitie POS</th>
                  <th className="px-4 py-3 text-left font-medium">Departament</th>
                  <th className="px-4 py-3 text-left font-medium">Vizibila POS</th>
                  <th className="px-4 py-3 text-left font-medium">POS-uri</th>
                  <th className="px-4 py-3 text-right font-medium">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubcategories.map((category) => (
                  <tr key={category.id} className="border-t border-slate-200">
                    <td className="px-4 py-4">
                      {category.imageUrl ? (
                        <img
                          src={resolvePublicAssetUrl(category.imageUrl)}
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
                    <td className="px-4 py-4 font-semibold text-slate-900">{category.name}</td>
                    <td className="px-4 py-4 text-slate-600">{category.parentCategory?.name || "-"}</td>
                    <td className="px-4 py-4 text-slate-600">{category.posSortOrder && category.posSortOrder > 0 ? category.posSortOrder : "-"}</td>
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
                    <td className="px-4 py-4 text-slate-600">
                      {category.terminalIds?.length ? `${category.terminalIds.length} POS` : "Toate POS-urile"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => startEdit(category)} className={documentButtonSecondaryClass}>
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(category.id)} className={documentButtonDangerClass}>
                          Sterge
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

      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-white shadow-2xl">
            <DocumentSection
              title="Edit subcategorie"
              description="Editezi rapid subcategoria fara sa pierzi categoria parinte din care face parte."
              actions={
                <>
                  <button type="button" onClick={resetForm} className={documentButtonSecondaryClass}>
                    Inchide
                  </button>
                  <button type="button" onClick={save} className={documentButtonPrimaryClass} disabled={saving || uploading}>
                    {saving ? "Se salveaza..." : "Salveaza"}
                  </button>
                </>
              }
            >
              {renderForm()}
            </DocumentSection>
          </div>
        </div>
      ) : null}
    </div>
  )
}
