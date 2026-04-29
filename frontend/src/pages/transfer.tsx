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
  address?: string | null
  city?: string | null
  county?: string | null
  country?: string | null
  postalCode?: string | null
}

type ProductOption = {
  id: string
  name: string
  sku?: string
  price?: number
  ncCode?: string | null
  isFiscalRiskProduct?: boolean
  grossWeightKg?: number
  uom?: { code?: string; standardCode?: string | null; name?: string | null } | null
}

type CompanyLookupResult = {
  name?: string
  cui?: string
  address?: string
  city?: string
  county?: string
  country?: string
  postalCode?: string
}

const ETRANSPORT_OPERATION_OPTIONS = [
  { value: "AIC", label: "AIC - Ach. intracomunitara" },
  { value: "LIH", label: "LIH - Lohn (UE) - intrare" },
  { value: "SC", label: "SC - Stoc client - intrare" },
  { value: "LIC", label: "LIC - Livr. intracomunitara" },
  { value: "LHE", label: "LHE - Lohn (UE) - iesire" },
  { value: "SCE", label: "SCE - Stoc client - iesire" },
  { value: "TTN", label: "TTN - Transp. pe teritoriul national" },
  { value: "IMP", label: "IMP - Import" },
  { value: "EXP", label: "EXP - Export" },
  { value: "ITD", label: "ITD - Intrare pentru depozitare" },
  { value: "DIE", label: "DIE - Iesire dupa depozitare" },
] as const

const ETRANSPORT_SCOPE_OPTIONS = [
  { value: "ADR", label: "ADR - Traseul incepe / se finalizeaza intr-un loc de pe teritoriul national" },
  { value: "PTF", label: "PTF - Punct rutier de trecere a frontierei" },
] as const

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

function formatUomOption(uom?: { code?: string | null; standardCode?: string | null; name?: string | null } | null) {
  const shortCode = String(uom?.code || "").trim().toUpperCase()
  const standardCode = String(uom?.standardCode || "").trim().toUpperCase()
  const fallbackName = String(uom?.name || "").trim()
  if (shortCode && standardCode) return `${shortCode}-${standardCode}`
  if (shortCode) return shortCode
  if (standardCode) return standardCode
  return fallbackName || "-"
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
  const [eTransportBusy, setETransportBusy] = useState(false)
  const [status, setStatus] = useState("DRAFT")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [partnerLookupBusy, setPartnerLookupBusy] = useState(false)

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
    trailerNo: "",
    eTransportOperationType: "TTN",
    eTransportPartnerCountry: "RO",
    eTransportPartnerCui: "",
    eTransportPartnerName: "",
    eTransportInternalRef: "",
    eTransportStartScope: "ADR",
    eTransportEndScope: "ADR",
    senderName: "",
    receiverName: "",
    approvedBy: "",
    eTransportDeclaredStart: "",
    eTransportVehicleMaxMassKg: "",
    eTransportOrganizer: "",
    eTransportOperator: "",
    eTransportRequired: false,
    eTransportCandidate: false,
    eTransportUit: "",
    eTransportStatus: "",
    eTransportUploadIndex: "",
    eTransportDownloadId: "",
    eTransportErrorText: "",
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
      const [locRes, prodRes, companyRes, numberingData] = await Promise.all([
        fetch(`${API}/api/v1/meta/locations`, { headers }),
        fetch(`${API}/api/v1/products`, { headers }),
        fetch(`${API}/api/v1/company`, { headers }),
        getDocumentNumbering().catch(() => null),
      ])

      const locData = await locRes.json().catch(() => ({}))
      const prodData = await prodRes.json().catch(() => ({}))
      const companyData = await companyRes.json().catch(() => ({}))

      if (locRes.status === 401 || prodRes.status === 401 || companyRes.status === 401) {
        setError("Sesiunea a expirat. Intra din nou in cont si reincerca.")
        return
      }

      const nextLocations = ensureArray<LocationOption>(locData.locations)
      const nextProducts = ensureArray<ProductOption>(prodData.items)

      setLocations(nextLocations)
      setProducts(nextProducts)
      setNumbering(numberingData?.previews || null)
      const activeCompany = companyData?.company || null

      if (!transferId) {
        const activeLocationId = getActiveLocationId()
        const fallbackFrom = nextLocations.find((location) => location.id === activeLocationId)?.id || nextLocations[0]?.id || ""

        setHeader((prev) => ({
          ...prev,
          fromLocationId: prev.fromLocationId || fallbackFrom,
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, "transfer"),
          eTransportOrganizer: prev.eTransportOrganizer || String(activeCompany?.name || "").trim(),
          eTransportPartnerCountry: prev.eTransportPartnerCountry || "RO",
          toLocationId:
            prev.toLocationId && prev.toLocationId !== (prev.fromLocationId || fallbackFrom)
              ? prev.toLocationId
              : nextLocations.find((location) => location.id !== (prev.fromLocationId || fallbackFrom))?.id || "",
        }))
      }
    } catch {
      setError("Nu am putut incarca datele pentru transfer.")
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
        setError("Sesiunea a expirat. Intra din nou in cont si reincerca.")
        return
      }

      if (!data.ok || !data.doc) {
        setError(data.error || "Nu am putut incarca transferul.")
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
        trailerNo: doc.trailerNo || "",
        eTransportOperationType: doc.eTransportOperationType || "TTN",
        eTransportPartnerCountry: doc.eTransportPartnerCountry || "RO",
        eTransportPartnerCui: doc.eTransportPartnerCui || "",
        eTransportPartnerName: doc.eTransportPartnerName || "",
        eTransportInternalRef: doc.eTransportInternalRef || "",
        eTransportStartScope: doc.eTransportStartScope || "ADR",
        eTransportEndScope: doc.eTransportEndScope || "ADR",
        senderName: doc.senderName || "",
        receiverName: doc.receiverName || "",
        approvedBy: doc.approvedBy || "",
        eTransportDeclaredStart: doc.eTransportDeclaredStart ? String(doc.eTransportDeclaredStart).slice(0, 16) : "",
        eTransportVehicleMaxMassKg:
          doc.eTransportVehicleMaxMassKg || doc.eTransportVehicleMaxMassKg === 0
            ? String(doc.eTransportVehicleMaxMassKg)
            : "",
        eTransportOrganizer: doc.eTransportOrganizer || "",
        eTransportOperator: doc.eTransportOperator || "",
        eTransportRequired: doc.eTransportRequired === true,
        eTransportCandidate: doc.eTransportCandidate === true,
        eTransportUit: doc.eTransportUit || "",
        eTransportStatus: doc.eTransportStatus || "",
        eTransportUploadIndex: doc.eTransportUploadIndex || "",
        eTransportDownloadId: doc.eTransportDownloadId || "",
        eTransportErrorText: doc.eTransportErrorText || "",
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
      setError("Nu am putut incarca transferul.")
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

  const eTransportSummary = useMemo(() => {
    const selectedProducts = validLines
      .map((line) => {
        const product = products.find((item) => item.id === line.productId)
        if (!product) return null
        return {
          qty: parsePositive(line.qty),
          lineValue: parsePositive(line.qty) * Math.max(0, Number(line.unitPrice || 0)),
          product,
        }
      })
      .filter(Boolean) as Array<{
      qty: number
      lineValue: number
      product: ProductOption
    }>

    const totalGrossWeightKg = selectedProducts.reduce((sum, line) => {
      return sum + line.qty * Math.max(0, Number(line.product.grossWeightKg || 0))
    }, 0)
    const totalValueRon = selectedProducts.reduce((sum, line) => sum + line.lineValue, 0)
    const hasFiscalRiskProducts = selectedProducts.some((line) => line.product.isFiscalRiskProduct === true)
    const thresholdsReached = totalGrossWeightKg > 500 || totalValueRon > 10000
    const vehicleMaxMassKg = parsePositive(header.eTransportVehicleMaxMassKg)
    const vehicleEligible = vehicleMaxMassKg >= 2500
    const candidate = hasFiscalRiskProducts && thresholdsReached
    const required = candidate && vehicleEligible

    return {
      candidate,
      required,
      hasFiscalRiskProducts,
      thresholdsReached,
      vehicleEligible,
      totalGrossWeightKg,
      totalValueRon,
    }
  }, [validLines, products, header.eTransportVehicleMaxMassKg])

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

  useEffect(() => {
    setHeader((prev) => {
      const nextCandidate = eTransportSummary.candidate
      const nextRequired = nextCandidate ? (prev.eTransportRequired || eTransportSummary.required) : false
      if (prev.eTransportCandidate === nextCandidate && prev.eTransportRequired === nextRequired) {
        return prev
      }
      return {
        ...prev,
        eTransportCandidate: nextCandidate,
        eTransportRequired: nextRequired,
      }
    })
  }, [eTransportSummary.candidate, eTransportSummary.required])

  const isPosted = status === "POSTED"
  const fromLocation = locations.find((location) => location.id === header.fromLocationId)
  const toLocationOptions = locations.filter((location) => location.id !== header.fromLocationId)

  async function saveDoc(postNow = false) {
    if (!token) {
      setError("Lipseste sesiunea de autentificare.")
      return
    }

    if (isPosted) {
      setError("Transferul este deja postat si nu mai poate fi modificat.")
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
      setError("Gestiunea de plecare si cea de sosire trebuie sa fie diferite.")
      return
    }

    if (!header.docDate) {
      setError("Completeaza data documentului.")
      return
    }

    if (!validLines.length) {
      setError("Adauga cel putin un produs in transfer.")
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
          header: {
            ...header,
            eTransportCandidate: eTransportSummary.candidate,
            eTransportRequired: header.eTransportRequired || eTransportSummary.required,
          },
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
        setError("Sesiunea a expirat. Intra din nou in cont si reincerca.")
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
      setMessage(postNow ? "Transferul a fost salvat si postat." : "Transferul a fost salvat ca draft.")
      if (transferId) await loadDoc()
    } catch {
      setError("A aparut o eroare la salvarea transferului.")
    } finally {
      setSaving(false)
    }
  }

  async function exportPdf() {
    if (!transferId) {
      setError("Salveaza documentul inainte de export.")
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

  async function generateETransportXml() {
    if (!transferId) {
      setError("Salveaza mai intai transferul.")
      return
    }

    setETransportBusy(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/transfers/${transferId}/etransport/prepare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Sesiunea a expirat. Intra din nou in cont si reincerca.")
        return
      }

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut genera XML-ul RO e-Transport.")
        return
      }

      setMessage(data.message || "XML RO e-Transport generat.")
      await loadDoc()
    } catch {
      setError("Nu am putut genera XML-ul RO e-Transport.")
    } finally {
      setETransportBusy(false)
    }
  }

  async function lookupPartnerByCui() {
    const normalizedCui = String(header.eTransportPartnerCui || "").trim().replace(/^RO/i, "").replace(/\D/g, "")
    if (!normalizedCui) {
      setError("Completeaza CUI-ul partenerului.")
      return
    }

    setPartnerLookupBusy(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(normalizedCui)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.company) {
        setError(data?.error || "Nu am gasit partenerul dupa CUI.")
        return
      }
      const company = data.company as CompanyLookupResult
      setHeader((prev) => ({
        ...prev,
        eTransportPartnerCui: normalizedCui,
        eTransportPartnerName: String(company.name || "").trim() || prev.eTransportPartnerName,
        eTransportPartnerCountry: "RO",
      }))
      setMessage("Partenerul a fost completat dupa CUI.")
    } catch {
      setError("Nu am putut cauta partenerul dupa CUI.")
    } finally {
      setPartnerLookupBusy(false)
    }
  }

  async function downloadETransportXml() {
    if (!transferId) {
      setError("Salveaza mai intai transferul.")
      return
    }

    setError("")
    const res = await fetch(`${API}/api/v1/transfers/${transferId}/etransport/xml`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Nu am putut descarca XML-ul RO e-Transport.")
      return
    }

    await downloadPdfFile(res, `RO-e-Transport-${header.docNo || "document"}.xml`)
  }

  const eTransportPrepared = ["PREPARED", "READY_TO_REVIEW", "SENT", "ACCEPTED"].includes(header.eTransportStatus || "")

  return (
    <div className="w-full space-y-4">
      <PageHeader badge="document" title={!transferId ? "Transfer nou" : isPosted ? "Transfer postat" : "Editare transfer"} />

      {loadingMeta ? <InlineNotice>Se incarca nomenclatoarele pentru transfer.</InlineNotice> : null}
      {loadingDoc ? <InlineNotice>Se incarca documentul selectat.</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {isPosted ? <InlineNotice>Documentul este postat si ramane doar in regim de vizualizare si export PDF.</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DocumentMetric title="Status" value={<DocumentStatusPill status={status || "DRAFT"} />} tone="amber" />
        <DocumentMetric title="Cantitate totala" value={formatNumber(totals.totalQty)} tone="blue" />
        <DocumentMetric title="Valoare estimata" value={`${formatNumber(totals.totalValue)} RON`} tone="emerald" />
      </div>

      {eTransportSummary.candidate ? (
        <InlineNotice tone={eTransportSummary.required ? "success" : "info"}>
          {eTransportSummary.required
            ? "Transferul intra in zona RO e-Transport pe baza produselor, valorii/greutatii si vehiculului completat."
            : "Transferul este candidat pentru RO e-Transport. Completeaza masa maxima a vehiculului si datele de transport pentru confirmare."}
        </InlineNotice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a href="/transfer" className={documentButtonSecondaryClass}>
          <ArrowLeft size={16} className="mr-2" />
          Inapoi la lista
        </a>
        <button type="button" className={documentButtonSecondaryClass} onClick={exportPdf} disabled={!transferId || loadingDoc}>
          <FileOutput size={16} className="mr-2" />
          PDF
        </button>
        <button type="button" className={documentButtonSecondaryClass} onClick={generateETransportXml} disabled={!transferId || loadingDoc || eTransportBusy}>
          <Truck size={16} className="mr-2" />
          {eTransportBusy ? "Se genereaza..." : "Genereaza XML"}
        </button>
        <button type="button" className={documentButtonSecondaryClass} onClick={downloadETransportXml} disabled={!transferId || !eTransportPrepared || loadingDoc}>
          <Truck size={16} className="mr-2" />
          XML
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="space-y-3 order-2">
          <DocumentSection title="Linii transfer" description="Adaugi produsele mutate intre gestiuni si completezi rapid cantitatea si pretul.">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-500">Scrie minim 2 litere, alege produsul si completeaza cantitatea si pretul.</div>
              {!isPosted ? (
                <button type="button" className={documentButtonPrimaryClass} onClick={addLine}>
                  <Plus size={16} className="mr-2" />
                  Adauga linie
                </button>
              ) : null}
            </div>

            <div>
              <div className="space-y-2">
                {lines.map((line, index) => {
                  const matches = productMatches(line.search)
                  const lineValue = parsePositive(line.qty) * Math.max(0, Number(line.unitPrice || 0))

                  return (
                    <div key={line.id} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">Pozitia {index + 1}</div>
                        {!isPosted ? (
                          <button type="button" onClick={() => removeLine(line.id)} className={documentButtonDangerClass}>
                            <Trash2 size={16} className="mr-2" />
                            Sterge
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.8fr)_110px_120px_120px_120px] lg:items-start">
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
                                        {product.sku || "Fara SKU"} - UM {formatUomOption(product.uom)} - Pret {formatNumber(product.price)}
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
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pret / Total</div>
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

              {!isPosted ? (
                <div className="mt-3 flex justify-center border-t border-dashed border-slate-200 pt-3">
                  <button type="button" className={documentButtonPrimaryClass} onClick={addLine}>
                    <Plus size={16} className="mr-2" />
                    Adauga linie
                  </button>
                </div>
              ) : null}
            </div>
          </DocumentSection>
        </div>

        <div className="space-y-3 order-1">
          <DocumentSection title="Detalii transfer" description="Completezi documentul, transportul si datele RO e-Transport in blocuri separate.">
            <div className="space-y-3">
              <DocumentSection title="Document si traseu">
                <div className="space-y-3">
                  <DocumentField label="Gestiuni">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                          <option value="">Gestiune predatoare</option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>{location.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="relative">
                        <ArrowRightLeft className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <select
                          value={header.toLocationId}
                          onChange={(e) => setHeader((prev) => ({ ...prev, toLocationId: e.target.value }))}
                          className={`${documentInputClass} pl-9`}
                          disabled={isPosted}
                        >
                          <option value="">Gestiune primitoare</option>
                          {toLocationOptions.map((location) => (
                            <option key={location.id} value={location.id}>{location.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </DocumentField>

                  <DocumentField label="Date document">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input value={header.docNo} className={documentInputClass} readOnly style={readonlyInputStyle} />
                      <input
                        type="date"
                        value={header.docDate}
                        onChange={(e) => setHeader((prev) => ({ ...prev, docDate: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      />
                    </div>
                  </DocumentField>

                  <DocumentField label="Motiv / observatii">
                    <div className="space-y-2">
                      <input
                        value={header.reason}
                        onChange={(e) => setHeader((prev) => ({ ...prev, reason: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Motiv transfer"
                      />
                      <textarea
                        value={header.note}
                        onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
                        rows={3}
                        className={documentTextareaClass}
                        disabled={isPosted}
                        placeholder="Observatii"
                      />
                    </div>
                  </DocumentField>
                </div>
              </DocumentSection>

              <DocumentSection title="Transport">
                <div className="space-y-3">
                  <DocumentField label="Mijloc transport">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                        placeholder="Numar vehicul"
                      />
                      <input
                        value={header.trailerNo}
                        onChange={(e) => setHeader((prev) => ({ ...prev, trailerNo: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Numar remorca"
                      />
                    </div>
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
                </div>
              </DocumentSection>

              <DocumentSection title="RO e-Transport" description="Completezi datele de notificare si generezi XML-ul local pentru transport.">
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <DocumentMetric title="Candidat" value={header.eTransportCandidate ? "Da" : "Nu"} tone={header.eTransportCandidate ? "amber" : "slate"} />
                    <DocumentMetric title="XML" value={eTransportPrepared ? "Generat" : "Negenerat"} tone={eTransportPrepared ? "emerald" : "slate"} />
                    <DocumentMetric title="Status UIT" value={header.eTransportStatus || "-"} tone="emerald" />
                  </div>

                  <DocumentMetric title="Greutate bruta" value={`${formatNumber(eTransportSummary.totalGrossWeightKg)} kg`} tone="blue" />

                  <DocumentField label="Generalitati">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <select
                        value={header.eTransportOperationType}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportOperationType: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      >
                        {ETRANSPORT_OPERATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <input
                        value={header.eTransportInternalRef}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportInternalRef: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Referinta interna operatiune"
                      />
                    </div>
                  </DocumentField>

                  <DocumentField label="Partener">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_minmax(0,1fr)_170px]">
                      <input
                        value={header.eTransportPartnerCountry}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportPartnerCountry: e.target.value.toUpperCase() }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Tara"
                      />
                      <input
                        value={header.eTransportPartnerCui}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportPartnerCui: e.target.value }))}
                        onBlur={() => {
                          if (header.eTransportPartnerCui.trim()) lookupPartnerByCui()
                        }}
                        className={documentInputClass}
                        disabled={isPosted || partnerLookupBusy}
                        placeholder="CUI partener"
                      />
                      <button type="button" className={documentButtonSecondaryClass} onClick={lookupPartnerByCui} disabled={isPosted || partnerLookupBusy}>
                        {partnerLookupBusy ? "Se cauta..." : "Cauta CUI"}
                      </button>
                    </div>
                    <input
                      value={header.eTransportPartnerName}
                      onChange={(e) => setHeader((prev) => ({ ...prev, eTransportPartnerName: e.target.value }))}
                      className={`${documentInputClass} mt-2`}
                      disabled={isPosted}
                      placeholder="Denumire partener"
                    />
                  </DocumentField>

                  <DocumentField label="Start transport">
                    <input
                      type="datetime-local"
                      value={header.eTransportDeclaredStart}
                      onChange={(e) => setHeader((prev) => ({ ...prev, eTransportDeclaredStart: e.target.value }))}
                      className={documentInputClass}
                      disabled={isPosted}
                    />
                  </DocumentField>

                  <DocumentField label="Locuri start / final traseu">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <select
                        value={header.eTransportStartScope}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportStartScope: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      >
                        {ETRANSPORT_SCOPE_OPTIONS.map((option) => (
                          <option key={`start-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <select
                        value={header.eTransportEndScope}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportEndScope: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      >
                        {ETRANSPORT_SCOPE_OPTIONS.map((option) => (
                          <option key={`end-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </DocumentField>

                  <DocumentField label="Organizator / transportator">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={header.eTransportOrganizer}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportOrganizer: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Organizator transport"
                      />
                      <input
                        value={header.eTransportOperator}
                        onChange={(e) => setHeader((prev) => ({ ...prev, eTransportOperator: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                        placeholder="Operator / transportator"
                      />
                    </div>
                  </DocumentField>

                  <DocumentField label="Masa maxima vehicul (kg)">
                    <input
                      value={header.eTransportVehicleMaxMassKg}
                      onChange={(e) => setHeader((prev) => ({ ...prev, eTransportVehicleMaxMassKg: e.target.value }))}
                      className={documentInputClass}
                      disabled={isPosted}
                      placeholder="Ex: 3500"
                    />
                  </DocumentField>

                  <DocumentField label="Coduri ANAF">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input value={header.eTransportUit} readOnly className={documentInputClass} style={readonlyInputStyle} placeholder="UIT" />
                      <input value={header.eTransportUploadIndex} readOnly className={documentInputClass} style={readonlyInputStyle} placeholder="ID incarcare" />
                      <input value={header.eTransportDownloadId} readOnly className={documentInputClass} style={readonlyInputStyle} placeholder="ID descarcare" />
                    </div>
                  </DocumentField>

                  {header.eTransportErrorText ? <InlineNotice tone="info">{header.eTransportErrorText}</InlineNotice> : null}
                </div>
              </DocumentSection>

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
                      {saving ? "Se salveaza..." : "Salveaza si posteaza"}
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



