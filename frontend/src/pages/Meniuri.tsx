import { useEffect, useMemo, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import PageHeader from "../components/PageHeader"
import { API_BASE, getToken } from "../lib/api"
import { formatMoneyRo, parseLocaleNumber } from "../lib/format"

type Product = {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  class: string
  price: number
  costPrice?: number
  purchaseFactor?: number
  isActive: boolean
  isMenu?: boolean
  posMenuCategory?: string | null
  isVisibleInPos?: boolean
  publishToGlovo?: boolean
  recipe?: {
    id: string
    status: string
    items?: any[]
  } | null
  vatRate?: { id: string; rate: number; name: string } | null
  uom?: { id: string; code: string; name: string; standardCode?: string | null } | null
  category?: {
    id: string
    name: string
    imageUrl?: string | null
    department?: { id: string; name: string } | null
  } | null
}

type ProductOption = {
  id: string
  name: string
  sku: string
  isMenu?: boolean
  isActive?: boolean
  uom?: { id: string; code: string; name: string; standardCode?: string | null } | null
}

type FormState = {
  sku: string
  name: string
  imageUrl: string
  uomId: string
  vatRateId: string
  categoryId: string
  posMenuCategory: string
  price: string
  costPrice: string
  isActive: boolean
  isVisibleInPos: boolean
  publishToGlovo: boolean
}

type RecipeLine = {
  ingredientId: string
  productSearch: string
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

const emptyForm: FormState = {
  sku: "",
  name: "",
  imageUrl: "",
  uomId: "",
  vatRateId: "",
  categoryId: "",
  posMenuCategory: "",
  price: "0",
  costPrice: "0",
  isActive: true,
  isVisibleInPos: true,
  publishToGlovo: false,
}

const emptyRecipeForm: RecipeForm = {
  code: "",
  name: "",
  notes: "",
  yieldQty: "1",
  status: "DRAFT",
  isActive: true,
  items: [],
}

function toNumberSafe(value: any) {
  return parseLocaleNumber(value)
}

function normalizePositiveString(value: any, fallback = "0") {
  const n = Math.max(0, toNumberSafe(value))
  return String(Number.isFinite(n) ? n : Number(fallback))
}

function normalizeRecipeNumberString(value: any, fallback = "0") {
  const n = toNumberSafe(value)
  if (!Number.isFinite(n)) return fallback
  return String(n)
}

function formatMoney(value: any) {
  return formatMoneyRo(value)
}

function formatUomOption(uom?: { code?: string | null; standardCode?: string | null; name?: string | null } | null) {
  const shortCode = String(uom?.code || "").trim().toUpperCase()
  const standardCode = String(uom?.standardCode || "").trim().toUpperCase()
  const fallbackName = String(uom?.name || "").trim()
  if (shortCode && standardCode) return `${shortCode}-${standardCode}`
  if (shortCode) return shortCode
  if (standardCode) return standardCode
  return fallbackName || "-"
}

function normalizeHostedImageUrl(value: any) {
  const text = String(value || "").trim()
  if (!text) return ""

  if (/^(data:|blob:)/i.test(text)) {
    return text
  }

  if (/^\/(?!\/)/.test(text)) {
    return `${API_BASE}${text}`
  }

  if (!/^https?:\/\//i.test(text)) {
    return `${API_BASE}/${text.replace(/^\/+/, "")}`
  }

  if (typeof window !== "undefined" && window.location.protocol === "https:" && text.startsWith("http://")) {
    return text.replace(/^http:\/\//i, "https://")
  }

  return text
}

function buildProductSearchLabel(product?: { name?: string | null; sku?: string | null } | null) {
  if (!product) return ""
  const name = String(product.name || "").trim()
  const sku = String(product.sku || "").trim()
  if (name && sku) return `${name} (${sku})`
  return name || sku
}

function normalizeSearchText(value: string) {
  return String(value || "").trim().toLowerCase()
}

function findMatchingProduct(products: ProductOption[], value: string) {
  const normalizedValue = normalizeSearchText(value)
  if (!normalizedValue) return null

  const exact = products.find((product) => {
    const label = buildProductSearchLabel(product)
    return (
      normalizeSearchText(label) === normalizedValue ||
      normalizeSearchText(product.name || "") === normalizedValue ||
      normalizeSearchText(product.sku || "") === normalizedValue
    )
  })
  if (exact) return exact

  const startsWithMatches = products.filter((product) => {
    const label = buildProductSearchLabel(product)
    return (
      normalizeSearchText(label).startsWith(normalizedValue) ||
      normalizeSearchText(product.name || "").startsWith(normalizedValue) ||
      normalizeSearchText(product.sku || "").startsWith(normalizedValue)
    )
  })
  if (startsWithMatches.length === 1) return startsWithMatches[0]

  const containsMatches = products.filter((product) => {
    const label = buildProductSearchLabel(product)
    return (
      normalizeSearchText(label).includes(normalizedValue) ||
      normalizeSearchText(product.name || "").includes(normalizedValue) ||
      normalizeSearchText(product.sku || "").includes(normalizedValue)
    )
  })
  if (containsMatches.length === 1) return containsMatches[0]

  return null
}

export default function MeniuriPage() {
  const token =
    getToken() ||
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<Product[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [uoms, setUoms] = useState<any[]>([])
  const [vatRates, setVatRates] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [isVatPayer, setIsVatPayer] = useState(true)

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
  const [livePreviewUrl, setLivePreviewUrl] = useState("")
  const [previewImageFailed, setPreviewImageFailed] = useState(false)
  const [nextSku, setNextSku] = useState("")

  const [form, setForm] = useState<FormState>(emptyForm)
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(emptyRecipeForm)

  const selectedCategory = useMemo(() => {
    return categories.find((c) => c.id === form.categoryId) || null
  }, [categories, form.categoryId])

  const imagePreviewSrc = livePreviewUrl || form.imageUrl.trim()

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (livePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(livePreviewUrl)
      }
    }
  }, [livePreviewUrl])

  useEffect(() => {
    setPreviewImageFailed(false)
  }, [imagePreviewSrc])

  async function loadAll() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const headers = { Authorization: `Bearer ${token}` }

      const [productsRes, uomRes, vatRes, catRes, companyRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/products`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/uom`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/vat`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/categories`, { headers }),
        fetch(`${API_BASE}/api/v1/company`, { headers }),
      ])

      const productsData = await productsRes.json().catch(() => ({}))
      const uomData = await uomRes.json().catch(() => ({}))
      const vatData = await vatRes.json().catch(() => ({}))
      const catData = await catRes.json().catch(() => ({}))
      const companyData = await companyRes.json().catch(() => ({}))

      if ([productsRes, uomRes, vatRes, catRes, companyRes].some((r) => r.status === 401)) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setLoading(false)
        return
      }

      const allProducts = Array.isArray(productsData.items)
        ? productsData.items.map((item: any) => ({
            ...item,
            imageUrl: normalizeHostedImageUrl(item?.imageUrl || ""),
            price: toNumberSafe(item?.price),
            costPrice: toNumberSafe(item?.costPrice),
            purchaseFactor: toNumberSafe(item?.purchaseFactor || 1),
          }))
        : []

      setItems(allProducts.filter((item: Product) => item.isMenu === true))
      setProductOptions(
        allProducts.filter(
          (item: Product) =>
            item.isMenu !== true &&
            ["PRODUS_FIN", "MARFA", "SEMIFABRICATE"].includes(String(item.class || ""))
        )
      )
      setUoms(Array.isArray(uomData.items) ? uomData.items : [])
      setVatRates(Array.isArray(vatData.items) ? vatData.items : [])
      setCategories(Array.isArray(catData.items) ? catData.items : [])
      setIsVatPayer(companyData?.company?.isVatPayer !== false)
      void loadNextSku()
    } catch {
      setError("Nu pot incarca meniurile.")
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

  async function loadNextSku() {
    if (!token) return

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/next-sku`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        setNextSku(String(data.sku || ""))
      }
    } catch {
      setNextSku("")
    }
  }

  function openAddModal() {
    const defaultUom = getDefaultUom()
    const defaultVat = getDefaultVat()

    setEditingItem(null)
    setForm({
      ...emptyForm,
      sku: nextSku,
      uomId: defaultUom?.id || "",
      vatRateId: isVatPayer ? defaultVat?.id || "" : "",
    })
    setError("")
    setMessage("")
    setPreviewImageFailed(false)
    setLivePreviewUrl("")
    setShowModal(true)
  }

  function openEditModal(item: Product) {
    setEditingItem(item)
    setForm({
      sku: item.sku || "",
      name: item.name || "",
      imageUrl: normalizeHostedImageUrl(item.imageUrl || ""),
      uomId: item.uom?.id || "",
      vatRateId: isVatPayer ? item.vatRate?.id || "" : "",
      categoryId: item.category?.id || "",
      posMenuCategory: item.posMenuCategory || "",
      price: normalizePositiveString(item.price || 0, "0"),
      costPrice: normalizePositiveString(item.costPrice || 0, "0"),
      isActive: item.isActive !== false,
      isVisibleInPos: item.isVisibleInPos !== false,
      publishToGlovo: item.publishToGlovo === true,
    })
    setError("")
    setMessage("")
    setPreviewImageFailed(false)
    setLivePreviewUrl("")
    setShowModal(true)
  }

  function closeModal() {
    if (livePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(livePreviewUrl)
    }
    setShowModal(false)
    setSaving(false)
    setUploading(false)
    setEditingItem(null)
    setPreviewImageFailed(false)
    setLivePreviewUrl("")
  }

  async function uploadImage(file: File) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    const formData = new FormData()
    formData.append("image", file)
    if (livePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(livePreviewUrl)
    }
    setLivePreviewUrl(URL.createObjectURL(file))

    setUploading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/upload-image`, {
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

      setForm((prev) => ({ ...prev, imageUrl: normalizeHostedImageUrl(data.imageUrl || "") }))
      setPreviewImageFailed(false)
    } catch {
      setError("Nu am putut incarca imaginea.")
    } finally {
      setUploading(false)
    }
  }

  async function saveMenu() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completeaza denumirea meniului.")
      return
    }

    if (!form.categoryId) {
      setError("Selecteaza categoria meniului.")
      return
    }

    const fallbackUom = form.uomId || getDefaultUom()?.id || ""
    const fallbackVat = isVatPayer ? form.vatRateId || getDefaultVat()?.id || "" : ""

    if (!fallbackUom) {
      setError("Nu am gasit o unitate de masura implicita pentru salvarea meniului.")
      return
    }

    if (isVatPayer && !fallbackVat) {
      setError("Nu am gasit o cota TVA implicita pentru salvarea meniului.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const url = editingItem
        ? `${API_BASE}/api/v1/products/${editingItem.id}`
        : `${API_BASE}/api/v1/products`

      const method = editingItem ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sku: !editingItem ? form.sku.trim() || null : undefined,
          name: form.name.trim(),
          imageUrl: normalizeHostedImageUrl(form.imageUrl.trim()) || null,
          class: "PRODUS_FIN",
          uomId: fallbackUom,
          purchaseUomId: fallbackUom,
          purchaseFactor: 1,
          vatRateId: isVatPayer ? fallbackVat : null,
          categoryId: form.categoryId || null,
          price: Math.max(0, toNumberSafe(form.price || 0)),
          costPrice: Math.max(0, toNumberSafe(form.costPrice || 0)),
          isActive: form.isActive,
          isMenu: true,
          posMenuCategory: null,
          isVisibleInPos: form.isVisibleInPos,
          publishToGlovo: form.publishToGlovo,
          isSgr: false,
          isFiscalRiskProduct: false,
          productionMode: "AUTO",
          trackLot: false,
          trackExpiry: false,
          costMethod: "AVG",
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva meniul.")
        return
      }

      const savedItem = data.item
        ? {
            ...data.item,
            imageUrl: normalizeHostedImageUrl(data.item?.imageUrl || ""),
          }
        : null

      setMessage(editingItem ? `Meniul "${form.name}" a fost actualizat.` : `Meniul "${form.name}" a fost creat.`)
      closeModal()
      await loadAll()

      if (!editingItem && savedItem) {
        await openRecipeModal(savedItem)
      }
    } catch {
      setError("Nu am putut salva meniul.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteMenu(item: Product) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    const confirmed = window.confirm(`Sigur vrei sa stergi meniul "${item.name}"?`)
    if (!confirmed) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut sterge meniul.")
        return
      }

      setMessage(`Meniul "${item.name}" a fost sters.`)
      await loadAll()
    } catch {
      setError("Nu am putut sterge meniul.")
    }
  }

  async function openRecipeModal(item: Product) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setRecipeProduct(item)
    setShowRecipeModal(true)
    setRecipeLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/${item.id}/recipe`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setShowRecipeModal(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut incarca produsele din meniu.")
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
          status: "ACTIVE",
          isActive: true,
          items: [],
        })
      } else {
        setRecipeForm({
          code: recipe.code || "",
          name: recipe.name || item.name || "",
          notes: recipe.notes || "",
          yieldQty: normalizeRecipeNumberString(recipe.yieldQty, "1"),
          status: recipe.status || "ACTIVE",
          isActive: recipe.isActive !== false,
          items: Array.isArray(recipe.items)
            ? recipe.items.map((line: any, idx: number) => ({
                ingredientId: line.ingredientId || "",
                productSearch: buildProductSearchLabel(
                  productOptions.find((product) => product.id === line.ingredientId)
                ),
                qty: normalizeRecipeNumberString(line.qty, "0"),
                lossPercent: normalizeRecipeNumberString(line.lossPercent, "0"),
                notes: line.notes || "",
                sortOrder: Number(line.sortOrder || idx + 1),
              }))
            : [],
        })
      }
    } catch {
      setError("Nu am putut incarca produsele din meniu.")
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
          productSearch: "",
          qty: "1",
          lossPercent: "0",
          notes: "",
          sortOrder: prev.items.length + 1,
        },
      ],
    }))
  }

  function removeRecipeLine(index: number) {
    setRecipeForm((prev) => ({
      ...prev,
      items: prev.items
        .filter((_, i) => i !== index)
        .map((line, i) => ({
          ...line,
          sortOrder: i + 1,
        })),
    }))
  }

  function updateRecipeLine(index: number, patch: Partial<RecipeLine>) {
    setRecipeForm((prev) => ({
      ...prev,
      items: prev.items.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  function updateRecipeLineSearch(index: number, value: string) {
    const matchedProduct = findMatchingProduct(productOptions, value)

    updateRecipeLine(index, {
      productSearch: matchedProduct ? buildProductSearchLabel(matchedProduct) : value,
      ingredientId: matchedProduct?.id || "",
    })
  }

  async function saveRecipe() {
    if (!token || !recipeProduct) {
      setError("Nu exista sesiune activa.")
      return
    }

    if (!recipeForm.items.length) {
      setError("Adauga cel putin un produs in meniu.")
      return
    }

    const normalizedItems = recipeForm.items.map((line) => {
      const matchedProduct =
        productOptions.find((product) => product.id === line.ingredientId) ||
        findMatchingProduct(productOptions, line.productSearch)

      return {
        ...line,
        ingredientId: matchedProduct?.id || "",
        productSearch: matchedProduct ? buildProductSearchLabel(matchedProduct) : line.productSearch,
      }
    })

    const invalidLineIndex = normalizedItems.findIndex((line) => !line.ingredientId)
    if (invalidLineIndex >= 0) {
      setRecipeForm((prev) => ({ ...prev, items: normalizedItems }))
      setError(`Produsul de pe linia ${invalidLineIndex + 1} nu a fost selectat complet din cautare.`)
      return
    }

    setRecipeSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/${recipeProduct.id}/recipe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: recipeForm.code || null,
          name: recipeForm.name || null,
          notes: recipeForm.notes || null,
          yieldQty: Number(recipeForm.yieldQty || 1),
          status: recipeForm.status,
          isActive: recipeForm.isActive,
          activateProduct: true,
          items: normalizedItems.map((line, idx) => ({
            ingredientId: line.ingredientId,
            qty: Number(line.qty || 0),
            lossPercent: Number(line.lossPercent || 0),
            notes: line.notes || null,
            sortOrder: idx + 1,
          })),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva produsele meniului.")
        return
      }

      setMessage(`Produsele pentru meniul "${recipeProduct.name}" au fost salvate.`)
      setShowRecipeModal(false)
      await loadAll()
    } catch {
      setError("Nu am putut salva produsele meniului.")
    } finally {
      setRecipeSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return items.filter((item) => {
      if (!qq) return true
      const name = String(item.name || "").toLowerCase()
      const sku = String(item.sku || "").toLowerCase()
      const category = String(item.category?.name || "").toLowerCase()
      return name.includes(qq) || sku.includes(qq) || category.includes(qq)
    })
  }, [items, q])

  const kpis = useMemo(() => {
    return {
      total: items.length,
      active: items.filter((item) => item.isActive !== false).length,
      visiblePos: items.filter((item) => item.isVisibleInPos !== false).length,
      glovo: items.filter((item) => item.publishToGlovo === true).length,
      withItems: items.filter((item) => (item.recipe?.items?.length || 0) > 0).length,
    }
  }, [items])

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Meniuri"
        subtitle="Definesti meniurile vandabile si alegi ce produse finite sau produse de vanzare din ERP intra in fiecare meniu."
      />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={kpiGrid}>
        <MetricCard title="Total meniuri" value={String(kpis.total)} />
        <MetricCard title="Meniuri active" value={String(kpis.active)} />
        <MetricCard title="Vizibile in POS" value={String(kpis.visiblePos)} />
        <MetricCard title="Publicate Glovo" value={String(kpis.glovo)} />
        <MetricCard title="Cu produse alocate" value={String(kpis.withItems)} />
      </div>

      <div style={card}>
        <div style={topBar}>
          <div style={{ flex: 1 }}>
            <input
              placeholder="Cauta dupa meniu, cod sau categorie ERP..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={input}
            />
          </div>

          <button onClick={openAddModal} style={btnPrimary}>
            Adauga meniu
          </button>
        </div>

        <div style={hintBox}>
          Meniul se salveaza separat de produsele normale. In compozitie poti alege produse finite, marfa si semifabricate, fara materii prime.
        </div>

        {!isVatPayer ? (
          <div style={warningBox}>
            Firma este setata ca neplatitoare de TVA. In aceasta pagina, meniurile se salveaza fara cota TVA.
          </div>
        ) : null}

        {loading ? (
          <div style={infoText}>Se incarca meniurile...</div>
        ) : filtered.length === 0 ? (
          <div style={emptyBox}>Nu exista meniuri definite.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Poza</th>
                  <th style={th}>Cod</th>
                  <th style={th}>Meniu</th>
                  <th style={th}>Categorie ERP</th>
                  <th style={th}>Pret</th>
                  <th style={th}>Cost</th>
                  <th style={th}>Produse in meniu</th>
                  <th style={th}>POS</th>
                  <th style={th}>Glovo</th>
                  <th style={th}>Activ</th>
                  <th style={th}>Actiuni</th>
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
                        <span style={{ color: "#94a3b8" }}>-</span>
                      )}
                    </td>
                    <td style={td}>{item.sku}</td>
                    <td style={td}>{item.name}</td>
                    <td style={td}>{item.category?.name || "-"}</td>
                    <td style={td}>{formatMoney(item.price || 0)}</td>
                    <td style={td}>{formatMoney(item.costPrice || 0)}</td>
                    <td style={td}>
                      <button onClick={() => openRecipeModal(item)} style={btnRecipeSmall}>
                        {item.recipe?.items?.length ? `Produse (${item.recipe.items.length})` : "Produse in meniu"}
                      </button>
                    </td>
                    <td style={td}>{item.isVisibleInPos !== false ? "Da" : "Nu"}</td>
                    <td style={td}>{item.publishToGlovo ? "Da" : "Nu"}</td>
                    <td style={td}>{item.isActive ? "Da" : "Nu"}</td>
                    <td style={td}>
                      <div style={rowActions}>
                        <button onClick={() => openEditModal(item)} style={btnSecondarySmall}>
                          Edit
                        </button>
                        <button onClick={() => deleteMenu(item)} style={btnDangerSmall}>
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
      </div>

      {showModal ? (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={modalHeader}>
              <div>
                <div style={cardTitle}>{editingItem ? "Editare meniu" : "Meniu nou"}</div>
                <div style={cardSubtitleCompact}>
                  Creezi un meniu separat, cu cod automat, nume, categorie, poza si produsele lui componente din ERP.
                </div>
              </div>

              <button onClick={closeModal} style={btnSecondary}>
                Inchide
              </button>
            </div>

            <div style={gridCompact}>
              <SectionCard title="Date meniu">
                <div style={sideStack}>
                  <Field label="Cod meniu">
                    <input
                      value={form.sku}
                      style={input}
                      readOnly
                    />
                  </Field>

                  <Field label="Denumire meniu">
                    <input
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Categorie ERP">
                    <select
                      value={form.categoryId}
                      onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                      style={input}
                    >
                      <option value="">Selecteaza categoria</option>
                      {categories
                        .filter((c) => c.isActive !== false)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>

                  <div style={hintBoxInline}>
                    Produsele din meniu se aleg dupa salvare, din butonul <strong>Produse in meniu</strong>. Materiile prime nu apar aici.
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Pret, imagine si publicare">
                <div style={sideStack}>
                  <Field label="Pret vanzare">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.price}
                      onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                      onBlur={() =>
                        setForm((prev) => ({
                          ...prev,
                          price: normalizePositiveString(prev.price, "0"),
                        }))
                      }
                      style={input}
                    />
                  </Field>

                  <Field label="Cost / meniu">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.costPrice}
                      onChange={(e) => setForm((prev) => ({ ...prev, costPrice: e.target.value }))}
                      onBlur={() =>
                        setForm((prev) => ({
                          ...prev,
                          costPrice: normalizePositiveString(prev.costPrice, "0"),
                        }))
                      }
                      style={input}
                    />
                  </Field>

                  <div style={checkBlock}>
                    <label style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={form.isVisibleInPos}
                        onChange={(e) => setForm((prev) => ({ ...prev, isVisibleInPos: e.target.checked }))}
                      />
                      <span>Vizibil in POS</span>
                    </label>
                    <div style={checkHint}>Meniul apare ca articol vandabil in POS.</div>
                  </div>

                  <div style={checkBlock}>
                    <label style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                      />
                      <span>Meniu activ</span>
                    </label>
                    <div style={checkHint}>Daca este inactiv, meniul ramane in nomenclator, dar nu poate fi folosit.</div>
                  </div>

                  <div style={checkBlock}>
                    <label style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={form.publishToGlovo}
                        onChange={(e) => setForm((prev) => ({ ...prev, publishToGlovo: e.target.checked }))}
                      />
                      <span>Publica in Glovo</span>
                    </label>
                    <div style={checkHint}>
                      Marcheaza meniul pentru exportul catre Glovo Merchant cand legam integrarea.
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Poza meniu">
              <div style={uploadRowCompact}>
                <label style={uploadLabel}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        void uploadImage(file)
                      }
                      e.currentTarget.value = ""
                    }}
                  />
                  <span style={btnSecondary}>{uploading ? "Se incarca..." : "Incarca poza"}</span>
                </label>
                <div style={fieldHint}>
                  Recomandat pentru Glovo: JPG patrata, gazduita prin HTTPS.
                </div>
              </div>

              {imagePreviewSrc && !previewImageFailed ? (
                <div style={imagePreviewCard}>
                  <img
                    src={imagePreviewSrc}
                    alt={form.name || "preview meniu"}
                    style={imagePreviewThumb}
                    onError={() => setPreviewImageFailed(true)}
                  />

                  <div style={imagePreviewMeta}>
                    <div style={imagePreviewTitle}>{form.name || "Preview meniu"}</div>
                    <div style={imagePreviewText}>
                      Poza aceasta se va vedea in ERP si poate fi folosita si in exportul pentru marketplace.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={hintBox}>
                  {imagePreviewSrc
                    ? "Poza meniului nu a putut fi incarcata in preview."
                    : "Meniul nu are inca poza. Dupa salvare, poza va putea fi folosita si la publicarea in Glovo."}
                </div>
              )}
            </SectionCard>

            <div style={hintBox}>
              Dupa salvarea meniului, folosesti butonul <strong>Produse in meniu</strong> ca sa alegi exact produsele din ERP care intra in el.
            </div>

            <div style={actionsRow}>
              <button onClick={closeModal} style={btnSecondary}>
                Renunta
              </button>

              <button onClick={saveMenu} disabled={saving || uploading} style={btnPrimary}>
                {saving ? "Se salveaza..." : editingItem ? "Salveaza modificarile" : "Salveaza meniu"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRecipeModal && recipeProduct ? (
        <div style={modalOverlay}>
          <div style={recipeModalCard}>
            <div style={modalHeader}>
              <div>
                <div style={cardTitle}>Produse in meniu</div>
                <div style={cardSubtitleCompact}>
                  {recipeProduct.name} ({recipeProduct.sku})
                </div>
              </div>

              <button onClick={closeRecipeModal} style={btnSecondary}>
                Inchide
              </button>
            </div>

            {recipeLoading ? (
              <div style={infoText}>Se incarca produsele meniului...</div>
            ) : (
              <>
                <div style={recipeTopGrid}>
                  <Field label="Cod configurare">
                    <input
                      value={recipeForm.code}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, code: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Nume configurare">
                    <input
                      value={recipeForm.name}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, name: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Cantitate rezultata">
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={recipeForm.yieldQty}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, yieldQty: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Status">
                    <select
                      value={recipeForm.status}
                      onChange={(e) =>
                        setRecipeForm((prev) => ({
                          ...prev,
                          status: e.target.value as RecipeForm["status"],
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
                  <Field label="Observatii">
                    <textarea
                      value={recipeForm.notes}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, notes: e.target.value }))}
                      style={textarea}
                      rows={3}
                    />
                  </Field>
                </div>

                <div style={recipeHeaderRow}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Produse din meniu</div>
                  <button onClick={addRecipeLine} style={btnPrimary}>
                    Adauga produs
                  </button>
                </div>

                {recipeForm.items.length === 0 ? (
                  <div style={emptyBox}>Nu exista inca produse alocate in meniu.</div>
                ) : (
                  <div style={recipeTableWrap}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={th}>Produs</th>
                          <th style={th}>UM</th>
                          <th style={th}>Cantitate</th>
                          <th style={th}>Pierdere %</th>
                          <th style={th}>Observatii</th>
                          <th style={th}>Actiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipeForm.items.map((line, index) => {
                          const selectedProduct = productOptions.find((p) => p.id === line.ingredientId)
                          return (
                            <tr key={`${index}-${line.sortOrder}`}>
                              <td style={td}>
                                <input
                                  list={`menu-product-options-${index}`}
                                  value={line.productSearch}
                                  onChange={(e) => updateRecipeLineSearch(index, e.target.value)}
                                  placeholder="Scrie numele sau primele litere..."
                                  style={input}
                                />
                                <datalist id={`menu-product-options-${index}`}>
                                  {productOptions
                                    .filter((p) => p.isActive !== false)
                                    .map((p) => (
                                      <option key={p.id} value={buildProductSearchLabel(p)} />
                                    ))}
                                </datalist>
                              </td>

                              <td style={td}>{formatUomOption(selectedProduct?.uom)}</td>

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
                                  type="text"
                                  inputMode="decimal"
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
                                  Sterge
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
                    <span>Configuratie activa</span>
                  </label>
                  <div style={checkHint}>
                    Produsele alocate aici reprezinta continutul meniului care trebuie dus in cos la vanzare.
                  </div>
                </div>

                <div style={actionsRow}>
                  <button onClick={closeRecipeModal} style={btnSecondary}>
                    Renunta
                  </button>

                  <button onClick={saveRecipe} disabled={recipeSaving} style={btnPrimary}>
                    {recipeSaving ? "Se salveaza..." : "Salveaza produsele meniului"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={metricCard}>
      <div style={metricTitle}>{title}</div>
      <div style={metricValue}>{value}</div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={sectionCard}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const kpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
}

const metricCard: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const metricTitle: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginBottom: 4,
}

const metricValue: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  fontWeight: 800,
  color: "#0f172a",
}

const topBar: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
}

const tableWrap: CSSProperties = {
  marginTop: 12,
  overflowX: "auto",
}

const cardTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#0f172a",
}

const cardSubtitleCompact: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 2,
}

const modalHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 10,
  marginBottom: 12,
  position: "sticky",
  top: 0,
  background: "#fff",
  zIndex: 2,
  paddingBottom: 4,
}

const sectionCard: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 14,
  background: "#fff",
}

const sectionTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 10,
}

const gridCompact: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
  marginBottom: 12,
}

const recipeTopGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
}

const sideStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
}

const fieldWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#334155",
}

const fieldHint: CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  marginTop: 2,
}

const input: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 13,
  boxSizing: "border-box",
}

const textarea: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 13,
  boxSizing: "border-box",
  resize: "vertical",
}

const actionsRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
  position: "sticky",
  bottom: 0,
  background: "#fff",
  paddingTop: 8,
}

const uploadRowCompact: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
}

const uploadLabel: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
}

const btnPrimary: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "none",
  background: "#17324d",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
}

const btnSecondary: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
}

const btnSecondarySmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
}

const btnDangerSmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
}

const btnRecipeSmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
}

const errorBox: CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 10,
}

const successBox: CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 10,
  padding: 10,
}

const infoText: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
}

const emptyBox: CSSProperties = {
  padding: 12,
  border: "1px dashed #d1d5db",
  borderRadius: 10,
  color: "#6b7280",
  marginTop: 12,
  fontSize: 13,
}

const recipeTableWrap: CSSProperties = {
  overflowX: "auto",
  marginTop: 10,
}

const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 1120,
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f8fafc",
  whiteSpace: "nowrap",
  fontSize: 12,
  color: "#475569",
  position: "sticky",
  top: 0,
}

const td: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  fontSize: 13,
}

const rowActions: CSSProperties = {
  display: "flex",
  gap: 6,
}

const thumb: CSSProperties = {
  width: 42,
  height: 42,
  objectFit: "cover",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
}

const warningBox: CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  color: "#334155",
  fontSize: 13,
}

const checkBlock: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 4,
  minHeight: 56,
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fafafa",
}

const checkBlockLarge: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 4,
  minHeight: 56,
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fafafa",
  marginTop: 12,
}

const checkLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 700,
  color: "#111827",
}

const checkHint: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
}

const recipeHeaderRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginTop: 14,
}

const hintBox: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 10,
  border: "1px dashed #d1d5db",
  background: "#f8fafc",
  color: "#4b5563",
  fontSize: 12,
}

const hintBoxInline: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  border: "1px dashed #d1d5db",
  background: "#f8fafc",
  color: "#4b5563",
  fontSize: 12,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
}

const imagePreviewCard: CSSProperties = {
  marginTop: 10,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
}

const imagePreviewThumb: CSSProperties = {
  width: 76,
  height: 76,
  objectFit: "cover",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
}

const imagePreviewMeta: CSSProperties = {
  display: "grid",
  gap: 4,
}

const imagePreviewTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: "#0f172a",
}

const imagePreviewText: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
}

const modalOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17, 24, 39, 0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: 12,
  zIndex: 50,
  overflowY: "auto",
}

const modalCard: CSSProperties = {
  width: "100%",
  maxWidth: 1180,
  background: "#ffffff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
  margin: "8px 0",
}

const recipeModalCard: CSSProperties = {
  width: "100%",
  maxWidth: 1180,
  background: "#ffffff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
  margin: "8px 0",
}
