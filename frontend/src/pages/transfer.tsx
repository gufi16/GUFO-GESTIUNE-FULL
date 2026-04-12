import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRightLeft, FileOutput, Plus, Search, Trash2, Truck, Warehouse } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  DocumentStatusPill,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
  readonlyInputStyle,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { downloadPdfFile } from "../lib/pdf"
import { getDocumentNumbering, getPreviewValue, type NumberingPayload } from "../lib/numbering"

type LocationOption = {
  id: string
  name: string
  code?: string
}

type ProductOption = {
  id: string
  name: string
  sku?: string
  price?: number
  uom?: { code?: string } | null
}

type TransferLine = {
  id: string
  productId: string
  search: string
  sku: string
  uomCode: string
  qty: string
  unitPrice: string
}

function makeLine(): TransferLine {
  return {
    id: crypto.randomUUID(),
    productId: "",
    search: "",
    sku: "",
    uomCode: "",
    qty: "1",
    unitPrice: "0",
  }
}

function ensureArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : []
}

function getTransferIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("id") || ""
}

function formatNumber(value: any) {
  return Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function parsePositive(value: any) {
  const normalized = String(value ?? "").replace(",", ".").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export default function TransferPage() {
  const token = getToken() || ""
  const transferId = getTransferIdFromUrl()

  const [locations, setLocations] = useState<LocationOption[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("DRAFT")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const [header, setHeader] = useState({
    fromLocationId: getActiveLocationId(),
    toLocationId: "",
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    reason: "",
    note: "",
    delegateName: "",
    delegateCi: "",
    vehicle: "",
    vehicleNo: "",
    senderName: "",
    receiverName: "",
    approvedBy: "",
  })

  const [lines, setLines] = useState<TransferLine[]>([makeLine()])

  useEffect(() => {
    loadMeta()
    const unsubscribe = subscribeToActiveLocation((locationId) => {
      if (transferId) return
      setHeader((prev) => {
        if (!locationId || prev.fromLocationId === locationId) return prev
        return {
          ...prev,
          fromLocationId: locationId,
          toLocationId: prev.toLocationId === locationId ? "" : prev.toLocationId,
        }
      })
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (transferId) loadDoc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId])

  async function loadMeta() {
    if (!token) return
    setLoadingMeta(true)
    setError("")

    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [locRes, prodRes, numberingData] = await Promise.all([
        fetch(`${API}/api/v1/meta/locations`, { headers }),
        fetch(`${API}/api/v1/products`, { headers }),
        getDocumentNumbering().catch(() => null),
      ])

      const locData = await locRes.json().catch(() => ({}))
      const prodData = await prodRes.json().catch(() => ({}))

      if (locRes.status === 401 || prodRes.status === 401) {
        setError("Sesiunea a expirat. Intra din nou în cont ?i reîncearca.")
        return
      }

      const nextLocations = ensureArray<LocationOption>(locData.locations)
      const nextProducts = ensureArray<ProductOption>(prodData.items)

      setLocations(nextLocations)
      setProducts(nextProducts)
      setNumbering(numberingData?.previews || null)

      if (!transferId) {
        const activeLocationId = getActiveLocationId()
        const fallbackFrom = nextLocations.find((location) => location.id === activeLocationId)?.id || nextLocations[0]?.id || ""

        setHeader((prev) => ({
          ...prev,
          fromLocationId: prev.fromLocationId || fallbackFrom,
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, "transfer"),
          toLocationId:
            prev.toLocationId && prev.toLocationId !== (prev.fromLocationId || fallbackFrom)
              ? prev.toLocationId
              : nextLocations.find((location) => location.id !== (prev.fromLocationId || fallbackFrom))?.id || "",
        }))
      }
    } catch {
      setError("Nu am putut încarca datele pentru transfer.")
    } finally {
      setLoadingMeta(false)
    }
  }

  async function loadDoc() {
    if (!token || !transferId) return
    setLoadingDoc(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/transfers/${transferId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Sesiunea a expirat. Intra din nou în cont ?i reîncearca.")
        return
      }

      if (!data.ok || !data.doc) {
        setError(data.error || "Nu am putut încarca transferul.")
        return
      }

      const doc = data.doc
      setStatus(doc.status || "DRAFT")
      setHeader({
        fromLocationId: doc.fromLocationId || "",
        toLocationId: doc.toLocationId || "",
        docNo: doc.docNo || "",
        docDate: String(doc.docDate || "").slice(0, 10),
        reason: doc.reason || "",
        note: doc.note || "",
        delegateName: doc.delegateName || "",
        delegateCi: doc.delegateCi || "",
        vehicle: doc.vehicle || "",
        vehicleNo: doc.vehicleNo || "",
        senderName: doc.senderName || "",
        receiverName: doc.receiverName || "",
        approvedBy: doc.approvedBy || "",
      })

      const loadedLines = ensureArray(doc.items).map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        productId: item.productId || "",
        search: item.product?.name || "",
        sku: item.product?.sku || "",
        uomCode: item.uom?.code || item.product?.uom?.code || "",
        qty: String(item.qty ?? 1),
        unitPrice: String(item.unitPrice ?? 0),
      }))

      setLines(loadedLines.length ? loadedLines : [makeLine()])
    } catch {
      setError("Nu am putut încarca transferul.")
    } finally {
      setLoadingDoc(false)
    }
  }

  function setLineValue(id: string, patch: Partial<TransferLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()])
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const next = prev.filter((line) => line.id !== id)
      return next.length ? next : [makeLine()]
    })
  }

  function productMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []
    return products
      .filter((product) => {
        const haystack = [product.name, product.sku].filter(Boolean).join(" ").toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, 8)
  }

  function chooseProduct(lineId: string, product: ProductOption) {
    setLineValue(lineId, {
      productId: product.id,
      search: product.name || "",
      sku: product.sku || "",
      uomCode: product.uom?.code || "",
      unitPrice: String(product.price ?? 0),
    })
  }

  const validLines = useMemo(() => lines.filter((line) => line.productId && parsePositive(line.qty) > 0), [lines])

  const totals = useMemo(
    () =>
      validLines.reduce(
        (acc, line) => {
          const qty = parsePositive(line.qty)
          const unitPrice = Math.max(0, Number(line.unitPrice || 0))
          acc.totalQty += qty
          acc.totalValue += qty * unitPrice
          return acc
        },
        { totalQty: 0, totalValue: 0 }
      ),
    [validLines]
  )

  const isPosted = status === "POSTED"
  const fromLocation = locations.find((location) => location.id === header.fromLocationId)
  const toLocationOptions = locations.filter((location) => location.id !== header.fromLocationId)

  async function saveDoc(postNow = false) {
    if (!token) {
      setError("Lipse?te sesiunea de autentificare.")
      return
    }

    if (isPosted) {
      setError("Transferul este deja postat ?i nu mai poate fi modificat.")
      return
    }

    if (!header.fromLocationId) {
      setError("Selecteaza gestiunea predatoare.")
      return
    }

    if (!header.toLocationId) {
      setError("Selecteaza gestiunea primitoare.")
      return
    }

    if (header.fromLocationId === header.toLocationId) {
      setError("Gestiunea de plecare ?i cea de sosire trebuie sa fie diferite.")
      return
    }

    if (!header.docDate) {
      setError("Completeaza data documentului.")
      return
    }

    if (!validLines.length) {
      setError("Adauga cel pu?in un produs în transfer.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/transfers/full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: transferId || null,
          header,
          items: validLines.map((line) => ({
            productId: line.productId,
            qty: parsePositive(line.qty),
            unitPrice: Math.max(0, Number(line.unitPrice || 0)),
          })),
          postNow,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Sesiunea a expirat. Intra din nou în cont ?i reîncearca.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Transferul nu a putut fi salvat.")
        return
      }

      if (!transferId && data.doc?.id) {
        window.location.href = `/transfer/edit?id=${data.doc.id}`
        return
      }

      setStatus(data.doc?.status || (postNow ? "POSTED" : "DRAFT"))
      setMessage(postNow ? "Transferul a fost salvat ?i postat." : "Transferul a fost salvat ca draft.")
      if (transferId) await loadDoc()
    } catch {
      setError("A aparut o eroare la salvarea transferului.")
    } finally {
      setSaving(false)
    }
  }

  async function exportPdf() {
    if (!transferId) {
      setError("Salveaza documentul înainte de export.")
      return
    }

    const res = await fetch(`${API}/api/v1/transfers/${transferId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      setError("Nu am putut genera PDF-ul transferului.")
      return
    }

    await downloadPdfFile(res, `TRANSFER_${header.docNo || "document"}.pdf`)
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader badge="document" title={!transferId ? "Transfer nou" : isPosted ? "Transfer postat" : "Editare transfer"} />

      {loadingMeta ? <InlineNotice>Se încarca nomenclatoarele pentru transfer.</InlineNotice> : null}
      {loadingDoc ? <InlineNotice>Se încarca documentul selectat.</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {isPosted ? <InlineNotice>Documentul este postat ?i ramâne doar în regim de vizualizare ?i export PDF.</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DocumentMetric title="Status" value={<DocumentStatusPill status={status || "DRAFT"} />} tone="amber" />
        <DocumentMetric title="Cantitate totala" value={formatNumber(totals.totalQty)} tone="blue" />
        <DocumentMetric title="Valoare estimata" value={`${formatNumber(totals.totalValue)} RON`} tone="emerald" />
      </div>

      <div className="flex flex-wrap gap-2">
        <a href="/transfer" className={documentButtonSecondaryClass}>
          <ArrowLeft size={16} className="mr-2" />
          Înapoi la lista
        </a>
        <button type="button" className={documentButtonSecondaryClass} onClick={exportPdf} disabled={!transferId || loadingDoc}>
          <FileOutput size={16} className="mr-2" />
          PDF
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <DocumentSection title="Adauga produse transfer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-500">Scrie minim 2 litere, alege produsul ?i completeaza cantitatea ?i pre?ul.</div>
              {!isPosted ? (
                <button type="button" className={documentButtonPrimaryClass} onClick={addLine}>
                  <Plus size={16} className="mr-2" />
                  Adauga linie
                </button>
              ) : null}
            </div>

            <div className="max-h-[520px] overflow-y-auto pr-1">
              <div className="space-y-2">
                {lines.map((line, index) => {
                  const matches = productMatches(line.search)
                  const lineValue = parsePositive(line.qty) * Math.max(0, Number(line.unitPrice || 0))

                  return (
                    <div key={line.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">Pozi?ia {index + 1}</div>
                        {!isPosted ? (
                          <button type="button" onClick={() => removeLine(line.id)} className={documentButtonDangerClass}>
                            <Trash2 size={16} className="mr-2" />
                            ?terge
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.8fr)_110px_120px_120px_120px] lg:items-start">
                        <div className="min-w-0">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Produs</div>
                          <input
                            value={line.search}
                            onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "" })}
                            className={documentInputClass}
                            disabled={isPosted}
                            placeholder="Scrie 2-3 litere"
                          />

                          {line.search.trim().length >= 2 && !line.productId && !isPosted ? (
                            <div className="mt-2 rounded-[14px] border border-slate-200 bg-white p-2 shadow-sm">
                              {matches.length ? (
                                <div className="space-y-1.5">
                                  {matches.map((product) => (
                                    <button
                                      key={product.id}
                                      type="button"
                                      onClick={() => chooseProduct(line.id, product)}
                                      className="w-full rounded-[12px] px-3 py-2.5 text-left transition hover:bg-slate-50"
                                    >
                                      <div className="font-semibold text-slate-900">{product.name}</div>
                                      <div className="mt-1 text-xs text-slate-500">
                                        {product.sku || "Fara SKU"} · UM {product.uom?.code || "-"} · Pre? {formatNumber(product.price)}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-2 text-sm text-red-600">Nu am gasit niciun produs pentru „{line.search}”.</div>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">SKU</div>
                          <input value={line.sku} readOnly className={documentInputClass} style={readonlyInputStyle} />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">UM</div>
                          <input value={line.uomCode} readOnly className={documentInputClass} style={readonlyInputStyle} />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Cantitate</div>
                          <input
                            value={line.qty}
                            onChange={(e) => setLineValue(line.id, { qty: e.target.value })}
                            className={documentInputClass}
                            disabled={isPosted}
                          />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pre? / Total</div>
                          <input
                            value={line.unitPrice}
                            onChange={(e) => setLineValue(line.id, { unitPrice: e.target.value })}
                            className={documentInputClass}
                            disabled={isPosted}
                          />
                          <div className="mt-2 rounded-[12px] bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                            {formatNumber(lineValue)} RON
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </DocumentSection>
        </div>

        <div className="space-y-3">
          <DocumentSection title="Detalii document">
            <div className="space-y-3">
              <DocumentField label="Gestiune predatoare" hint={fromLocation?.code ? `Cod: ${fromLocation.code}` : undefined}>
                <div className="relative">
                  <Warehouse className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select
                    value={header.fromLocationId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      setHeader((prev) => ({
                        ...prev,
                        fromLocationId: nextId,
                        toLocationId: prev.toLocationId === nextId ? "" : prev.toLocationId,
                      }))
                      setActiveLocationId(nextId)
                    }}
                    className={`${documentInputClass} pl-9`}
                    disabled={isPosted}
                  >
                    <option value="">Selecteaza</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </div>
              </DocumentField>

              <DocumentField label="Gestiune primitoare">
                <div className="relative">
                  <ArrowRightLeft className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select
                    value={header.toLocationId}
                    onChange={(e) => setHeader((prev) => ({ ...prev, toLocationId: e.target.value }))}
                    className={`${documentInputClass} pl-9`}
                    disabled={isPosted}
                  >
                    <option value="">Selecteaza</option>
                    {toLocationOptions.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </div>
              </DocumentField>

              <DocumentField label="Nr. document">
                <input value={header.docNo} className={documentInputClass} readOnly style={readonlyInputStyle} />
              </DocumentField>

              <DocumentField label="Data document">
                <input
                  type="date"
                  value={header.docDate}
                  onChange={(e) => setHeader((prev) => ({ ...prev, docDate: e.target.value }))}
                  className={documentInputClass}
                  disabled={isPosted}
                />
              </DocumentField>

              <DocumentField label="Motiv transfer">
                <input
                  value={header.reason}
                  onChange={(e) => setHeader((prev) => ({ ...prev, reason: e.target.value }))}
                  className={documentInputClass}
                  disabled={isPosted}
                />
              </DocumentField>

              <DocumentField label="Observa?ii interne">
                <textarea
                  value={header.note}
                  onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
                  rows={4}
                  className={documentTextareaClass}
                  disabled={isPosted}
                />
              </DocumentField>

              <DocumentField label="Delegat / CI">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={header.delegateName}
                    onChange={(e) => setHeader((prev) => ({ ...prev, delegateName: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="Delegat"
                  />
                  <input
                    value={header.delegateCi}
                    onChange={(e) => setHeader((prev) => ({ ...prev, delegateCi: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="CI / BI"
                  />
                </div>
              </DocumentField>

              <DocumentField label="Transport">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="relative">
                    <Truck className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      value={header.vehicle}
                      onChange={(e) => setHeader((prev) => ({ ...prev, vehicle: e.target.value }))}
                      className={`${documentInputClass} pl-9`}
                      disabled={isPosted}
                      placeholder="Mijloc transport"
                    />
                  </div>
                  <input
                    value={header.vehicleNo}
                    onChange={(e) => setHeader((prev) => ({ ...prev, vehicleNo: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="Nr. auto"
                  />
                </div>
              </DocumentField>

              <DocumentField label="Semnaturi">
                <div className="grid grid-cols-1 gap-2">
                  <input
                    value={header.senderName}
                    onChange={(e) => setHeader((prev) => ({ ...prev, senderName: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="Am predat"
                  />
                  <input
                    value={header.receiverName}
                    onChange={(e) => setHeader((prev) => ({ ...prev, receiverName: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="Am primit"
                  />
                  <input
                    value={header.approvedBy}
                    onChange={(e) => setHeader((prev) => ({ ...prev, approvedBy: e.target.value }))}
                    className={documentInputClass}
                    disabled={isPosted}
                    placeholder="Avizat"
                  />
                </div>
              </DocumentField>

              <div className="grid grid-cols-1 gap-2">
                {!isPosted ? (
                  <>
                    <button type="button" className={documentButtonSecondaryClass} onClick={() => saveDoc(false)} disabled={saving || loadingDoc}>
                      {saving ? "Se salveaza..." : "Salveaza draft"}
                    </button>
                    <button type="button" className={documentButtonPrimaryClass} onClick={() => saveDoc(true)} disabled={saving || loadingDoc}>
                      {saving ? "Se salveaza..." : "Salveaza ?i posteaza"}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </DocumentSection>
        </div>
      </div>
    </div>
  )
}



