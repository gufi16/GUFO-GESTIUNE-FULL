import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

function toNumberSafe(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function makeLine() {
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
    sgrValue: "0.50"
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

function formatNumber(value: any) {
  return Number(value || 0).toFixed(2)
}

export default function NirPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const receiptId = getReceiptIdFromUrl()

  const [products, setProducts] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [uoms, setUoms] = useState<any[]>([])
  const [vatRates, setVatRates] = useState<any[]>([])

  const [saving, setSaving] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [authError, setAuthError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [status, setStatus] = useState("DRAFT")

  const [supplierSearch, setSupplierSearch] = useState("")
  const [supplierChosen, setSupplierChosen] = useState(false)

  const [header, setHeader] = useState({
    locationId: "",
    supplierId: "",
    supplierName: "",
    supplierCode: "",
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    currency: "RON",
    fxRate: "1",
    note: ""
  })

  const [lines, setLines] = useState<any[]>([makeLine()])

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
    isSgr: false
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
    phone: ""
  })

  useEffect(() => {
    loadMeta()
  }, [])

  useEffect(() => {
    if (receiptId) {
      loadReceipt(receiptId)
    }
  }, [receiptId])

  async function loadMeta() {
    setLoadingMeta(true)
    setAuthError("")
    setLoadError("")

    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const [p, l, s, u, v] = await Promise.all([
        fetch(`${API}/api/v1/products`, { headers }),
        fetch(`${API}/api/v1/meta/locations`, { headers }),
        fetch(`${API}/api/v1/meta/suppliers`, { headers }),
        fetch(`${API}/api/v1/meta/uom`, { headers }),
        fetch(`${API}/api/v1/meta/vat`, { headers })
      ])

      const pData = await p.json().catch(() => ({}))
      const lData = await l.json().catch(() => ({}))
      const sData = await s.json().catch(() => ({}))
      const uData = await u.json().catch(() => ({}))
      const vData = await v.json().catch(() => ({}))

      if ([p, l, s, u, v].some((x) => x.status === 401)) {
        setAuthError("Token lipsă sau expirat. Fă login din nou în aplicație.")
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

      if (
        !nextProducts.length &&
        !nextLocations.length &&
        !nextSuppliers.length &&
        !nextUoms.length &&
        !nextVatRates.length
      ) {
        setLoadError("Nu s-au putut încărca datele pentru NIR.")
      }
    } catch {
      setLoadError("Nu pot încărca datele din backend.")
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
      const res = await fetch(`${API}/api/v1/purchase-receipts/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setAuthError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok || !data.receipt) {
        setLoadError(data.error || "Nu pot încărca documentul NIR.")
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
        note: r.note || ""
      })

      setSupplierSearch(r.supplier?.name || r.supplierName || "")
      setSupplierChosen(!!(r.supplierId || r.supplierName))

      const loadedLines = ensureArray(r.items).map((item: any) => ({
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
        sgrValue: String(item.product?.isSgr ? Number(item.product?.sgrValue || 0.5) : 0)
      }))

      setLines(loadedLines.length ? loadedLines : [makeLine()])
    } catch {
      setLoadError("Nu pot încărca documentul NIR.")
    } finally {
      setLoadingReceipt(false)
    }
  }

  function setLineValue(id: string, patch: any) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line))
    )
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()])
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
      .filter((p: any) => {
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
      .filter((s: any) => {
        const name = String(s?.name || "").toLowerCase()
        const code = String(s?.code || "").toLowerCase()
        const cif = String(s?.cif || "").toLowerCase()
        return name.includes(q) || code.includes(q) || cif.includes(q)
      })
      .slice(0, 8)
  }

  function chooseProduct(lineId: string, product: any) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line
        return {
          ...line,
          productId: product.id,
          search: product.name,
          uomId: product.purchaseUom?.id || product.uom?.id || "",
          uomCode: product.purchaseUom?.code || product.uom?.code || "",
          factor: String(product.purchaseFactor || 1),
          vat: String(product.vatRate?.rate || 19),
          price: String(product.price ?? line.price ?? "0"),
          isSgr: Boolean(product.isSgr),
          sgrValue: String(product.isSgr ? Number(product.sgrValue || 0.5) : 0)
        }
      })
    )
  }

  function chooseSupplier(supplier: any) {
    setHeader((prev) => ({
      ...prev,
      supplierId: supplier.id,
      supplierName: supplier.name || "",
      supplierCode: supplier.code || ""
    }))
    setSupplierSearch(supplier.name || "")
    setSupplierChosen(true)
    setQuickSupplierOpen(false)
    setQuickSupplierError("")
  }

  function openQuickProduct(line: any) {
    const defaultUom = uoms.find((u: any) => u.isActive !== false) || uoms[0]
    const defaultVat =
      vatRates.find((v: any) => Number(v.rate) === 19 && v.isActive !== false) ||
      vatRates.find((v: any) => v.isActive !== false) ||
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
      isSgr: false
    })
  }

  function closeQuickProduct() {
    setQuickProductOpen(false)
    setQuickProductLineId("")
    setQuickProductLoading(false)
    setQuickProductError("")
  }

  async function tryCreateProduct(url: string, payload: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })

    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function saveQuickProduct() {
    if (!quickProductForm.name.trim()) {
      setQuickProductError("Completează denumirea produsului.")
      return
    }

    if (!quickProductForm.uomId) {
      setQuickProductError("Selectează UM stoc.")
      return
    }

    if (!quickProductForm.purchaseUomId) {
      setQuickProductError("Selectează UM achiziție.")
      return
    }

    if (!quickProductForm.vatRateId) {
      setQuickProductError("Selectează TVA.")
      return
    }

    setQuickProductLoading(true)
    setQuickProductError("")

    const payload = {
      name: quickProductForm.name.trim(),
      uomId: quickProductForm.uomId,
      purchaseUomId: quickProductForm.purchaseUomId,
      purchaseFactor: toNumberSafe(quickProductForm.purchaseFactor) || 1,
      vatRateId: quickProductForm.vatRateId,
      price: toNumberSafe(quickProductForm.price),
      isActive: true,
      isSgr: quickProductForm.isSgr
    }

    try {
      let result = await tryCreateProduct(`${API}/api/v1/products`, payload)

      if (!result.res.ok) {
        result = await tryCreateProduct(`${API}/api/v1/meta/products`, payload)
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

      setProducts((prev) => {
        const next = [created, ...prev]
        return next
      })

      chooseProduct(quickProductLineId, created)
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
      code: "",
      cif: "",
      regNo: "",
      address: "",
      email: "",
      phone: ""
    })
  }

  function closeQuickSupplier() {
    setQuickSupplierOpen(false)
    setQuickSupplierLoading(false)
    setQuickSupplierError("")
  }

  async function tryCreateSupplier(url: string, payload: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })

    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function saveQuickSupplier() {
    if (!quickSupplierForm.name.trim()) {
      setQuickSupplierError("Completează numele furnizorului.")
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
      isActive: true
    }

    try {
      let result = await tryCreateSupplier(`${API}/api/v1/suppliers`, payload)

      if (!result.res.ok) {
        result = await tryCreateSupplier(`${API}/api/v1/meta/suppliers`, payload)
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
    return lines.filter((l) => l.productId && Number(l.qty || 0) > 0)
  }, [lines])

  const totals = useMemo(() => {
    return validLines.reduce(
      (acc, l) => {
        const qty = Number(l.qty || 0)
        const factor = Number(l.factor || 1)
        const price = Number(l.price || 0)
        const vat = Number(l.vat || 0)
        const fx = Number(header.fxRate || 1)
        const isSgr = Boolean(l.isSgr)
        const sgrUnit = isSgr ? Number(l.sgrValue || 0.5) : 0
        const sgrFc = qty * sgrUnit

        const stockQty = qty * factor
        const netFc = qty * price
        const vatFc = (netFc * vat) / 100
        const grossFc = netFc + vatFc

        const netRon = netFc * fx
        const vatRon = vatFc * fx
        const grossRon = grossFc * fx
        const sgrRon = sgrFc * fx

        acc.stockQty += stockQty
        acc.netFc += netFc
        acc.vatFc += vatFc
        acc.grossFc += grossFc
        acc.sgrFc += sgrFc
        acc.withSgrFc += grossFc + sgrFc
        acc.netRon += netRon
        acc.vatRon += vatRon
        acc.grossRon += grossRon
        acc.sgrRon += sgrRon
        acc.withSgrRon += grossRon + sgrRon

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
        withSgrRon: 0
      }
    )
  }, [validLines, header.fxRate])

  async function saveNir(postNow = false) {
    if (!token) {
      alert("Nu există token de autentificare. Fă login din nou.")
      return
    }

    if (isPosted) {
      alert("Documentul POSTED este doar pentru vizualizare și nu mai poate fi modificat.")
      return
    }

    if (!header.locationId) {
      alert("Selectează locația.")
      return
    }

    if (!header.docNo.trim()) {
      alert("Completează numărul documentului.")
      return
    }

    if (!header.docDate) {
      alert("Completează data documentului.")
      return
    }

    if (!validLines.length) {
      alert("Adaugă cel puțin un produs.")
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
        fxRate: Number(header.fxRate || 1),
        note: header.note
      },
      items: validLines.map((l) => ({
        productId: l.productId,
        uomId: l.uomId || null,
        qty: Number(l.qty || 0),
        conversionFactor: Number(l.factor || 1),
        unitCostNetFc: Number(l.price || 0),
        vatRateValue: Number(l.vat || 19)
      })),
      postNow
    }

    setSaving(true)

    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts/full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await res.json().catch(() => ({}))
      setSaving(false)

      if (res.status === 401) {
        alert("Token expirat sau invalid. Fă login din nou.")
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
      alert(postNow ? "NIR salvat și postat în stoc." : "NIR salvat.")

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
      alert("Salvează documentul înainte.")
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
      alert("Salvează documentul înainte de export.")
      return
    }

    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts/${receiptId}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        alert("Nu pot genera PDF.")
        return
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")

      const supplier = (header.supplierName || supplierSearch || "Furnizor")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_.]/g, "")

      const docNo = (header.docNo || "document")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_.]/g, "")

      link.href = url
      link.download = `NIR_${docNo}_${supplier}.pdf`

      document.body.appendChild(link)
      link.click()
      link.remove()

      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert("Eroare export PDF")
    }
  }

  const matchedSuppliers = supplierMatches(supplierSearch)
  const isPosted = status === "POSTED"
  const pageTitle = !receiptId
    ? "NIR nou"
    : isPosted
      ? "Vizualizare NIR"
      : "Editare NIR"

  return (
    <div style={{ padding: 4 }}>
      <div className="no-print" style={{ marginBottom: 20 }}>
        <PageHeader
          badge="operațiuni"
          title={pageTitle}
          subtitle={
            !receiptId
              ? "Recepție marfă one-screen"
              : isPosted
                ? "Document postat în stoc, disponibil doar pentru vizualizare"
                : "Document draft editabil"
          }
        />
      </div>

      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap"
        }}
      >

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/inregistrare-document/nir" style={{ textDecoration: "none" }}>
            <button style={btnSecondary}>Înapoi la listă</button>
          </a>

          <button
            style={btnSecondary}
            onClick={handlePrint}
            disabled={!receiptId || loadingReceipt}
            title={!receiptId ? "Salvează documentul înainte de print." : ""}
          >
            Printează
          </button>

          <button
            style={btnSecondary}
            onClick={exportPdf}
            disabled={!receiptId || loadingReceipt}
            title={!receiptId ? "Salvează documentul înainte de export PDF." : ""}
          >
            Export PDF
          </button>

          {!isPosted && (
            <>
              <button
                style={btnSecondary}
                onClick={() => saveNir(false)}
                disabled={saving || loadingReceipt}
              >
                {saving ? "Se salvează..." : "Salvează draft"}
              </button>

              <button
                style={btnPrimary}
                onClick={() => saveNir(true)}
                disabled={saving || loadingReceipt}
              >
                {saving ? "Se salvează..." : "Salvează și postează"}
              </button>
            </>
          )}
        </div>
      </div>

      {status && (
        <div style={{ marginBottom: 14 }}>
          <StatusBadge status={status} />
        </div>
      )}

      {isPosted && (
        <div style={infoBox}>
          Documentul este POSTED și este blocat la editare. Poți doar să îl vizualizezi, să îl printezi sau să faci export PDF.
        </div>
      )}

      {(authError || loadError) && <div style={errorBox}>{authError || loadError}</div>}

      {loadingReceipt ? (
        <div style={infoBox}>Se încarcă documentul...</div>
      ) : (
        <>
          <Section title="Antet document">
            <div style={grid2}>
              <Field label="Locație">
                <select
                  value={header.locationId}
                  onChange={(e) => setHeader({ ...header, locationId: e.target.value })}
                  style={input}
                  disabled={isPosted}
                >
                  <option value="">Selectează locația</option>
                  {ensureArray(locations).map((l: any) => (
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
                      supplierCode: ""
                    }))
                  }}
                  style={input}
                  disabled={isPosted}
                />

                {supplierSearch.trim().length >= 2 && !supplierChosen && !isPosted && (
                  <div style={inlineUnderField}>
                    {matchedSuppliers.length > 0 ? (
                      <div style={resultsBox}>
                        {matchedSuppliers.map((s: any) => (
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
                          Nu există furnizori găsiți pentru „{supplierSearch}”
                        </div>

                        <button
                          type="button"
                          style={btnSecondary}
                          onClick={openQuickSupplierModal}
                        >
                          Adaugă furnizor nou
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Field>

              <Field label="Cod furnizor">
                <input
                  value={header.supplierCode}
                  readOnly
                  style={{ ...input, background: "#f9fafb" }}
                />
              </Field>

              <Field label="Monedă">
                <select
                  value={header.currency}
                  onChange={(e) => {
                    const value = e.target.value
                    setHeader({
                      ...header,
                      currency: value,
                      fxRate: value === "RON" ? "1" : header.fxRate
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
                  style={input}
                  disabled={header.currency === "RON" || isPosted}
                />
              </Field>
            </div>
          </Section>

          <Section title="Produse recepționate">
            {!isPosted && (
              <div style={{ marginBottom: 12 }}>
                <button
                  style={btnPrimary}
                  onClick={addLine}
                  disabled={loadingMeta}
                >
                  + Adaugă linie
                </button>
              </div>
            )}

            {lines.map((line) => {
              const matches = productMatches(line.search)
              const qty = Number(line.qty || 0)
              const price = Number(line.price || 0)
              const vat = Number(line.vat || 0)

              const net = qty * price
              const vatValue = (net * vat) / 100
              const sgrUnit = Boolean(line.isSgr) ? Number(line.sgrValue || 0.5) : 0
              const sgrTotal = qty * sgrUnit
              const total = net + vatValue + sgrTotal

              const canAddQuickProduct =
                !isPosted &&
                line.search.trim().length >= 2 &&
                !line.productId &&
                matches.length === 0 &&
                uoms.length > 0 &&
                vatRates.length > 0

              return (
                <div key={line.id} style={lineCard}>
                  <div style={gridLine}>
                    <CompactField label="Produs">
                      <input
                        type="text"
                        placeholder="Scrie primele 2-3 litere..."
                        value={line.search}
                        onChange={(e) =>
                          setLineValue(line.id, {
                            search: e.target.value,
                            productId: ""
                          })
                        }
                        style={inputCompact}
                        disabled={isPosted}
                      />
                    </CompactField>

                    <CompactField label="UM">
                      <input
                        type="text"
                        value={line.uomCode}
                        readOnly
                        style={{ ...inputCompact, background: "#f9fafb" }}
                      />
                    </CompactField>

                    <CompactField label="Factor">
                      <input
                        type="text"
                        value={line.factor}
                        onChange={(e) => setLineValue(line.id, { factor: e.target.value })}
                        style={inputCompact}
                        disabled={isPosted}
                      />
                    </CompactField>

                    <CompactField label="Cant.">
                      <input
                        type="text"
                        value={line.qty}
                        onChange={(e) => setLineValue(line.id, { qty: e.target.value })}
                        style={inputCompact}
                        disabled={isPosted}
                      />
                    </CompactField>

                    <CompactField label="Preț ach.">
                      <input
                        type="text"
                        value={line.price}
                        onChange={(e) => setLineValue(line.id, { price: e.target.value })}
                        style={inputCompact}
                        disabled={isPosted}
                      />
                    </CompactField>

                    <CompactField label="TVA %">
                      <input
                        type="text"
                        value={line.vat}
                        onChange={(e) => setLineValue(line.id, { vat: e.target.value })}
                        style={inputCompact}
                        disabled={isPosted}
                      />
                    </CompactField>

                    <CompactField label="Net">
                      <input
                        type="text"
                        value={net.toFixed(2)}
                        readOnly
                        style={{ ...inputCompact, background: "#f9fafb", fontWeight: 600 }}
                      />
                    </CompactField>

                    <CompactField label="TVA">
                      <input
                        type="text"
                        value={vatValue.toFixed(2)}
                        readOnly
                        style={{ ...inputCompact, background: "#f9fafb", fontWeight: 600 }}
                      />
                    </CompactField>

                    <CompactField label="SGR">
                      <input
                        type="text"
                        value={sgrTotal.toFixed(2)}
                        readOnly
                        style={{ ...inputCompact, background: "#f9fafb", fontWeight: 600 }}
                      />
                    </CompactField>

                    <CompactField label="Total">
                      <input
                        type="text"
                        value={total.toFixed(2)}
                        readOnly
                        style={{ ...inputCompact, background: "#f9fafb", fontWeight: 600 }}
                      />
                    </CompactField>

                    <div style={{ paddingTop: 22 }}>
                      {!isPosted ? (
                        <button
                          style={btnDangerSmall}
                          onClick={() => removeLine(line.id)}
                        >
                          Șterge
                        </button>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>

                  {line.productId && line.isSgr && (
                    <div style={sgrRow}>
                      <div style={sgrRowGrid}>
                        <div style={sgrLabelWrap}>
                          <div style={sgrBadge}>SGR</div>
                          <div style={sgrName}>SGR {line.search || "Produs"}</div>
                        </div>

                        <div>
                          <div style={sgrMiniLabel}>UM</div>
                          <div style={sgrMiniValue}>{line.uomCode || "-"}</div>
                        </div>

                        <div>
                          <div style={sgrMiniLabel}>Cant.</div>
                          <div style={sgrMiniValue}>{qty.toFixed(2)}</div>
                        </div>

                        <div>
                          <div style={sgrMiniLabel}>Preț</div>
                          <div style={sgrMiniValue}>{sgrUnit.toFixed(2)}</div>
                        </div>

                        <div>
                          <div style={sgrMiniLabel}>TVA %</div>
                          <div style={sgrMiniValue}>0.00</div>
                        </div>

                        <div>
                          <div style={sgrMiniLabel}>Total SGR</div>
                          <div style={sgrMiniValueStrong}>{sgrTotal.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {line.search.trim().length >= 2 && !line.productId && !isPosted && (
                    <div style={{ marginTop: 10 }}>
                      {matches.length > 0 ? (
                        <div style={resultsBox}>
                          {matches.map((p: any) => (
                            <button
                              key={p.id}
                              type="button"
                              style={resultBtn}
                              onClick={() => chooseProduct(line.id, p)}
                            >
                              <div style={{ fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: 12, color: "#666" }}>
                                {p.sku} · UM {p.purchaseUom?.code || p.uom?.code || "-"} · TVA{" "}
                                {p.vatRate?.rate ?? "-"}{p.isSgr ? " · SGR 0.50" : ""}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={quickAddWrap}>
                          <div style={{ color: "#991b1b", fontSize: 13 }}>
                            Nu există produse găsite pentru „{line.search}”
                          </div>

                          {canAddQuickProduct && (
                            <button
                              type="button"
                              style={btnSecondary}
                              onClick={() => openQuickProduct(line)}
                            >
                              Adaugă produs nou
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </Section>

          <Section title="Totaluri">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Card
                title={`Net ${header.currency}`}
                value={`${formatNumber(totals.netFc)} ${header.currency}`}
              />
              <Card
                title={`TVA ${header.currency}`}
                value={`${formatNumber(totals.vatFc)} ${header.currency}`}
              />
              <Card
                title={`SGR ${header.currency}`}
                value={`${formatNumber(totals.sgrFc)} ${header.currency}`}
              />
              <Card
                title={`Total fără SGR ${header.currency}`}
                value={`${formatNumber(totals.grossFc)} ${header.currency}`}
              />
              <Card
                title={`Total cu SGR ${header.currency}`}
                value={`${formatNumber(totals.withSgrFc)} ${header.currency}`}
              />

              {header.currency !== "RON" && (
                <>
                  <Card title="Total RON fără SGR" value={`${formatNumber(totals.grossRon)} RON`} />
                  <Card title="SGR RON" value={`${formatNumber(totals.sgrRon)} RON`} />
                  <Card title="Total RON cu SGR" value={`${formatNumber(totals.withSgrRon)} RON`} />
                </>
              )}
            </div>
          </Section>
        </>
      )}

      {quickProductOpen && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>Adaugă produs nou</h3>
                <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
                  Produsul se salvează în nomenclator și se selectează automat în linia curentă.
                </div>
              </div>

              <button type="button" onClick={closeQuickProduct} style={btnSecondary}>
                Închide
              </button>
            </div>

            {quickProductError && <div style={{ ...errorBox, marginTop: 14 }}>{quickProductError}</div>}

            <div style={{ ...grid2, marginTop: 16 }}>
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
                    setQuickProductForm((prev) => ({
                      ...prev,
                      uomId: e.target.value
                    }))
                  }
                  style={input}
                >
                  <option value="">Selectează UM</option>
                  {uoms.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.code} - {u.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="UM achiziție">
                <select
                  value={quickProductForm.purchaseUomId}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      purchaseUomId: e.target.value
                    }))
                  }
                  style={input}
                >
                  <option value="">Selectează UM achiziție</option>
                  {uoms.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.code} - {u.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Factor achiziție">
                <input
                  value={quickProductForm.purchaseFactor}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      purchaseFactor: e.target.value
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
                      vatRateId: e.target.value
                    }))
                  }
                  style={input}
                >
                  <option value="">Selectează TVA</option>
                  {vatRates.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.name} - {v.rate}%
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Preț implicit">
                <input
                  value={quickProductForm.price}
                  onChange={(e) =>
                    setQuickProductForm((prev) => ({
                      ...prev,
                      price: e.target.value
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
                        isSgr: e.target.checked
                      }))
                    }
                  />
                  <span>Produs cu SGR 0.50 fără TVA</span>
                </label>
              </Field>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={closeQuickProduct} style={btnSecondary}>
                Renunță
              </button>
              <button
                type="button"
                onClick={saveQuickProduct}
                style={btnPrimary}
                disabled={quickProductLoading}
              >
                {quickProductLoading ? "Se salvează..." : "Salvează produs"}
              </button>
            </div>
          </div>
        </div>
      )}

      {quickSupplierOpen && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>Adaugă furnizor nou</h3>
                <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
                  Furnizorul se salvează și se selectează automat în antet.
                </div>
              </div>

              <button type="button" onClick={closeQuickSupplier} style={btnSecondary}>
                Închide
              </button>
            </div>

            {quickSupplierError && <div style={{ ...errorBox, marginTop: 14 }}>{quickSupplierError}</div>}

            <div style={{ ...grid2, marginTop: 16 }}>
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
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, code: e.target.value }))
                  }
                  style={input}
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

              <Field label="Reg. comerțului">
                <input
                  value={quickSupplierForm.regNo}
                  onChange={(e) =>
                    setQuickSupplierForm((prev) => ({ ...prev, regNo: e.target.value }))
                  }
                  style={input}
                />
              </Field>

              <Field label="Adresă">
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={closeQuickSupplier} style={btnSecondary}>
                Renunță
              </button>
              <button
                type="button"
                onClick={saveQuickSupplier}
                style={btnPrimary}
                disabled={quickSupplierLoading}
              >
                {quickSupplierLoading ? "Se salvează..." : "Salvează furnizor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sectionWrap}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 14, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, color: "#555", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={cardSmall}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
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
        fontWeight: 700
      }}
    >
      {status}
    </span>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700
}

const btnSecondary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 600
}

const btnDangerSmall: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#991b1b",
  cursor: "pointer",
  fontWeight: 600
}

const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box"
}

const inputCompact: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "9px 10px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box"
}

const sectionWrap: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 24,
  padding: 20,
  marginBottom: 18,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)"
}

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 14
}

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14
}

const gridLine: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2.1fr 0.8fr 0.8fr 0.8fr 0.9fr 0.7fr 0.9fr 0.9fr 0.9fr 0.9fr auto",
  gap: 10,
  alignItems: "start"
}

const lineCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  marginBottom: 12
}

const sgrRow: React.CSSProperties = {
  marginTop: 10,
  padding: 12,
  border: "1px dashed #cbd5e1",
  borderRadius: 12,
  background: "#f8fafc"
}

const sgrRowGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2.1fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr",
  gap: 10,
  alignItems: "center"
}

const sgrLabelWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10
}

const sgrBadge: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 999,
  background: "#e0f2fe",
  color: "#075985",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap"
}

const sgrName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#0f172a"
}

const sgrMiniLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  marginBottom: 4,
  fontWeight: 600
}

const sgrMiniValue: React.CSSProperties = {
  fontSize: 14,
  color: "#0f172a"
}

const sgrMiniValueStrong: React.CSSProperties = {
  fontSize: 14,
  color: "#0f172a",
  fontWeight: 700
}

const cardSmall: React.CSSProperties = {
  minWidth: 180,
  padding: 16,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#fff"
}

const infoBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1d4ed8",
  marginBottom: 16
}

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  marginBottom: 16
}

const resultsBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 6
}

const resultBtn: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer"
}

const quickAddWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  paddingTop: 8
}

const inlineUnderField: React.CSSProperties = {
  marginTop: 8
}

const inlineActionBox: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  border: "1px dashed #fca5a5",
  borderRadius: 10,
  padding: 10,
  background: "#fff7ed"
}

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1000
}

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  background: "#fff",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
  maxHeight: "90vh",
  overflowY: "auto"
}