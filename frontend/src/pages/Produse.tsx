import { useEffect, useMemo, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import PageHeader from "../components/PageHeader"
import { DocumentTabs } from "../components/DocumentUi"
import { API_BASE, getToken } from "../lib/api"
import { formatFactorRo, formatMoneyRo, formatQtyRo, parseLocaleNumber } from "../lib/format"

type Product = {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  class: string
  ncCode?: string | null
  isFiscalRiskProduct?: boolean
  netWeightKg?: number
  grossWeightKg?: number
  price: number
  costPrice?: number
  purchaseFactor?: number
  isActive: boolean
  isVisibleInPos?: boolean
  isSgr?: boolean
  sgrValue?: number
  productionMode?: "AUTO" | "MANUAL"
  trackLot?: boolean
  trackExpiry?: boolean
  costMethod?: "AVG" | "FIFO" | "FEFO"
  forcedInactiveBecauseMissingRecipe?: boolean
  recipe?: {
    id: string
    status: string
    items?: any[]
  } | null
  vatRate?: { id: string; rate: number; name: string }
  uom?: { id: string; code: string; name: string; standardCode?: string | null }
  purchaseUom?: { id: string; code: string; name: string; standardCode?: string | null } | null
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
  uom?: { id: string; code: string; name: string; standardCode?: string | null } | null
  isActive?: boolean
}

type FormState = {
  sku: string
  name: string
  imageUrl: string
  class: string
  uomId: string
  purchaseUomId: string
  purchaseFactor: string
  vatRateId: string
  categoryId: string
  ncCode: string
  netWeightKg: string
  grossWeightKg: string
  price: string
  costPrice: string
  isActive: boolean
  isVisibleInPos: boolean
  isSgr: boolean
  isFiscalRiskProduct: boolean
  productionMode: "AUTO" | "MANUAL"
  trackLot: boolean
  trackExpiry: boolean
  costMethod: "AVG" | "FIFO" | "FEFO"
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

type ProductModalTab = "general" | "comercial" | "control" | "media"

type NcSuggestion = {
  code: string
  label: string
  confidence: number
  matchedKeywords: string[]
  fiscalRisk: boolean
  fiscalRiskCategory?: string | null
}

const CLASS_OPTIONS = [
  { value: "MATERIE_PRIMA", label: "materie prima" },
  { value: "ALTE_MATERIALE", label: "alte materiale" },
  { value: "PRODUS_FIN", label: "produs finit" },
  { value: "MARFA", label: "marfa" },
  { value: "AMBALAJE", label: "ambalaje" },
  { value: "AMBALAJ_SGR", label: "ambalaj SGR" },
  { value: "SEMIFABRICATE", label: "semifabricate" },
  { value: "REZIDUALE", label: "reziduale" },
  { value: "CONSUMABILE", label: "consumabile" },
  { value: "SERVICIU_VANDUT", label: "serviciu vandut" },
  { value: "DISCOUNT_FINANCIAR_IESIRI", label: "discount financiar iesiri" },
  { value: "DISCOUNT_COMERCIAL_IESIRI", label: "discount comercial iesiri" },
  { value: "TAXA_VERDE", label: "taxa verde" }
]

const CLASS_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CLASS_OPTIONS.map((x) => [x.value, x.label])
)

const PRODUCTION_MODE_OPTIONS = [
  { value: "AUTO", label: "Automata" },
  { value: "MANUAL", label: "Manuala" }
] as const

const PRODUCTION_MODE_LABEL_MAP: Record<string, string> = {
  AUTO: "Automata",
  MANUAL: "Manuala"
}

const STOCK_COST_METHOD_OPTIONS = [
  { value: "AVG", label: "Cost mediu" },
  { value: "FIFO", label: "FIFO" },
  { value: "FEFO", label: "FEFO" }
] as const

const emptyForm: FormState = {
  sku: "",
  name: "",
  imageUrl: "",
  class: "MARFA",
  uomId: "",
  purchaseUomId: "",
  purchaseFactor: "1",
  vatRateId: "",
  categoryId: "",
  ncCode: "",
  netWeightKg: "0",
  grossWeightKg: "0",
  price: "0",
  costPrice: "0",
  isActive: true,
  isVisibleInPos: true,
  isSgr: false,
  isFiscalRiskProduct: false,
  productionMode: "AUTO",
  trackLot: false,
  trackExpiry: false,
  costMethod: "AVG"
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

function toNumberSafe(value: any) {
  return parseLocaleNumber(value)
}

function normalizePositiveString(value: any, fallback = "0") {
  const n = Math.max(0, toNumberSafe(value))
  return String(Number.isFinite(n) ? n : Number(fallback))
}

function normalizeStrictPositiveString(value: any, fallback = "1") {
  const n = Math.max(0.000001, toNumberSafe(value))
  return String(Number.isFinite(n) ? n : Number(fallback))
}

function formatCompactNumber(value: any) {
  return formatQtyRo(value)
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

  if (typeof window !== "undefined" && window.location.protocol === "https:" && text.startsWith("http://")) {
    return text.replace(/^http:\/\//i, "https://")
  }

  return text
}

export default function ProdusePage() {
  const token =
    getToken() ||
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [items, setItems] = useState<Product[]>([])
  const [uoms, setUoms] = useState<any[]>([])
  const [vatRates, setVatRates] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
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
  const [previewImageFailed, setPreviewImageFailed] = useState(false)
  const [livePreviewUrl, setLivePreviewUrl] = useState("")
  const [activeProductTab, setActiveProductTab] = useState<ProductModalTab>("general")
  const [ncSuggesting, setNcSuggesting] = useState(false)
  const [ncSuggestion, setNcSuggestion] = useState<NcSuggestion | null>(null)
  const [ncCodeManual, setNcCodeManual] = useState(false)
  const [page, setPage] = useState(1)
  const [classFilter, setClassFilter] = useState<string>("ALL")
  const [nextSku, setNextSku] = useState("")

  const [form, setForm] = useState<FormState>(emptyForm)
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(emptyRecipeForm)

  const pageSize = 10

  const selectedCategory = useMemo(() => {
    return categories.find((c) => c.id === form.categoryId) || null
  }, [categories, form.categoryId])

  const selectedUom = useMemo(() => {
    return uoms.find((u) => u.id === form.uomId) || null
  }, [uoms, form.uomId])

  const selectedPurchaseUom = useMemo(() => {
    return uoms.find((u) => u.id === form.purchaseUomId) || null
  }, [uoms, form.purchaseUomId])

  const fiscalRiskPrompt = useMemo(() => {
    if (form.isFiscalRiskProduct || !ncSuggestion?.fiscalRisk) return null
    return {
      code: ncSuggestion.code,
      label: ncSuggestion.label,
      category: ncSuggestion.fiscalRiskCategory || "categorie ANAF cu risc fiscal ridicat",
    }
  }, [form.isFiscalRiskProduct, ncSuggestion])

  const isFinishedProduct = form.class === "PRODUS_FIN"
  const productModalTabs = [
    { id: "general" as const, title: "Date generale" },
    { id: "comercial" as const, title: "Unitati si achizitie" },
    { id: "control" as const, title: "Control si loturi" },
    { id: "media" as const, title: "Poza produs" },
  ]
  const imagePreviewSrc = livePreviewUrl || form.imageUrl.trim()

  useEffect(() => {
    if (!isFinishedProduct || !form.uomId) return

    if (form.purchaseUomId !== form.uomId || form.purchaseFactor !== "1") {
      setForm((prev) => ({
        ...prev,
        purchaseUomId: prev.uomId,
        purchaseFactor: "1"
      }))
    }
  }, [isFinishedProduct, form.uomId, form.purchaseUomId, form.purchaseFactor])

  useEffect(() => {
    return () => {
      if (livePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(livePreviewUrl)
      }
    }
  }, [livePreviewUrl])

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        fetch(`${API_BASE}/api/v1/company`, { headers })
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

      const nextProducts = Array.isArray(productsData.items)
        ? productsData.items.map((item: any) => ({
            ...item,
            imageUrl: normalizeHostedImageUrl(item?.imageUrl || ""),
            price: toNumberSafe(item?.price),
            costPrice: toNumberSafe(item?.costPrice),
            purchaseFactor: toNumberSafe(item?.purchaseFactor || 1),
            sgrValue: toNumberSafe(item?.sgrValue || 0),
            trackLot: item?.trackLot === true,
            trackExpiry: item?.trackExpiry === true,
            costMethod: item?.costMethod || "AVG",
          }))
        : []

      setItems(nextProducts)
      setProductOptions(nextProducts)
      setUoms(Array.isArray(uomData.items) ? uomData.items : [])
      setVatRates(Array.isArray(vatData.items) ? vatData.items : [])
      setCategories(Array.isArray(catData.items) ? catData.items : [])
      setIsVatPayer(companyData?.company?.isVatPayer !== false)
      void loadNextSku()
    } catch {
      setError("Nu pot incarca produsele.")
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
          Authorization: `Bearer ${token}`
        }
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
      class: "MARFA",
      uomId: defaultUom?.id || "",
      purchaseUomId: defaultUom?.id || "",
      purchaseFactor: "1",
      vatRateId: isVatPayer ? defaultVat?.id || "" : "",
      ncCode: "",
      netWeightKg: "0",
      grossWeightKg: "0",
      isActive: true,
      isVisibleInPos: true,
      isSgr: false,
      isFiscalRiskProduct: false,
      productionMode: "AUTO",
      trackLot: false,
      trackExpiry: false,
      costMethod: "AVG"
    })
    setError("")
    setMessage("")
    setNcSuggestion(null)
    setNcCodeManual(false)
    setPreviewImageFailed(false)
    setActiveProductTab("general")
    setLivePreviewUrl("")
    setShowModal(true)
  }

  function openEditModal(item: Product) {
    setEditingItem(item)
    setForm({
      sku: item.sku || "",
      name: item.name || "",
      imageUrl: normalizeHostedImageUrl(item.imageUrl || ""),
      class: item.class || "MARFA",
      uomId: item.uom?.id || "",
      purchaseUomId: item.purchaseUom?.id || item.uom?.id || "",
      purchaseFactor: normalizeStrictPositiveString(item.purchaseFactor || 1, "1"),
      vatRateId: isVatPayer ? item.vatRate?.id || "" : "",
      categoryId: item.category?.id || "",
      ncCode: item.ncCode || "",
      netWeightKg: normalizePositiveString(item.netWeightKg || 0, "0"),
      grossWeightKg: normalizePositiveString(item.grossWeightKg || 0, "0"),
      price: normalizePositiveString(item.price || 0, "0"),
      costPrice: normalizePositiveString(item.costPrice || 0, "0"),
      isActive: item.isActive !== false,
      isVisibleInPos: item.isVisibleInPos !== false,
      isSgr: item.isSgr === true,
      isFiscalRiskProduct: item.isFiscalRiskProduct === true,
      productionMode: item.productionMode === "MANUAL" ? "MANUAL" : "AUTO",
      trackLot: item.trackLot === true,
      trackExpiry: item.trackExpiry === true,
      costMethod: item.costMethod === "FEFO" ? "FEFO" : item.costMethod === "FIFO" ? "FIFO" : "AVG"
    })
    setError("")
    setMessage("")
    setNcSuggestion(null)
    setNcCodeManual(false)
    setPreviewImageFailed(false)
    setActiveProductTab("general")
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
    setNcSuggestion(null)
    setNcCodeManual(false)
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
          Authorization: `Bearer ${token}`
        },
        body: formData
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

  async function saveProduct() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completeaza denumirea produsului.")
      return
    }

    if (!form.uomId) {
      setError("Selecteaza UM.")
      return
    }

    if (!isFinishedProduct && !form.purchaseUomId) {
      setError("Selecteaza ambalajul.")
      return
    }

    if (isVatPayer && !form.vatRateId) {
      setError("Selecteaza TVA.")
      return
    }

    const normalizedPurchaseUomId = isFinishedProduct ? form.uomId : form.purchaseUomId || form.uomId
    const normalizedFactor = isFinishedProduct
      ? 1
      : Math.max(0.000001, toNumberSafe(form.purchaseFactor || 1))
    const normalizedNetWeightKg = Math.max(0, toNumberSafe(form.netWeightKg || 0))
    const normalizedGrossWeightKg = Math.max(0, toNumberSafe(form.grossWeightKg || 0))
    const normalizedPrice = Math.max(0, toNumberSafe(form.price || 0))
    const normalizedCost = Math.max(0, toNumberSafe(form.costPrice || 0))

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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sku: !editingItem ? form.sku.trim() || null : undefined,
          name: form.name.trim(),
          imageUrl: normalizeHostedImageUrl(form.imageUrl.trim()) || null,
          class: form.class,
          uomId: form.uomId,
          purchaseUomId: normalizedPurchaseUomId,
          purchaseFactor: normalizedFactor,
          vatRateId: isVatPayer ? form.vatRateId : null,
          categoryId: form.categoryId || null,
          ncCode: form.isFiscalRiskProduct ? form.ncCode.trim().toUpperCase() || null : null,
          netWeightKg: form.isFiscalRiskProduct ? normalizedNetWeightKg : 0,
          grossWeightKg: form.isFiscalRiskProduct ? normalizedGrossWeightKg : 0,
          price: normalizedPrice,
          costPrice: normalizedCost,
          isActive: form.isActive,
          isVisibleInPos: form.isVisibleInPos,
          isSgr: form.isSgr,
          isFiscalRiskProduct: form.isFiscalRiskProduct,
          productionMode: form.productionMode,
          trackLot: form.trackLot,
          trackExpiry: form.trackExpiry,
          costMethod: form.costMethod
        })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
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
          `Produsul ${savedItem.name} a fost salvat initial ca inactiv. Completeaza acum retetarul ca sa devina utilizabil.`
        )
        await loadAll()
        await openRecipeModal(savedItem)
      } else {
        if (editingItem) {
          if (savedItem?.forcedInactiveBecauseMissingRecipe) {
            setMessage(
              `Produsul ${savedItem?.name || ""} a fost actualizat, dar a ramas inactiv pentru ca nu are retetar completat.`
            )
          } else {
            setMessage(`Produsul ${savedItem?.name || ""} a fost actualizat.`)
          }
        } else {
          if (savedItem?.forcedInactiveBecauseMissingRecipe) {
            setMessage(
              `Produsul a fost salvat cu codul ${savedItem?.sku || ""} si marcat automat inactiv pana la completarea retetarului.`
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

  async function suggestNcCode(force = false) {
    const productName = String(form.name || "").trim()
    if (!token || !productName) return
    if (!force && String(form.ncCode || "").trim() && ncCodeManual) return

    setNcSuggesting(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/products/nc-suggest?name=${encodeURIComponent(productName)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) return

      const best = data?.best as NcSuggestion | null
      setNcSuggestion(best || null)
      if (best?.code) {
        setForm((prev) => ({
          ...prev,
          ncCode:
            force || !String(prev.ncCode || "").trim() || !ncCodeManual
              ? best.code
              : prev.ncCode,
        }))
      }
    } finally {
      setNcSuggesting(false)
    }
  }

  useEffect(() => {
    if (!showModal) return
    const productName = String(form.name || "").trim()
    if (productName.length < 3) {
      if (!ncCodeManual) {
        setNcSuggestion(null)
      }
      return
    }

    const timeoutId = window.setTimeout(() => {
      void suggestNcCode(false)
    }, 450)

    return () => window.clearTimeout(timeoutId)
  }, [form.name, showModal, ncCodeManual])

  useEffect(() => {
    if (form.isFiscalRiskProduct) return
    if (!form.ncCode && toNumberSafe(form.netWeightKg) === 0 && toNumberSafe(form.grossWeightKg) === 0) return
    setForm((prev) => ({
      ...prev,
      ncCode: "",
      netWeightKg: "0",
      grossWeightKg: "0",
    }))
    setNcSuggestion(null)
    setNcCodeManual(false)
  }, [form.isFiscalRiskProduct])

  async function deleteProduct(item: Product) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    const ok = window.confirm(`Sigur vrei sa stergi produsul "${item.name}"?`)
    if (!ok) return

    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/products/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut sterge produsul.")
        return
      }

      setMessage(`Produsul "${item.name}" a fost sters.`)
      await loadAll()
    } catch {
      setError("Nu am putut sterge produsul.")
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
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setShowRecipeModal(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut incarca retetarul.")
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
      setError("Nu am putut incarca retetarul.")
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
      setError("Nu exista sesiune activa.")
      return
    }

    if (!recipeForm.items.length) {
      setError("Adauga cel putin un ingredient in retetar.")
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
        setError(data.error || "Nu am putut salva retetarul.")
        return
      }

      setMessage(
        `Retetarul pentru "${recipeProduct.name}" a fost salvat. Produsul a fost activat automat.`
      )
      setShowRecipeModal(false)
      await loadAll()
    } catch {
      setError("Nu am putut salva retetarul.")
    } finally {
      setRecipeSaving(false)
    }
  }

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const option of CLASS_OPTIONS) counts[option.value] = 0
    for (const item of items) {
      counts[item.class] = (counts[item.class] || 0) + 1
    }
    return counts
  }, [items])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    return items.filter((item) => {
      const classOk = classFilter === "ALL" ? true : item.class === classFilter
      if (!classOk) return false

      if (!qq) return true

      const name = String(item.name || "").toLowerCase()
      const sku = String(item.sku || "").toLowerCase()
      const cat = String(item.category?.name || "").toLowerCase()
      const dep = String(item.category?.department?.name || item.department?.name || "").toLowerCase()
      const ambalaj = String(item.purchaseUom?.code || item.purchaseUom?.name || "").toLowerCase()

      return (
        name.includes(qq) ||
        sku.includes(qq) ||
        cat.includes(qq) ||
        dep.includes(qq) ||
        ambalaj.includes(qq)
      )
    })
  }, [items, q, classFilter])

  useEffect(() => {
    setPage(1)
  }, [q, classFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  const paginated = useMemo(() => {
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, totalPages])

  const recipeEligibleClasses = ["PRODUS_FIN", "SEMIFABRICATE"]

  const kpis = useMemo(() => {
    return {
      total: items.length,
      visiblePos: items.filter((x) => x.isVisibleInPos !== false).length,
      sgr: items.filter((x) => x.isSgr).length,
      recipe: items.filter((x) => recipeEligibleClasses.includes(x.class)).length
    }
  }, [items])

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Produse"
        subtitle="Lista produselor, configurarea lor, clasificari, POS, SGR si retetare."
      />

      {error ? <div style={errorBox}>{error}</div> : null}
      {message ? <div style={successBox}>{message}</div> : null}

      <div style={kpiGrid}>
        <MetricCard title="Total produse" value={String(kpis.total)} />
        <MetricCard title="Vizibile in POS" value={String(kpis.visiblePos)} />
        <MetricCard title="Cu SGR" value={String(kpis.sgr)} />
        <MetricCard title="Cu retetar" value={String(kpis.recipe)} />
      </div>

      <div style={card}>
        <div style={filterBar}>
          <button
            type="button"
            onClick={() => setClassFilter("ALL")}
            style={classFilter === "ALL" ? chipActive : chip}
          >
            Toate ({items.length})
          </button>

          {CLASS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setClassFilter(option.value)}
              style={classFilter === option.value ? chipActive : chip}
            >
              {option.label} ({classCounts[option.value] || 0})
            </button>
          ))}
        </div>

        <div style={topBar}>
          <div style={{ flex: 1 }}>
            <input
              placeholder="Cauta rapid dupa produs, cod, categorie, departament sau ambalaj..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={input}
            />
          </div>

          <button onClick={openAddModal} style={btnPrimary}>
            Adauga produs
          </button>
        </div>

        {!isVatPayer ? (
          <div style={warningBox}>
            Firma este setata ca neplatitoare de TVA. In aceasta pagina, produsele se salveaza fara cota TVA, iar in lista TVA-ul este ignorat.
          </div>
        ) : null}

        {loading ? (
          <div style={infoText}>Se incarca produsele...</div>
        ) : filtered.length === 0 ? (
          <div style={emptyBox}>Nu exista produse pentru filtrul selectat.</div>
        ) : (
          <>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Poza</th>
                    <th style={th}>Cod</th>
                    <th style={th}>Produs</th>
                    <th style={th}>Clasificare</th>
                    <th style={th}>Categorie</th>
                    <th style={th}>Departament</th>
                    <th style={th}>UM</th>
                    <th style={th}>Ambalaj</th>
                    <th style={th}>Cant./ambalaj</th>
                    <th style={th}>TVA</th>
                    <th style={th}>Pret</th>
                    <th style={th}>Cost / UM</th>
                    <th style={th}>Lot / FIFO</th>
                    <th style={th}>POS</th>
                    <th style={th}>SGR</th>
                    <th style={th}>Activ</th>
                    <th style={th}>Retetar</th>
                    <th style={th}>Actiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item) => (
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
                      <td style={td}>{CLASS_LABEL_MAP[item.class] || item.class}</td>
                      <td style={td}>{item.category?.name || "-"}</td>
                      <td style={td}>{item.category?.department?.name || item.department?.name || "-"}</td>
                      <td style={td}>{formatUomOption(item.uom)}</td>
                      <td style={td}>{formatUomOption(item.purchaseUom)}</td>
                      <td style={td}>{formatFactorRo(item.purchaseFactor || 1)}</td>
                      <td style={td}>
                        {isVatPayer
                          ? item.vatRate?.rate != null
                            ? `${item.vatRate.rate}%`
                            : "-"
                          : "Neplatitor"}
                      </td>
                      <td style={td}>{formatMoney(item.price || 0)}</td>
                      <td style={td}>{formatMoney(item.costPrice || 0)}</td>
                      <td style={td}>
                        {item.trackLot ? (
                          <div style={{ display: "grid", gap: 2 }}>
                            <span>{item.trackExpiry ? "Lot + expirare" : "Lot"}</span>
                            <span style={{ color: "#64748b", fontSize: 12 }}>{item.costMethod || "AVG"}</span>
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>Standard</span>
                        )}
                      </td>
                      <td style={td}>{item.isVisibleInPos !== false ? "Da" : "Nu"}</td>
                      <td style={td}>{item.isSgr ? "Da" : "Nu"}</td>
                      <td style={td}>{item.isActive ? "Da" : "Nu"}</td>
                      <td style={td}>
                        {recipeEligibleClasses.includes(item.class) ? (
                          <button onClick={() => openRecipeModal(item)} style={btnRecipeSmall}>
                            {item.recipe?.items?.length ? `Retetar (${item.recipe.items.length})` : "Retetar"}
                          </button>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>-</span>
                        )}
                      </td>
                      <td style={td}>
                        <div style={rowActions}>
                          <button onClick={() => openEditModal(item)} style={btnSecondarySmall}>
                            Edit
                          </button>
                          <button onClick={() => deleteProduct(item)} style={btnDangerSmall}>
                            Sterge
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={paginationWrap}>
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={page === 1 ? btnDisabled : btnSecondarySmall}
              >
                Inapoi
              </button>

              <div style={paginationInfo}>
                Pagina {Math.min(page, totalPages)} din {totalPages}
              </div>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={page >= totalPages ? btnDisabled : btnSecondarySmall}
              >
                Urmator
              </button>
            </div>
          </>
        )}
      </div>

      {showModal && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={modalHeader}>
              <div>
                <div style={cardTitle}>{editingItem ? "Edit produs" : "Adauga produs"}</div>
                <div style={cardSubtitleCompact}>
                  {editingItem
                    ? "SKU stabil dupa salvare."
                    : "SKU propus automat, editabil doar la creare."}
                </div>
              </div>

              <button onClick={closeModal} style={btnSecondary}>
                Inchide
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <DocumentTabs items={productModalTabs} activeId={activeProductTab} onChange={setActiveProductTab} />
            </div>

            <div style={productTabPanel}>
              {activeProductTab === "general" ? (
                <SectionCard title="Date generale">
                  <div style={gridCompact}>
                    <Field label="SKU">
                      <input
                        value={form.sku}
                        onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                        style={{
                          ...input,
                          ...(editingItem
                            ? {
                                background: "#f8fafc",
                                borderColor: "#e2e8f0",
                                color: "#475569"
                              }
                            : null)
                        }}
                        readOnly={Boolean(editingItem)}
                      />
                    </Field>

                    <Field label="Denumire produs">
                      <input
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        onBlur={() => {
                          void suggestNcCode(false)
                        }}
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

                    <Field label="Mod productie">
                      <select
                        value={form.productionMode}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            productionMode: e.target.value as "AUTO" | "MANUAL"
                          }))
                        }
                        style={input}
                      >
                        {PRODUCTION_MODE_OPTIONS.map((option) => (
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

                    <Field label="Departament">
                      <input
                        value={selectedCategory?.department?.name || "-"}
                        readOnly
                        style={{ ...input, background: "#f8fafc" }}
                      />
                    </Field>

                    {form.isFiscalRiskProduct ? (
                      <Field label="Cod NC">
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              value={form.ncCode}
                              onChange={(e) => {
                                setNcCodeManual(true)
                                setForm((prev) => ({ ...prev, ncCode: e.target.value.toUpperCase() }))
                              }}
                              style={{ ...input, flex: 1 }}
                              placeholder="Ex: 22021000"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setNcCodeManual(false)
                                void suggestNcCode(true)
                              }}
                              disabled={ncSuggesting || !String(form.name || "").trim()}
                              style={{
                                border: "1px solid #cbd5e1",
                                background: "#f8fafc",
                                borderRadius: 10,
                                padding: "0 12px",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#17324D",
                                minWidth: 110,
                              }}
                            >
                              {ncSuggesting ? "Cauta..." : "Sugereaza"}
                            </button>
                          </div>
                          {ncSuggestion ? (
                            <div style={{ fontSize: 12, color: "#64748b" }}>
                              Sugestie: <strong>{ncSuggestion.code}</strong> - {ncSuggestion.label}
                            </div>
                          ) : null}
                        </div>
                      </Field>
                    ) : null}
                  </div>
                </SectionCard>
              ) : null}

              {activeProductTab === "comercial" ? (
                <SectionCard title="Unitati si achizitie">
                  <div style={gridCompact}>
                    <Field label={isFinishedProduct ? "UM vanzare" : "UM"}>
                      <select
                        value={form.uomId}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            uomId: e.target.value,
                            purchaseUomId: isFinishedProduct
                              ? e.target.value
                              : prev.purchaseUomId || e.target.value,
                            purchaseFactor: isFinishedProduct ? "1" : prev.purchaseFactor
                          }))
                        }
                        style={input}
                      >
                        <option value="">Selecteaza UM</option>
                        {uoms
                          .filter((u) => u.isActive !== false)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {formatUomOption(u)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    {!isFinishedProduct ? (
                      <>
                        <Field label="Ambalaj">
                          <select
                            value={form.purchaseUomId}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, purchaseUomId: e.target.value }))
                            }
                            style={input}
                          >
                            <option value="">Selecteaza ambalaj</option>
                            {uoms
                              .filter((u) => u.isActive !== false)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {formatUomOption(u)}
                                </option>
                              ))}
                          </select>
                        </Field>

                        <Field label="Cantitate pe ambalaj">
                          <input
                            type="number"
                            min="1"
                            step="0.001"
                            value={form.purchaseFactor}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, purchaseFactor: e.target.value }))
                            }
                            onBlur={() =>
                              setForm((prev) => ({
                                ...prev,
                                purchaseFactor: normalizeStrictPositiveString(prev.purchaseFactor, "1")
                              }))
                            }
                            style={input}
                          />
                          <div style={fieldHint}>
                            {form.uomId && form.purchaseUomId && form.uomId === form.purchaseUomId
                              ? `Lasa 1 daca produsul se cumpara si se stocheaza in aceeasi unitate (${selectedUom?.code || "UM"}).`
                              : `Exemplu: 1 ${selectedPurchaseUom?.code || "ambalaj"} = 8 ${selectedUom?.code || "UM"}.`}
                          </div>
                        </Field>
                      </>
                    ) : (
                      <div style={hintBoxInline}>
                        Pentru produs finit se foloseste doar U.M. de vanzare. Ambalajul si factorul raman automat pe aceeasi unitate.
                      </div>
                    )}

                    <Field label="TVA">
                      {isVatPayer ? (
                        <select
                          value={form.vatRateId}
                          onChange={(e) => setForm((prev) => ({ ...prev, vatRateId: e.target.value }))}
                          style={input}
                        >
                          <option value="">Selecteaza TVA</option>
                          {vatRates
                            .filter((v) => v.isActive !== false)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.rate}%
                              </option>
                            ))}
                        </select>
                      ) : (
                        <div style={hintBoxInline}>
                          Firma este neplatitoare de TVA. Produsul se salveaza fara cota TVA.
                        </div>
                      )}
                    </Field>

                    <Field label="Pret vanzare">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.price}
                        onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                        onBlur={() =>
                          setForm((prev) => ({
                            ...prev,
                            price: normalizePositiveString(prev.price, "0")
                          }))
                        }
                        style={input}
                      />
                    </Field>

                    <Field label="Cost achizitie / UM">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.costPrice}
                        onChange={(e) => setForm((prev) => ({ ...prev, costPrice: e.target.value }))}
                        onBlur={() =>
                          setForm((prev) => ({
                            ...prev,
                            costPrice: normalizePositiveString(prev.costPrice, "0")
                          }))
                        }
                        style={input}
                      />
                      <div style={fieldHint}>
                        Costul se introduce pe unitatea de baza, nu pe ambalaj.
                      </div>
                    </Field>

                    {form.isFiscalRiskProduct ? (
                      <>
                        <Field label="Greutate neta / UM (kg)">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.netWeightKg}
                            onChange={(e) => setForm((prev) => ({ ...prev, netWeightKg: e.target.value }))}
                            onBlur={() =>
                              setForm((prev) => ({
                                ...prev,
                                netWeightKg: normalizePositiveString(prev.netWeightKg, "0")
                              }))
                            }
                            style={input}
                          />
                          <div style={fieldHint}>Se foloseste la greutatea neta din RO e-Transport.</div>
                        </Field>

                        <Field label="Greutate bruta / UM (kg)">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.grossWeightKg}
                            onChange={(e) => setForm((prev) => ({ ...prev, grossWeightKg: e.target.value }))}
                            onBlur={() =>
                              setForm((prev) => ({
                                ...prev,
                                grossWeightKg: normalizePositiveString(prev.grossWeightKg, "0")
                              }))
                            }
                            style={input}
                          />
                          <div style={fieldHint}>Se foloseste la pragurile automate si la greutatea bruta din RO e-Transport.</div>
                        </Field>
                      </>
                    ) : null}
                  </div>
                </SectionCard>
              ) : null}

              {activeProductTab === "control" ? (
                <>
                <SectionCard title="Loturi si cost">
                  <div style={sideStack}>
                    <div style={checkBlock}>
                      <label style={checkLabel}>
                        <input
                          type="checkbox"
                          checked={form.trackLot}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              trackLot: e.target.checked,
                              trackExpiry: e.target.checked ? prev.trackExpiry : false,
                              costMethod: e.target.checked ? prev.costMethod : "AVG",
                            }))
                          }
                        />
                        <span>Urmareste lot</span>
                      </label>
                      <div style={checkHint}>Activeaza loturi distincte pe intrari, consum si transfer.</div>
                    </div>

                    <div style={checkBlock}>
                      <label style={checkLabel}>
                        <input
                          type="checkbox"
                          checked={form.trackExpiry}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              trackLot: e.target.checked ? true : prev.trackLot,
                              trackExpiry: e.target.checked,
                              costMethod: e.target.checked && prev.costMethod === "AVG" ? "FEFO" : prev.costMethod,
                            }))
                          }
                        />
                        <span>Urmareste expirare</span>
                      </label>
                      <div style={checkHint}>Pentru produse cu expirare, sistemul poate consuma FEFO.</div>
                    </div>

                    <Field label="Metoda cost">
                      <select
                        value={form.costMethod}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            costMethod: e.target.value as "AVG" | "FIFO" | "FEFO",
                            trackLot: e.target.value === "AVG" ? prev.trackLot : true,
                            trackExpiry: e.target.value === "FEFO" ? true : prev.trackExpiry,
                          }))
                        }
                        style={input}
                      >
                        {STOCK_COST_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="Setari rapide">
                  <div style={sideStack}>
                    <div style={checkBlock}>
                      <label style={checkLabel}>
                        <input
                          type="checkbox"
                          checked={form.isSgr}
                          onChange={(e) => setForm((prev) => ({ ...prev, isSgr: e.target.checked }))}
                        />
                        <span>SGR</span>
                      </label>
                      <div style={checkHint}>SGR = 0.50 lei fara TVA.</div>
                    </div>

                    <div style={checkBlock}>
                      <label style={checkLabel}>
                        <input
                          type="checkbox"
                          checked={form.isFiscalRiskProduct}
                          onChange={(e) => setForm((prev) => ({ ...prev, isFiscalRiskProduct: e.target.checked }))}
                        />
                        <span>Bun cu risc fiscal ridicat</span>
                      </label>
                      <div style={checkHint}>Activeaza verificarea automata pentru RO e-Transport pe documente.</div>
                      {fiscalRiskPrompt ? (
                        <div
                          style={{
                            marginTop: 10,
                            border: "1px solid #f59e0b",
                            background: "#fffbeb",
                            color: "#92400e",
                            borderRadius: 12,
                            padding: "10px 12px",
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                            Produsul pare sa intre intr-o categorie ANAF cu risc fiscal ridicat:
                            {" "}
                            <strong>{fiscalRiskPrompt.category}</strong>.
                            Pentru RO e-Transport recomandam sa bifezi optiunea si sa completezi
                            {" "}
                            <strong>Cod NC</strong>,
                            {" "}
                            <strong>greutate neta</strong>
                            {" "}si{" "}
                            <strong>greutate bruta</strong>.
                          </div>
                          <div style={{ fontSize: 12, color: "#b45309" }}>
                            Sugestie curenta: <strong>{fiscalRiskPrompt.code}</strong> - {fiscalRiskPrompt.label}
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  isFiscalRiskProduct: true,
                                  ncCode: prev.ncCode || fiscalRiskPrompt.code,
                                }))
                              }
                              style={{
                                border: "1px solid #f59e0b",
                                background: "#fff7ed",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                color: "#9a3412",
                              }}
                            >
                              Bifeaza automat produsul cu risc fiscal
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div style={checkBlock}>
                      <label style={checkLabel}>
                        <input
                          type="checkbox"
                          checked={form.isVisibleInPos}
                          onChange={(e) => setForm((prev) => ({ ...prev, isVisibleInPos: e.target.checked }))}
                        />
                        <span>Vizibil in POS</span>
                      </label>
                      <div style={checkHint}>Daca este debifat, produsul nu apare in Android POS.</div>
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
                        Pentru produs finit si semifabricate, daca nu exista retetar, produsul poate fi salvat automat inactiv.
                      </div>
                    </div>
                  </div>
                </SectionCard>
                </>
              ) : null}

              {activeProductTab === "media" ? (
                <>
                <SectionCard title="Poza produs">
                  <div style={uploadRowCompact}>
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
                        {uploading ? "Se incarca..." : "Incarca poza"}
                      </span>
                    </label>

                  </div>

                  {imagePreviewSrc && !previewImageFailed ? (
                    <div style={imagePreviewWrapCompact}>
                      <img
                        key={imagePreviewSrc}
                        src={imagePreviewSrc}
                        alt="Preview produs"
                        style={imagePreviewLarge}
                        onError={() => setPreviewImageFailed(true)}
                      />
                    </div>
                  ) : (
                    <div style={hintBox}>
                      {imagePreviewSrc
                        ? "Poza produsului nu a putut fi incarcata in preview."
                        : "Produsul nu are inca poza. Se lucreaza doar cu upload, fara camp de image URL."}
                    </div>
                  )}
                </SectionCard>

                {(form.class === "PRODUS_FIN" || form.class === "SEMIFABRICATE") && (
                  <div style={warningBox}>
                    Pentru aceasta clasificare, produsul se salveaza intai ca inactiv si trebuie completat imediat retetarul.
                  </div>
                )}
                </>
              ) : null}
            </div>

            <div style={actionsRow}>
              <button onClick={closeModal} style={btnSecondary}>
                Renunta
              </button>

              <button onClick={saveProduct} disabled={saving || uploading} style={btnPrimary}>
                {saving ? "Se salveaza..." : editingItem ? "Salveaza modificarile" : "Salveaza produs"}
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
                <div style={cardTitle}>Retetar produs</div>
                <div style={cardSubtitleCompact}>
                  {recipeProduct.name} ({recipeProduct.sku})
                </div>
              </div>

              <button onClick={closeRecipeModal} style={btnSecondary}>
                Inchide
              </button>
            </div>

            {recipeLoading ? (
              <div style={infoText}>Se incarca retetarul...</div>
            ) : (
              <>
                <div style={recipeTopGrid}>
                  <Field label="Cod retetar">
                    <input
                      value={recipeForm.code}
                      onChange={(e) => setRecipeForm((prev) => ({ ...prev, code: e.target.value }))}
                      style={input}
                    />
                  </Field>

                  <Field label="Nume retetar">
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

                  <Field label="Status retetar">
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
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Ingrediente</div>
                  <button onClick={addRecipeLine} style={btnPrimary}>
                    Adauga ingredient
                  </button>
                </div>

                {recipeForm.items.length === 0 ? (
                  <div style={emptyBox}>Nu exista inca ingrediente in retetar.</div>
                ) : (
                  <div style={recipeTableWrap}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={th}>Ingredient</th>
                          <th style={th}>UM</th>
                          <th style={th}>Cantitate</th>
                          <th style={th}>Pierdere %</th>
                          <th style={th}>Observatii</th>
                          <th style={th}>Actiuni</th>
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
                                  <option value="">Selecteaza ingredient</option>
                                  {productOptions
                                    .filter((p) => p.id !== recipeProduct.id && p.isActive !== false)
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} ({p.sku})
                                      </option>
                                    ))}
                                </select>
                              </td>

                              <td style={td}>{selectedIngredient?.uom?.code || "-"}</td>

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
                    <span>Retetar activ</span>
                  </label>
                  <div style={checkHint}>
                    Dupa salvarea retetarului, produsul va fi activat automat.
                  </div>
                </div>

                <div style={actionsRow}>
                  <button onClick={closeRecipeModal} style={btnSecondary}>
                    Renunta
                  </button>

                  <button onClick={saveRecipe} disabled={recipeSaving} style={btnPrimary}>
                    {recipeSaving ? "Se salveaza..." : "Salveaza retetar"}
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
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const kpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10
}

const metricCard: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const metricTitle: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginBottom: 4
}

const metricValue: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  fontWeight: 800,
  color: "#0f172a"
}

const filterBar: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 10
}

const chip: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#334155",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700
}

const chipActive: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 800
}

const topBar: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap"
}

const tableWrap: CSSProperties = {
  marginTop: 12,
  overflowX: "auto"
}

const paginationWrap: CSSProperties = {
  marginTop: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap"
}

const paginationInfo: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 600
}

const cardTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#0f172a"
}

const cardSubtitleCompact: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 2
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
  paddingBottom: 4
}

const productTabPanel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12
}

const sectionCard: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 14,
  background: "#fff"
}

const sectionTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 10
}

const gridCompact: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10
}

const recipeTopGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10
}

const sideStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10
}

const fieldWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#334155"
}

const fieldHint: CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  marginTop: 2
}

const input: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 13,
  boxSizing: "border-box"
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
  resize: "vertical"
}

const actionsRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
  position: "sticky",
  bottom: 0,
  background: "#fff",
  paddingTop: 8
}

const uploadRowCompact: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap"
}

const uploadLabel: CSSProperties = {
  display: "inline-flex",
  alignItems: "center"
}

const btnPrimary: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "none",
  background: "#17324d",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700
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
  alignItems: "center"
}

const btnSecondarySmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
}

const btnDisabled: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  color: "#94a3b8",
  cursor: "not-allowed",
  fontSize: 12,
  fontWeight: 600
}

const btnDangerSmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
}

const btnRecipeSmall: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
}

const btnDangerSoft: CSSProperties = {
  background: "#fff1f2",
  color: "#991b1b",
  border: "1px solid #fecdd3",
  borderRadius: 10,
  padding: "9px 12px",
  cursor: "pointer"
}

const errorBox: CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 10
}

const successBox: CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 10,
  padding: 10
}

const infoText: CSSProperties = {
  color: "#6b7280",
  fontSize: 13
}

const emptyBox: CSSProperties = {
  padding: 12,
  border: "1px dashed #d1d5db",
  borderRadius: 10,
  color: "#6b7280",
  marginTop: 12,
  fontSize: 13
}

const recipeTableWrap: CSSProperties = {
  overflowX: "auto",
  marginTop: 10
}

const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 1320
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
  top: 0
}

const td: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  fontSize: 13
}

const rowActions: CSSProperties = {
  display: "flex",
  gap: 6
}

const thumb: CSSProperties = {
  width: 42,
  height: 42,
  objectFit: "cover",
  borderRadius: 8,
  border: "1px solid #e5e7eb"
}

const warningBox: CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  color: "#334155",
  fontSize: 13
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
  background: "#fafafa"
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
  marginTop: 12
}

const checkLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 700,
  color: "#111827"
}

const checkHint: CSSProperties = {
  fontSize: 12,
  color: "#6b7280"
}

const recipeHeaderRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginTop: 14
}

const hintBox: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 10,
  border: "1px dashed #d1d5db",
  background: "#f8fafc",
  color: "#4b5563",
  fontSize: 12
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
  alignItems: "center"
}

const imagePreviewWrapCompact: CSSProperties = {
  marginTop: 10
}

const imagePreviewLarge: CSSProperties = {
  width: "100%",
  maxWidth: 260,
  aspectRatio: "1 / 1",
  objectFit: "cover",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc"
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
  overflowY: "auto"
}

const modalCard: CSSProperties = {
  width: "100%",
  maxWidth: 1380,
  background: "#ffffff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
  margin: "8px 0"
}

const recipeModalCard: CSSProperties = {
  width: "100%",
  maxWidth: 1180,
  background: "#ffffff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
  margin: "8px 0"
}






