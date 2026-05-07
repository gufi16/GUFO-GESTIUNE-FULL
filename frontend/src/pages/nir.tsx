import { useEffect, useMemo, useState } from "react"
import type { CSSProperties, KeyboardEvent, ReactNode } from "react"
import { ArrowLeft, FileOutput, Printer } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { DocumentPageHeader, DocumentTabs, documentButtonPrimaryClass, documentButtonSecondaryClass } from "../components/DocumentUi"
import { API_BASE, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { downloadPdfFile } from "../lib/pdf"
import { getDocumentNumbering, getPreviewValue, type NumberingPayload } from "../lib/numbering"
import { formatFactorRo, formatMoneyRo, formatNumberRo, formatQtyRo, parseLocaleNumber } from "../lib/format"

type AnyObj = Record<string, any>

type NirLine = {
  id: string
  productId: string
  search: string
  uomId: string
  uomCode: string
  factor: string
  qty: string
  price: string
  vat: string
  isSgr: boolean
  sgrValue: string
  autoFactor: boolean
}

function rawToken() {
  return getToken() || localStorage.getItem("token") || localStorage.getItem("access_token") || ""
}

function toNumberSafe(value: any) {
  return parseLocaleNumber(value)
}

function clampPositiveString(value: any, fallback = "0") {
  const n = Math.max(0, toNumberSafe(value))
  if (!Number.isFinite(n)) return fallback
  return String(n)
}

function clampStrictPositiveString(value: any, fallback = "1") {
  const n = Math.max(0.000001, toNumberSafe(value))
  if (!Number.isFinite(n)) return fallback
  return String(n)
}

function makeLine(): NirLine {
  return {
    id: crypto.randomUUID(),
    productId: "",
    search: "",
    uomId: "",
    uomCode: "",
    factor: "1",
    qty: "1",
    price: "0",
    vat: "19",
    isSgr: false,
    sgrValue: "0.50",
    autoFactor: true,
  }
}

function ensureArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function normalizeProductsResponse(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.products)) return data.products
  return []
}

function normalizeLocationsResponse(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.locations)) return data.locations
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeSuppliersResponse(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.suppliers)) return data.suppliers
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeMetaItems(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function getReceiptIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("id") || ""
}

function getIncomingInvoiceIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("incomingInvoiceId") || ""
}

function formatNumber(value: any, digits = 2) {
  return formatNumberRo(value, digits)
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

function focusNextField(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
  if (e.key !== "Enter") return
  e.preventDefault()

  const current = e.currentTarget
  const fields = Array.from(
    document.querySelectorAll<HTMLElement>("[data-grid-field='nir']")
  ).filter((el) => !el.hasAttribute("disabled"))

  const index = fields.indexOf(current)
  if (index >= 0 && index < fields.length - 1) {
    fields[index + 1].focus()
    if ((fields[index + 1] as HTMLInputElement).select) {
      ;(fields[index + 1] as HTMLInputElement).select()
    }
  }
}

function getLineComputed(line: NirLine, fxRate: string) {
  const qty = Math.max(0, toNumberSafe(line.qty))
  const factor = Math.max(0.000001, toNumberSafe(line.factor) || 1)
  const price = Math.max(0, toNumberSafe(line.price))
  const vat = Math.max(0, toNumberSafe(line.vat))
  const fx = Math.max(0.000001, toNumberSafe(fxRate) || 1)
  const qtyBase = qty * factor
  const netFc = qtyBase * price
  const vatFc = (netFc * vat) / 100
  const sgrUnit = line.isSgr ? Math.max(0, toNumberSafe(line.sgrValue || 0.5)) : 0
  const sgrFc = qtyBase * sgrUnit
  const grossFc = netFc + vatFc
  const withSgrFc = grossFc + sgrFc

  return {
    qty,
    factor,
    price,
    vat,
    fx,
    qtyBase,
    netFc,
    vatFc,
    sgrUnit,
    sgrFc,
    grossFc,
    withSgrFc,
    netRon: netFc * fx,
    vatRon: vatFc * fx,
    grossRon: grossFc * fx,
    sgrRon: sgrFc * fx,
    withSgrRon: withSgrFc * fx,
  }
}

export default function NirPage() {
  const navigate = useNavigate()
  const token = rawToken()
  const receiptId = getReceiptIdFromUrl()
  const incomingInvoiceId = getIncomingInvoiceIdFromUrl()
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  )
  const [activePanel, setActivePanel] = useState<"header" | "lines" | "summary">("header")

  const [products, setProducts] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [uoms, setUoms] = useState<any[]>([])
  const [vatRates, setVatRates] = useState<any[]>([])
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)

  const [saving, setSaving] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [authError, setAuthError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [status, setStatus] = useState("DRAFT")

  const [supplierSearch, setSupplierSearch] = useState("")
  const [supplierChosen, setSupplierChosen] = useState(false)

  const [header, setHeader] = useState({
    locationId: getActiveLocationId(),
    supplierId: "",
    supplierName: "",
    supplierCode: "",
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    currency: "RON",
    fxRate: "1",
    note: "",
    sourceIncomingEInvoiceId: "",
    spvDownloadId: "",
    spvUploadIndex: "",
    spvInvoiceNo: "",
  })

  const [lines, setLines] = useState<NirLine[]>([makeLine()])
  const [lineEditorOpen, setLineEditorOpen] = useState(false)
  const [lineEditorMode, setLineEditorMode] = useState<"create" | "edit">("create")
  const [lineDraft, setLineDraft] = useState<NirLine | null>(null)
  const [lineEditorError, setLineEditorError] = useState("")

  const [quickProductOpen, setQuickProductOpen] = useState(false)
  const [quickProductLineId, setQuickProductLineId] = useState("")
  const [quickProductLoading, setQuickProductLoading] = useState(false)
  const [quickProductError, setQuickProductError] = useState("")
  const [quickProductForm, setQuickProductForm] = useState({
    name: "",
    uomId: "",
    purchaseUomId: "",
    purchaseFactor: "1",
    vatRateId: "",
    price: "0",
    isSgr: false,
  })

  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false)
  const [quickSupplierLoading, setQuickSupplierLoading] = useState(false)
  const [quickSupplierError, setQuickSupplierError] = useState("")
  const [quickSupplierForm, setQuickSupplierForm] = useState({
    name: "",
    code: "",
    cif: "",
    regNo: "",
    address: "",
    email: "",
    phone: "",
  })

  useEffect(() => {
    loadMeta()
    const unsubscribe = subscribeToActiveLocation((locationId) => {
      if (receiptId) return
      setHeader((prev) => {
        if (!locationId || prev.locationId === locationId) return prev
        return { ...prev, locationId }
      })
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const syncViewport = () => setIsMobileViewport(window.innerWidth < 768)

    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [])

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId])

  useEffect(() => {
    if (!receiptId && incomingInvoiceId && products.length && locations.length) {
      void loadIncomingInvoice(incomingInvoiceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId, incomingInvoiceId, products.length, locations.length])

  async function loadMeta() {
    setLoadingMeta(true)
    setAuthError("")
    setLoadError("")

    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const [p, l, s, u, v, numberingData] = await Promise.all([
        fetch(`${API_BASE}/api/v1/products`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/locations`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/suppliers`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/uom`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/vat`, { headers }),
        getDocumentNumbering().catch(() => null),
      ])

      const pData = await p.json().catch(() => ({}))
      const lData = await l.json().catch(() => ({}))
      const sData = await s.json().catch(() => ({}))
      const uData = await u.json().catch(() => ({}))
      const vData = await v.json().catch(() => ({}))

      if ([p, l, s, u, v].some((x) => x.status === 401)) {
        setAuthError("Token lipsa sau expirat. Fa login din nou in aplicatie.")
        setProducts([])
        setLocations([])
        setSuppliers([])
        setUoms([])
        setVatRates([])
        return
      }

      const nextProducts = normalizeProductsResponse(pData)
      const nextLocations = normalizeLocationsResponse(lData)
      const nextSuppliers = normalizeSuppliersResponse(sData)
      const nextUoms = normalizeMetaItems(uData)
      const nextVatRates = normalizeMetaItems(vData)

      setProducts(nextProducts)
      setLocations(nextLocations)
      setSuppliers(nextSuppliers)
      setUoms(nextUoms)
      setVatRates(nextVatRates)
      setNumbering(numberingData?.previews || null)

      if (!receiptId && nextLocations.length) {
        const preferredLocationId =
          nextLocations.find((location: AnyObj) => location.id === getActiveLocationId())?.id || nextLocations[0]?.id || ""

        setHeader((prev) => ({
          ...prev,
          locationId: prev.locationId || preferredLocationId,
        }))
      }

      if (
        !nextProducts.length &&
        !nextLocations.length &&
        !nextSuppliers.length &&
        !nextUoms.length &&
        !nextVatRates.length
      ) {
        setLoadError("Nu s-au putut incarca datele pentru NIR.")
      }
    } catch {
      setLoadError("Nu pot incarca datele din backend.")
      setProducts([])
      setLocations([])
      setSuppliers([])
      setUoms([])
      setVatRates([])
    } finally {
      setLoadingMeta(false)
    }
  }

  async function loadReceipt(id: string) {
    if (!token) return

    setLoadingReceipt(true)
    setLoadError("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/purchase-receipts/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setAuthError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok || !data.receipt) {
        setLoadError(data.error || "Nu pot incarca documentul NIR.")
        return
      }

      const r = data.receipt

      setStatus(r.status || "DRAFT")

      setHeader({
        locationId: r.locationId || "",
        supplierId: r.supplierId || "",
        supplierName: r.supplier?.name || r.supplierName || "",
        supplierCode: r.supplier?.code || r.supplierCode || "",
        docNo: r.docNo || "",
        docDate: r.docDate ? String(r.docDate).slice(0, 10) : "",
        currency: r.currency || "RON",
        fxRate: String(r.fxRate || 1),
        note: r.note || "",
        sourceIncomingEInvoiceId: r.sourceIncomingEInvoiceId || "",
        spvDownloadId: r.spvDownloadId || "",
        spvUploadIndex: r.spvUploadIndex || "",
        spvInvoiceNo: r.spvInvoiceNo || "",
      })

      setSupplierSearch(r.supplier?.name || r.supplierName || "")
      setSupplierChosen(!!(r.supplierId || r.supplierName))

      const loadedLines: NirLine[] = ensureArray(r.items).map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        productId: item.productId || "",
        search: item.product?.name || "",
        uomId: item.uomId || "",
        uomCode:
          item.uom?.code ||
          item.product?.purchaseUom?.code ||
          item.product?.uom?.code ||
          "",
        factor: String(item.conversionFactor ?? 1),
        qty: String(item.qty ?? 1),
        price: String(item.unitCostNetFc ?? 0),
        vat: String(item.vatRateValue ?? 19),
        isSgr: Boolean(item.product?.isSgr),
        sgrValue: String(
          item.product?.isSgr ? Number(item.product?.sgrValue || 0.5) : 0
        ),
        autoFactor: true,
      }))

      setLines(loadedLines.length ? loadedLines : [makeLine()])
    } catch {
      setLoadError("Nu pot incarca documentul NIR.")
    } finally {
      setLoadingReceipt(false)
    }
  }

  async function loadIncomingInvoice(id: string) {
    if (!token) return

    setLoadError("")

    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.item) {
        setLoadError(data?.error || "Nu pot incarca factura primita din SPV.")
        return
      }

      const item = data.item
      const preferredLocationId =
        locations.find((location: AnyObj) => location.id === getActiveLocationId())?.id ||
        locations[0]?.id ||
        ""

      setHeader((prev) => ({
        ...prev,
        locationId: prev.locationId || preferredLocationId,
        supplierId: item.supplierId || "",
        supplierName: item.supplier?.name || item.supplierName || "",
        supplierCode: item.supplier?.code || item.supplierCode || "",
        docNo: item.invoiceNo || prev.docNo,
        docDate: item.invoiceDate ? String(item.invoiceDate).slice(0, 10) : prev.docDate,
        currency: item.currency || "RON",
        fxRate: "1",
        note: `Import SPV - ID descarcare: ${item.spvDownloadId || "-"}`,
        sourceIncomingEInvoiceId: item.id || "",
        spvDownloadId: item.spvDownloadId || "",
        spvUploadIndex: item.spvUploadIndex || "",
        spvInvoiceNo: item.invoiceNo || "",
      }))

      setSupplierSearch(item.supplier?.name || item.supplierName || "")
      setSupplierChosen(Boolean(item.supplierId || item.supplierName))

      const nextLines: NirLine[] = ensureArray(item.items).map((line: any) => {
        const matched = line.matchedProduct
        const purchaseUom = matched?.purchaseUom || matched?.uom || null
        const fallbackUom = uoms.find((entry: AnyObj) => String(entry?.code || "").trim().toLowerCase() === String(line.uomCode || "").trim().toLowerCase())
        return {
          id: crypto.randomUUID(),
          productId: matched?.id || "",
          search: matched?.name || line.productName || "",
          uomId: purchaseUom?.id || fallbackUom?.id || "",
          uomCode: purchaseUom?.code || fallbackUom?.code || line.uomCode || "",
          factor: String(matched?.purchaseFactor || 1),
          qty: String(line.qty ?? 0),
          price: String(line.unitPrice ?? 0),
          vat: String(line.vatRate ?? matched?.vatRate?.rate ?? 19),
          isSgr: Boolean(matched?.isSgr),
          sgrValue: String(matched?.isSgr ? Number(matched?.sgrValue || 0.5) : 0),
          autoFactor: true,
        }
      })

      setLines(nextLines.length ? nextLines : [makeLine()])
    } catch {
      setLoadError("Nu pot incarca factura primita din SPV.")
    }
  }

  function setLineValue(id: string, patch: Partial<NirLine>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line))
    )
  }

  function setDraftLineValue(patch: Partial<NirLine>) {
    setLineDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function applyProductSelection(line: NirLine, product: AnyObj): NirLine {
    const productFactor = Math.max(0.000001, toNumberSafe(product.purchaseFactor || 1))

    return {
      ...line,
      productId: product.id,
      search: product.name,
      uomId: product.purchaseUom?.id || product.uom?.id || "",
      uomCode: product.purchaseUom?.code || product.uom?.code || "",
      factor: String(productFactor),
      vat: String(product.vatRate?.rate || 19),
      price: String(product.costPrice ?? line.price ?? "0"),
      isSgr: Boolean(product.isSgr),
      sgrValue: String(product.isSgr ? Number(product.sgrValue || 0.5) : 0),
      autoFactor: true,
    }
  }

  function normalizeLineValue(id: string, key: keyof NirLine) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line

        if (key === "qty") return { ...line, qty: clampPositiveString(line.qty, "1") }
        if (key === "price") return { ...line, price: clampPositiveString(line.price, "0") }
        if (key === "vat") return { ...line, vat: clampPositiveString(line.vat, "19") }
        if (key === "factor") return { ...line, factor: clampStrictPositiveString(line.factor, "1") }
        if (key === "sgrValue") return { ...line, sgrValue: clampPositiveString(line.sgrValue, "0.50") }

        return line
      })
    )
  }

  function normalizeDraftLineValue(key: keyof NirLine) {
    setLineDraft((prev) => {
      if (!prev) return prev
      if (key === "qty") return { ...prev, qty: clampPositiveString(prev.qty, "1") }
      if (key === "price") return { ...prev, price: clampPositiveString(prev.price, "0") }
      if (key === "vat") return { ...prev, vat: clampPositiveString(prev.vat, "19") }
      if (key === "factor") return { ...prev, factor: clampStrictPositiveString(prev.factor, "1") }
      if (key === "sgrValue") return { ...prev, sgrValue: clampPositiveString(prev.sgrValue, "0.50") }
      return prev
    })
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()])
    setTimeout(() => {
      const fields = Array.from(
        document.querySelectorAll<HTMLElement>("[data-grid-field='nir']")
      )
      const last = fields[fields.length - 6]
      last?.focus()
    }, 0)
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.id !== id)
      return next.length ? next : [makeLine()]
    })
  }

  function productMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []

    return ensureArray(products)
      .filter((p: AnyObj) => {
        const name = String(p?.name || "").toLowerCase()
        const sku = String(p?.sku || "").toLowerCase()
        return name.includes(q) || sku.includes(q)
      })
      .slice(0, 8)
  }

  function supplierMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []

    return ensureArray(suppliers)
      .filter((s: AnyObj) => {
        const name = String(s?.name || "").toLowerCase()
        const code = String(s?.code || "").toLowerCase()
        const cif = String(s?.cif || "").toLowerCase()
        return name.includes(q) || code.includes(q) || cif.includes(q)
      })
      .slice(0, 8)
  }

  function chooseProduct(lineId: string, product: AnyObj) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line
        return applyProductSelection(line, product)
      })
    )
  }

  function chooseSupplier(supplier: AnyObj) {
    setHeader((prev) => ({
      ...prev,
      supplierId: supplier.id,
      supplierName: supplier.name || "",
      supplierCode: supplier.code || "",
    }))
    setSupplierSearch(supplier.name || "")
    setSupplierChosen(true)
    setQuickSupplierOpen(false)
    setQuickSupplierError("")
  }

  function toggleFactorMode(line: NirLine) {
    if (!line.productId) return

    if (line.autoFactor) {
      setLineValue(line.id, { autoFactor: false })
      return
    }

    const product = products.find((p: AnyObj) => p.id === line.productId)
    const productFactor = Math.max(0.000001, toNumberSafe(product?.purchaseFactor || 1))

    setLineValue(line.id, {
      autoFactor: true,
      factor: String(productFactor),
    })
  }

  function openLineEditor(line?: NirLine) {
    setLineEditorMode(line ? "edit" : "create")
    setLineDraft(line ? { ...line } : makeLine())
    setLineEditorError("")
    setLineEditorOpen(true)
  }

  function closeLineEditor() {
    setLineEditorOpen(false)
    setLineDraft(null)
    setLineEditorError("")
  }

  function toggleDraftFactorMode() {
    if (!lineDraft?.productId) return

    if (lineDraft.autoFactor) {
      setDraftLineValue({ autoFactor: false })
      return
    }

    const product = products.find((p: AnyObj) => p.id === lineDraft.productId)
    const productFactor = Math.max(0.000001, toNumberSafe(product?.purchaseFactor || 1))
    setDraftLineValue({
      autoFactor: true,
      factor: String(productFactor),
    })
  }

  function chooseProductInDraft(product: AnyObj) {
    setLineDraft((prev) => (prev ? applyProductSelection(prev, product) : prev))
    setLineEditorError("")
  }

  function saveLineDraft() {
    if (!lineDraft) return
    if (!lineDraft.productId) {
      setLineEditorError("Selecteaza un produs din lista inainte sa salvezi linia.")
      return
    }

    const normalized: NirLine = {
      ...lineDraft,
      qty: clampPositiveString(lineDraft.qty, "1"),
      price: clampPositiveString(lineDraft.price, "0"),
      vat: clampPositiveString(lineDraft.vat, "19"),
      factor: clampStrictPositiveString(lineDraft.factor, "1"),
      sgrValue: clampPositiveString(lineDraft.sgrValue, "0.50"),
    }

    setLines((prev) => {
      if (lineEditorMode === "edit") {
        return prev.map((line) => (line.id === normalized.id ? normalized : line))
      }
      if (prev.length === 1 && !prev[0].productId && !prev[0].search.trim()) {
        return [normalized]
      }
      return [...prev, normalized]
    })

    closeLineEditor()
  }

  function openQuickProduct(line: NirLine) {
    const defaultUom = uoms.find((u: AnyObj) => u.isActive !== false) || uoms[0]
    const defaultVat =
      vatRates.find((v: AnyObj) => Number(v.rate) === 19 && v.isActive !== false) ||
      vatRates.find((v: AnyObj) => v.isActive !== false) ||
      vatRates[0]

    setQuickProductLineId(line.id)
    setQuickProductOpen(true)
    setQuickProductError("")
    setQuickProductForm({
      name: line.search.trim(),
      uomId: defaultUom?.id || "",
      purchaseUomId: defaultUom?.id || "",
      purchaseFactor: "1",
      vatRateId: defaultVat?.id || "",
      price: "0",
      isSgr: false,
    })
  }

  function closeQuickProduct() {
    setQuickProductOpen(false)
    setQuickProductLineId("")
    setQuickProductLoading(false)
    setQuickProductError("")
  }

  async function tryCreateProduct(url: string, payload: AnyObj) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function saveQuickProduct() {
    if (!quickProductForm.name.trim()) {
      setQuickProductError("Completeaza denumirea produsului.")
      return
    }

    if (!quickProductForm.uomId) {
      setQuickProductError("Selecteaza UM stoc.")
      return
    }

    if (!quickProductForm.purchaseUomId) {
      setQuickProductError("Selecteaza ambalaj.")
      return
    }

    if (!quickProductForm.vatRateId) {
      setQuickProductError("Selecteaza TVA.")
      return
    }

    setQuickProductLoading(true)
    setQuickProductError("")

    const payload = {
      name: quickProductForm.name.trim(),
      uomId: quickProductForm.uomId,
      purchaseUomId: quickProductForm.purchaseUomId,
      purchaseFactor: Math.max(0.000001, toNumberSafe(quickProductForm.purchaseFactor) || 1),
      vatRateId: quickProductForm.vatRateId,
      price: Math.max(0, toNumberSafe(quickProductForm.price)),
      isActive: true,
      isSgr: quickProductForm.isSgr,
    }

    try {
      let result = await tryCreateProduct(`${API_BASE}/api/v1/products`, payload)

      if (!result.res.ok) {
        result = await tryCreateProduct(`${API_BASE}/api/v1/meta/products`, payload)
      }

      if (result.res.status === 401) {
        setQuickProductError("Token expirat sau invalid.")
        setQuickProductLoading(false)
        return
      }

      const created =
        result.data?.item ||
        result.data?.product ||
        result.data?.data ||
        null

      if (!result.res.ok || !created) {
        const err =
          typeof result.data?.error === "string"
            ? result.data.error
            : "Nu am putut salva produsul."
        setQuickProductError(err)
        setQuickProductLoading(false)
        return
      }

      setProducts((prev) => [created, ...prev])
      if (lineDraft && lineDraft.id === quickProductLineId) {
        setLineDraft((prev) => (prev ? applyProductSelection(prev, created) : prev))
      } else {
        chooseProduct(quickProductLineId, created)
      }
      setQuickProductLoading(false)
      closeQuickProduct()
    } catch {
      setQuickProductError("Eroare la salvarea produsului.")
      setQuickProductLoading(false)
    }
  }

  function openQuickSupplierModal() {
    setQuickSupplierOpen(true)
    setQuickSupplierError("")
    setQuickSupplierForm({
      name: supplierSearch.trim(),
      code: getPreviewValue(numbering, "supplier"),
      cif: "",
      regNo: "",
      address: "",
      email: "",
      phone: "",
    })
  }

  function closeQuickSupplier() {
    setQuickSupplierOpen(false)
    setQuickSupplierLoading(false)
    setQuickSupplierError("")
  }

  async function tryCreateSupplier(url: string, payload: AnyObj) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function saveQuickSupplier() {
    if (!quickSupplierForm.name.trim()) {
      setQuickSupplierError("Completeaza numele furnizorului.")
      return
    }

    setQuickSupplierLoading(true)
    setQuickSupplierError("")

    const payload = {
      name: quickSupplierForm.name.trim(),
      code: quickSupplierForm.code.trim() || null,
      cif: quickSupplierForm.cif.trim() || null,
      regCom: quickSupplierForm.regNo.trim() || null,
      address: quickSupplierForm.address.trim() || null,
      email: quickSupplierForm.email.trim() || null,
      phone: quickSupplierForm.phone.trim() || null,
      isActive: true,
    }

    try {
      let result = await tryCreateSupplier(`${API_BASE}/api/v1/suppliers`, payload)

      if (!result.res.ok) {
        result = await tryCreateSupplier(`${API_BASE}/api/v1/meta/suppliers`, payload)
      }

      if (result.res.status === 401) {
        setQuickSupplierError("Token expirat sau invalid.")
        setQuickSupplierLoading(false)
        return
      }

      const created =
        result.data?.supplier ||
        result.data?.item ||
        result.data?.data ||
        null

      if (!result.res.ok || !created) {
        const err =
          typeof result.data?.error === "string"
            ? result.data.error
            : "Nu am putut salva furnizorul."
        setQuickSupplierError(err)
        setQuickSupplierLoading(false)
        return
      }

      setSuppliers((prev) => [created, ...prev])
      chooseSupplier(created)
      setQuickSupplierLoading(false)
    } catch {
      setQuickSupplierError("Eroare la salvarea furnizorului.")
      setQuickSupplierLoading(false)
    }
  }

  const validLines = useMemo(() => {
    return lines.filter((l) => l.productId && Math.max(0, toNumberSafe(l.qty)) > 0)
  }, [lines])

  const duplicateProductIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const line of validLines) {
      counts.set(line.productId, (counts.get(line.productId) || 0) + 1)
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([productId]) => productId)
    )
  }, [validLines])

  const totals = useMemo(() => {
    return validLines.reduce(
      (acc, line) => {
        const c = getLineComputed(line, header.fxRate)

        acc.stockQty += c.qtyBase
        acc.netFc += c.netFc
        acc.vatFc += c.vatFc
        acc.grossFc += c.grossFc
        acc.sgrFc += c.sgrFc
        acc.withSgrFc += c.withSgrFc
        acc.netRon += c.netRon
        acc.vatRon += c.vatRon
        acc.grossRon += c.grossRon
        acc.sgrRon += c.sgrRon
        acc.withSgrRon += c.withSgrRon

        return acc
      },
      {
        stockQty: 0,
        netFc: 0,
        vatFc: 0,
        grossFc: 0,
        sgrFc: 0,
        withSgrFc: 0,
        netRon: 0,
        vatRon: 0,
        grossRon: 0,
        sgrRon: 0,
        withSgrRon: 0,
      }
    )
  }, [validLines, header.fxRate])

  async function saveNir(postNow = false) {
    if (!token) {
      alert("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (isPosted) {
      alert("Documentul POSTED este doar pentru vizualizare si nu mai poate fi modificat.")
      return
    }

    if (!header.locationId) {
      alert("Selecteaza locatia.")
      return
    }

    if (!header.docNo.trim()) {
      alert("Completeaza numarul documentului.")
      return
    }

    if (!header.docDate) {
      alert("Completeaza data documentului.")
      return
    }

    if (!validLines.length) {
      alert("Adauga cel putin un produs.")
      return
    }

    const payload = {
      id: receiptId || null,
      header: {
        locationId: header.locationId,
        supplierId: header.supplierId || null,
        supplierName: header.supplierName || supplierSearch || "",
        supplierCode: header.supplierCode || "",
        docNo: header.docNo,
        docDate: header.docDate,
        currency: header.currency,
        fxRate: Math.max(0.000001, toNumberSafe(header.fxRate) || 1),
        note: header.note,
        sourceIncomingEInvoiceId: header.sourceIncomingEInvoiceId || null,
        spvDownloadId: header.spvDownloadId || null,
        spvUploadIndex: header.spvUploadIndex || null,
        spvInvoiceNo: header.spvInvoiceNo || header.docNo,
      },
      items: validLines.map((l) => ({
        productId: l.productId,
        uomId: l.uomId || null,
        qty: Math.max(0, toNumberSafe(l.qty)),
        conversionFactor: Math.max(0.000001, toNumberSafe(l.factor) || 1),
        unitCostNetFc: Math.max(0, toNumberSafe(l.price)),
        vatRateValue: Math.max(0, toNumberSafe(l.vat)),
      })),
      postNow,
    }

    setSaving(true)

    try {
      const res = await fetch(`${API_BASE}/api/v1/purchase-receipts/full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      setSaving(false)

      if (res.status === 401) {
        alert("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok) {
        alert(data.error || "Eroare la salvarea NIR")
        return
      }

      if (!receiptId && data.receipt?.id) {
        window.location.href = `/inregistrare-document/nir/edit?id=${data.receipt.id}`
        return
      }

      setStatus(data.receipt?.status || (postNow ? "POSTED" : "DRAFT"))
      alert(postNow ? "NIR salvat si postat in stoc." : "NIR finalizat si salvat in documente.")

      if (receiptId) {
        await loadReceipt(receiptId)
      }
    } catch {
      setSaving(false)
      alert("Eroare la salvarea NIR")
    }
  }

  function handlePrint() {
    if (!receiptId) {
      alert("Salveaza documentul inainte.")
      return
    }

    window.open(
      `/inregistrare-document/nir/print?id=${receiptId}&mode=print`,
      "_blank",
      "width=1200,height=900"
    )
  }

  async function exportPdf() {
    if (!receiptId) {
      alert("Salveaza documentul inainte de export.")
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/purchase-receipts/${receiptId}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        alert("Nu pot genera PDF.")
        return
      }

      const supplier = (header.supplierName || supplierSearch || "Furnizor")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_.]/g, "")

      const docNo = (header.docNo || "document")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_.]/g, "")

      await downloadPdfFile(res, `NIR_${docNo}_${supplier}.pdf`)
    } catch (err) {
      console.error(err)
      alert("Eroare PDF")
    }
  }

  const matchedSuppliers = supplierMatches(supplierSearch)
  const isPosted = status === "POSTED"
  const pageTitle = !receiptId
    ? "NIR nou"
    : isPosted
      ? "Vizualizare NIR"
      : "Editare NIR"

  const uniqueProductsCount = new Set(validLines.map((x) => x.productId)).size
  const visibleLines =
    isMobileViewport && lines.length === 1 && !lines[0].productId && !lines[0].search.trim()
      ? []
      : lines
  const hasSgr = totals.sgrFc > 0 || lines.some((line) => line.isSgr)
  const documentPanels = [
    {
      id: "header" as const,
      title: "Date document",
    },
    {
      id: "lines" as const,
      title: "Produse",
    },
    {
      id: "summary" as const,
      title: "Verificare",
    },
  ]

  return (
    <div style={pageWrap}>
      <div className="no-print">
        <DocumentPageHeader
          title={pageTitle}
          actions={
            <>
              <button type="button" onClick={() => navigate(receiptId ? "/documente?tab=receipt" : "/inregistrare-document")} className={documentButtonSecondaryClass}>
                <ArrowLeft size={16} className="mr-2" />
                Inapoi
              </button>
              <button type="button" onClick={handlePrint} disabled={!receiptId || loadingReceipt} className={documentButtonSecondaryClass}>
                <Printer size={16} className="mr-2" />
                Print
              </button>
              <button type="button" onClick={exportPdf} disabled={!receiptId || loadingReceipt} className={documentButtonSecondaryClass}>
                <FileOutput size={16} className="mr-2" />
                PDF
              </button>
              {!isPosted && (
                <button type="button" onClick={() => saveNir(false)} disabled={saving || loadingReceipt} className={documentButtonPrimaryClass}>
                  {saving ? "Se salveaza..." : "Finalizeaza"}
                </button>
              )}
            </>
          }
        />
      </div>

      {status && (
        <div style={{ marginBottom: 14 }}>
          <StatusBadge status={status} />
        </div>
      )}

      {isPosted && (
          <div style={infoBox}>
            Documentul este POSTED si este blocat la editare. Poti doar sa il vizualizezi, sa il printezi sau sa generezi PDF.
          </div>
      )}

      {(authError || loadError) && <div style={errorBox}>{authError || loadError}</div>}

      {loadingReceipt ? (
        <div style={infoBox}>Se incarca documentul...</div>
      ) : (
        <div style={documentWorkspace}>
          <div className="no-print">
            <DocumentTabs items={documentPanels} activeId={activePanel} onChange={setActivePanel} />
          </div>

          <div style={documentPanelBody}>
          {activePanel === "header" && (
          <Section title="Date document">
            {isMobileViewport ? (
              <div style={mobileHeaderStack}>
                <div style={mobileHeaderHeroCard}>
                  <div style={mobileHeaderHeroLabel}>Furnizor</div>
                  <Field label="">
                    <input
                      type="text"
                      placeholder="Scrie primele 2-3 litere..."
                      value={supplierSearch}
                      onChange={(e) => {
                        const value = e.target.value
                        setSupplierSearch(value)
                        setSupplierChosen(false)
                        setQuickSupplierOpen(false)
                        setQuickSupplierError("")
                        setHeader((prev) => ({
                          ...prev,
                          supplierId: "",
                          supplierName: value,
                          supplierCode: "",
                        }))
                      }}
                      style={input}
                      disabled={isPosted}
                    />

                    {supplierSearch.trim().length >= 2 && !supplierChosen && !isPosted && (
                      <div style={inlineUnderField}>
                        {matchedSuppliers.length > 0 ? (
                          <div style={resultsBox}>
                            {matchedSuppliers.map((s: AnyObj) => (
                              <button
                                key={s.id}
                                type="button"
                                style={resultBtn}
                                onClick={() => chooseSupplier(s)}
                              >
                                <div style={{ fontWeight: 600 }}>{s.name}</div>
                                <div style={{ fontSize: 12, color: "#666" }}>
                                  {s.code || "-"} · CIF {s.cif || "-"}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div style={inlineActionBox}>
                            <div style={{ color: "#991b1b", fontSize: 13 }}>
                              Nu exista furnizori gasiti pentru "{supplierSearch}"
                            </div>

                            <button
                              type="button"
                              style={btnSecondary}
                              onClick={openQuickSupplierModal}
                            >
                              Adauga furnizor nou
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </Field>
                </div>

                <div style={mobileHeaderCardGrid}>
                  <Field label="Locatie">
                    <select
                      value={header.locationId}
                      onChange={(e) => {
                        const nextLocationId = e.target.value
                        setHeader({ ...header, locationId: nextLocationId })
                        setActiveLocationId(nextLocationId)
                      }}
                      style={input}
                      disabled={isPosted}
                    >
                      <option value="">Selecteaza locatia</option>
                      {ensureArray(locations).map((l: AnyObj) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Nr. document">
                    <input
                      value={header.docNo}
                      onChange={(e) => setHeader({ ...header, docNo: e.target.value })}
                      style={input}
                      disabled={isPosted}
                    />
                  </Field>

                  <Field label="Data document">
                    <input
                      type="date"
                      value={header.docDate}
                      onChange={(e) => setHeader({ ...header, docDate: e.target.value })}
                      style={input}
                      disabled={isPosted}
                    />
                  </Field>

                  <Field label="Moneda">
                    <select
                      value={header.currency}
                      onChange={(e) => {
                        const value = e.target.value
                        setHeader({
                          ...header,
                          currency: value,
                          fxRate: value === "RON" ? "1" : header.fxRate,
                        })
                      }}
                      style={input}
                      disabled={isPosted}
                    >
                      <option value="RON">RON</option>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="HUF">HUF</option>
                    </select>
                  </Field>

                  {header.currency !== "RON" ? (
                    <Field label="Curs">
                      <input
                        type="text"
                        value={header.fxRate}
                        onChange={(e) => setHeader({ ...header, fxRate: e.target.value })}
                        onBlur={() =>
                          setHeader((prev) => ({
                            ...prev,
                            fxRate:
                              prev.currency === "RON"
                                ? "1"
                                : clampStrictPositiveString(prev.fxRate, "1"),
                          }))
                        }
                        style={input}
                        disabled={isPosted}
                      />
                    </Field>
                  ) : null}

                  <Field label="Cod furnizor">
                    <input
                      value={header.supplierCode}
                      readOnly
                      style={{ ...input, background: "#f8fafc" }}
                    />
                  </Field>

                  <Field label="Observatii">
                    <input
                      value={header.note}
                      onChange={(e) => setHeader({ ...header, note: e.target.value })}
                      style={input}
                      disabled={isPosted}
                    />
                  </Field>
                </div>
              </div>
            ) : null}
            <div style={isMobileViewport ? { display: "none" } : headerGrid}>
              <div>
                <Field label="Locatie">
                <select
                  value={header.locationId}
                  onChange={(e) => {
                    const nextLocationId = e.target.value
                    setHeader({ ...header, locationId: nextLocationId })
                    setActiveLocationId(nextLocationId)
                  }}
                  style={input}
                  disabled={isPosted}
                >
                  <option value="">Selecteaza locatia</option>
                  {ensureArray(locations).map((l: AnyObj) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                </Field>
              </div>

              <Field label="Nr. document">
                <input
                  value={header.docNo}
                  onChange={(e) => setHeader({ ...header, docNo: e.target.value })}
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <Field label="Data document">
                <input
                  type="date"
                  value={header.docDate}
                  onChange={(e) => setHeader({ ...header, docDate: e.target.value })}
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <div>
                <Field label="Furnizor">
                <input
                  type="text"
                  placeholder="Scrie primele 2-3 litere..."
                  value={supplierSearch}
                  onChange={(e) => {
                    const value = e.target.value
                    setSupplierSearch(value)
                    setSupplierChosen(false)
                    setQuickSupplierOpen(false)
                    setQuickSupplierError("")
                    setHeader((prev) => ({
                      ...prev,
                      supplierId: "",
                      supplierName: value,
                      supplierCode: "",
                    }))
                  }}
                  style={input}
                  disabled={isPosted}
                />

                {supplierSearch.trim().length >= 2 && !supplierChosen && !isPosted && (
                  <div style={inlineUnderField}>
                    {matchedSuppliers.length > 0 ? (
                      <div style={resultsBox}>
                        {matchedSuppliers.map((s: AnyObj) => (
                          <button
                            key={s.id}
                            type="button"
                            style={resultBtn}
                            onClick={() => chooseSupplier(s)}
                          >
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                            <div style={{ fontSize: 12, color: "#666" }}>
                              {s.code || "-"} · CIF {s.cif || "-"}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={inlineActionBox}>
                        <div style={{ color: "#991b1b", fontSize: 13 }}>
                          Nu exista furnizori gasiti pentru "{supplierSearch}"
                        </div>

                        <button
                          type="button"
                          style={btnSecondary}
                          onClick={openQuickSupplierModal}
                        >
                          Adauga furnizor nou
                        </button>
                      </div>
                    )}
                  </div>
                )}
                </Field>
              </div>

              <Field label="Cod furnizor">
                <input
                  value={header.supplierCode}
                  readOnly
                  style={{ ...input, background: "#f8fafc" }}
                />
              </Field>

              <Field label="Moneda">
                <select
                  value={header.currency}
                  onChange={(e) => {
                    const value = e.target.value
                    setHeader({
                      ...header,
                      currency: value,
                      fxRate: value === "RON" ? "1" : header.fxRate,
                    })
                  }}
                  style={input}
                  disabled={isPosted}
                >
                  <option value="RON">RON</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="HUF">HUF</option>
                </select>
              </Field>

              <Field label="Curs">
                <input
                  type="text"
                  value={header.fxRate}
                  onChange={(e) => setHeader({ ...header, fxRate: e.target.value })}
                  onBlur={() =>
                    setHeader((prev) => ({
                      ...prev,
                      fxRate:
                        prev.currency === "RON"
                          ? "1"
                          : clampStrictPositiveString(prev.fxRate, "1"),
                    }))
                  }
                  style={input}
                  disabled={header.currency === "RON" || isPosted}
                />
              </Field>

              <Field label="Observatii">
                <input
                  value={header.note}
                  onChange={(e) => setHeader({ ...header, note: e.target.value })}
                  style={input}
                  disabled={isPosted}
                />
              </Field>
            </div>
          </Section>
          )}

          {activePanel === "summary" && (
          <Section title="Verificare document">
            <div style={totalsGrid}>
              <Card title="Linii document" value={String(lines.length)} />
              <Card title="Produse valide" value={String(uniqueProductsCount)} />
              <Card title="Cantitate reala" value={`${formatNumber(totals.stockQty)} buc`} />
              <Card
                title={hasSgr ? `Total cu SGR ${header.currency}` : `Total ${header.currency}`}
                value={`${formatNumber(totals.withSgrFc)} ${header.currency}`}
              />
            </div>

            {duplicateProductIds.size > 0 && (
              <div style={{ ...warningBox, marginTop: 16 }}>
                Ai produse duplicate pe mai multe linii. Nu blochez salvarea, dar verifica sa nu dublezi receptia din greseala.
              </div>
            )}
          </Section>
          )}

          {activePanel === "lines" && (
          <Section title="Produse receptionate">
            <div style={linesTotalBar}>
              <Card title="Linii" value={String(lines.length)} />
              <Card title={`Net ${header.currency}`} value={`${formatNumber(totals.netFc)} ${header.currency}`} />
              <Card title={`TVA ${header.currency}`} value={`${formatNumber(totals.vatFc)} ${header.currency}`} />
              {hasSgr ? <Card title={`SGR ${header.currency}`} value={`${formatNumber(totals.sgrFc)} ${header.currency}`} /> : null}
              <Card title={`Total ${header.currency}`} value={`${formatNumber(totals.withSgrFc)} ${header.currency}`} />
            </div>

            <div style={toolbarRow}>
              <div>
                <div style={toolbarTitle}>Produse</div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={miniStatPill}>
                  {visibleLines.length} {visibleLines.length === 1 ? "linie" : "linii"}
                </div>
                {!isPosted && (
                  <button
                    style={btnPrimary}
                    onClick={() => (isMobileViewport ? openLineEditor() : addLine())}
                    disabled={loadingMeta}
                  >
                    + Adauga linie
                  </button>
                )}
              </div>
            </div>

            <div style={isMobileViewport ? { ...rowsHeader, display: "none" } : rowsHeader}>
              <div>Produs</div>
              <div>Ambalaj</div>
              <div>Cant.</div>
              <div>Pret/buc</div>
              <div>TVA</div>
              <div>Cant./ambalaj</div>
              <div>Total</div>
              <div></div>
            </div>

            <div style={isMobileViewport ? { ...linesViewport, ...linesViewportMobile } : linesViewport}>
              <div style={rowsStack}>
                {visibleLines.map((line) => {
                  const matches = productMatches(line.search)
                  const canAddQuickProduct =
                    !isPosted &&
                    line.search.trim().length >= 2 &&
                    !line.productId &&
                    matches.length === 0 &&
                    uoms.length > 0 &&
                    vatRates.length > 0

                  const computed = getLineComputed(line, header.fxRate)
                  const isDuplicate = Boolean(line.productId && duplicateProductIds.has(line.productId))

                  return (
                    <div
                      key={line.id}
                      style={{
                        ...rowCard,
                        border: isDuplicate ? "1px solid #fbbf24" : rowCard.border,
                        background: isDuplicate ? "#fffdf5" : rowCard.background,
                      }}
                    >
                      {isMobileViewport ? (
                        <div style={mobileLineSummaryCard}>
                          <div style={mobileLineSummaryTop}>
                            <div style={{ minWidth: 0 }}>
                              <div style={mobileLineTitle}>{line.search.trim() || "Linie fara produs"}</div>
                              <div style={mobileLineMeta}>
                                Ambalaj {line.uomCode || "-"} · {line.autoFactor ? "factor auto" : "factor manual"}
                                {line.isSgr ? " · SGR" : ""}
                              </div>
                            </div>

                            <div style={mobileLineTotalBox}>
                              <div style={mobileLineTotalLabel}>Total</div>
                              <div style={mobileLineTotalValue}>{formatMoneyRo(computed.withSgrFc)}</div>
                            </div>
                          </div>

                          <div style={mobileLineFacts}>
                            <div style={mobileLineFact}><strong>Cant.</strong> {formatQtyRo(computed.qty)}</div>
                            <div style={mobileLineFact}><strong>Pret</strong> {formatMoneyRo(computed.price)}</div>
                            <div style={mobileLineFact}><strong>TVA</strong> {formatNumberRo(computed.vat, 0)}%</div>
                            <div style={mobileLineFact}><strong>Factor</strong> {formatFactorRo(computed.factor)}</div>
                          </div>

                          {isDuplicate && (
                            <div style={duplicateMeta}>Atentie: produsul apare si pe alta linie.</div>
                          )}

                          <div style={mobileLineActions}>
                            <button type="button" style={btnSecondary} onClick={() => openLineEditor(line)}>
                              Detalii
                            </button>
                            {!isPosted && (
                              <button type="button" style={btnDangerMobile} onClick={() => removeLine(line.id)}>
                                Sterge
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                      <>
                      <div
                        style={{
                          ...rowMain,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ ...productCell, minWidth: 0, ...(isMobileViewport ? mobileFullSpan : {}) }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Produs</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            placeholder="Produs..."
                            value={line.search}
                            onChange={(e) =>
                              setLineValue(line.id, {
                                search: e.target.value,
                                productId: "",
                              })
                            }
                            onKeyDown={focusNextField}
                            style={inputCompact}
                            disabled={isPosted}
                          />

                          {line.productId && (
                            <div style={selectedProductMeta}>
                              Selectat · ambalaj {line.uomCode || "-"} {line.isSgr ? "· SGR" : ""}
                              {line.autoFactor ? " · factor auto" : " · factor manual"}
                            </div>
                          )}

                          {isDuplicate && (
                            <div style={duplicateMeta}>
                              Atentie: produsul apare si pe alta linie.
                            </div>
                          )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Ambalaj</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            value={line.uomCode}
                            readOnly
                            style={inputCompactReadOnly}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Cantitate</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            value={line.qty}
                            onChange={(e) => setLineValue(line.id, { qty: e.target.value })}
                            onBlur={() => normalizeLineValue(line.id, "qty")}
                            onKeyDown={focusNextField}
                            style={inputCompact}
                            disabled={isPosted}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Pret/buc</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            value={line.price}
                            onChange={(e) => setLineValue(line.id, { price: e.target.value })}
                            onBlur={() => normalizeLineValue(line.id, "price")}
                            onKeyDown={focusNextField}
                            style={inputCompact}
                            disabled={isPosted}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          {isMobileViewport && <div style={mobileGridLabel}>TVA</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            value={line.vat}
                            onChange={(e) => setLineValue(line.id, { vat: e.target.value })}
                            onBlur={() => normalizeLineValue(line.id, "vat")}
                            onKeyDown={focusNextField}
                            style={inputCompact}
                            disabled={isPosted}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Cant./ambalaj</div>}
                          <input
                            data-grid-field="nir"
                            type="text"
                            value={line.factor}
                            onChange={(e) => setLineValue(line.id, { factor: e.target.value })}
                            onBlur={() => normalizeLineValue(line.id, "factor")}
                            onKeyDown={focusNextField}
                            style={{
                              ...inputCompact,
                              background:
                                line.productId && line.autoFactor ? "#f8fafc" : "#fff",
                              color:
                                line.productId && line.autoFactor ? "#64748b" : "#0f172a",
                            }}
                            disabled={isPosted || Boolean(line.productId && line.autoFactor)}
                          />
                        </div>

                        <div style={{ minWidth: 0, ...(isMobileViewport ? mobileFullSpan : {}) }}>
                          {isMobileViewport && <div style={mobileGridLabel}>Total</div>}
                          <div style={totalCell}>
                          <div style={totalValue}>{formatMoneyRo(computed.withSgrFc)}</div>
                          <div style={totalMeta}>
                            {computed.qty.toFixed(2)} amb × {computed.factor.toFixed(2)} ={" "}
                            {computed.qtyBase.toFixed(2)} buc
                          </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            justifyContent: "flex-end",
                            minWidth: 0,
                            ...(isMobileViewport ? mobileFullSpan : {}),
                          }}
                        >
                          {isMobileViewport && <div style={mobileGridLabel}>Actiuni</div>}
                          {!isPosted && (
                            <button
                              style={
                                isMobileViewport
                                  ? { ...btnDangerIcon, width: "100%" }
                                  : btnDangerIcon
                              }
                              onClick={() => removeLine(line.id)}
                            >
                              aœ•
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={rowExtra}>
                        {line.productId && (
                          <div style={lineInsightGrid}>
                            <div style={insightChip}>
                              <strong>Relatie:</strong> {computed.qty.toFixed(2)} amb ×{" "}
                              {computed.factor.toFixed(2)} = {computed.qtyBase.toFixed(2)} buc
                            </div>

                            <div style={insightChip}>
                              <strong>Net:</strong> {computed.netFc.toFixed(2)} {header.currency}
                            </div>

                            <div style={insightChip}>
                              <strong>TVA:</strong> {computed.vatFc.toFixed(2)} {header.currency}
                            </div>

                            {line.isSgr && (
                              <div style={sgrInlineBox}>
                                <span style={sgrBadge}>SGR</span>
                                <span>
                                  {computed.qtyBase.toFixed(2)} buc × {computed.sgrUnit.toFixed(2)} ={" "}
                                  {computed.sgrFc.toFixed(2)}
                                </span>
                              </div>
                            )}

                            {!isPosted && (
                              <button
                                type="button"
                                style={line.autoFactor ? btnSoftAuto : btnSoftManual}
                                onClick={() => toggleFactorMode(line)}
                              >
                                Factor: {line.autoFactor ? "Auto" : "Manual"}
                              </button>
                            )}
                          </div>
                        )}

                        {line.search.trim().length >= 2 && !line.productId && !isPosted && (
                          <>
                            {matches.length > 0 ? (
                              <div style={quickResultsGrid}>
                                {matches.map((p: AnyObj) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    style={resultBtnCompact}
                                    onClick={() => chooseProduct(line.id, p)}
                                  >
                                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: "#64748b" }}>
                                      {p.sku || "-"} - Ambalaj {formatUomOption(p.purchaseUom || p.uom)} - TVA {p.vatRate?.rate ?? "-"}%
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div style={quickAddWrap}>
                                <div style={{ color: "#991b1b", fontSize: 13 }}>
                                  Nu exista produse gasite pentru "{line.search}"
                                </div>

                                {canAddQuickProduct && (
                                  <button
                                    type="button"
                                    style={btnSecondary}
                                    onClick={() => openQuickProduct(line)}
                                  >
                                    Adauga produs nou
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      </>
                      )}
                    </div>
                  )
                })}
                {visibleLines.length === 0 && (
                  <div style={emptyMobileLinesBox}>
                    Nu ai inca nicio linie salvata. Apasa `Adauga linie` si completeaza produsul in popup.
                  </div>
                )}
              </div>
            </div>

            {!isPosted && !isMobileViewport && (
              <div style={{ display: "flex", justifyContent: "center", borderTop: "1px dashed #e2e8f0", paddingTop: 12, marginTop: 12 }}>
                <button
                  style={btnPrimary}
                  onClick={() => addLine()}
                  disabled={loadingMeta}
                >
                  + Adauga linie
                </button>
              </div>
            )}
          </Section>
          )}

          {activePanel === "summary" && (
          <Section title="Totaluri finale">
            <div style={totalsGrid}>
              <Card title={`Net ${header.currency}`} value={`${formatNumber(totals.netFc)} ${header.currency}`} />
              <Card title={`TVA ${header.currency}`} value={`${formatNumber(totals.vatFc)} ${header.currency}`} />
              {hasSgr ? <Card title={`SGR ${header.currency}`} value={`${formatNumber(totals.sgrFc)} ${header.currency}`} /> : null}
              {hasSgr ? <Card title={`Total fara SGR ${header.currency}`} value={`${formatNumber(totals.grossFc)} ${header.currency}`} /> : null}
              <Card title={hasSgr ? `Total cu SGR ${header.currency}` : `Total ${header.currency}`} value={`${formatNumber(totals.withSgrFc)} ${header.currency}`} />
              {header.currency !== "RON" && (
                <>
                  <Card title="Total RON fara SGR" value={`${formatNumber(totals.grossRon)} RON`} />
                  {hasSgr ? <Card title="SGR RON" value={`${formatNumber(totals.sgrRon)} RON`} /> : null}
                  <Card title="Total RON cu SGR" value={`${formatNumber(totals.withSgrRon)} RON`} />
                </>
              )}
            </div>
          </Section>
          )}
          </div>
        </div>
      )}

      {lineEditorOpen && lineDraft && (
        <div style={modalOverlay}>
          <div style={{ ...modalCard, maxWidth: 720 }}>
            <div style={modalHeader}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {lineEditorMode === "create" ? "Adauga linie produs" : "Detalii linie produs"}
                </h3>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                  Completezi produsul in popup, apoi in pagina ramane doar rezumatul curat al liniei.
                </div>
              </div>

              <button type="button" onClick={closeLineEditor} style={btnSecondary}>
                Inchide
              </button>
            </div>

            {lineEditorError && <div style={{ ...errorBox, marginTop: 14 }}>{lineEditorError}</div>}

            <div style={{ ...headerGrid, marginTop: 16 }}>
              <Field label="Produs">
                <input
                  type="text"
                  placeholder="Cauta produs..."
                  value={lineDraft.search}
                  onChange={(e) =>
                    setDraftLineValue({
                      search: e.target.value,
                      productId: "",
                    })
                  }
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <Field label="Ambalaj">
                <input value={lineDraft.uomCode} readOnly style={{ ...input, background: "#f8fafc" }} />
              </Field>

              <Field label="Cantitate">
                <input
                  type="text"
                  value={lineDraft.qty}
                  onChange={(e) => setDraftLineValue({ qty: e.target.value })}
                  onBlur={() => normalizeDraftLineValue("qty")}
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <Field label="Pret / bucata">
                <input
                  type="text"
                  value={lineDraft.price}
                  onChange={(e) => setDraftLineValue({ price: e.target.value })}
                  onBlur={() => normalizeDraftLineValue("price")}
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <Field label="TVA">
                <input
                  type="text"
                  value={lineDraft.vat}
                  onChange={(e) => setDraftLineValue({ vat: e.target.value })}
                  onBlur={() => normalizeDraftLineValue("vat")}
                  style={input}
                  disabled={isPosted}
                />
              </Field>

              <Field label="Cant. / ambalaj">
                <input
                  type="text"
                  value={lineDraft.factor}
                  onChange={(e) => setDraftLineValue({ factor: e.target.value })}
                  onBlur={() => normalizeDraftLineValue("factor")}
                  style={{
                    ...input,
                    background: lineDraft.productId && lineDraft.autoFactor ? "#f8fafc" : "#fff",
                    color: lineDraft.productId && lineDraft.autoFactor ? "#64748b" : "#0f172a",
                  }}
                  disabled={isPosted || Boolean(lineDraft.productId && lineDraft.autoFactor)}
                />
              </Field>
            </div>

            <div style={{ ...rowExtra, marginTop: 14 }}>
              <div style={totalCell}>
                <div style={totalValue}>
                  {formatMoneyRo(getLineComputed(lineDraft, header.fxRate).withSgrFc)}
                </div>
                <div style={totalMeta}>
                  {formatQtyRo(getLineComputed(lineDraft, header.fxRate).qty)} amb ×{" "}
                  {formatFactorRo(getLineComputed(lineDraft, header.fxRate).factor)} ={" "}
                  {formatQtyRo(getLineComputed(lineDraft, header.fxRate).qtyBase)} buc
                </div>
              </div>

              {lineDraft.productId && (
                <div style={lineInsightGrid}>
                  {lineDraft.isSgr && (
                    <div style={sgrInlineBox}>
                      <span style={sgrBadge}>SGR</span>
                      <span>Produsul are garantie returnabila activa.</span>
                    </div>
                  )}
                  {!isPosted && (
                    <button
                      type="button"
                      style={lineDraft.autoFactor ? btnSoftAuto : btnSoftManual}
                      onClick={toggleDraftFactorMode}
                    >
                      Factor: {lineDraft.autoFactor ? "Auto" : "Manual"}
                    </button>
                  )}
                </div>
              )}

              {lineDraft.search.trim().length >= 2 && !lineDraft.productId && !isPosted && (
                <>
                  {productMatches(lineDraft.search).length > 0 ? (
                    <div style={quickResultsGrid}>
                      {productMatches(lineDraft.search).map((p: AnyObj) => (
                        <button
                          key={p.id}
                          type="button"
                          style={resultBtnCompact}
                          onClick={() => chooseProductInDraft(p)}
                        >
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {p.sku || "-"} - Ambalaj {formatUomOption(p.purchaseUom || p.uom)} - TVA {p.vatRate?.rate ?? "-"}%
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={quickAddWrap}>
                      <div style={{ color: "#991b1b", fontSize: 13 }}>
                        Nu exista produse gasite pentru "{lineDraft.search}"
                      </div>

                      {!isPosted && uoms.length > 0 && vatRates.length > 0 && (
                        <button type="button" style={btnSecondary} onClick={() => openQuickProduct(lineDraft)}>
                          Adauga produs nou
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={modalActions}>
              <button type="button" style={btnSecondary} onClick={closeLineEditor}>
                Renunta
              </button>
              {!isPosted && (
                <button type="button" style={btnPrimary} onClick={saveLineDraft}>
                  Salveaza linia
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {quickProductOpen && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={modalHeader}>
              <div>
                <h3 style={{ margin: 0 }}>Adauga produs nou</h3>
                <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
                  Produsul se salveaza in nomenclator si se selecteaza automat in linia curenta.
                </div>
              </div>

              <button type="button" onClick={closeQuickProduct} style={btnSecondary}>
                Inchide
              </button>
            </div>

            {quickProductError && <div style={{ ...errorBox, marginTop: 14 }}>{quickProductError}</div>}

            <div style={{ ...headerGrid, marginTop: 16 }}>
              <Field label="Denumire produs">
                <input
                  value={quickProductForm.name}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="UM stoc">
                <select
                  value={quickProductForm.uomId}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({ ...prev, uomId: e.target.value }))
                  }
                  style={input}
                >
                  <option value="">Selecteaza UM</option>
                  {uoms.map((u: AnyObj) => (
                    <option key={u.id} value={u.id}>
                      {formatUomOption(u)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Ambalaj">
                <select
                  value={quickProductForm.purchaseUomId}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      purchaseUomId: e.target.value,
                    }))
                  }
                  style={input}
                >
                  <option value="">Selecteaza ambalaj</option>
                  {uoms.map((u: AnyObj) => (
                    <option key={u.id} value={u.id}>
                      {formatUomOption(u)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Cantitate pe ambalaj">
                <input
                  value={quickProductForm.purchaseFactor}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      purchaseFactor: e.target.value,
                    }))
                  }
                  onBlur={() =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      purchaseFactor: clampStrictPositiveString(prev.purchaseFactor, "1"),
                    }))
                  }
                  style={input}
                />
              </Field>

              <Field label="TVA">
                <select
                  value={quickProductForm.vatRateId}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      vatRateId: e.target.value,
                    }))
                  }
                  style={input}
                >
                  <option value="">Selecteaza TVA</option>
                  {vatRates.map((v: AnyObj) => (
                    <option key={v.id} value={v.id}>
                      {v.name} - {v.rate}%
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Pret implicit">
                <input
                  value={quickProductForm.price}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      price: e.target.value,
                    }))
                  }
                  onBlur={() =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      price: clampPositiveString(prev.price, "0"),
                    }))
                  }
                  style={input}
                />
              </Field>

              <Field label="SGR">
                <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42 }}>
                  <input
                    type="checkbox"
                    checked={quickProductForm.isSgr}
                    onChange={(e) =>
                      setQuickProductForm((prev) => ({
                        ...prev,
                        isSgr: e.target.checked,
                      }))
                    }
                  />
                  <span>Produs cu SGR 0.50 fara TVA</span>
                </label>
              </Field>
            </div>

            <div style={modalActions}>
              <button type="button" onClick={closeQuickProduct} style={btnSecondary}>
                Renunta
              </button>
              <button
                type="button"
                onClick={saveQuickProduct}
                style={btnPrimary}
                disabled={quickProductLoading}
              >
                {quickProductLoading ? "Se salveaza..." : "Salveaza produs"}
              </button>
            </div>
          </div>
        </div>
      )}

      {quickSupplierOpen && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={modalHeader}>
              <div>
                <h3 style={{ margin: 0 }}>Adauga furnizor nou</h3>
                <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
                  Furnizorul se salveaza si se selecteaza automat in antet.
                </div>
              </div>

              <button type="button" onClick={closeQuickSupplier} style={btnSecondary}>
                Inchide
              </button>
            </div>

            {quickSupplierError && <div style={{ ...errorBox, marginTop: 14 }}>{quickSupplierError}</div>}

            <div style={{ ...headerGrid, marginTop: 16 }}>
              <Field label="Nume">
                <input
                  value={quickSupplierForm.name}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Cod">
                <input
                  value={quickSupplierForm.code}
                  readOnly
                  style={inputCompactReadOnly}
                />
              </Field>

              <Field label="CIF">
                <input
                  value={quickSupplierForm.cif}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, cif: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Reg. comertului">
                <input
                  value={quickSupplierForm.regNo}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, regNo: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Adresa">
                <input
                  value={quickSupplierForm.address}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, address: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Email">
                <input
                  value={quickSupplierForm.email}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Telefon">
                <input
                  value={quickSupplierForm.phone}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  style={input}
                />
              </Field>
            </div>

            <div style={modalActions}>
              <button type="button" onClick={closeQuickSupplier} style={btnSecondary}>
                Renunta
              </button>
              <button
                type="button"
                onClick={saveQuickSupplier}
                style={btnPrimary}
                disabled={quickSupplierLoading}
              >
                {quickSupplierLoading ? "Se salveaza..." : "Salveaza furnizor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={sectionWrap}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={cardSmall}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "POSTED"
      ? { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }
      : status === "CANCELLED"
        ? { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }
        : { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }

  return (
    <span
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  )
}

const pageWrap: CSSProperties = {
  padding: 0,
}

const documentTopBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "12px 14px",
  marginBottom: 12,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const documentTopBadge: CSSProperties = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  color: "#475569",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.2,
}

const documentTopTitle: CSSProperties = {
  margin: "4px 0 0",
  color: "#17324d",
  fontSize: 22,
  lineHeight: 1.2,
  fontWeight: 700,
}

const documentTopActions: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
}

const documentTopActionsMobile: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  width: "100%",
}

const topActions: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  marginBottom: 10,
  gap: 8,
  flexWrap: "wrap",
}

const topActionsMobile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  marginBottom: 12,
  gap: 8,
}

const topActionsPrimaryMobile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
}

const topActionsCompactRowMobile: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
}

const headerGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 8,
}

const mobileHeaderStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
}

const mobileHeaderHeroCard: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
}

const mobileHeaderHeroLabel: CSSProperties = {
  marginBottom: 8,
  fontSize: 11,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.4,
}

const mobileHeaderCardGrid: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
}

const documentWorkspace: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
}

const documentWorkspaceMobile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
}

const documentTabs: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  padding: 8,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const documentTab: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "#334155",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 800,
}

const documentTabActive: CSSProperties = {
  ...documentTab,
  border: "1px solid #17324d",
  background: "#17324d",
  color: "#fff",
  boxShadow: "0 8px 20px rgba(23,50,77,0.14)",
}

const documentTabIndex: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background: "#f1f5f9",
  color: "#17324d",
  fontSize: 12,
  fontWeight: 800,
}

const documentTabIndexActive: CSSProperties = {
  ...documentTabIndex,
  background: "rgba(255,255,255,0.14)",
  color: "#fff",
}

const documentPanelBody: CSSProperties = {
  minWidth: 0,
}

const linesTotalBar: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 10,
}

const sectionWrap: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 12,
  marginBottom: 10,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const sectionTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 8,
}

const toolbarRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 8,
}

const toolbarTitle: CSSProperties = {
  display: "none",
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a",
}

const toolbarSubtitle: CSSProperties = {
  display: "none",
  fontSize: 11,
  color: "#64748b",
  marginTop: 2,
}

const rowsHeader: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px,2.4fr) 80px 88px 96px 70px 110px 150px 44px",
  gap: 5,
  padding: "0 2px 4px",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.3,
}

const linesViewport: CSSProperties = {
  overflow: "visible",
  paddingRight: 0,
}

const linesViewportMobile: CSSProperties = {
  maxHeight: "none",
  overflow: "visible",
  paddingRight: 0,
}

const rowsStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
}

const rowCard: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#ffffff",
  padding: 4,
}

const rowMain: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px,2.4fr) 80px 88px 96px 70px 110px 150px 44px",
  gap: 5,
  alignItems: "center",
}

const rowMainMobile: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  alignItems: "stretch",
}

const rowExtra: CSSProperties = {
  marginTop: 4,
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 4,
}

const productCell: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
}

const selectedProductMeta: CSSProperties = {
  fontSize: 11,
  color: "#16a34a",
  fontWeight: 700,
  paddingLeft: 2,
}

const duplicateMeta: CSSProperties = {
  fontSize: 11,
  color: "#b45309",
  fontWeight: 700,
  paddingLeft: 2,
}

const totalCell: CSSProperties = {
  minHeight: 32,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 1,
  padding: "4px 6px",
  borderRadius: 8,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
}

const totalValue: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: "#1e3a8a",
  lineHeight: 1.1,
}

const totalMeta: CSSProperties = {
  fontSize: 10,
  color: "#64748b",
  lineHeight: 1.15,
}

const mobileGridLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.3,
  paddingLeft: 2,
}

const mobileFullSpan: CSSProperties = {
  gridColumn: "1 / -1",
}

const mobileLineSummaryCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 10,
  borderRadius: 12,
  background: "#fff",
  border: "1px solid #e2e8f0",
}

const mobileLineSummaryTop: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 10,
}

const mobileLineTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#0f172a",
  lineHeight: 1.25,
  wordBreak: "break-word",
}

const mobileLineMeta: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#64748b",
  lineHeight: 1.3,
}

const mobileLineTotalBox: CSSProperties = {
  minWidth: 90,
  textAlign: "right",
  flexShrink: 0,
}

const mobileLineTotalLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.3,
}

const mobileLineTotalValue: CSSProperties = {
  marginTop: 4,
  fontSize: 14,
  fontWeight: 800,
  color: "#1e3a8a",
}

const mobileLineFacts: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
}

const mobileLineFact: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  fontSize: 12,
  color: "#0f172a",
}

const mobileLineActions: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
}

const emptyMobileLinesBox: CSSProperties = {
  padding: 14,
  borderRadius: 12,
  border: "1px dashed #cbd5e1",
  background: "#f8fafc",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.45,
}

const totalsGrid: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
}

const miniStatPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 8px",
  borderRadius: 999,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#0f172a",
  fontSize: 11,
  fontWeight: 700,
}

const sgrInlineBox: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  padding: "5px 7px",
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px dashed #cbd5e1",
  fontSize: 11,
  color: "#0f172a",
}

const quickResultsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 6,
}

const lineInsightGrid: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  alignItems: "center",
}

const insightChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 8px",
  borderRadius: 999,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  fontSize: 11,
  color: "#0f172a",
}

const btnPrimary: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "none",
  background: "#17324d",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
}

const btnSecondary: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#111827",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
}

const btnGhostMobile: CSSProperties = {
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid #dbe3ee",
  background: "#fff",
  color: "#17324d",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  width: "100%",
}

const btnSoftAuto: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
}

const btnSoftManual: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#334155",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
}

const btnDangerIcon: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 800,
}

const btnDangerMobile: CSSProperties = {
  ...btnSecondary,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#991b1b",
}

const input: CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "9px 10px",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
}

const inputCompact: CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "6px 7px",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
  height: 30,
}

const inputCompactReadOnly: CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "6px 7px",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  background: "#f8fafc",
  height: 30,
}

const cardSmall: CSSProperties = {
  minWidth: 0,
  flex: "1 1 160px",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
}

const infoBox: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1d4ed8",
  marginBottom: 12,
  fontSize: 13,
}

const warningBox: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: 13,
}

const errorBox: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  marginBottom: 12,
  fontSize: 13,
}

const resultsBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 4,
}

const resultBtn: CSSProperties = {
  textAlign: "left",
  padding: 8,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer",
}

const resultBtnCompact: CSSProperties = {
  textAlign: "left",
  padding: 8,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer",
}

const quickAddWrap: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  border: "1px dashed #cbd5e1",
  borderRadius: 10,
  padding: 8,
  background: "#f8fafc",
  flexWrap: "wrap",
}

const inlineUnderField: CSSProperties = {
  marginTop: 6,
}

const inlineActionBox: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  border: "1px dashed #cbd5e1",
  borderRadius: 8,
  padding: 8,
  background: "#f8fafc",
  flexWrap: "wrap",
}

const sgrBadge: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 999,
  background: "#e0f2fe",
  color: "#075985",
  fontSize: 11,
  fontWeight: 800,
  whiteSpace: "nowrap",
}

const modalOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  zIndex: 1000,
}

const modalCard: CSSProperties = {
  width: "100%",
  maxWidth: 900,
  background: "#fff",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
  maxHeight: "90vh",
  overflowY: "auto",
  overflowX: "hidden",
}

const modalHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
}

const modalActions: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
  flexWrap: "wrap",
}




