import { useEffect, useMemo, useState } from "react"
import { FileOutput, Plus, Search, Trash2 } from "lucide-react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  DocumentField,
  DocumentMetric,
  DocumentSection,
  DocumentStatusPill,
  InlineNotice,
  documentInputClass,
  documentTextareaClass,
  readonlyInputStyle,
} from "../components/DocumentUi"
import api from "../lib/api"
import { getDocumentNumbering, getPreviewValue } from "../lib/numbering"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { formatMoneyRo, formatQtyRo, parseLocaleNumber } from "../lib/format"
import { openPdfInNewTab } from "../lib/pdf"

type Product = {
  id: string
  name: string
  sku: string
  uom?: { code?: string } | null
  price?: number
  costPrice?: number
}

type Line = {
  id: string
  productId: string
  search: string
  qty: string
  unitValue: string
  oldPrice: string
  newPrice: string
  note: string
}

function makeLine(): Line {
  return {
    id: crypto.randomUUID(),
    productId: "",
    search: "",
    qty: "1",
    unitValue: "0",
    oldPrice: "0",
    newPrice: "0",
    note: "",
  }
}

export default function ProcesVerbalPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const id = searchParams.get("id") || ""
  const docType = location.pathname.includes("/pret/") ? "PRICE_CHANGE" : "DETERIORATION"
  const isDeterioration = docType === "DETERIORATION"

  const [locations, setLocations] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [numbering, setNumbering] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState("DRAFT")

  const [header, setHeader] = useState({
    locationId: getActiveLocationId(),
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    reasonCode: isDeterioration ? "DAMAGE" : "PRICE_UPDATE",
    findingCode: isDeterioration ? "DAMAGE_PARTIAL" : "",
    note: "",
  })
  const [lines, setLines] = useState<Line[]>([makeLine()])

  const pageTitle = isDeterioration ? "PV deteriorare" : "PV schimbare pret"

  useEffect(() => {
    void loadMeta()
    const unsubscribe = subscribeToActiveLocation((locationId) => {
      if (id) return
      setHeader((prev) => ({ ...prev, locationId: locationId || prev.locationId }))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (id) void loadDoc(id)
  }, [id])

  async function loadMeta() {
    try {
      const [locationsData, productsData, numberingData] = await Promise.all([
        api<any>("/api/v1/meta/locations"),
        api<any>("/api/v1/products"),
        getDocumentNumbering(),
      ])

      const nextLocations = Array.isArray(locationsData?.locations) ? locationsData.locations : []
      const nextProducts = Array.isArray(productsData) ? productsData : Array.isArray(productsData?.items) ? productsData.items : Array.isArray(productsData?.products) ? productsData.products : []

      setLocations(nextLocations)
      setProducts(nextProducts)
      setNumbering(numberingData?.previews || null)
      if (!id) {
        setHeader((prev) => ({
          ...prev,
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, isDeterioration ? "deterioration" : "priceChange"),
          locationId: prev.locationId || nextLocations[0]?.id || "",
        }))
      }
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca datele documentului.")
    }
  }

  async function loadDoc(docId: string) {
    setLoading(true)
    setError("")
    try {
      const data = await api<any>(`/api/v1/minutes-docs/${docId}`)
      const item = data?.item
      setStatus(item?.status || "DRAFT")
      setHeader({
        locationId: item?.locationId || "",
        docNo: item?.docNo || "",
        docDate: String(item?.docDate || "").slice(0, 10),
        reasonCode: item?.reasonCode || (isDeterioration ? "DAMAGE" : "PRICE_UPDATE"),
        findingCode: item?.findingCode || (isDeterioration ? "DAMAGE_PARTIAL" : ""),
        note: item?.note || "",
      })
      setLines(
        Array.isArray(item?.items) && item.items.length
          ? item.items.map((row: any) => ({
              id: row.id || crypto.randomUUID(),
              productId: row.productId || "",
              search: row.product?.name || "",
              qty: String(Number(row.qty || 0)),
              unitValue: String(Number(row.unitValue || 0)),
              oldPrice: String(Number(row.oldPrice || row.product?.price || 0)),
              newPrice: String(Number(row.newPrice || 0)),
              note: row.note || "",
            }))
          : [makeLine()]
      )
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca documentul.")
    } finally {
      setLoading(false)
    }
  }

  function setLineValue(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function chooseProduct(lineId: string, product: Product) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              productId: product.id,
              search: product.name,
              unitValue: isDeterioration ? String(Number(product.costPrice || 0)) : String(Number(product.price || 0)),
              oldPrice: String(Number(product.price || 0)),
            }
          : line
      )
    )
  }

  const validLines = useMemo(() => lines.filter((line) => line.productId), [lines])

  const totalValue = useMemo(
    () =>
      validLines.reduce((sum, line) => {
        const qty = Math.max(0, parseLocaleNumber(line.qty))
        if (isDeterioration) return sum + qty * Math.max(0, parseLocaleNumber(line.unitValue))
        return sum + qty * Math.max(0, parseLocaleNumber(line.newPrice))
      }, 0),
    [validLines, isDeterioration]
  )

  async function saveDoc(postNow = false) {
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const payload = {
        id: id || null,
        header: {
          ...header,
          type: docType,
          locationId: header.locationId,
        },
        items: validLines.map((line) => ({
          productId: line.productId,
          qty: Math.max(0, parseLocaleNumber(line.qty)),
          unitValue: Math.max(0, parseLocaleNumber(line.unitValue)),
          oldPrice: Math.max(0, parseLocaleNumber(line.oldPrice)),
          newPrice: Math.max(0, parseLocaleNumber(line.newPrice)),
          note: line.note || null,
        })),
        postNow,
      }

      const data = await api<any>("/api/v1/minutes-docs/full", {
        method: "POST",
        body: JSON.stringify(payload),
      })

      const nextId = data?.item?.id
      setStatus(data?.item?.status || (postNow ? "POSTED" : "DRAFT"))
      setMessage(postNow ? "Document salvat si postat." : "Document salvat.")

      if (!id && nextId) {
        navigate(
          isDeterioration
            ? `/inregistrare-document/pv-deteriorare/edit?id=${nextId}`
            : `/inregistrare-document/pv-schimbare-pret/edit?id=${nextId}`
        )
      } else if (id) {
        await loadDoc(id)
      }
    } catch (e: any) {
      setError(e?.message || "Nu pot salva documentul.")
    } finally {
      setSaving(false)
    }
  }

  async function openPdf() {
    if (!id) return
    const response = await api<Response>(`/api/v1/minutes-docs/${id}/pdf`, { raw: true })
    await openPdfInNewTab(response)
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader badge="document" title={pageTitle} />

      {loading ? <InlineNotice>Se incarca documentul...</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <DocumentMetric title="Status" value={<DocumentStatusPill status={status} />} tone="amber" />
        <DocumentMetric title="Pozitii" value={validLines.length} tone="slate" />
        <DocumentMetric title="Cantitate" value={formatQtyRo(validLines.reduce((sum, line) => sum + Math.max(0, parseLocaleNumber(line.qty)), 0), 3)} tone="blue" />
        <DocumentMetric title="Total" value={formatMoneyRo(totalValue, "RON")} tone="emerald" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate("/inregistrare-document")} className={documentButtonSecondaryClass}>
          Inapoi
        </button>
        {id ? (
          <button type="button" onClick={openPdf} className={documentButtonSecondaryClass}>
            <FileOutput size={16} className="mr-2" />
            PDF
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <DocumentSection
            title="Pozitii document"
            actions={
              status !== "POSTED" ? (
                <button type="button" onClick={() => setLines((prev) => [...prev, makeLine()])} className={documentButtonPrimaryClass}>
                  <Plus size={16} className="mr-2" />
                  Adauga linie
                </button>
              ) : null
            }
          >
            <div>
              <div className="space-y-2">
                {lines.map((line) => {
                  const matches =
                    line.search.trim().length < 2
                      ? []
                      : products
                          .filter((product) => {
                            const q = line.search.trim().toLowerCase()
                            return product.name.toLowerCase().includes(q) || String(product.sku || "").toLowerCase().includes(q)
                          })
                          .slice(0, 6)

                  return (
                    <div key={line.id} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.8fr)_110px_120px_120px_120px_110px] lg:items-start">
                        <div className="min-w-0">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Produs</div>
                          <input
                            value={line.search}
                            onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "" })}
                            placeholder="Produs..."
                            className={documentInputClass}
                            disabled={status === "POSTED"}
                          />
                          {matches.length && !line.productId && status !== "POSTED" ? (
                            <div className="mt-2 rounded-[14px] border border-slate-200 bg-white p-2 shadow-sm">
                              {matches.map((product) => (
                                <button
                                  key={product.id}
                                  type="button"
                                  onClick={() => chooseProduct(line.id, product)}
                                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                                >
                                  <span>{product.name}</span>
                                  <span className="text-xs text-slate-400">{product.sku || "-"}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Cantitate</div>
                          <input
                            value={line.qty}
                            onChange={(e) => setLineValue(line.id, { qty: e.target.value })}
                            placeholder="Cant."
                            className={documentInputClass}
                            disabled={status === "POSTED"}
                          />
                        </div>

                        {isDeterioration ? (
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Valoare</div>
                            <input
                              value={line.unitValue}
                              onChange={(e) => setLineValue(line.id, { unitValue: e.target.value })}
                              placeholder="Valoare"
                              className={documentInputClass}
                              disabled={status === "POSTED"}
                            />
                          </div>
                        ) : (
                          <>
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pret vechi</div>
                              <input
                                value={line.oldPrice}
                                onChange={(e) => setLineValue(line.id, { oldPrice: e.target.value })}
                                placeholder="Pret vechi"
                                className={documentInputClass}
                                disabled={status === "POSTED"}
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pret nou</div>
                              <input
                                value={line.newPrice}
                                onChange={(e) => setLineValue(line.id, { newPrice: e.target.value })}
                                placeholder="Pret nou"
                                className={documentInputClass}
                                disabled={status === "POSTED"}
                              />
                            </div>
                          </>
                        )}

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Total</div>
                          <input
                            value={
                              isDeterioration
                                ? formatMoneyRo(parseLocaleNumber(line.qty) * parseLocaleNumber(line.unitValue), "RON")
                                : formatMoneyRo(parseLocaleNumber(line.qty) * parseLocaleNumber(line.newPrice), "RON")
                            }
                            readOnly
                            className={`${documentInputClass} bg-slate-100 font-semibold`}
                          />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Actiune</div>
                          <button
                            type="button"
                            onClick={() => setLines((prev) => (prev.length === 1 ? [makeLine()] : prev.filter((item) => item.id !== line.id)))}
                            className={`${documentButtonSecondaryClass} w-full justify-center`}
                            disabled={status === "POSTED"}
                          >
                            <Trash2 size={16} className="mr-2" />
                            Sterge
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {status !== "POSTED" ? (
                <div className="mt-3 flex justify-center border-t border-dashed border-slate-200 pt-3">
                  <button type="button" onClick={() => setLines((prev) => [...prev, makeLine()])} className={documentButtonPrimaryClass}>
                    <Plus size={16} className="mr-2" />
                    Adauga linie
                  </button>
                </div>
              ) : null}
            </div>
          </DocumentSection>
        </div>

        <div className="space-y-3">
          <DocumentSection title="Detalii document">
            <div className="space-y-3">
              <DocumentField label="Locatie">
                <select
                  value={header.locationId}
                  onChange={(e) => {
                    setHeader((prev) => ({ ...prev, locationId: e.target.value }))
                    setActiveLocationId(e.target.value)
                  }}
                  className={documentInputClass}
                  disabled={status === "POSTED"}
                >
                  <option value="">Selecteaza locatia</option>
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </DocumentField>

              <DocumentField label="Nr. document">
                <input value={header.docNo} className={documentInputClass} readOnly style={readonlyInputStyle} />
              </DocumentField>

              <DocumentField label="Data">
                <input
                  type="date"
                  value={header.docDate}
                  onChange={(e) => setHeader((prev) => ({ ...prev, docDate: e.target.value }))}
                  className={documentInputClass}
                  disabled={status === "POSTED"}
                />
              </DocumentField>

              <DocumentField label="Motiv">
                <select
                  value={header.reasonCode}
                  onChange={(e) =>
                    setHeader((prev) => ({
                      ...prev,
                      reasonCode: e.target.value,
                      findingCode:
                        e.target.value === "EXPIRED"
                          ? "EXPIRED_FOUND"
                          : e.target.value === "LOSS"
                            ? "LOSS_FOUND"
                            : prev.findingCode === "EXPIRED_FOUND" || prev.findingCode === "LOSS_FOUND"
                              ? "DAMAGE_PARTIAL"
                              : prev.findingCode,
                    }))
                  }
                  className={documentInputClass}
                  disabled={status === "POSTED"}
                >
                  {isDeterioration ? (
                    <>
                      <option value="DAMAGE">Deteriorat</option>
                      <option value="EXPIRED">Expirat</option>
                      <option value="LOSS">Pierdere</option>
                      <option value="OTHER">Alt motiv</option>
                    </>
                  ) : (
                    <option value="PRICE_UPDATE">Schimbare pret</option>
                  )}
                </select>
              </DocumentField>

              {isDeterioration ? (
                <DocumentField label="Constatare">
                  <select
                    value={header.findingCode}
                    onChange={(e) => setHeader((prev) => ({ ...prev, findingCode: e.target.value }))}
                    className={documentInputClass}
                    disabled={status === "POSTED"}
                  >
                    <option value="DAMAGE_PARTIAL">Deteriorare partiala</option>
                    <option value="DAMAGE_TOTAL">Deteriorare totala</option>
                    <option value="EXPIRED_FOUND">Produs expirat</option>
                    <option value="LOSS_FOUND">Lipsa in gestiune</option>
                  </select>
                </DocumentField>
              ) : null}

              <DocumentField label="Observatii">
                <textarea
                  value={header.note}
                  onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
                  rows={4}
                  className={documentTextareaClass}
                  disabled={status === "POSTED"}
                />
              </DocumentField>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => saveDoc(false)} className={documentButtonSecondaryClass} disabled={saving}>
                  {saving ? "Se salveaza..." : "Salveaza draft"}
                </button>
                {status !== "POSTED" ? (
                  <button type="button" onClick={() => saveDoc(true)} className={documentButtonPrimaryClass} disabled={saving}>
                    {saving ? "Se salveaza..." : isDeterioration ? "Salveaza si posteaza" : "Salveaza si aplica"}
                  </button>
                ) : null}
              </div>
            </div>
          </DocumentSection>
        </div>
      </div>
    </div>
  )
}



