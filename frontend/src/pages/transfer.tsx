import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRightLeft, ChevronDown, FileOutput, FileText, PackagePlus, Plus, Search, Trash2, Truck, Warehouse } from "lucide-react"
import { useNavigate } from "react-router-dom"
import {
  DocumentMetric,
  DocumentPageHeader,
  DocumentSection,
  DocumentStatusPill,
  DocumentTabs,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
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
  netWeightKg?: number
  grossWeightKg?: number
  vatRate?: { rate?: number | null } | null
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

type ETransportAdrForm = {
  sourceLocationId: string
  companyCui: string
  companyName: string
  country: string
  county: string
  city: string
  street: string
  streetNo: string
  building: string
  staircase: string
  floor: string
  apartment: string
  postalCode: string
  details: string
}

type ActiveCompany = {
  name?: string
  cui?: string
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

const ETRANSPORT_BORDER_POINTS = [
  "Albita",
  "Bechet",
  "Bors",
  "Bors 2 - A3",
  "Calafat",
  "Calarasi (Chiciu)",
  "Carei",
  "Cenad",
  "Constanta Sud Agigea",
  "Corabia",
  "Episcopia Bihor",
  "Galati Giurgiulesti",
  "Giurgiu",
  "Halmeu",
  "Jimbolia",
  "Naidas",
  "Nadlac",
  "Nadlac 2 - A1",
  "Negru Voda",
  "Oncesti",
  "Ostrov",
  "Petea",
  "Portile de Fier 1",
  "Sculeni",
  "Siret",
  "Stanca Costesti",
  "Stamora Moravita",
  "Turnu Magurele",
  "Urziceni",
  "Valea lui Mihai",
  "Vama Veche",
  "Vladimirescu",
  "Varsand",
  "Zimnicea",
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

function shouldOpenETransportFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("etr") === "1"
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

function buildLocationLabel(location?: LocationOption | null) {
  if (!location) return ""
  return [location.name, location.address, location.city, location.county]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ")
}

function buildAddressOptions(locations: LocationOption[]) {
  return locations
    .map((location) => ({
      id: location.id,
      name: location.name,
      label: buildLocationLabel(location),
    }))
    .filter((location) => location.label)
}

function createEmptyAdrForm(): ETransportAdrForm {
  return {
    sourceLocationId: "",
    companyCui: "",
    companyName: "",
    country: "Romania",
    county: "",
    city: "",
    street: "",
    streetNo: "",
    building: "",
    staircase: "",
    floor: "",
    apartment: "",
    postalCode: "",
    details: "",
  }
}

function splitStreetAddress(value: string) {
  const text = String(value || "").trim()
  if (!text) return { street: "", streetNo: "" }

  const explicitNo = text.match(/^(.*?)(?:\s*,?\s*(?:nr|nr\.)\s*)([A-Za-z0-9\-\/]+)\s*$/i)
  if (explicitNo) {
    return {
      street: explicitNo[1].trim(),
      streetNo: explicitNo[2].trim(),
    }
  }

  const trailingNo = text.match(/^(.*?)(?:\s+)(\d+[A-Za-z0-9\-\/]*)$/)
  if (trailingNo) {
    return {
      street: trailingNo[1].trim(),
      streetNo: trailingNo[2].trim(),
    }
  }

  return { street: text, streetNo: "" }
}

function buildAdrFormFromLocation(location?: LocationOption | null): ETransportAdrForm {
  if (!location) return createEmptyAdrForm()
  const parsedStreet = splitStreetAddress(String(location.address || ""))
  return {
    sourceLocationId: location.id,
      companyCui: "",
      companyName: location.name || "",
      country: location.country || "Romania",
      county: location.county || "",
      city: location.city || "",
      street: parsedStreet.street,
      streetNo: parsedStreet.streetNo,
      building: "",
      staircase: "",
      floor: "",
      apartment: "",
      postalCode: location.postalCode || "",
      details: "",
    }
  }

function buildAdrFormFromCompany(company?: CompanyLookupResult | null, fallback?: Partial<ETransportAdrForm>) {
  const rawStreet = String(company?.address || fallback?.street || "")
  const parsedStreet = splitStreetAddress(rawStreet)
  return {
    ...createEmptyAdrForm(),
    ...fallback,
    sourceLocationId: "",
    companyCui: String(fallback?.companyCui || company?.cui || ""),
    companyName: String(company?.name || fallback?.companyName || ""),
    country: normalizeCountryLabel(String(company?.country || fallback?.country || "Romania")),
    county: String(company?.county || fallback?.county || ""),
    city: String(company?.city || fallback?.city || ""),
    street: parsedStreet.street,
    streetNo: String(fallback?.streetNo || parsedStreet.streetNo || ""),
    building: String(fallback?.building || ""),
    staircase: String(fallback?.staircase || ""),
    floor: String(fallback?.floor || ""),
    apartment: String(fallback?.apartment || ""),
    postalCode: String(company?.postalCode || fallback?.postalCode || ""),
    details: String(fallback?.details || ""),
  }
}

function routeAdrFromParty(form?: Partial<ETransportAdrForm> | null): ETransportAdrForm {
  return {
    ...createEmptyAdrForm(),
    companyCui: String(form?.companyCui || ""),
    companyName: String(form?.companyName || ""),
    country: String(form?.country || "Romania"),
    county: String(form?.county || ""),
    city: String(form?.city || ""),
    street: String(form?.street || ""),
    streetNo: String(form?.streetNo || ""),
    building: String(form?.building || ""),
    staircase: String(form?.staircase || ""),
    floor: String(form?.floor || ""),
    apartment: String(form?.apartment || ""),
    postalCode: String(form?.postalCode || ""),
    details: String(form?.details || ""),
    sourceLocationId: "",
  }
}

function buildOrganizerStartAdr(company: ActiveCompany | null, location?: LocationOption | null): ETransportAdrForm {
  return {
    ...buildAdrFormFromLocation(location),
    companyCui: String(company?.cui || ""),
    companyName: String(company?.name || location?.name || ""),
  }
}

function buildPartnerEndAdr(
  partner: { cui?: string | null; name?: string | null; country?: string | null },
  fallbackLocation?: LocationOption | null,
): ETransportAdrForm {
  if (partner.cui || partner.name) {
    return routeAdrFromParty(
      buildAdrFormFromCompany(
        {
          cui: partner.cui || "",
          name: partner.name || "",
          country: partner.country || "RO",
        },
        { companyCui: partner.cui || "" },
      ),
    )
  }
  return buildAdrFormFromLocation(fallbackLocation)
}

function normalizeCountryLabel(value: string) {
  const text = String(value || "").trim()
  if (!text) return "Romania"
  return text.toUpperCase() === "RO" ? "Romania" : text
}

function normalizeStoredAddressText(value: string) {
  return String(value || "").trim()
}

function serializeAdrForm(form: ETransportAdrForm) {
  return `ADRJSON:${JSON.stringify({
    sourceLocationId: form.sourceLocationId || "",
    companyCui: form.companyCui || "",
    companyName: form.companyName || "",
    country: form.country || "",
    county: form.county || "",
    city: form.city || "",
    street: form.street || "",
    streetNo: form.streetNo || "",
    building: form.building || "",
    staircase: form.staircase || "",
    floor: form.floor || "",
    apartment: form.apartment || "",
    address: form.street || "",
    postalCode: form.postalCode || "",
    details: form.details || "",
    extra: form.details || "",
  })}`
}

function parseAdrForm(value: string, fallbackLocation?: LocationOption | null) {
  const text = normalizeStoredAddressText(value)
  if (text.startsWith("ADRJSON:")) {
    try {
      const parsed = JSON.parse(text.slice("ADRJSON:".length))
        return {
          sourceLocationId: String(parsed?.sourceLocationId || ""),
          companyCui: String(parsed?.companyCui || ""),
          companyName: String(parsed?.companyName || ""),
          country: normalizeCountryLabel(String(parsed?.country || "")),
          county: String(parsed?.county || ""),
          city: String(parsed?.city || ""),
          street: String(parsed?.street || parsed?.address || ""),
          streetNo: String(parsed?.streetNo || ""),
          building: String(parsed?.building || ""),
          staircase: String(parsed?.staircase || ""),
          floor: String(parsed?.floor || ""),
          apartment: String(parsed?.apartment || ""),
          postalCode: String(parsed?.postalCode || ""),
          details: String(parsed?.details || parsed?.extra || ""),
        } satisfies ETransportAdrForm
      } catch {
        return buildAdrFormFromLocation(fallbackLocation)
      }
    }

  if (text) {
      return {
        ...buildAdrFormFromLocation(fallbackLocation),
        street: text,
        sourceLocationId: "",
      }
    }

  return buildAdrFormFromLocation(fallbackLocation)
}

function adrFormHasContent(form: ETransportAdrForm) {
  return Boolean(
      form.companyName.trim() ||
        form.street.trim() ||
        form.streetNo.trim() ||
        form.building.trim() ||
        form.staircase.trim() ||
        form.floor.trim() ||
        form.apartment.trim() ||
        form.city.trim() ||
        form.county.trim() ||
        form.postalCode.trim() ||
        form.details.trim()
    )
  }

function parsePositive(value: any) {
  const normalized = String(value ?? "").replace(",", ".").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function labelValue(label: string, value: string) {
  return (
    <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{value || "-"}</div>
    </div>
  )
}

export default function TransferPage() {
  const navigate = useNavigate()
  const token = getToken() || ""
  const transferId = getTransferIdFromUrl()

  const [locations, setLocations] = useState<LocationOption[]>([])
  const [fromWarehouses, setFromWarehouses] = useState<LocationOption[]>([])
  const [toWarehouses, setToWarehouses] = useState<LocationOption[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [activeCompany, setActiveCompany] = useState<ActiveCompany | null>(null)
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [eTransportBusy, setETransportBusy] = useState(false)
  const [status, setStatus] = useState("DRAFT")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [activePanel, setActivePanel] = useState<"date" | "produse">("date")
  const [activeETransportPanel, setActiveETransportPanel] = useState<"date" | "parties" | "route" | "items" | "check">("date")
  const [partnerLookupBusy, setPartnerLookupBusy] = useState(false)
  const [showETransportModal, setShowETransportModal] = useState(false)
  const [startAdr, setStartAdr] = useState<ETransportAdrForm>(createEmptyAdrForm())
  const [endAdr, setEndAdr] = useState<ETransportAdrForm>(createEmptyAdrForm())
  const [startAdrLookupBusy, setStartAdrLookupBusy] = useState(false)
  const [endAdrLookupBusy, setEndAdrLookupBusy] = useState(false)

  const [header, setHeader] = useState({
    fromLocationId: getActiveLocationId(),
    fromWarehouseId: "",
    toLocationId: "",
    toWarehouseId: "",
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
    eTransportStartAddress: "",
    eTransportEndAddress: "",
    eTransportStartBorderPoint: "",
    eTransportEndBorderPoint: "",
    eTransportTransportDocType: "TRANSFER",
    eTransportTransportDocNo: "",
    eTransportTransportDocDate: "",
    eTransportTransportDocNotes: "",
    eTransportExtraInfo: "",
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
            fromWarehouseId: "",
            toLocationId: prev.toLocationId === locationId ? "" : prev.toLocationId,
            toWarehouseId: prev.toLocationId === locationId ? "" : prev.toWarehouseId,
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

  useEffect(() => {
    if (!token || !header.fromLocationId) {
      setFromWarehouses([])
      return
    }
    void loadWarehouses(header.fromLocationId, "from")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.fromLocationId])

  useEffect(() => {
    if (!token || !header.toLocationId) {
      setToWarehouses([])
      return
    }
    void loadWarehouses(header.toLocationId, "to")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.toLocationId])

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
      const nextActiveCompany = companyData?.company || null
      setActiveCompany(nextActiveCompany)

      if (!transferId) {
        const activeLocationId = getActiveLocationId()
        const fallbackFrom = nextLocations.find((location) => location.id === activeLocationId)?.id || nextLocations[0]?.id || ""
        const fallbackFromLocation = nextLocations.find((location) => location.id === fallbackFrom) || null
        const fallbackToLocation =
          nextLocations.find((location) => location.id !== fallbackFrom) || null

        setHeader((prev) => ({
          ...prev,
          fromLocationId: prev.fromLocationId || fallbackFrom,
          fromWarehouseId: prev.fromWarehouseId || "",
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, "transfer"),
          eTransportOrganizer: prev.eTransportOrganizer || String(nextActiveCompany?.name || "").trim(),
          eTransportPartnerCountry: prev.eTransportPartnerCountry || "RO",
          eTransportStartAddress: prev.eTransportStartAddress || buildLocationLabel(fallbackFromLocation),
          eTransportEndAddress: prev.eTransportEndAddress || buildLocationLabel(fallbackToLocation),
          toLocationId:
            prev.toLocationId && prev.toLocationId !== (prev.fromLocationId || fallbackFrom)
              ? prev.toLocationId
              : nextLocations.find((location) => location.id !== (prev.fromLocationId || fallbackFrom))?.id || "",
          toWarehouseId: prev.toWarehouseId || "",
        }))
        setStartAdr(buildOrganizerStartAdr(nextActiveCompany, fallbackFromLocation))
        setEndAdr(buildAdrFormFromLocation(fallbackToLocation))
      }
    } catch {
      setError("Nu am putut incarca datele pentru transfer.")
    } finally {
      setLoadingMeta(false)
    }
  }

  async function loadWarehouses(locationId: string, kind: "from" | "to") {
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const res = await fetch(`${API}/api/v1/meta/warehouses?locationId=${encodeURIComponent(locationId)}`, { headers })
      const data = await res.json().catch(() => ({}))
      const items = ensureArray<LocationOption>(data.items)
      if (kind === "from") {
        setFromWarehouses(items)
        setHeader((prev) => ({
          ...prev,
          fromWarehouseId:
            prev.fromWarehouseId && items.some((warehouse) => warehouse.id === prev.fromWarehouseId)
              ? prev.fromWarehouseId
              : items[0]?.id || "",
        }))
      } else {
        setToWarehouses(items)
        setHeader((prev) => ({
          ...prev,
          toWarehouseId:
            prev.toWarehouseId && items.some((warehouse) => warehouse.id === prev.toWarehouseId)
              ? prev.toWarehouseId
              : items[0]?.id || "",
        }))
      }
    } catch {
      if (kind === "from") setFromWarehouses([])
      else setToWarehouses([])
    }
  }

  async function loadDoc(idOverride?: string) {
    const activeTransferId = idOverride || transferId
    if (!token || !activeTransferId) return
    setLoadingDoc(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/transfers/${activeTransferId}`, {
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
        fromWarehouseId: doc.fromWarehouseId || doc.fromWarehouse?.id || "",
        toLocationId: doc.toLocationId || "",
        toWarehouseId: doc.toWarehouseId || doc.toWarehouse?.id || "",
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
        eTransportStartAddress: doc.eTransportStartAddress || buildLocationLabel(doc.fromLocation),
        eTransportEndAddress: doc.eTransportEndAddress || buildLocationLabel(doc.toLocation),
        eTransportStartBorderPoint: doc.eTransportStartBorderPoint || "",
        eTransportEndBorderPoint: doc.eTransportEndBorderPoint || "",
        eTransportTransportDocType: doc.eTransportTransportDocType || "TRANSFER",
        eTransportTransportDocNo: doc.eTransportTransportDocNo || doc.docNo || "",
        eTransportTransportDocDate: doc.eTransportTransportDocDate ? String(doc.eTransportTransportDocDate).slice(0, 10) : "",
        eTransportTransportDocNotes: doc.eTransportTransportDocNotes || "",
        eTransportExtraInfo: doc.eTransportExtraInfo || "",
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

      const fallbackStartAdr = buildOrganizerStartAdr(activeCompany, doc.fromLocation)
      const fallbackEndAdr = buildPartnerEndAdr(
        {
          name: doc.eTransportPartnerName || "",
          cui: doc.eTransportPartnerCui || "",
          country: doc.eTransportPartnerCountry || "RO",
        },
        doc.toLocation,
      )

      setStartAdr(doc.eTransportStartAddress ? parseAdrForm(doc.eTransportStartAddress || "", doc.fromLocation) : fallbackStartAdr)
      setEndAdr(doc.eTransportEndAddress ? parseAdrForm(doc.eTransportEndAddress || "", doc.toLocation) : fallbackEndAdr)

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
    const vatRate = Math.max(0, Number(product.vatRate?.rate || 0))
    const grossPrice = Math.max(0, Number(product.price || 0))
    const unitPrice = vatRate > 0 ? grossPrice / (1 + vatRate / 100) : grossPrice
    setLineValue(lineId, {
      productId: product.id,
      search: product.name || "",
      sku: product.sku || "",
      uomCode: product.uom?.code || "",
      unitPrice: String(unitPrice),
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
  const toLocation = locations.find((location) => location.id === header.toLocationId)
  const toLocationOptions = locations.filter((location) => location.id !== header.fromLocationId)
  const addressOptions = useMemo(() => buildAddressOptions(locations), [locations])
  const startScopeIsBorder = header.eTransportStartScope === "PTF"
  const endScopeIsBorder = header.eTransportEndScope === "PTF"
  const selectedStartAddressOption = startAdr.sourceLocationId || "__manual__"
  const selectedEndAddressOption = endAdr.sourceLocationId || "__manual__"
  const eTransportFieldDisabled = loadingDoc || eTransportBusy

  useEffect(() => {
    if (!fromLocation) return
    setStartAdr((prev) => {
      if (!prev.sourceLocationId || prev.sourceLocationId === fromLocation.id || !adrFormHasContent(prev)) {
        return buildOrganizerStartAdr(activeCompany, fromLocation)
      }
      return prev
    })
  }, [fromLocation?.id, activeCompany?.cui, activeCompany?.name])

  useEffect(() => {
    if (header.eTransportPartnerCui || header.eTransportPartnerName) {
      setEndAdr((prev) => {
        const normalizedPartnerCui = String(header.eTransportPartnerCui || "").trim()
        if (adrFormHasContent(prev) && prev.companyCui === normalizedPartnerCui) {
          return prev
        }
        return buildPartnerEndAdr(
          {
            cui: header.eTransportPartnerCui,
            name: header.eTransportPartnerName,
            country: header.eTransportPartnerCountry,
          },
          toLocation,
        )
      })
      return
    }
    if (!toLocation) return
    setEndAdr((prev) => {
      if (!prev.sourceLocationId || prev.sourceLocationId === toLocation.id || !adrFormHasContent(prev)) {
        return buildAdrFormFromLocation(toLocation)
      }
      return prev
    })
  }, [toLocation?.id, header.eTransportPartnerCui, header.eTransportPartnerName, header.eTransportPartnerCountry])

  useEffect(() => {
    if (transferId && shouldOpenETransportFromUrl()) {
      setShowETransportModal(true)
    }
  }, [transferId])

  function buildTransferPayload(postNow = false) {
    return {
      id: transferId || null,
      header: {
        ...header,
        eTransportStartAddress:
          header.eTransportStartScope === "ADR" ? serializeAdrForm(startAdr) : header.eTransportStartBorderPoint,
        eTransportEndAddress:
          header.eTransportEndScope === "ADR" ? serializeAdrForm(endAdr) : header.eTransportEndBorderPoint,
        eTransportCandidate: eTransportSummary.candidate,
        eTransportRequired: header.eTransportRequired || eTransportSummary.required,
      },
      items: validLines.map((line) => ({
        productId: line.productId,
        qty: parsePositive(line.qty),
        unitPrice: Math.max(0, Number(line.unitPrice || 0)),
      })),
      postNow,
    }
  }

  async function persistTransfer(postNow = false, navigateOnCreate = false) {
    if (!token) {
      setError("Lipseste sesiunea de autentificare.")
      return { ok: false as const, id: "" }
    }

    if (isPosted) {
      setError("Transferul este deja postat si nu mai poate fi modificat.")
      return { ok: false as const, id: transferId || "" }
    }

    if (!header.fromLocationId) {
      setError("Selecteaza gestiunea predatoare.")
      return { ok: false as const, id: transferId || "" }
    }

    if (!header.toLocationId) {
      setError("Selecteaza gestiunea primitoare.")
      return { ok: false as const, id: transferId || "" }
    }

    if (header.fromLocationId === header.toLocationId) {
      setError("Gestiunea de plecare si cea de sosire trebuie sa fie diferite.")
      return { ok: false as const, id: transferId || "" }
    }

    if (!header.docDate) {
      setError("Completeaza data documentului.")
      return { ok: false as const, id: transferId || "" }
    }

    if (!validLines.length) {
      setError("Adauga cel putin un produs in transfer.")
      return { ok: false as const, id: transferId || "" }
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
        body: JSON.stringify(buildTransferPayload(postNow)),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Sesiunea a expirat. Intra din nou in cont si reincerca.")
        return { ok: false as const, id: transferId || "" }
      }

      if (!data.ok) {
        setError(data.error || "Transferul nu a putut fi salvat.")
        return { ok: false as const, id: transferId || "" }
      }

      const nextId = String(data.doc?.id || transferId || "")

      if (!transferId && data.doc?.id && navigateOnCreate) {
        navigate(`/transfer/edit?id=${data.doc.id}`)
        return { ok: true as const, id: nextId, data }
      }

      setStatus(data.doc?.status || (postNow ? "POSTED" : "DRAFT"))
      if (data.doc?.docNo) {
        setHeader((prev) => ({ ...prev, docNo: data.doc.docNo }))
      }
      setMessage(postNow ? "Transferul a fost salvat si postat." : "Transferul a fost salvat ca draft.")
      if (transferId || (!navigateOnCreate && nextId)) await loadDoc(nextId || undefined)
      return { ok: true as const, id: nextId, data }
    } catch {
      setError("A aparut o eroare la salvarea transferului.")
      return { ok: false as const, id: transferId || "" }
    } finally {
      setSaving(false)
    }
  }

  async function saveDoc(postNow = false) {
    await persistTransfer(postNow, true)
  }

  async function saveETransportDetails() {
    setETransportBusy(true)
    setError("")
    setMessage("")
    try {
      if (isPosted && transferId) {
        const res = await fetch(`${API}/api/v1/transfers/${transferId}/etransport-fields`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            header: {
              eTransportOperationType: header.eTransportOperationType,
              eTransportPartnerCountry: header.eTransportPartnerCountry,
              eTransportPartnerCui: header.eTransportPartnerCui,
              eTransportPartnerName: header.eTransportPartnerName,
              eTransportInternalRef: header.eTransportInternalRef,
              eTransportStartScope: header.eTransportStartScope,
              eTransportEndScope: header.eTransportEndScope,
              eTransportStartAddress:
                header.eTransportStartScope === "ADR" ? serializeAdrForm(startAdr) : header.eTransportStartBorderPoint,
              eTransportEndAddress:
                header.eTransportEndScope === "ADR" ? serializeAdrForm(endAdr) : header.eTransportEndBorderPoint,
              eTransportTransportDocType: header.eTransportTransportDocType,
              eTransportTransportDocNo: header.eTransportTransportDocNo,
              eTransportTransportDocDate: header.eTransportTransportDocDate,
              eTransportTransportDocNotes: header.eTransportTransportDocNotes,
              eTransportExtraInfo: header.eTransportExtraInfo,
              eTransportStartBorderPoint: header.eTransportStartBorderPoint,
              eTransportEndBorderPoint: header.eTransportEndBorderPoint,
              eTransportDeclaredStart: header.eTransportDeclaredStart,
              eTransportVehicleMaxMassKg: header.eTransportVehicleMaxMassKg,
              eTransportOrganizer: header.eTransportOrganizer,
              eTransportOperator: header.eTransportOperator,
              eTransportRequired: header.eTransportRequired || eTransportSummary.required,
              vehicleNo: header.vehicleNo,
              trailerNo: header.trailerNo,
            },
          }),
        })

        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.ok) {
          setError(data?.error || "Nu am putut salva datele RO e-Transport.")
          return
        }

        setMessage(data?.message || "Datele RO e-Transport au fost salvate.")
        await loadDoc(transferId)
        return
      }

      const persisted = await persistTransfer(false, false)
      if (!persisted.ok) return
      setMessage("Datele RO e-Transport au fost salvate.")
      if (!transferId && persisted.id) {
        navigate(`/transfer/edit?id=${persisted.id}&etr=1`, { replace: true })
      }
    } catch {
      setError("Nu am putut salva datele RO e-Transport.")
    } finally {
      setETransportBusy(false)
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
    setETransportBusy(true)
    setError("")
    setMessage("")

    try {
      let activeTransferId = transferId || ""
      if (!isPosted) {
        const persisted = await persistTransfer(false, false)
        activeTransferId = persisted.id || transferId || ""
        if (!persisted.ok || !activeTransferId) return
      } else if (!activeTransferId) {
        setError("Salveaza mai intai transferul.")
        return
      }

      const res = await fetch(`${API}/api/v1/transfers/${activeTransferId}/etransport/prepare`, {
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
      if (!transferId && activeTransferId) {
        navigate(`/transfer/edit?id=${activeTransferId}`, { replace: true })
      }
      await loadDoc(activeTransferId)
    } catch {
      setError("Nu am putut genera XML-ul RO e-Transport.")
    } finally {
      setETransportBusy(false)
    }
  }

  async function lookupAdrByCui(side: "start" | "end") {
    const isStart = side === "start"
    const form = isStart ? startAdr : endAdr
    const setBusy = isStart ? setStartAdrLookupBusy : setEndAdrLookupBusy
    const setForm = isStart ? setStartAdr : setEndAdr
    const normalizedCui = String(form.companyCui || "").trim().replace(/^RO/i, "").replace(/\D/g, "")

    if (!normalizedCui) {
      setError(`Completeaza mai intai CUI-ul pentru locul de ${isStart ? "start" : "final"}.`)
      return
    }

    setBusy(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(normalizedCui)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.company) {
        throw new Error(data?.error || "Nu am putut obtine datele firmei dupa CUI.")
      }

      const company = data.company as CompanyLookupResult
      setForm((prev) => ({
        ...prev,
        companyCui: normalizedCui,
        companyName: String(company.name || "").trim() || prev.companyName,
        country: normalizeCountryLabel(String(company.country || "")) || prev.country,
          county: String(company.county || "").trim() || prev.county,
          city: String(company.city || "").trim() || prev.city,
          street: String(company.address || "").trim() || prev.street,
          postalCode: String(company.postalCode || "").trim() || prev.postalCode,
          sourceLocationId: "",
        }))
      setMessage(`Adresa pentru locul de ${isStart ? "start" : "final"} a fost completata dupa CUI.`)
    } catch (e: any) {
      setError(e?.message || "Nu am putut cauta firma dupa CUI.")
    } finally {
      setBusy(false)
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
      setEndAdr(routeAdrFromParty(buildAdrFormFromCompany(company, { companyCui: normalizedCui })))
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

  async function deleteTransfer() {
    if (!transferId || !token) return
    if (isPosted) {
      setError("Transferurile postate nu pot fi sterse.")
      return
    }

    const confirmed = window.confirm(`Stergi definitiv transferul ${header.docNo || ""}?`)
    if (!confirmed) return

    try {
      const res = await fetch(`${API}/api/v1/transfers/${transferId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut sterge transferul.")
      }
      navigate("/documente?tab=transfer")
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge transferul.")
    }
  }

  async function sendETransport() {
    setETransportBusy(true)
    setError("")
    setMessage("")
    try {
      let activeTransferId = transferId || ""
      if (!isPosted) {
        const persisted = await persistTransfer(false, false)
        activeTransferId = persisted.id || transferId || ""
        if (!persisted.ok || !activeTransferId) return
      } else if (!activeTransferId) {
        setError("Salveaza mai intai transferul.")
        return
      }

      const res = await fetch(`${API}/api/v1/transfers/${activeTransferId}/etransport/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Nu am putut trimite RO e-Transport la ANAF.")
        return
      }
      setMessage(data?.message || "RO e-Transport a fost trimis la ANAF.")
      if (!transferId && activeTransferId) {
        navigate(`/transfer/edit?id=${activeTransferId}`, { replace: true })
      }
      await loadDoc(activeTransferId)
    } catch {
      setError("Nu am putut trimite RO e-Transport la ANAF.")
    } finally {
      setETransportBusy(false)
    }
  }

  async function checkETransportStatus() {
    if (!transferId) {
      setError("Salveaza mai intai transferul.")
      return
    }

    setETransportBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/transfers/${transferId}/etransport/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Nu am putut verifica starea RO e-Transport.")
        return
      }
      setMessage(data?.message || "Starea RO e-Transport a fost verificata.")
      await loadDoc()
    } catch {
      setError("Nu am putut verifica starea RO e-Transport.")
    } finally {
      setETransportBusy(false)
    }
  }

  async function downloadETransportReceipt() {
    if (!transferId) {
      setError("Salveaza mai intai transferul.")
      return
    }

    setError("")
    const res = await fetch(`${API}/api/v1/transfers/${transferId}/etransport/receipt`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Nu am putut descarca raspunsul ANAF.")
      return
    }

    await downloadPdfFile(res, `RO-e-Transport-Raspuns-${header.docNo || "document"}.zip`)
    await loadDoc()
  }

  const eTransportPrepared = ["PREPARED", "READY_TO_REVIEW", "SENT", "ACCEPTED"].includes(header.eTransportStatus || "")
  const panels = [
    { key: "date", title: "Date" },
    { key: "produse", title: "Produse" },
  ] as const
  const eTransportPanels = [
    { key: "date", title: "Date" },
    { key: "parties", title: "Parti" },
    { key: "route", title: "Traseu" },
    { key: "items", title: "Bunuri" },
    { key: "check", title: "Verificare" },
  ] as const

  return (
    <div className="w-full space-y-3">
      <DocumentPageHeader
        title={!transferId ? "Transfer nou" : isPosted ? "Transfer postat" : "Editare transfer"}
        actions={
          <>
            <button type="button" onClick={() => navigate("/transfer")} className={documentButtonSecondaryClass}>
              <ArrowLeft size={16} className="mr-2" />
              Inapoi
            </button>
            <button
              type="button"
              className={documentButtonSecondaryClass}
              onClick={() => {
                setActiveETransportPanel("date")
                setShowETransportModal(true)
              }}
            >
              <Truck size={16} className="mr-2" />
              E-Transport
            </button>
            <button type="button" className={documentButtonSecondaryClass} onClick={exportPdf} disabled={!transferId || loadingDoc}>
              <FileOutput size={16} className="mr-2" />
              PDF
            </button>
            {!isPosted ? (
              <button type="button" className={documentButtonPrimaryClass} onClick={() => saveDoc(true)} disabled={saving || loadingDoc}>
                {saving ? "Se salveaza..." : "Finalizeaza"}
              </button>
            ) : null}
          </>
        }
      />

      {loadingMeta ? <InlineNotice>Se incarca nomenclatoarele pentru transfer.</InlineNotice> : null}
      {loadingDoc ? <InlineNotice>Se incarca documentul selectat.</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {isPosted ? <InlineNotice>Documentul este postat si ramane doar in regim de vizualizare si export PDF.</InlineNotice> : null}

      {eTransportSummary.candidate ? (
        <InlineNotice tone={eTransportSummary.required ? "success" : "info"}>
          {eTransportSummary.required
            ? "Transferul intra in zona RO e-Transport pe baza produselor, valorii/greutatii si vehiculului completat."
            : "Transferul este candidat pentru RO e-Transport. Completeaza masa maxima a vehiculului si datele de transport pentru confirmare."}
        </InlineNotice>
      ) : null}

      <DocumentTabs items={panels.map((panel) => ({ id: panel.key, title: panel.title }))} activeId={activePanel} onChange={setActivePanel} />

      <div className="flex flex-col gap-3">
        {activePanel === "produse" ? (
        <div className="space-y-3 order-2">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <DocumentMetric title="Status" value={<DocumentStatusPill status={status || "DRAFT"} />} tone="amber" />
            <DocumentMetric title="Cantitate totala" value={formatNumber(totals.totalQty)} tone="blue" />
            <DocumentMetric title="Valoare estimata" value={`${formatNumber(totals.totalValue)} RON`} tone="emerald" />
          </div>

          <DocumentSection title="Linii transfer" actions={!isPosted ? (
            <button type="button" className={documentButtonPrimaryClass} onClick={addLine}>
              <Plus size={16} className="mr-2" />
              Adauga linie
            </button>
          ) : null}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-500">Scrie minim 2 litere, alege produsul si completeaza repede cantitatea si pretul.</div>
            </div>

            <div>
              <div className="space-y-2">
                {lines.map((line, index) => {
                  const matches = productMatches(line.search)
                  const lineValue = parsePositive(line.qty) * Math.max(0, Number(line.unitPrice || 0))

                  return (
                    <div key={line.id} className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">Pozitia {index + 1}</div>
                        {!isPosted ? (
                          <button type="button" onClick={() => removeLine(line.id)} className={documentButtonDangerClass}>
                            <Trash2 size={16} className="mr-2" />
                            Sterge
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1.9fr)_110px_90px_100px_150px]">
                        <div className="relative min-w-0">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Produs</div>
                          <input
                            value={line.search}
                            onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "", sku: "", uomCode: "" })}
                            className={documentInputClass}
                            disabled={isPosted}
                            placeholder="Scrie minim 2 litere"
                          />

                          {line.search.trim().length >= 2 && !line.productId && !isPosted ? (
                            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-[14px] border border-slate-200 bg-white p-2 shadow-xl">
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
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            <input
                              value={line.unitPrice}
                              onChange={(e) => setLineValue(line.id, { unitPrice: e.target.value })}
                              className={documentInputClass}
                              disabled={isPosted}
                            />
                            <div className="inline-flex items-center rounded-[10px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900">
                              {formatNumber(lineValue)}
                            </div>
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
        ) : null}

        {activePanel === "date" ? (
        <div className="space-y-3 order-1">
          <DocumentSection
            title="Detalii transfer"
            actions={!isPosted && transferId ? (
              <button type="button" className={documentButtonDangerClass} onClick={deleteTransfer} disabled={saving || loadingDoc}>
                Anuleaza
              </button>
            ) : null}
          >
            <div className="space-y-3">
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Document</div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                  <div className="xl:col-span-4">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Gestiune plecare</div>
                    <div className="relative">
                      <Warehouse className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <select
                        value={header.fromLocationId}
                        onChange={(e) => {
                          const nextId = e.target.value
                          const nextLocation = locations.find((location) => location.id === nextId) || null
                          setHeader((prev) => ({
                            ...prev,
                            fromLocationId: nextId,
                            fromWarehouseId: "",
                            toLocationId: prev.toLocationId === nextId ? "" : prev.toLocationId,
                            toWarehouseId: prev.toLocationId === nextId ? "" : prev.toWarehouseId,
                          }))
                          setStartAdr((prev) => {
                            if (!prev.sourceLocationId || prev.sourceLocationId === header.fromLocationId || !adrFormHasContent(prev)) {
                              return buildOrganizerStartAdr(activeCompany, nextLocation)
                            }
                            return prev
                          })
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
                    <div className="mt-2">
                      <select
                        value={header.fromWarehouseId}
                        onChange={(e) => setHeader((prev) => ({ ...prev, fromWarehouseId: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      >
                        <option value="">Gestiune interna sursa</option>
                        {fromWarehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="xl:col-span-4">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Gestiune sosire</div>
                    <div className="relative">
                      <ArrowRightLeft className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <select
                        value={header.toLocationId}
                        onChange={(e) => {
                          const nextId = e.target.value
                          const nextLocation = locations.find((location) => location.id === nextId) || null
                          setHeader((prev) => ({
                            ...prev,
                            toLocationId: nextId,
                            toWarehouseId: "",
                          }))
                          setEndAdr((prev) => {
                            if (!prev.sourceLocationId || prev.sourceLocationId === header.toLocationId || !adrFormHasContent(prev)) {
                              return buildAdrFormFromLocation(nextLocation)
                            }
                            return prev
                          })
                        }}
                        className={`${documentInputClass} pl-9`}
                        disabled={isPosted}
                      >
                        <option value="">Gestiune primitoare</option>
                        {toLocationOptions.map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2">
                      <select
                        value={header.toWarehouseId}
                        onChange={(e) => setHeader((prev) => ({ ...prev, toWarehouseId: e.target.value }))}
                        className={documentInputClass}
                        disabled={isPosted}
                      >
                        <option value="">Gestiune interna destinatie</option>
                        {toWarehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="xl:col-span-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Nr. document</div>
                    <input value={header.docNo} className={documentInputClass} readOnly style={readonlyInputStyle} />
                  </div>
                  <div className="xl:col-span-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Data</div>
                    <input
                      type="date"
                      value={header.docDate}
                      onChange={(e) => setHeader((prev) => ({ ...prev, docDate: e.target.value }))}
                      className={documentInputClass}
                      disabled={isPosted}
                    />
                  </div>
                  <div className="xl:col-span-4">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Motiv transfer</div>
                    <input
                      value={header.reason}
                      onChange={(e) => setHeader((prev) => ({ ...prev, reason: e.target.value }))}
                      className={documentInputClass}
                      disabled={isPosted}
                      placeholder="Motiv transfer"
                    />
                  </div>
                  <div className="xl:col-span-8">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Observatii</div>
                    <input
                      value={header.note}
                      onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))}
                      className={documentInputClass}
                      disabled={isPosted}
                      placeholder="Observatii scurte pentru transfer"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Rezumat RO e-Transport</div>
                    <div className="mt-1 text-xs text-slate-500">Completezi doar cand documentul chiar necesita raportare.</div>
                  </div>
                  <button
                    type="button"
                    className={documentButtonSecondaryClass}
                    onClick={() => {
                      setActiveETransportPanel("date")
                      setShowETransportModal(true)
                    }}
                  >
                    <Truck size={16} className="mr-2" />
                    Deschide e-Transport
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                  <DocumentMetric title="Candidat" value={header.eTransportCandidate ? "Da" : "Nu"} tone={header.eTransportCandidate ? "amber" : "slate"} />
                  <DocumentMetric title="XML" value={eTransportPrepared ? "Generat" : "Negenerat"} tone={eTransportPrepared ? "emerald" : "slate"} />
                  <DocumentMetric title="Status UIT" value={header.eTransportStatus || "-"} tone="emerald" />
                  <DocumentMetric title="Greutate bruta" value={`${formatNumber(eTransportSummary.totalGrossWeightKg)} kg`} tone="blue" />
                </div>
              </div>

              {showETransportModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                  <div className="max-h-[94vh] w-full max-w-7xl overflow-auto rounded-[28px] border border-slate-200 bg-slate-50 p-4 shadow-2xl">
                    <div className="space-y-3">
                      <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-900/[0.03]">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                              e-Transport
                            </div>
                            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-[#17324D]">
                              Notificare noua
                            </h2>
                          </div>

                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" onClick={() => setShowETransportModal(false)} className={documentButtonSecondaryClass}>
                              <ArrowLeft size={16} className="mr-2" />
                              Inapoi
                            </button>
                            <button type="button" onClick={saveETransportDetails} disabled={loadingDoc || eTransportBusy} className={documentButtonPrimaryClass}>
                              <PackagePlus size={16} className="mr-2" />
                              {eTransportBusy ? "Se salveaza..." : "Finalizeaza"}
                            </button>
                            <button type="button" onClick={sendETransport} disabled={!transferId || loadingDoc || eTransportBusy || !isPosted} className={documentButtonPrimaryClass}>
                              <Truck size={16} className="mr-2" />
                              {eTransportBusy ? "Se trimite..." : "Trimite SPV"}
                            </button>
                            <details className="relative">
                              <summary className={`${documentButtonSecondaryClass} cursor-pointer list-none`}>
                                <FileText size={16} className="mr-2" />
                                Descarca
                                <ChevronDown size={15} className="ml-1" />
                              </summary>
                              <div className="absolute right-0 z-30 mt-2 min-w-[190px] rounded-[8px] border border-slate-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
                                <button
                                  type="button"
                                  onClick={downloadETransportXml}
                                  disabled={!transferId || !eTransportPrepared || loadingDoc}
                                  className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  XML
                                </button>
                                <button
                                  type="button"
                                  onClick={downloadETransportReceipt}
                                  disabled={!transferId || loadingDoc || !header.eTransportUploadIndex}
                                  className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Raspuns ANAF
                                </button>
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>

                      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
                      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
                      {header.eTransportErrorText ? <InlineNotice tone="info">{header.eTransportErrorText}</InlineNotice> : null}
                      {!isPosted ? (
                        <InlineNotice tone="info">
                          Completeaza datele aici si finalizeaza transferul. Dupa ce documentul este postat apar trimiterea ANAF si descarcarea XML / raspuns.
                        </InlineNotice>
                      ) : null}

                      <div className="rounded-[8px] border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/[0.03]">
                        <div className="flex flex-wrap gap-2">
                          {eTransportPanels.map((panel, index) => {
                            const isActive = activeETransportPanel === panel.key
                            return (
                              <button
                                key={panel.key}
                                type="button"
                                onClick={() => setActiveETransportPanel(panel.key)}
                                className={[
                                  "inline-flex h-10 items-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition",
                                  isActive ? "bg-[#17324D] text-white" : "bg-slate-50 text-[#17324D] hover:bg-slate-100",
                                ].join(" ")}
                              >
                                <span
                                  className={[
                                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                                    isActive ? "bg-white/15 text-white" : "bg-slate-100 text-[#17324D]",
                                  ].join(" ")}
                                >
                                  {index + 1}
                                </span>
                                {panel.title}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {activeETransportPanel === "date" ? (
                        <DocumentSection title="Date notificare">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div className="space-y-1 xl:col-span-2">
                              <label className="block text-xs font-medium text-[#17324D]">Tip document transport</label>
                              <select
                                value={header.eTransportTransportDocType}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportTransportDocType: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              >
                                <option value="TRANSFER">Transfer intre gestiuni</option>
                                <option value="FACTURA">Factura</option>
                                <option value="AVIZ">Aviz de insotire</option>
                                <option value="CMR">CMR</option>
                                <option value="COMANDA">Comanda</option>
                                <option value="ALTELE">Alt document</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Nr. document transport</label>
                              <input
                                value={header.eTransportTransportDocNo}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportTransportDocNo: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                                placeholder="TRF-00006 / CMR / Factura"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Data document transport</label>
                              <input
                                type="date"
                                value={header.eTransportTransportDocDate}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportTransportDocDate: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              />
                            </div>
                            <div className="space-y-1 xl:col-span-2">
                              <label className="block text-xs font-medium text-[#17324D]">Tip operatiune</label>
                              <select
                                value={header.eTransportOperationType}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportOperationType: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              >
                                {ETRANSPORT_OPERATION_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Data transport</label>
                              <input
                                type="datetime-local"
                                value={header.eTransportDeclaredStart}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportDeclaredStart: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Referinta interna</label>
                              <input
                                value={header.eTransportInternalRef}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportInternalRef: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                                placeholder="Referinta interna operatiune"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Nr. vehicul</label>
                              <input
                                value={header.vehicleNo}
                                onChange={(e) => setHeader((prev) => ({ ...prev, vehicleNo: e.target.value.toUpperCase() }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                                placeholder="CJ13POS"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Nr. remorca</label>
                              <input
                                value={header.trailerNo}
                                onChange={(e) => setHeader((prev) => ({ ...prev, trailerNo: e.target.value.toUpperCase() }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                                placeholder="Optional"
                              />
                            </div>
                            <div className="space-y-1 md:col-span-2 xl:col-span-3">
                              <label className="block text-xs font-medium text-[#17324D]">Observatii document</label>
                              <input
                                value={header.eTransportTransportDocNotes}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportTransportDocNotes: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              />
                            </div>
                            <div className="space-y-1 md:col-span-2 xl:col-span-3">
                              <label className="block text-xs font-medium text-[#17324D]">Informatii suplimentare</label>
                              <input
                                value={header.eTransportExtraInfo}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportExtraInfo: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-[#17324D]">Masa maxima vehicul (kg)</label>
                              <input
                                value={header.eTransportVehicleMaxMassKg}
                                onChange={(e) => setHeader((prev) => ({ ...prev, eTransportVehicleMaxMassKg: e.target.value }))}
                                className={documentInputClass}
                                disabled={eTransportFieldDisabled}
                                placeholder="Ex: 3500"
                              />
                            </div>
                          </div>
                        </DocumentSection>
                      ) : null}

                      {activeETransportPanel === "parties" ? (
                        <DocumentSection title="Organizator si partener">
                          <div className="grid gap-4 2xl:grid-cols-2">
                            <div className="min-w-0 rounded-[16px] border border-slate-200 bg-white p-4">
                              <div className="mb-3 text-sm font-semibold text-slate-900">Organizator transport</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                {labelValue("Tara", "Romania")}
                                {labelValue("Cod organizator", String(activeCompany?.cui || ""))}
                                <div className="md:col-span-2">{labelValue("Denumire organizator", header.eTransportOrganizer)}</div>
                              </div>
                            </div>

                            <div className="min-w-0 rounded-[16px] border border-slate-200 bg-white p-4">
                              <div className="mb-3 text-sm font-semibold text-slate-900">Partener comercial</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">CUI partener</label>
                                  <input
                                    value={header.eTransportPartnerCui}
                                    onChange={(e) => setHeader((prev) => ({ ...prev, eTransportPartnerCui: e.target.value.replace(/\D/g, "") }))}
                                    className={documentInputClass}
                                    disabled={eTransportFieldDisabled || partnerLookupBusy}
                                    placeholder="Scrie CUI-ul"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">Partener</label>
                                  <button
                                    type="button"
                                    className={`${documentButtonSecondaryClass} w-full justify-center`}
                                    onClick={lookupPartnerByCui}
                                    disabled={eTransportFieldDisabled || partnerLookupBusy}
                                  >
                                    {partnerLookupBusy ? "Se cauta..." : "Cauta CUI"}
                                  </button>
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">Denumire partener</label>
                                  <input value={header.eTransportPartnerName} className={documentInputClass} readOnly style={readonlyInputStyle} placeholder="Denumire partener" />
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">Transportator / operator</label>
                                  <input
                                    value={header.eTransportOperator}
                                    onChange={(e) => setHeader((prev) => ({ ...prev, eTransportOperator: e.target.value }))}
                                    className={documentInputClass}
                                    disabled={eTransportFieldDisabled}
                                    placeholder="Nume sofer / transportator / operator"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </DocumentSection>
                      ) : null}

                      {activeETransportPanel === "route" ? (
                        <DocumentSection title="Loc start si loc final traseu">
                          <div className="grid gap-4 2xl:grid-cols-2">
                            <div className="min-w-0 space-y-3 rounded-[16px] border border-slate-200 bg-white p-4">
                              <div className="text-sm font-semibold text-slate-900">Loc start</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">Tip start</label>
                                  <select
                                    value={header.eTransportStartScope}
                                    onChange={(e) => setHeader((prev) => ({ ...prev, eTransportStartScope: e.target.value }))}
                                    className={documentInputClass}
                                    disabled={eTransportFieldDisabled}
                                  >
                                    {ETRANSPORT_SCOPE_OPTIONS.map((option) => (
                                      <option key={`start-${option.value}`} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </div>
                                {startScopeIsBorder ? (
                                  <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[#17324D]">Punct frontiera</label>
                                    <select
                                      value={header.eTransportStartBorderPoint}
                                      onChange={(e) => setHeader((prev) => ({ ...prev, eTransportStartBorderPoint: e.target.value }))}
                                      className={documentInputClass}
                                      disabled={eTransportFieldDisabled}
                                    >
                                      <option value="">Alege punctul de frontiera</option>
                                      {ETRANSPORT_BORDER_POINTS.map((point) => (
                                        <option key={`start-point-${point}`} value={point}>{point}</option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[#17324D]">Locatie</label>
                                    <select
                                      value={selectedStartAddressOption}
                                      onChange={(e) => {
                                        if (e.target.value === "__manual__") {
                                          setStartAdr((prev) => ({ ...prev, sourceLocationId: "" }))
                                          return
                                        }
                                        const option = addressOptions.find((item) => item.id === e.target.value)
                                        const location = locations.find((item) => item.id === e.target.value) || null
                                        if (!option) return
                                        setStartAdr(buildOrganizerStartAdr(activeCompany, location))
                                      }}
                                      className={documentInputClass}
                                      disabled={eTransportFieldDisabled}
                                    >
                                      <option value="__manual__">Completare manuala</option>
                                      {addressOptions.map((option) => (
                                        <option key={`start-addr-${option.id}`} value={option.id}>{option.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                              {!startScopeIsBorder ? (
                                <>
                                  <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                    Locul de start foloseste automat datele organizatorului si ale gestiunii de plecare.
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Tara</label>
                                      <input value={startAdr.country} onChange={(e) => setStartAdr((prev) => ({ ...prev, country: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Judet</label>
                                      <input value={startAdr.county} onChange={(e) => setStartAdr((prev) => ({ ...prev, county: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Localitate</label>
                                      <input value={startAdr.city} onChange={(e) => setStartAdr((prev) => ({ ...prev, city: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Cod postal</label>
                                      <input value={startAdr.postalCode} onChange={(e) => setStartAdr((prev) => ({ ...prev, postalCode: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <label className="block text-xs font-medium text-[#17324D]">Strada</label>
                                      <input value={startAdr.street} onChange={(e) => setStartAdr((prev) => ({ ...prev, street: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Numar</label>
                                      <input value={startAdr.streetNo} onChange={(e) => setStartAdr((prev) => ({ ...prev, streetNo: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Bloc</label>
                                      <input value={startAdr.building} onChange={(e) => setStartAdr((prev) => ({ ...prev, building: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Scara</label>
                                      <input value={startAdr.staircase} onChange={(e) => setStartAdr((prev) => ({ ...prev, staircase: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Etaj</label>
                                      <input value={startAdr.floor} onChange={(e) => setStartAdr((prev) => ({ ...prev, floor: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Apartament</label>
                                      <input value={startAdr.apartment} onChange={(e) => setStartAdr((prev) => ({ ...prev, apartment: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <label className="block text-xs font-medium text-[#17324D]">Detalii suplimentare</label>
                                      <input value={startAdr.details} onChange={(e) => setStartAdr((prev) => ({ ...prev, details: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                  </div>
                                </>
                              ) : null}
                            </div>

                            <div className="min-w-0 space-y-3 rounded-[16px] border border-slate-200 bg-white p-4">
                              <div className="text-sm font-semibold text-slate-900">Loc final</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="block text-xs font-medium text-[#17324D]">Tip final</label>
                                  <select
                                    value={header.eTransportEndScope}
                                    onChange={(e) => setHeader((prev) => ({ ...prev, eTransportEndScope: e.target.value }))}
                                    className={documentInputClass}
                                    disabled={eTransportFieldDisabled}
                                  >
                                    {ETRANSPORT_SCOPE_OPTIONS.map((option) => (
                                      <option key={`end-${option.value}`} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </div>
                                {endScopeIsBorder ? (
                                  <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[#17324D]">Punct frontiera</label>
                                    <select
                                      value={header.eTransportEndBorderPoint}
                                      onChange={(e) => setHeader((prev) => ({ ...prev, eTransportEndBorderPoint: e.target.value }))}
                                      className={documentInputClass}
                                      disabled={eTransportFieldDisabled}
                                    >
                                      <option value="">Alege punctul de frontiera</option>
                                      {ETRANSPORT_BORDER_POINTS.map((point) => (
                                        <option key={`end-point-${point}`} value={point}>{point}</option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[#17324D]">Locatie</label>
                                    <select
                                      value={selectedEndAddressOption}
                                      onChange={(e) => {
                                        if (e.target.value === "__manual__") {
                                          setEndAdr((prev) => ({ ...prev, sourceLocationId: "" }))
                                          return
                                        }
                                        const option = addressOptions.find((item) => item.id === e.target.value)
                                        const location = locations.find((item) => item.id === e.target.value) || null
                                        if (!option) return
                                        setEndAdr(buildAdrFormFromLocation(location))
                                      }}
                                      className={documentInputClass}
                                      disabled={eTransportFieldDisabled}
                                    >
                                      <option value="__manual__">Completare manuala</option>
                                      {addressOptions.map((option) => (
                                        <option key={`end-addr-${option.id}`} value={option.id}>{option.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                              {!endScopeIsBorder ? (
                                <>
                                  <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                    Locul final foloseste automat datele partenerului selectat.
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Tara</label>
                                      <input value={endAdr.country} onChange={(e) => setEndAdr((prev) => ({ ...prev, country: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Judet</label>
                                      <input value={endAdr.county} onChange={(e) => setEndAdr((prev) => ({ ...prev, county: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Localitate</label>
                                      <input value={endAdr.city} onChange={(e) => setEndAdr((prev) => ({ ...prev, city: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Cod postal</label>
                                      <input value={endAdr.postalCode} onChange={(e) => setEndAdr((prev) => ({ ...prev, postalCode: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <label className="block text-xs font-medium text-[#17324D]">Strada</label>
                                      <input value={endAdr.street} onChange={(e) => setEndAdr((prev) => ({ ...prev, street: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Numar</label>
                                      <input value={endAdr.streetNo} onChange={(e) => setEndAdr((prev) => ({ ...prev, streetNo: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Bloc</label>
                                      <input value={endAdr.building} onChange={(e) => setEndAdr((prev) => ({ ...prev, building: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Scara</label>
                                      <input value={endAdr.staircase} onChange={(e) => setEndAdr((prev) => ({ ...prev, staircase: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Etaj</label>
                                      <input value={endAdr.floor} onChange={(e) => setEndAdr((prev) => ({ ...prev, floor: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs font-medium text-[#17324D]">Apartament</label>
                                      <input value={endAdr.apartment} onChange={(e) => setEndAdr((prev) => ({ ...prev, apartment: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <label className="block text-xs font-medium text-[#17324D]">Detalii suplimentare</label>
                                      <input value={endAdr.details} onChange={(e) => setEndAdr((prev) => ({ ...prev, details: e.target.value, sourceLocationId: "" }))} className={documentInputClass} disabled={eTransportFieldDisabled} />
                                    </div>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </DocumentSection>
                      ) : null}

                      {activeETransportPanel === "items" ? (
                        <DocumentSection title="Bunuri transportate">
                          <div className="mb-3 grid gap-3 md:grid-cols-3">
                            <DocumentMetric title="Bunuri" value={String(validLines.length)} tone="blue" />
                            <DocumentMetric title="Valoare fara TVA" value={`${formatNumber(eTransportSummary.totalValueRon)} RON`} tone="emerald" />
                            <DocumentMetric title="Greutate bruta" value={`${formatNumber(eTransportSummary.totalGrossWeightKg)} kg`} tone="slate" />
                          </div>
                          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                            <div className="mb-2 text-sm font-semibold text-slate-900">Bunuri preluate din transfer</div>
                            <div className="mb-3 text-xs text-slate-500">Produsele pentru e-Transport vin direct din liniile transferului. Daca vrei sa schimbi un produs, il modifici in documentul de transfer.</div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-slate-500">
                                    <th className="px-2 py-2">Produs</th>
                                    <th className="px-2 py-2">SKU</th>
                                    <th className="px-2 py-2">Cod NC</th>
                                    <th className="px-2 py-2">UM</th>
                                    <th className="px-2 py-2">Cantitate</th>
                                    <th className="px-2 py-2">Valoare fara TVA</th>
                                    <th className="px-2 py-2">Greutate bruta</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {validLines.map((line) => {
                                    const product = products.find((item) => item.id === line.productId)
                                    const qty = parsePositive(line.qty)
                                    const gross = qty * Math.max(0, Number(product?.grossWeightKg || 0))
                                    return (
                                      <tr key={`etr-${line.id}`} className="border-b border-slate-100">
                                        <td className="px-2 py-2 text-slate-700">{line.search || "-"}</td>
                                        <td className="px-2 py-2 text-slate-600">{line.sku || "-"}</td>
                                        <td className="px-2 py-2 text-slate-600">{product?.ncCode || "-"}</td>
                                        <td className="px-2 py-2 text-slate-600">{formatUomOption(product?.uom)}</td>
                                        <td className="px-2 py-2 text-slate-600">{formatNumber(qty)}</td>
                                        <td className="px-2 py-2 text-slate-600">{formatNumber(qty * Math.max(0, Number(line.unitPrice || 0)))}</td>
                                        <td className="px-2 py-2 text-slate-600">{formatNumber(gross)}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </DocumentSection>
                      ) : null}

                      {activeETransportPanel === "check" ? (
                        <>
                          <div className="grid gap-3 xl:grid-cols-5">
                            <DocumentMetric title="Candidat" value={header.eTransportCandidate ? "Da" : "Nu"} tone={header.eTransportCandidate ? "amber" : "slate"} />
                            <DocumentMetric title="Status" value={header.eTransportStatus || "-"} tone="slate" />
                            <DocumentMetric title="UIT" value={header.eTransportUit || "-"} tone="emerald" />
                            <DocumentMetric title="Greutate bruta" value={`${formatNumber(eTransportSummary.totalGrossWeightKg)} kg`} tone="emerald" />
                            <DocumentMetric title="Valoare fara TVA" value={`${formatNumber(eTransportSummary.totalValueRon)} RON`} tone="amber" />
                          </div>

                          <DocumentSection title="Verificare ANAF">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {labelValue("Upload index", header.eTransportUploadIndex)}
                              {labelValue("Download ID", header.eTransportDownloadId)}
                              {labelValue("XML", eTransportPrepared ? "Generat" : "-")}
                              {labelValue("Raspuns", header.eTransportUploadIndex ? "Disponibil dupa verificare" : "-")}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" onClick={checkETransportStatus} disabled={!transferId || loadingDoc || eTransportBusy || !header.eTransportUploadIndex} className={documentButtonSecondaryClass}>
                                Verifica stare
                              </button>
                            </div>
                          </DocumentSection>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </DocumentSection>
        </div>
        ) : null}
      </div>
    </div>
  )
}




