import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  DocumentField,
  DocumentSection,
  DocumentStatusPill,
  InlineNotice,
  documentInputClass,
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
    <div className="space-y-3">
      <PageHeader badge="operatiuni" title={pageTitle} />

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate("/inregistrare-document")}
            className={documentButtonSecondaryClass}
          >
            Inapoi
          </button>
          {id ? (
            <button type="button" onClick={openPdf} className={documentButtonSecondaryClass}>
              PDF
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
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

      <div className="flex items-center gap-2">
        <DocumentStatusPill status={status} />
      </div>

      <DocumentSection title="Antet document">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </DocumentField>

          <DocumentField label="Nr. document">
            <input
              value={header.docNo}
              className={documentInputClass}
              readOnly
              style={readonlyInputStyle}
            />
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
        </div>

        <div className="mt-3">
          <DocumentField label="Observatii">
            <textarea
              value={header.note}
              onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
              className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-[#17324D] outline-none transition focus:border-[#244A7C] focus:ring-2 focus:ring-[#DCE7F5]"
              rows={2}
              disabled={status === "POSTED"}
            />
          </DocumentField>
        </div>
      </DocumentSection>

      {isDeterioration ? (
        <DocumentSection title="Constatare">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            <DocumentField label="Observatii interne">
              <input
                value={header.note}
                onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
                className={documentInputClass}
                disabled={status === "POSTED"}
              />
            </DocumentField>
          </div>
        </DocumentSection>
      ) : null}

      <DocumentSection title="Pozitii">
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
              <div key={line.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className={`grid grid-cols-1 gap-2 ${isDeterioration ? "md:grid-cols-[2fr_110px_120px_1fr_44px]" : "md:grid-cols-[2fr_110px_120px_120px_1fr_44px]"}`}>
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Produs
                    </div>
                    <input
                      value={line.search}
                      onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "" })}
                      placeholder="Produs..."
                      className={documentInputClass}
                      disabled={status === "POSTED"}
                    />
                    {matches.length && !line.productId && status !== "POSTED" ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
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

                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                    Cantitate
                  </div>
                  <input
                    value={line.qty}
                    onChange={(e) => setLineValue(line.id, { qty: e.target.value })}
                    placeholder="Cant."
                    className={documentInputClass}
                    disabled={status === "POSTED"}
                  />

                  {isDeterioration ? (
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                        Valoare
                      </div>
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
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                          Pret vechi
                        </div>
                        <input
                          value={line.oldPrice}
                          onChange={(e) => setLineValue(line.id, { oldPrice: e.target.value })}
                          placeholder="Pret vechi"
                          className={documentInputClass}
                          disabled={status === "POSTED"}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                          Pret nou
                        </div>
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

                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Total
                    </div>
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

                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                      Actiuni
                    </div>
                    <button
                      type="button"
                      onClick={() => setLines((prev) => (prev.length === 1 ? [makeLine()] : prev.filter((item) => item.id !== line.id)))}
                      className={`${documentButtonSecondaryClass} w-full justify-center md:w-auto`}
                      disabled={status === "POSTED"}
                    >
                      X
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {status !== "POSTED" ? (
          <div className="mt-3">
            <button type="button" onClick={() => setLines((prev) => [...prev, makeLine()])} className={documentButtonPrimaryClass}>
              Adauga linie
            </button>
          </div>
        ) : null}
      </DocumentSection>

      <DocumentSection title="Sumar">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pozitii</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{validLines.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cantitate</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatQtyRo(validLines.reduce((sum, line) => sum + Math.max(0, parseLocaleNumber(line.qty)), 0), 3)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{formatMoneyRo(totalValue, "RON")}</div>
          </div>
        </div>
      </DocumentSection>
    </div>
  )
}
