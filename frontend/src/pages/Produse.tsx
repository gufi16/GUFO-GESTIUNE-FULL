import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

type Product = {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  class: string
  price: number
  isActive: boolean
  isVisibleInPos?: boolean
  isSgr?: boolean
  sgrValue?: number
  forcedInactiveBecauseMissingRecipe?: boolean
  recipe?: {
    id: string
    status: string
    items?: any[]
  } | null
  vatRate?: { id: string; rate: number; name: string }
  uom?: { id: string; code: string; name: string }
  purchaseUom?: { id: string; code: string; name: string } | null
  category?: {
    id: string
    name: string
    imageUrl?: string | null
    department?: { id: string; name: string } | null
  } | null
  department?: { id: string; name: string } | null
}

type ProductOption = {
  id: string
  name: string
  sku: string
  class: string
  uom?: { id: string; code: string; name: string } | null
  isActive?: boolean
}

type FormState = {
  name: string
  imageUrl: string
  class: string
  uomId: string
  purchaseUomId: string
  purchaseFactor: string
  vatRateId: string
  categoryId: string
  price: string
  isActive: boolean
  isVisibleInPos: boolean
  isSgr: boolean
}

type RecipeLine = {
  ingredientId: string
  qty: string
  lossPercent: string
  notes: string
  sortOrder: number
}

type RecipeForm = {
  code: string
  name: string
  notes: string
  yieldQty: string
  status: "DRAFT" | "ACTIVE" | "INACTIVE"
  isActive: boolean
  items: RecipeLine[]
}

const CLASS_OPTIONS = [
  { value: "MATERIE_PRIMA", label: "materie prima" },
  { value: "ALTE_MATERIALE", label: "alte materiale" },
  { value: "PRODUS_FIN", label: "produs finit" },
  { value: "MARFA", label: "marfă" },
  { value: "AMBALAJE", label: "ambalaje" },
  { value: "SEMIFABRICATE", label: "semifabricate" },
  { value: "REZIDUALE", label: "reziduale" },
  { value: "CONSUMABILE", label: "consumabile" }
]

const CLASS_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CLASS_OPTIONS.map((x) => [x.value, x.label])
)

const emptyForm: FormState = {
  name: "",
  imageUrl: "",
  class: "MARFA",
  uomId: "",
  purchaseUomId: "",
  purchaseFactor: "1",
  vatRateId: "",
  categoryId: "",
  price: "0",
  isActive: true,
  isVisibleInPos: true,
  isSgr: false
}

const emptyRecipeForm: RecipeForm = {
  code: "",
  name: "",
  notes: "",
  yieldQty: "1",
  status: "DRAFT",
  isActive: true,
  items: []
}

export default function ProdusePage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<Product[]>([])
  const [uoms, setUoms] = useState<any[]>([])
  const [vatRates, setVatRates] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeSaving, setRecipeSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [q, setQ] = useState("")
  const [showModal, setShowModal] = useState(false)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Product | null>(null)
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null)

  const [form, setForm] = useState<FormState>(emptyForm)
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(emptyRecipeForm)

  const selectedCategory = useMemo(() => {
    return categories.find((c) => c.id === form.categoryId) || null
  }, [categories, form.categoryId])

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const headers = { Authorization: `Bearer ${token}` }

      const [productsRes, uomRes, vatRes, catRes] = await Promise.all([
        fetch(`${API}/api/v1/products`, { headers }),
        fetch(`${API}/api/v1/meta/uom`, { headers }),
        fetch(`${API}/api/v1/meta/vat`, { headers }),
        fetch(`${API}/api/v1/meta/categories`, { headers })
      ])

      const productsData = await productsRes.json().catch(() => ({}))
      const uomData = await uomRes.json().catch(() => ({}))
      const vatData = await vatRes.json().catch(() => ({}))
      const catData = await catRes.json().catch(() => ({}))

      if ([productsRes, uomRes, vatRes, catRes].some((r) => r.status === 401)) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setLoading(false)
        return
      }

      const nextProducts = Array.isArray(productsData.items) ? productsData.items : []

      setItems(nextProducts)
      setProductOptions(nextProducts)
      setUoms(Array.isArray(uomData.items) ? uomData.items : [])
      setVatRates(Array.isArray(vatData.items) ? vatData.items : [])
      setCategories(Array.isArray(catData.items) ? catData.items : [])
    } catch {
      setError("Nu pot încărca produsele.")
    } finally {
      setLoading(false)
    }
  }

  function getDefaultUom(list = uoms) {
    return list.find((u: any) => u.isActive !== false) || list[0] || null
  }

  function getDefaultVat(list = vatRates) {
    return (
      list.find((x: any) => x.isActive !== false && Number(x.rate) === 19) ||
      list.find((x: any) => x.isActive !== false) ||
      list[0] ||
      null
    )
  }

  function openAddModal() {
    const defaultUom = getDefaultUom()
    const defaultVat = getDefaultVat()

    setEditingItem(null)
    setForm({
      ...emptyForm,
      class: "MARFA",
      uomId: defaultUom?.id || "",
      purchaseUomId: defaultUom?.id || "",
      vatRateId: defaultVat?.id || "",
      isActive: true,
      isVisibleInPos: true,
      isSgr: false
    })
    setError("")
    setMessage("")
    setShowModal(true)
  }

  function openEditModal(item: Product) {
    setEditingItem(item)
    setForm({
      name: item.name || "",
      imageUrl: item.imageUrl || "",
      class: item.class || "MARFA",
      uomId: item.uom?.id || "",
      purchaseUomId: item.purchaseUom?.id || item.uom?.id || "",
      purchaseFactor: "1",
      vatRateId: item.vatRate?.id || "",
      categoryId: item.category?.id || "",
      price: String(Number(item.price || 0)),
      isActive: item.isActive !== false,
      isVisibleInPos: item.isVisibleInPos !== false,
      isSgr: item.isSgr === true
    })
    setError("")
    setMessage("")
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setSaving(false)
    setUploading(false)
    setEditingItem(null)
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
      const res = await fetch(`${API}/api/v1/products/upload-image`, {
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

      setForm((prev) => ({ ...prev, imageUrl: data.imageUrl || "" }))
    } catch {
      setError("Nu am putut încărca imaginea.")
    } finally {
      setUploading(false)
    }
  }

  async function saveProduct() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completează denumirea produsului.")
      return
    }

    if (!form.uomId) {
      setError("Selectează UM.")
      return
    }

    if (!form.vatRateId) {
      setError("Selectează TVA.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const url = editingItem
        ? `${API}/api/v1/products/${editingItem.id}`
        : `${API}/api/v1/products`

      const method = editingItem ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: form.name,
          imageUrl: form.imageUrl.trim() || null,
          class: form.class,
          uomId: form.uomId,
          purchaseUomId: form.purchaseUomId || form.uomId,
          purchaseFactor: Number(form.purchaseFactor || 1),
          vatRateId: form.vatRateId,
          categoryId: form.categoryId || null,
          price: Number(form.price || 0),
          isActive: form.isActive,
          isVisibleInPos: form.isVisibleInPos,
          isSgr: form.isSgr
        })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut salva produsul.")
        return
      }

      const savedItem = data.item as Product
      const needsRecipeFlow =
        !editingItem &&
        savedItem &&
        ["PRODUS_FIN", "SEMIFABRICATE"].includes(savedItem.class)

      setShowModal(false)

      if (needsRecipeFlow) {
        setMessage(
          `Produsul ${savedItem.name} a fost salvat inițial ca inactiv. Completează acum rețetarul ca să devină utilizabil.`
        )
        await loadAll()
        await openRecipeModal(savedItem)
      } else {
        if (editingItem) {
          if (savedItem?.forcedInactiveBecauseMissingRecipe) {
            setMessage(
              `Produsul ${savedItem?.name || ""} a fost actualizat, dar a rămas inactiv pentru că nu are rețetar completat.`
            )
          } else {
            setMessage(`Produsul ${savedItem?.name || ""} a fost actualizat.`)
          }
        } else {
          if (savedItem?.forcedInactiveBecauseMissingRecipe) {
            setMessage(
              `Produsul a fost salvat cu codul ${savedItem?.sku || ""} și marcat automat inactiv până la completarea rețetarului.`
            )
          } else {
            setMessage(`Produsul a fost salvat cu codul ${savedItem?.sku || ""}.`)
          }
        }

        await loadAll()
      }
    } catch {
      setError("Nu am putut salva produsul.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteProduct(item: Product) {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    const ok = window.confirm(`Sigur vrei să ștergi produsul "${item.name}"?`)
    if (!ok) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/products/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut șterge produsul.")
        return
      }

      setMessage(`Produsul "${item.name}" a fost șters.`)
      await loadAll()
    } catch {
      setError("Nu am putut șterge produsul.")
    }
  }

  async function openRecipeModal(item: Product) {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    setRecipeProduct(item)
    setShowRecipeModal(true)
    setRecipeLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/products/${item.id}/recipe`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setShowRecipeModal(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut încărca rețetarul.")
        setShowRecipeModal(false)
        return
      }

      const recipe = data.recipe

      if (!recipe) {
        setRecipeForm({
          code: "",
          name: item.name,
          notes: "",
          yieldQty: "1",
          status: "DRAFT",
          isActive: true,
          items: []
        })
      } else {
        setRecipeForm({
          code: recipe.code || "",
          name: recipe.name || item.name || "",
          notes: recipe.notes || "",
          yieldQty: String(Number(recipe.yieldQty || 1)),
          status: recipe.status || "DRAFT",
          isActive: recipe.isActive !== false,
          items: Array.isArray(recipe.items)
            ? recipe.items.map((line: any, idx: number) => ({
                ingredientId: line.ingredientId || "",
                qty: String(Number(line.qty || 0)),
                lossPercent: String(Number(line.lossPercent || 0)),
                notes: line.notes || "",
                sortOrder: Number(line.sortOrder || idx + 1)
              }))
            : []
        })
      }
    } catch {
      setError("Nu am putut încărca rețetarul.")
      setShowRecipeModal(false)
    } finally {
      setRecipeLoading(false)
    }
  }

  function closeRecipeModal() {
    setShowRecipeModal(false)
    setRecipeProduct(null)
    setRecipeForm(emptyRecipeForm)
    setRecipeLoading(false)
    setRecipeSaving(false)
  }

  function addRecipeLine() {
    setRecipeForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          ingredientId: "",
          qty: "",
          lossPercent: "0",
          notes: "",
          sortOrder: prev.items.length + 1
        }
      ]
    }))
  }

  function removeRecipeLine(index: number) {
    setRecipeForm((prev) => ({
      ...prev,
      items: prev.items
        .filter((_, i) => i !== index)
        .map((line, i) => ({
          ...line,
          sortOrder: i + 1
        }))
    }))
  }

  function updateRecipeLine(index: number, patch: Partial<RecipeLine>) {
    setRecipeForm((prev) => ({
      ...prev,
      items: prev.items.map((line, i) =>
        i === index ? { ...line, ...patch } : line
      )
    }))
  }

  async function saveRecipe() {
    if (!token || !recipeProduct) {
      setError("Nu există sesiune activă.")
      return
    }

    if (!recipeForm.items.length) {
      setError("Adaugă cel puțin un ingredient în rețetar.")
      return
    }

    setRecipeSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/products/${recipeProduct.id}/recipe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          code: recipeForm.code || null,
          name: recipeForm.name || null,
          notes: recipeForm.notes || null,
          yieldQty: Number(recipeForm.yieldQty || 1),
          status: recipeForm.status,
          isActive: recipeForm.isActive,
          activateProduct: true,
          items: recipeForm.items.map((line, idx) => ({
            ingredientId: line.ingredientId,
            qty: Number(line.qty || 0),
            lossPercent: Number(line.lossPercent || 0),
            notes: line.notes || null,
            sortOrder: idx + 1
          }))
        })
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva rețetarul.")
        return
      }

      setMessage(
        `Rețetarul pentru "${recipeProduct.name}" a fost salvat. Produsul a fost activat automat.`
      )
      setShowRecipeModal(false)
      await loadAll()
    } catch {
      setError("Nu am putut salva rețetarul.")
    } finally {
      setRecipeSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return items

    return items.filter((item) => {
      const name = String(item.name || "").toLowerCase()
      const sku = String(item.sku || "").toLowerCase()
      const cat = String(item.category?.name || "").toLowerCase()
      const dep = String(item.category?.department?.name || item.department?.name || "").toLowerCase()

      return name.includes(qq) || sku.includes(qq) || cat.includes(qq) || dep.includes(qq)
    })
  }, [items, q])

  const recipeEligibleClasses = ["PRODUS_FIN", "SEMIFABRICATE"]

  return (
    <div className="space-y-6">
      <PageHeader badge="nomenclator" title="Produse" subtitle="Lista produselor, configurarea lor, clasificări, POS, SGR și rețetare." />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={card}>
        <div style={topBar}>
          <div style={{ flex: 1 }}>
            <input
              placeholder="Caută rapid după produs, cod, categorie sau departament..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={input}
            />
          </div>

          <button onClick={openAddModal} style={btnPrimary}>
            Adaugă produs
          </button>
        </div>

        <div style={legendBox}>
          <div style={legendTitle}>Clasificări disponibile acum</div>
          <div style={legendText}>
            materie prima, alte materiale, produs finit, marfă, ambalaje, semifabricate, reziduale, consumabile
          </div>
          <div style={legendSubText}>
            Pentru „nespecificat” și „obiecte de inv.” trebuie extins separat enum-ul din baza de date.
          </div>
        </div>

        {loading ? (
          <div style={infoText}>Se încarcă produsele...</div>
        ) : filtered.length === 0 ? (
          <div style={emptyBox}>Nu există produse.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Poză</th>
                  <th style={th}>Cod</th>
                  <th style={th}>Produs</th>
                  <th style={th}>Clasificare</th>
                  <th style={th}>Categorie</th>
                  <th style={th}>Departament</th>
                  <th style={th}>UM</th>
                  <th style={th}>TVA</th>
                  <th style={th}>Preț</th>
                  <th style={th}>SGR</th>
                  <th style={th}>Vizibil POS</th>
                  <th style={th}>Activ</th>
                  <th style={th}>Rețetar</th>
                  <th style={th}>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          style={thumb}
                          onError={(e) => {
                            ;(e.currentTarget as HTMLImageElement).style.display = "none"
                          }}
                        />
                      ) : (
                        <span style={{ color: "#888" }}>-</span>
                      )}
                    </td>
                    <td style={td}>{item.sku}</td>
                    <td style={td}>{item.name}</td>
                    <td style={td}>{CLASS_LABEL_MAP[item.class] || item.class}</td>
                    <td style={td}>{item.category?.name || "-"}</td>
                    <td style={td}>{item.category?.department?.name || item.department?.name || "-"}</td>
                    <td style={td}>{item.uom?.code || "-"}</td>
                    <td style={td}>{item.vatRate?.rate != null ? `${item.vatRate.rate}%` : "-"}</td>
                    <td style={td}>{Number(item.price || 0).toFixed(2)}</td>
                    <td style={td}>{item.isSgr ? "Da" : "Nu"}</td>
                    <td style={td}>{item.isVisibleInPos !== false ? "Da" : "Nu"}</td>
                    <td style={td}>{item.isActive ? "Da" : "Nu"}</td>
                    <td style={td}>
                      {recipeEligibleClasses.includes(item.class) ? (
                        <button onClick={() => openRecipeModal(item)} style={btnRecipeSmall}>
                          {item.recipe?.items?.length ? `Rețetar (${item.recipe.items.length})` : "Rețetar"}
                        </button>
                      ) : (
                        <span style={{ color: "#9ca3af" }}>-</span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={rowActions}>
                        <button onClick={() => openEditModal(item)} style={btnSecondarySmall}>
                          Edit
                        </button>
                        <button onClick={() => deleteProduct(item)} style={btnDangerSmall}>
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
      </div>

      {showModal && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={modalHeader}>
              <div>
                <div style={cardTitle}>{editingItem ? "Edit produs" : "Adaugă produs"}</div>
                <div style={cardSubtitle}>
                  Codul produsului se generează automat la salvare și se afișează după salvare.
                </div>
              </div>

              <button onClick={closeModal} style={btnSecondary}>
                Închide
              </button>
            </div>

            <div style={grid}>
              <Field label="Denumire produs">
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  style={input}
                />
              </Field>

              <Field label="Clasificare">
                <select
                  value={form.class}
                  onChange={(e) => setForm((prev) => ({ ...prev, class: e.target.value }))}
                  style={input}
                >
                  {CLASS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Categorie">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                  style={input}
                >
                  <option value="">Selectează categoria</option>
                  {categories
                    .filter((c) => c.isActive !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Departament">
                <input value={selectedCategory?.department?.name || "-"} readOnly style={{ ...input, background: "#f9fafb" }} />
              </Field>

              <Field label="UM">
                <select
                  value={form.uomId}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      uomId: e.target.value,
                      purchaseUomId: prev.purchaseUomId || e.target.value
                    }))
                  }
                  style={input}
                >
                  <option value="">Selectează UM</option>
                  {uoms
                    .filter((u) => u.isActive !== false)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} - {u.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="UM achiziție">
                <select
                  value={form.purchaseUomId}
                  onChange={(e) => setForm((prev) => ({ ...prev, purchaseUomId: e.target.value }))}
                  style={input}
                >
                  <option value="">Selectează UM achiziție</option>
                  {uoms
                    .filter((u) => u.isActive !== false)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} - {u.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Factor achiziție">
                <input
                  type="number"
                  min="1"
                  step="0.001"
                  value={form.purchaseFactor}
                  onChange={(e) => setForm((prev) => ({ ...prev, purchaseFactor: e.target.value }))}
                  style={input}
                />
              </Field>

              <Field label="TVA">
                <select
                  value={form.vatRateId}
                  onChange={(e) => setForm((prev) => ({ ...prev, vatRateId: e.target.value }))}
                  style={input}
                >
                  <option value="">Selectează TVA</option>
                  {vatRates
                    .filter((v) => v.isActive !== false)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.rate}%
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Preț">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  style={input}
                />
              </Field>

              <div style={checkBlock}>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.isSgr}
                    onChange={(e) => setForm((prev) => ({ ...prev, isSgr: e.target.checked }))}
                  />
                  <span>SGR</span>
                </label>
                <div style={checkHint}>SGR = 0.50 lei fără TVA</div>
              </div>

              <div style={checkBlock}>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.isVisibleInPos}
                    onChange={(e) => setForm((prev) => ({ ...prev, isVisibleInPos: e.target.checked }))}
                  />
                  <span>Vizibil în POS</span>
                </label>
                <div style={checkHint}>Dacă este debifat, produsul nu apare în Android POS.</div>
              </div>

              <div style={checkBlock}>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                  />
                  <span>Produs activ</span>
                </label>
                <div style={checkHint}>
                  Pentru produs finit și semifabricate, dacă nu există rețetar, produsul va fi salvat automat inactiv.
                </div>
              </div>
            </div>

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
                <span style={btnSecondary}>{uploading ? "Se încarcă..." : "Încarcă poză produs"}</span>
              </label>

              {form.imageUrl.trim() ? (
                <button type="button" style={btnDangerSoft} onClick={() => setForm((prev) => ({ ...prev, imageUrl: "" }))}>
                  Șterge poza
                </button>
              ) : null}
            </div>

            {form.imageUrl.trim() ? (
              <div style={imagePreviewWrap}>
                <div style={imagePreviewLabel}>Preview produs</div>
                <img
                  src={form.imageUrl}
                  alt="Preview produs"
                  style={imagePreview}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = "none"
                  }}
                />
              </div>
            ) : (
              <div style={hintBox}>Produsul nu are încă poză. Se lucrează doar cu upload, fără câmp de image URL.</div>
            )}

            {(form.class === "PRODUS_FIN" || form.class === "SEMIFABRICATE") && (
              <div style={warningBox}>
                Pentru această clasificare, produsul se salvează întâi ca inactiv și trebuie completat imediat rețetarul.
              </div>
            )}

            <div style={actionsRow}>
              <button onClick={closeModal} style={btnSecondary}>
                Renunță
              </button>

              <button onClick={saveProduct} disabled={saving || uploading} style={btnPrimary}>
                {saving ? "Se salvează..." : editingItem ? "Salvează modificările" : "Salvează produs"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecipeModal && recipeProduct && (
        <div style={modalOverlay}>
          <div style={recipeModalCard}>
            <div style={modalHeader}>
              <div>
                <div style={cardTitle}>Rețetar produs</div>
                <div style={cardSubtitle}>
                  {recipeProduct.name} ({recipeProduct.sku})
                </div>
              </div>

              <button onClick={closeRecipeModal} style={btnSecondary}>
                Închide
              </button>
            </div>

            {recipeLoading ? (
              <div style={infoText}>Se încarcă rețetarul...</div>
            ) : (
              <>
                <div style={recipeTopGrid}>
                  <Field label="Cod rețetar">
                    <input
                      value={recipeForm.code}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, code: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Nume rețetar">
                    <input
                      value={recipeForm.name}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, name: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Randament">
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={recipeForm.yieldQty}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, yieldQty: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Status rețetar">
                    <select
                      value={recipeForm.status}
                      onChange={(e) =>
                        setRecipeForm((prev) => ({
                          ...prev,
                          status: e.target.value as RecipeForm["status"]
                        }))
                      }
                      style={input}
                    >
                      <option value="DRAFT">DRAFT</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </Field>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Field label="Observații">
                    <textarea
                      value={recipeForm.notes}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, notes: e.target.value }))}
                      style={textarea}
                      rows={3}
                    />
                  </Field>
                </div>

                <div style={recipeHeaderRow}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Ingrediente</div>
                  <button onClick={addRecipeLine} style={btnPrimary}>
                    Adaugă ingredient
                  </button>
                </div>

                {recipeForm.items.length === 0 ? (
                  <div style={emptyBox}>Nu există încă ingrediente în rețetar.</div>
                ) : (
                  <div style={recipeTableWrap}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={th}>Ingredient</th>
                          <th style={th}>UM</th>
                          <th style={th}>Cantitate</th>
                          <th style={th}>Pierdere %</th>
                          <th style={th}>Observații</th>
                          <th style={th}>Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipeForm.items.map((line, index) => {
                          const selectedIngredient = productOptions.find((p) => p.id === line.ingredientId)
                          return (
                            <tr key={`${index}-${line.sortOrder}`}>
                              <td style={td}>
                                <select
                                  value={line.ingredientId}
                                  onChange={(e) => updateRecipeLine(index, { ingredientId: e.target.value })}
                                  style={input}
                                >
                                  <option value="">Selectează ingredient</option>
                                  {productOptions
                                    .filter((p) => p.id !== recipeProduct.id && p.isActive !== false)
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} ({p.sku})
                                      </option>
                                    ))}
                                </select>
                              </td>

                              <td style={td}>
                                {selectedIngredient?.uom?.code || "-"}
                              </td>

                              <td style={td}>
                                <input
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  value={line.qty}
                                  onChange={(e) => updateRecipeLine(index, { qty: e.target.value })}
                                  style={input}
                                />
                              </td>

                              <td style={td}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.lossPercent}
                                  onChange={(e) => updateRecipeLine(index, { lossPercent: e.target.value })}
                                  style={input}
                                />
                              </td>

                              <td style={td}>
                                <input
                                  value={line.notes}
                                  onChange={(e) => updateRecipeLine(index, { notes: e.target.value })}
                                  style={input}
                                />
                              </td>

                              <td style={td}>
                                <button onClick={() => removeRecipeLine(index)} style={btnDangerSmall}>
                                  Șterge
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={checkBlockLarge}>
                  <label style={checkLabel}>
                    <input
                      type="checkbox"
                      checked={recipeForm.isActive}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                    />
                    <span>Rețetar activ</span>
                  </label>
                  <div style={checkHint}>
                    După salvarea rețetarului, produsul va fi activat automat.
                  </div>
                </div>

                <div style={actionsRow}>
                  <button onClick={closeRecipeModal} style={btnSecondary}>
                    Renunță
                  </button>

                  <button onClick={saveRecipe} disabled={recipeSaving} style={btnPrimary}>
                    {recipeSaving ? "Se salvează..." : "Salvează rețetar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const topBar: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap"
}

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700
}

const cardSubtitle: React.CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
  marginTop: 4
}

const modalHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 18
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16
}

const recipeTopGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16
}

const fieldWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: "#374151"
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box"
}

const textarea: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",
  resize: "vertical"
}

const actionsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 22
}

const uploadRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 18
}

const uploadLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center"
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600
}

const btnSecondary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center"
}

const btnSecondarySmall: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600
}

const btnDangerSmall: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600
}

const btnRecipeSmall: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600
}

const btnDangerSoft: React.CSSProperties = {
  background: "#fff1f2",
  color: "#991b1b",
  border: "1px solid #fecdd3",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer"
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 12
}

const successBox: React.CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 12,
  padding: 12
}

const infoText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 14
}

const emptyBox: React.CSSProperties = {
  padding: 16,
  border: "1px dashed #d1d5db",
  borderRadius: 12,
  color: "#6b7280"
}

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  marginTop: 18
}

const recipeTableWrap: React.CSSProperties = {
  overflowX: "auto",
  marginTop: 14
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse"
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f8fafc"
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
  width: 52,
  height: 52,
  objectFit: "cover",
  borderRadius: 10,
  border: "1px solid #e5e7eb"
}

const imagePreviewWrap: React.CSSProperties = {
  marginTop: 16
}

const imagePreviewLabel: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  marginBottom: 8
}

const imagePreview: React.CSSProperties = {
  width: 120,
  height: 120,
  objectFit: "cover",
  borderRadius: 14,
  border: "1px solid #e5e7eb"
}

const hintBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 12,
  border: "1px dashed #d1d5db",
  background: "#f8fafc",
  color: "#4b5563"
}

const warningBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e"
}

const legendBox: React.CSSProperties = {
  marginTop: 16,
  marginBottom: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc"
}

const legendTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 6
}

const legendText: React.CSSProperties = {
  fontSize: 13,
  color: "#374151"
}

const legendSubText: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 6
}

const checkBlock: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 6,
  minHeight: 72,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fafafa"
}

const checkBlockLarge: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 6,
  minHeight: 72,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fafafa",
  marginTop: 16
}

const checkLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  color: "#111827"
}

const checkHint: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280"
}

const recipeHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginTop: 20
}

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17, 24, 39, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 50
}

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 980,
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#ffffff",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)"
}

const recipeModalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 1180,
  maxHeight: "92vh",
  overflowY: "auto",
  background: "#ffffff",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)"
}