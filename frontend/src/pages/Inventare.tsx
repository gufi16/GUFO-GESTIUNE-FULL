import PageHeader from "../components/PageHeader"
import { useEffect, useMemo, useState } from "react"
import { api, API_BASE as API, getToken } from "../lib/api"
import { DocumentMetric, InlineNotice, documentButtonPrimaryClass, documentButtonSecondaryClass, documentInputClass } from "../components/DocumentUi"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { openPdfInNewTab } from "../lib/pdf"
import { getDocumentNumbering, getPreviewValue, type NumberingPayload } from "../lib/numbering"


type LocationItem = {
  id: string
  name: string
  code?: string
}

type InventoryDocListItem = {
  id: string
  docNo: string
  docDate: string
  note?: string | null
  status?: "DRAFT" | "FINALIZED" | "CANCELLED"
  finalizedAt?: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code?: string
  }
  itemsCount: number
  totalSystemQty: number
  totalCountedQty: number
  totalDifferenceQty: number
  positiveItems: number
  negativeItems: number
  zeroItems: number
}

type InventoryDocDetails = {
  id: string
  docNo: string
  docDate: string
  note?: string | null
  status?: "DRAFT" | "FINALIZED" | "CANCELLED"
  finalizedAt?: string | null
  createdAt: string
  updatedAt: string
  location: {
    id: string
    name: string
    code?: string
  }
  items: Array<{
    id: string
    product: {
      id: string
      sku: string
      name: string
      class?: string
      price?: number
      uom?: {
        id: string
        code: string
        name: string
      } | null
    }
    systemQty: number
    countedQty: number
    differenceQty: number
  }>
  summary: {
    itemsCount: number
    totalSystemQty: number
    totalCountedQty: number
    totalDifferenceQty: number
  }
}

type DraftItem = {
  localId: string
  productId: string
  sku: string
  name: string
  uomCode: string
  systemQty: number
  countedQty: string
}

type SearchResult = {
  id: string
  sku: string
  name: string
  class?: string
  uom?: {
    id: string
    code: string
    name: string
  } | null
  systemQty: number
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toNumber(value: string | number | null | undefined) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("ro-RO")
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString("ro-RO")
}

function diffClass(value: number) {
  if (value < 0) return "text-red-600 font-semibold"
  if (value > 0) return "text-emerald-600 font-semibold"
  return "text-slate-500"
}

function statusBadge(status?: string) {
  if (status === "FINALIZED") {
    return "bg-emerald-100 text-emerald-700 border border-emerald-200"
  }
  if (status === "CANCELLED") {
    return "bg-red-100 text-red-700 border border-red-200"
  }
  return "bg-amber-100 text-amber-700 border border-amber-200"
}

function statusText(status?: string) {
  if (status === "FINALIZED") return "Finalizat"
  if (status === "CANCELLED") return "Anulat"
  return "In lucru"
}

export default function Inventare() {
  const [docs, setDocs] = useState<InventoryDocListItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)

  const [loading, setLoading] = useState(false)
  const [loadingInit, setLoadingInit] = useState(true)
  const [savingDraft, setSavingDraft] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [cancellingId, setCancellingId] = useState("")

  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [q, setQ] = useState("")
  const [locationId, setLocationId] = useState(getActiveLocationId())
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState("")
  const [docNo, setDocNo] = useState("")
  const [docStatus, setDocStatus] = useState<"DRAFT" | "FINALIZED" | "CANCELLED">("DRAFT")
  const [finalizedAt, setFinalizedAt] = useState<string | null>("")
  const [editorLocationId, setEditorLocationId] = useState(getActiveLocationId())
  const [editorNote, setEditorNote] = useState("")
  const [editorItems, setEditorItems] = useState<DraftItem[]>([])

  const [search, setSearch] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [formError, setFormError] = useState("")

  useEffect(() => {
    loadInit()
    const unsubscribe = subscribeToActiveLocation((nextLocationId) => {
      setLocationId((current) => current || nextLocationId)
      setEditorLocationId((current) => current || nextLocationId)
    })
    return unsubscribe
  }, [])

  async function loadInit() {
    setLoadingInit(true)
    setError("")
    setSuccess("")
    try {
      const numberingData = await getDocumentNumbering().catch(() => null)
      setNumbering(numberingData?.previews || null)
      await Promise.all([loadLocations(), loadDocs()])
      if (!editingId) {
        setDocNo((current) => current || getPreviewValue(numberingData?.previews, "inventory"))
      }
    } finally {
      setLoadingInit(false)
    }
  }

  async function loadLocations() {
    try {
      const data = await api<{ ok: boolean; locations: LocationItem[] }>("/api/v1/meta/locations")
      const items = Array.isArray(data.locations) ? data.locations : []
      setLocations(items)

      const preferredLocationId =
        items.find((item) => item.id === getActiveLocationId())?.id || items[0]?.id || ""

      if (!locationId && preferredLocationId) setLocationId(preferredLocationId)
      if (!editorLocationId && preferredLocationId) setEditorLocationId(preferredLocationId)
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca locatiile.")
      setLocations([])
    }
  }

  async function loadDocs() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set("q", q.trim())
      if (locationId) params.set("locationId", locationId)
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)
      if (statusFilter) params.set("status", statusFilter)

      const url = `/api/v1/inventory-docs${params.toString() ? `?${params.toString()}` : ""}`
      const data = await api<{ ok: boolean; items: InventoryDocListItem[] }>(url)
      setDocs(Array.isArray(data.items) ? data.items : [])
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca inventarele.")
      setDocs([])
    } finally {
      setLoading(false)
    }
  }

  function resetEditor() {
    setEditingId("")
    setDocNo(getPreviewValue(numbering, "inventory"))
    setDocStatus("DRAFT")
    setFinalizedAt("")
    setEditorNote("")
    setEditorItems([])
    setSearch("")
    setSearchResults([])
    setFormError("")
    setShowEditor(false)
    if (locations.length > 0) {
      setEditorLocationId(locations.find((item) => item.id === getActiveLocationId())?.id || locations[0].id)
    } else {
      setEditorLocationId("")
    }
  }

  function openNewDraft() {
    setEditingId("")
    setDocNo(getPreviewValue(numbering, "inventory"))
    setDocStatus("DRAFT")
    setFinalizedAt("")
    setEditorNote("")
    setEditorItems([])
    setSearch("")
    setSearchResults([])
    setFormError("")
    setSuccess("")
    setError("")
    if (locations.length > 0) {
      setEditorLocationId(locations.find((item) => item.id === getActiveLocationId())?.id || locations[0].id)
    }
    setShowEditor(true)
  }

  async function openEditDraft(id: string) {
    setError("")
    setSuccess("")
    setFormError("")
    try {
      const data = await api<{ ok: boolean; item: InventoryDocDetails }>(`/api/v1/inventory-docs/${id}`)
      const item = data.item

      setEditingId(item.id)
      setDocNo(item.docNo)
      setDocStatus((item.status as any) || "DRAFT")
      setFinalizedAt(item.finalizedAt || "")
      setEditorLocationId(item.location.id)
      setEditorNote(item.note || "")
      setEditorItems(
        item.items.map((row) => ({
          localId: uid(),
          productId: row.product.id,
          sku: row.product.sku || "",
          name: row.product.name || "",
          uomCode: row.product.uom?.code || "",
          systemQty: Number(row.systemQty || 0),
          countedQty: String(Number(row.countedQty || 0))
        }))
      )
      setSearch("")
      setSearchResults([])
      setShowEditor(true)
    } catch (e: any) {
      setError(e?.message || "Nu am putut deschide inventarul.")
    }
  }

  async function searchProducts(term: string) {
    setSearch(term)

    if (!editorLocationId) {
      setSearchResults([])
      return
    }

    if (term.trim().length < 3) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    try {
      const data = await api<{ ok: boolean; items: any[] }>(
        `/api/v1/products?q=${encodeURIComponent(term.trim())}`
      )

      const productIds = editorItems.map((x) => x.productId)

      const results: SearchResult[] = (Array.isArray(data.items) ? data.items : [])
        .map((item: any) => ({
          id: String(item?.id ?? ""),
          sku: String(item?.sku ?? ""),
          name: String(item?.name ?? ""),
          class: item?.class ? String(item.class) : undefined,
          uom: item?.uom
            ? {
                id: String(item.uom.id ?? ""),
                code: String(item.uom.code ?? ""),
                name: String(item.uom.name ?? "")
              }
            : null,
          systemQty: 0
        }))
        .filter((item) => item.id && item.name)
        .filter((item) => !productIds.includes(item.id))

      if (results.length === 0) {
        setSearchResults([])
        return
      }

      const balancesData = await api<{ ok: boolean; items: any[] }>(
        `/api/v1/stock/by-location?locationId=${encodeURIComponent(editorLocationId)}`
      )

      const balances = Array.isArray(balancesData.items) ? balancesData.items : []
      const balanceMap = new Map(
        balances.map((row: any) => [
          String(row?.product?.id ?? row?.productId ?? ""),
          Number(row?.qty ?? 0)
        ])
      )

      setSearchResults(
        results.map((row) => ({
          ...row,
          systemQty: balanceMap.get(row.id) ?? 0
        }))
      )
    } catch {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  function addProductToDraft(product: SearchResult) {
    setEditorItems((prev) => [
      ...prev,
      {
        localId: uid(),
        productId: product.id,
        sku: product.sku || "",
        name: product.name || "",
        uomCode: product.uom?.code || "",
        systemQty: Number(product.systemQty || 0),
        countedQty: String(Number(product.systemQty || 0))
      }
    ])
    setSearch("")
    setSearchResults([])
  }

  function removeDraftItem(localId: string) {
    setEditorItems((prev) => prev.filter((x) => x.localId !== localId))
  }

  function updateDraftItem(localId: string, patch: Partial<DraftItem>) {
    setEditorItems((prev) => prev.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
  }

  const totals = useMemo(() => {
    const totalSystemQty = editorItems.reduce((sum, item) => sum + Number(item.systemQty || 0), 0)
    const totalCountedQty = editorItems.reduce((sum, item) => sum + toNumber(item.countedQty), 0)
    const totalDifferenceQty = totalCountedQty - totalSystemQty

    return {
      totalSystemQty,
      totalCountedQty,
      totalDifferenceQty
    }
  }, [editorItems])

  const docStats = useMemo(() => {
    return docs.reduce(
      (acc, doc) => {
        acc.total += 1
        if (doc.status === "FINALIZED") acc.finalized += 1
        if (doc.status === "CANCELLED") acc.cancelled += 1
        if (!doc.status || doc.status === "DRAFT") acc.draft += 1
        return acc
      },
      { total: 0, draft: 0, finalized: 0, cancelled: 0 }
    )
  }, [docs])

  async function saveDraft() {
    setFormError("")
    setError("")
    setSuccess("")

    if (!editorLocationId) {
      setFormError("Selecteaza locatia.")
      return
    }

    const payloadItems = editorItems.map((item) => ({
      productId: item.productId,
      countedQty: toNumber(item.countedQty)
    }))

    if (!payloadItems.length) {
      setFormError("Adauga cel putin un produs.")
      return
    }

    if (payloadItems.some((x) => !x.productId)) {
      setFormError("Exista produse invalide in document.")
      return
    }

    if (payloadItems.some((x) => x.countedQty < 0)) {
      setFormError("Cantitatea numarata nu poate fi negativa.")
      return
    }

    setSavingDraft(true)
    try {
      if (editingId) {
        await api(`/api/v1/inventory-docs/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            locationId: editorLocationId,
            note: editorNote.trim() || null,
            items: payloadItems
          })
        })
        setSuccess("Inventarul a fost actualizat.")
      } else {
        const data = await api<{ ok: boolean; item: InventoryDocDetails }>(`/api/v1/inventory`, {
          method: "POST",
          body: JSON.stringify({
            locationId: editorLocationId,
            note: editorNote.trim() || null,
            items: payloadItems
          })
        })
        setEditingId(data.item.id)
        setDocNo(data.item.docNo)
        setDocStatus((data.item.status as any) || "DRAFT")
        setFinalizedAt(data.item.finalizedAt || "")
        setSuccess("Inventarul a fost salvat ca draft.")
      }

      await loadDocs()
    } catch (e: any) {
      setFormError(e?.message || "Nu am putut salva inventarul.")
    } finally {
      setSavingDraft(false)
    }
  }

  async function finalizeDraft(id?: string) {
    const targetId = id || editingId
    if (!targetId) {
      setFormError("Salveaza mai intai inventarul.")
      return
    }

    setFinalizing(true)
    setFormError("")
    setError("")
    setSuccess("")

    try {
      await api(`/api/v1/inventory-docs/${targetId}/finalize`, {
        method: "POST"
      })
      setSuccess("Inventarul a fost finalizat.")
      await loadDocs()
      await openEditDraft(targetId)
    } catch (e: any) {
      setFormError(e?.message || "Nu am putut finaliza inventarul.")
    } finally {
      setFinalizing(false)
    }
  }

  async function quickFinalizeFromList(id: string) {
    setError("")
    setSuccess("")
    try {
      await api(`/api/v1/inventory-docs/${id}/finalize`, {
        method: "POST"
      })
      setSuccess("Inventarul a fost finalizat.")
      await loadDocs()
    } catch (e: any) {
      setError(e?.message || "Nu am putut finaliza inventarul.")
    }
  }

  async function cancelInventory(id?: string) {
    const targetId = id || editingId
    if (!targetId) return

    const ok = window.confirm("Sigur vrei sa anulezi inventarul?")
    if (!ok) return

    setError("")
    setSuccess("")
    setFormError("")
    setCancellingId(targetId)

    try {
      await api(`/api/v1/inventory-docs/${targetId}/cancel`, {
        method: "POST"
      })

      setSuccess("Inventarul a fost anulat.")
      await loadDocs()

      if (editingId === targetId) {
        await openEditDraft(targetId)
      }
    } catch (e: any) {
      setError(e?.message || "Nu am putut anula inventarul.")
    } finally {
      setCancellingId("")
    }
  }

  async function printPdf(id?: string) {
    const targetId = id || editingId
    if (!targetId) return

    setPrinting(true)
    setError("")
    setFormError("")

    try {
      const token = getToken()
      if (!token) {
        setError("Nu exista token de autentificare.")
        return
      }

      const res = await fetch(`${API}/api/v1/inventory-docs/${targetId}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Nu am putut genera PDF-ul.")
      }

      await openPdfInNewTab(res)
    } catch (e: any) {
      setError(e?.message || "Nu am putut genera PDF-ul.")
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="gestiune"
        title="Inventare"
        subtitle="Planifica, verifica si finalizeaza inventarele operationale pe locatia activa, cu evidenta clara pentru drafturi, documente inchise si anulari."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Inventare" value={docStats.total} tone="slate" />
        <DocumentMetric title="In lucru" value={docStats.draft} tone="amber" />
        <DocumentMetric title="Finalizate" value={docStats.finalized} tone="emerald" />
        <DocumentMetric title="Anulate" value={docStats.cancelled} tone="blue" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {success ? <InlineNotice tone="success">{success}</InlineNotice> : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div />
        <div className="flex gap-2">
          <button
            onClick={loadDocs}
            className={documentButtonSecondaryClass}
          >
            {loading ? "Se incarca..." : "Reincarca"}
          </button>

          <button
            onClick={openNewDraft}
            className={documentButtonPrimaryClass}
          >
            Inventar nou
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Cautare</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={documentInputClass}
              placeholder="Nr document, observatii, produs..."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Locatie</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={documentInputClass}
            >
              <option value="">Toate locatiile</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.code ? ` (${loc.code})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={documentInputClass}
            >
              <option value="">Toate</option>
              <option value="DRAFT">In lucru</option>
              <option value="FINALIZED">Finalizat</option>
              <option value="CANCELLED">Anulat</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">De la</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={documentInputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Pana la</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className={documentInputClass}
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={loadDocs}
            className={documentButtonPrimaryClass}
          >
            Filtreaza
          </button>

          <button
            onClick={() => {
              setQ("")
              setLocationId(getActiveLocationId())
              setStatusFilter("")
              setDateFrom("")
              setDateTo("")
            }}
            className={documentButtonSecondaryClass}
          >
            Reseteaza
          </button>
        </div>
      </div>

      {showEditor && (
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold">
                {editingId ? (docStatus === "DRAFT" ? "Editare inventar" : "Vizualizare inventar") : "Inventar nou"}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {docNo ? `Document: ${docNo}` : "Document nou"}
              </div>
              {finalizedAt ? (
                <div className="text-xs text-slate-500 mt-1">
                  Finalizat la: {formatDateTime(finalizedAt)}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(docStatus)}`}>
                {statusText(docStatus)}
              </span>

              {editingId ? (
                <button
                  onClick={() => printPdf()}
                  disabled={printing}
                  className={documentButtonSecondaryClass}
                >
                  {printing ? "Se genereaza..." : "PDF"}
                </button>
              ) : null}

              <button
                onClick={resetEditor}
                className={documentButtonSecondaryClass}
              >
                Inchide
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Locatie</label>
              <select
                value={editorLocationId}
                onChange={(e) => {
                  const nextLocationId = e.target.value
                  setEditorLocationId(nextLocationId)
                  setActiveLocationId(nextLocationId)
                }}
                disabled={docStatus !== "DRAFT"}
                className={`${documentInputClass} disabled:bg-slate-100`}
              >
                <option value="">Selecteaza locatia</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                    {loc.code ? ` (${loc.code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Observatii</label>
              <input
                value={editorNote}
                onChange={(e) => setEditorNote(e.target.value)}
                disabled={docStatus !== "DRAFT"}
                className={`${documentInputClass} disabled:bg-slate-100`}
                placeholder="Observatii document"
              />
            </div>
          </div>

          {docStatus === "DRAFT" ? (
            <div className="rounded-[16px] border border-slate-200 p-3">
              <div className="text-sm font-semibold">Adauga produs</div>
              <div className="text-xs text-slate-500 mt-1">
                Scrie minim 3 litere din nume sau SKU. Produsul apare imediat sub camp.
              </div>

              <div className="mt-3 relative">
                <input
                  value={search}
                  onChange={(e) => searchProducts(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-300"
                  placeholder="Cauta produs..."
                />

                {(search.trim().length >= 3 || searchLoading) ? (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    {searchLoading ? (
                      <div className="px-4 py-3 text-sm text-slate-500">Se cauta...</div>
                    ) : searchResults.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-500">Nu am gasit produse.</div>
                    ) : (
                      searchResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addProductToDraft(product)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                        >
                          <div className="font-medium text-sm">{product.name}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            SKU: {product.sku || "-"}
                            {product.uom?.code ? ` • UM: ${product.uom.code}` : ""}
                            {product.class ? ` • ${product.class}` : ""}
                            {` • Stoc sistem: ${product.systemQty}`}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-[16px] border border-slate-200 overflow-hidden">
            <div className="px-3 py-2.5 bg-slate-50 text-[13px] font-semibold">
              Produse inventar
            </div>

            {editorItems.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">
                Nu ai adaugat inca produse in inventar.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {editorItems.map((item) => {
                  const countedQty = toNumber(item.countedQty)
                  const differenceQty = countedQty - Number(item.systemQty || 0)

                  return (
                    <div
                      key={item.localId}
                      className="grid grid-cols-1 lg:grid-cols-[2fr_120px_140px_140px_100px] gap-3 px-3 py-3 items-center"
                    >
                      <div>
                        <div className="font-medium text-sm">{item.name}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          SKU: {item.sku || "-"}
                          {item.uomCode ? ` • UM: ${item.uomCode}` : ""}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-slate-500">Sistem</div>
                        <div className="text-sm font-medium">{item.systemQty}</div>
                      </div>

                      <div>
                        <div className="text-xs text-slate-500">Numarat</div>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={item.countedQty}
                          disabled={docStatus !== "DRAFT"}
                          onChange={(e) =>
                            updateDraftItem(item.localId, { countedQty: e.target.value })
                          }
                          className="mt-1 w-full rounded-[14px] border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <div className="text-xs text-slate-500">Diferenta</div>
                        <div className={`text-sm mt-1 ${diffClass(differenceQty)}`}>
                          {differenceQty}
                        </div>
                      </div>

                      <div className="flex items-end">
                        {docStatus === "DRAFT" ? (
                          <button
                            onClick={() => removeDraftItem(item.localId)}
                            className="w-full rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700"
                          >
                            Sterge
                          </button>
                        ) : (
                          <div className="text-xs text-slate-400">Blocat</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-[16px] border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Total sistem</div>
              <div className="text-lg font-semibold mt-1">{totals.totalSystemQty}</div>
            </div>

            <div className="rounded-[16px] border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Total numarat</div>
              <div className="text-lg font-semibold mt-1">{totals.totalCountedQty}</div>
            </div>

            <div className="rounded-[16px] border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Diferenta totala</div>
              <div className={`text-lg font-semibold mt-1 ${diffClass(totals.totalDifferenceQty)}`}>
                {totals.totalDifferenceQty}
              </div>
            </div>
          </div>

          {formError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3">
              {formError}
            </div>
          ) : null}

          <div className="flex gap-2 justify-end flex-wrap">
            {docStatus === "DRAFT" ? (
              <>
                <button
                  onClick={saveDraft}
                  disabled={savingDraft}
                  className={documentButtonSecondaryClass}
                >
                  {savingDraft ? "Se salveaza..." : "Salveaza draft"}
                </button>

                {editingId ? (
                  <>
                    <button
                      onClick={() => printPdf()}
                      disabled={printing}
                      className={documentButtonSecondaryClass}
                    >
                      {printing ? "Se genereaza..." : "PDF"}
                    </button>

                    <button
                      onClick={() => cancelInventory()}
                      disabled={cancellingId === editingId}
                      className="inline-flex h-9 items-center justify-center rounded-[14px] border border-red-300 bg-red-50 px-3 text-[13px] font-medium text-red-700 disabled:opacity-60"
                    >
                      {cancellingId === editingId ? "Se anuleaza..." : "Anuleaza"}
                    </button>
                  </>
                ) : null}

                <button
                  onClick={() => finalizeDraft()}
                  disabled={finalizing}
                  className="inline-flex h-9 items-center justify-center rounded-[14px] bg-emerald-600 px-3 text-[13px] font-medium text-white disabled:opacity-60"
                >
                  {finalizing ? "Se finalizeaza..." : "Finalizeaza"}
                </button>
              </>
            ) : editingId ? (
              <button
                onClick={() => printPdf()}
                disabled={printing}
                className={documentButtonPrimaryClass}
              >
                {printing ? "Se genereaza..." : "PDF"}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div className="text-lg font-semibold">Documente inventar</div>

        {loadingInit ? (
          <div className="mt-4 text-sm text-slate-500">Se incarca pagina...</div>
        ) : docs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-slate-500">
            Nu exista documente de inventar.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[16px] border border-slate-200">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-3 border-b border-slate-200">Document</th>
                  <th className="text-left p-3 border-b border-slate-200">Status</th>
                  <th className="text-left p-3 border-b border-slate-200">Data</th>
                  <th className="text-left p-3 border-b border-slate-200">Locatie</th>
                  <th className="text-left p-3 border-b border-slate-200">Articole</th>
                  <th className="text-left p-3 border-b border-slate-200">Diferenta</th>
                  <th className="text-left p-3 border-b border-slate-200">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td className="p-3 border-b border-slate-100">
                      <div className="font-medium">{doc.docNo}</div>
                      <div className="text-xs text-slate-500 mt-1">{doc.note || "-"}</div>
                    </td>

                    <td className="p-3 border-b border-slate-100">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(doc.status)}`}>
                        {statusText(doc.status)}
                      </span>
                    </td>

                    <td className="p-3 border-b border-slate-100">
                      <div>{formatDate(doc.docDate)}</div>
                      <div className="text-xs text-slate-500 mt-1">{formatDateTime(doc.createdAt)}</div>
                    </td>

                    <td className="p-3 border-b border-slate-100">
                      {doc.location?.name}
                      {doc.location?.code ? ` (${doc.location.code})` : ""}
                    </td>

                    <td className="p-3 border-b border-slate-100">{doc.itemsCount}</td>

                    <td className={`p-3 border-b border-slate-100 ${diffClass(doc.totalDifferenceQty)}`}>
                      {doc.totalDifferenceQty}
                    </td>

                    <td className="p-3 border-b border-slate-100">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => openEditDraft(doc.id)}
                          className="inline-flex h-9 items-center justify-center rounded-[14px] border border-slate-300 bg-white px-3 text-[13px] font-medium"
                        >
                          {doc.status === "DRAFT" ? "Editeaza" : "Deschide"}
                        </button>

                        <button
                          onClick={() => printPdf(doc.id)}
                          disabled={printing}
                          className={documentButtonSecondaryClass}
                        >
                          {printing ? "Se genereaza..." : "PDF"}
                        </button>

                        {doc.status === "DRAFT" ? (
                          <>
                            <button
                              onClick={() => quickFinalizeFromList(doc.id)}
                              className="inline-flex h-9 items-center justify-center rounded-[14px] bg-emerald-600 px-3 text-[13px] font-medium text-white"
                            >
                              Finalizeaza
                            </button>

                            <button
                              onClick={() => cancelInventory(doc.id)}
                              disabled={cancellingId === doc.id}
                              className="inline-flex h-9 items-center justify-center rounded-[14px] border border-red-300 bg-red-50 px-3 text-[13px] font-medium text-red-700 disabled:opacity-60"
                            >
                              {cancellingId === doc.id ? "Se anuleaza..." : "Anuleaza"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

