import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, FileText, PackagePlus, Plus, Search } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  DocumentStatusPill,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"

type NoticeItem = {
  id?: string
  lineNo: number
  productId?: string
  sourceItemId?: string
  sku: string
  name: string
  ncCode: string
  fiscalRisk: boolean
  uomCode: string
  qty: string
  unitPrice: string
  lineValue: string
  netWeightPerUnitKg: string
  netWeightTotalKg: string
  grossWeightPerUnitKg: string
  grossWeightTotalKg: string
  internalReference: string
}

type NoticeHeader = {
  noticeNo: string
  sourceType: string
  sourceDocNo: string
  transportDocType: string
  transportDocNo: string
  transportDocDate: string
  transportDocNotes: string
  extraInfo: string
  operationType: string
  partnerCountry: string
  partnerCui: string
  partnerName: string
  partnerAddress: string
  internalRef: string
  startScope: string
  endScope: string
  startAddress: string
  endAddress: string
  startBorderPoint: string
  endBorderPoint: string
  declaredStart: string
  vehicleNo: string
  trailerNo: string
  vehicleMaxMassKg: string
  organizerCountry: string
  organizerCode: string
  organizerName: string
  organizerAddress: string
  operatorName: string
  status: string
  candidate: boolean
  required: boolean
  uit: string
  uploadIndex: string
  downloadId: string
  errorText: string
  preparedXml: string
  totalGrossWeightKg: number
  totalValueRon: number
}

type NoticeAddressForm = {
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
  uom?: { code?: string | null; standardCode?: string | null; name?: string | null } | null
}

type NoticeRecord = {
  id: string
  noticeNo: string
  operationType?: string | null
  partnerName?: string | null
  declaredStart?: string | null
  status?: string | null
  uit?: string | null
  totalGrossWeightKg?: number
  totalValueRon?: number
  preparedXml?: string | null
}

type CompanyLookupResult = {
  name?: string
  address?: string
  city?: string
  county?: string
  country?: string
  postalCode?: string
}

const operationOptions = [
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

const scopeOptions = [
  { value: "ADR", label: "ADR - Loc pe teritoriul national" },
  { value: "PTF", label: "PTF - Punct rutier de trecere a frontierei" },
] as const

const borderPoints = [
  "Albita", "Bechet", "Bors", "Bors 2 - A3", "Calafat", "Calarasi (Chiciu)", "Carei", "Cenad",
  "Constanta Sud Agigea", "Corabia", "Episcopia Bihor", "Galati Giurgiulesti", "Giurgiu", "Halmeu",
  "Jimbolia", "Naidas", "Nadlac", "Nadlac 2 - A1", "Negru Voda", "Oncesti", "Ostrov", "Petea",
  "Portile de Fier 1", "Sculeni", "Siret", "Stanca Costesti", "Stamora Moravita", "Turnu Magurele",
  "Urziceni", "Valea lui Mihai", "Vama Veche", "Vladimirescu", "Varsand", "Zimnicea",
] as const

function makeLine(index = 1): NoticeItem {
  return {
    lineNo: index,
    sku: "",
    name: "",
    ncCode: "",
    fiscalRisk: false,
    uomCode: "",
    qty: "1",
    unitPrice: "0",
    lineValue: "0",
    netWeightPerUnitKg: "0",
    netWeightTotalKg: "0",
    grossWeightPerUnitKg: "0",
    grossWeightTotalKg: "0",
    internalReference: "",
  }
}

function makeHeader(): NoticeHeader {
  return {
    noticeNo: "",
    sourceType: "MANUAL",
    sourceDocNo: "",
    transportDocType: "FACTURA",
    transportDocNo: "",
    transportDocDate: "",
    transportDocNotes: "",
    extraInfo: "",
    operationType: "TTN",
    partnerCountry: "RO",
    partnerCui: "",
    partnerName: "",
    partnerAddress: "",
    internalRef: "",
    startScope: "ADR",
    endScope: "ADR",
    startAddress: "",
    endAddress: "",
    startBorderPoint: "",
    endBorderPoint: "",
    declaredStart: "",
    vehicleNo: "",
    trailerNo: "",
    vehicleMaxMassKg: "",
    organizerCountry: "RO",
    organizerCode: "",
    organizerName: "",
    organizerAddress: "",
    operatorName: "",
    status: "DRAFT",
    candidate: false,
    required: false,
    uit: "",
    uploadIndex: "",
    downloadId: "",
    errorText: "",
    preparedXml: "",
    totalGrossWeightKg: 0,
    totalValueRon: 0,
  }
}

function createEmptyAdrForm(): NoticeAddressForm {
  return {
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

function toNumber(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(",", ".").trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDateTimeInput(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatDateInput(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function formatUomOption(uom?: { code?: string | null; standardCode?: string | null; name?: string | null } | null) {
  const shortCode = String(uom?.code || "").trim().toUpperCase()
  const standardCode = String(uom?.standardCode || "").trim().toUpperCase()
  const fallbackName = String(uom?.name || "").trim()
  if (shortCode && standardCode) return `${shortCode}-${standardCode}`
  if (shortCode) return shortCode
  if (standardCode) return standardCode
  return fallbackName || ""
}

function normalizeCountryLabel(value: string) {
  const text = String(value || "").trim()
  if (!text) return "Romania"
  if (text.toUpperCase() === "RO") return "Romania"
  return text
}

function normalizeStoredAddressText(value: string) {
  return String(value || "").trim()
}

function serializeAdrForm(form: NoticeAddressForm) {
  return `ADRJSON:${JSON.stringify({
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

function parseAdrForm(value: string) {
  const text = normalizeStoredAddressText(value)
  if (text.startsWith("ADRJSON:")) {
    try {
      const parsed = JSON.parse(text.slice("ADRJSON:".length))
      return {
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
      } satisfies NoticeAddressForm
    } catch {
      return createEmptyAdrForm()
    }
  }

  return {
    ...createEmptyAdrForm(),
    street: text,
  }
}

function companyToAdrForm(company?: CompanyLookupResult | null, fallback?: Partial<NoticeAddressForm>) {
  return {
    ...createEmptyAdrForm(),
    ...fallback,
    companyName: company?.name || fallback?.companyName || "",
    country: normalizeCountryLabel(company?.country || fallback?.country || "Romania"),
    county: String(company?.county || fallback?.county || ""),
    city: String(company?.city || fallback?.city || ""),
    street: String(company?.address || fallback?.street || ""),
    postalCode: String(company?.postalCode || fallback?.postalCode || ""),
  }
}

function routeAdrFromParty(form: NoticeAddressForm): NoticeAddressForm {
  return {
    ...createEmptyAdrForm(),
    companyCui: form.companyCui || "",
    companyName: form.companyName || "",
    country: form.country || "Romania",
    county: form.county || "",
    city: form.city || "",
    street: form.street || "",
    streetNo: form.streetNo || "",
    building: form.building || "",
    staircase: form.staircase || "",
    floor: form.floor || "",
    apartment: form.apartment || "",
    postalCode: form.postalCode || "",
    details: form.details || "",
  }
}

function labelValue(label: string, value: string) {
  return (
    <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{value || "-"}</div>
    </div>
  )
}

function AddressEditor(props: {
  title: string
  form: NoticeAddressForm
  onChange: (patch: Partial<NoticeAddressForm>) => void
  onLookup?: () => void
  lookupBusy?: boolean
  showLookupRow?: boolean
}) {
  const { title, form, onChange, onLookup, lookupBusy, showLookupRow = true } = props

  return (
    <div className="space-y-3 rounded-[16px] border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {showLookupRow ? (
        <div className="grid gap-3 xl:grid-cols-[160px_150px_minmax(0,1fr)]">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Tara</label>
            <input value={form.country} onChange={(e) => onChange({ country: e.target.value })} className={documentInputClass} placeholder="Tara" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">CUI</label>
            <input
              value={form.companyCui}
              onChange={(e) => onChange({ companyCui: e.target.value.replace(/^RO/i, "").replace(/\D/g, "") })}
              className={documentInputClass}
              placeholder="CUI"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Denumire</label>
            <div className="flex gap-2">
              <input value={form.companyName} onChange={(e) => onChange({ companyName: e.target.value })} className={documentInputClass} placeholder="Denumire firma" />
              <button type="button" onClick={onLookup} disabled={lookupBusy || !onLookup} className={documentButtonSecondaryClass}>
                <Search size={16} className="mr-2" />
                {lookupBusy ? "Se cauta..." : "Cauta CUI"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Adresa este preluata automat din organizator pentru start si din partener pentru final. Aici ramane doar completarea sau ajustarea detaliilor de adresa.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Judet</label>
          <input value={form.county} onChange={(e) => onChange({ county: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Oras / Localitate</label>
          <input value={form.city} onChange={(e) => onChange({ city: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Cod postal</label>
          <input value={form.postalCode} onChange={(e) => onChange({ postalCode: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1 md:col-span-3 xl:col-span-1">
          <label className="block text-xs font-medium text-[#17324D]">Strada</label>
          <input value={form.street} onChange={(e) => onChange({ street: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Nr.</label>
          <input value={form.streetNo} onChange={(e) => onChange({ streetNo: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Bl.</label>
          <input value={form.building} onChange={(e) => onChange({ building: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Sc.</label>
          <input value={form.staircase} onChange={(e) => onChange({ staircase: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Et.</label>
          <input value={form.floor} onChange={(e) => onChange({ floor: e.target.value })} className={documentInputClass} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[#17324D]">Ap.</label>
          <input value={form.apartment} onChange={(e) => onChange({ apartment: e.target.value })} className={documentInputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-[#17324D]">Detalii suplimentare</label>
        <input value={form.details} onChange={(e) => onChange({ details: e.target.value })} className={documentInputClass} />
      </div>
    </div>
  )
}

export default function ETransportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const token = getToken() || ""
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const noticeId = params.get("id") || ""
  const isListMode = location.pathname === "/e-transport"

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notices, setNotices] = useState<NoticeRecord[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [header, setHeader] = useState<NoticeHeader>(makeHeader())
  const [items, setItems] = useState<NoticeItem[]>([makeLine(1)])
  const [partnerAdr, setPartnerAdr] = useState<NoticeAddressForm>(createEmptyAdrForm())
  const [organizerAdr, setOrganizerAdr] = useState<NoticeAddressForm>(createEmptyAdrForm())
  const [startAdr, setStartAdr] = useState<NoticeAddressForm>(createEmptyAdrForm())
  const [endAdr, setEndAdr] = useState<NoticeAddressForm>(createEmptyAdrForm())
  const [partnerLookupBusy, setPartnerLookupBusy] = useState(false)
  const [organizerLookupBusy, setOrganizerLookupBusy] = useState(false)
  const [startLookupBusy, setStartLookupBusy] = useState(false)
  const [endLookupBusy, setEndLookupBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const totals = useMemo(() => {
    const totalGrossWeightKg = items.reduce((sum, item) => sum + toNumber(item.grossWeightTotalKg || toNumber(item.qty) * toNumber(item.grossWeightPerUnitKg)), 0)
    const totalValueRon = items.reduce((sum, item) => sum + toNumber(item.lineValue), 0)
    const totalNetWeightKg = items.reduce((sum, item) => sum + toNumber(item.netWeightTotalKg || toNumber(item.qty) * toNumber(item.netWeightPerUnitKg)), 0)
    return { totalGrossWeightKg, totalValueRon, totalNetWeightKg }
  }, [items])

  useEffect(() => {
    if (!isListMode) {
      void loadProducts()
    }
  }, [isListMode])

  useEffect(() => {
    if (isListMode) {
      void loadList()
      return
    }
    if (noticeId) {
      void loadItem(noticeId)
      return
    }
    setHeader(makeHeader())
    setItems([makeLine(1)])
    setPartnerAdr(createEmptyAdrForm())
    setOrganizerAdr(createEmptyAdrForm())
    setStartAdr(createEmptyAdrForm())
    setEndAdr(createEmptyAdrForm())
  }, [isListMode, noticeId])

  async function loadProducts() {
    if (!token) return
    try {
      const res = await fetch(`${API}/api/v1/products`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data?.items)) return
      setProducts(data.items)
    } catch {
      // Keep the page usable even if products fail to load.
    }
  }

  async function loadList() {
    if (!token) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/etransport/notices`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut incarca notificarile.")
      setNotices(Array.isArray(data?.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca notificarile.")
    } finally {
      setLoading(false)
    }
  }

  async function loadItem(id: string) {
    if (!token) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/etransport/notices/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.item) throw new Error(data?.error || "Nu am putut incarca notificarea.")
      const item = data.item
      setHeader({
        noticeNo: item.noticeNo || "",
        sourceType: item.sourceType || "MANUAL",
        sourceDocNo: item.sourceDocNo || "",
        transportDocType: item.transportDocType || "FACTURA",
        transportDocNo: item.transportDocNo || "",
        transportDocDate: formatDateInput(item.transportDocDate),
        transportDocNotes: item.transportDocNotes || "",
        extraInfo: item.extraInfo || "",
        operationType: item.operationType || "TTN",
        partnerCountry: item.partnerCountry || "RO",
        partnerCui: item.partnerCui || "",
        partnerName: item.partnerName || "",
        partnerAddress: item.partnerAddress || "",
        internalRef: item.internalRef || "",
        startScope: item.startScope || "ADR",
        endScope: item.endScope || "ADR",
        startAddress: item.startAddress || "",
        endAddress: item.endAddress || "",
        startBorderPoint: item.startBorderPoint || "",
        endBorderPoint: item.endBorderPoint || "",
        declaredStart: formatDateTimeInput(item.declaredStart),
        vehicleNo: item.vehicleNo || "",
        trailerNo: item.trailerNo || "",
        vehicleMaxMassKg: String(item.vehicleMaxMassKg || ""),
        organizerCountry: item.organizerCountry || "RO",
        organizerCode: item.organizerCode || "",
        organizerName: item.organizerName || "",
        organizerAddress: item.organizerAddress || "",
        operatorName: item.operatorName || "",
        status: item.status || "DRAFT",
        candidate: Boolean(item.candidate),
        required: Boolean(item.required),
        uit: item.uit || "",
        uploadIndex: item.uploadIndex || "",
        downloadId: item.downloadId || "",
        errorText: item.errorText || "",
        preparedXml: item.preparedXml || "",
        totalGrossWeightKg: toNumber(item.totalGrossWeightKg),
        totalValueRon: toNumber(item.totalValueRon),
      })
      const nextPartnerAdr = {
        ...parseAdrForm(item.partnerAddress || ""),
        companyCui: item.partnerCui || "",
        companyName: item.partnerName || "",
        country: normalizeCountryLabel(item.partnerCountry || "RO"),
      }
      const nextOrganizerAdr = {
        ...parseAdrForm(item.organizerAddress || ""),
        companyCui: item.organizerCode || "",
        companyName: item.organizerName || "",
        country: normalizeCountryLabel(item.organizerCountry || "RO"),
      }
      setPartnerAdr(nextPartnerAdr)
      setOrganizerAdr(nextOrganizerAdr)
      setStartAdr(item.startAddress ? parseAdrForm(item.startAddress || "") : routeAdrFromParty(nextOrganizerAdr))
      setEndAdr(item.endAddress ? parseAdrForm(item.endAddress || "") : routeAdrFromParty(nextPartnerAdr))
      const nextItems = Array.isArray(item.items) && item.items.length
        ? item.items.map((line: any, index: number) => ({
            id: line.id,
            lineNo: line.lineNo || index + 1,
            productId: line.productId || "",
            sourceItemId: line.sourceItemId || "",
            sku: line.sku || line.product?.sku || "",
            name: line.name || line.product?.name || "",
            ncCode: line.ncCode || line.product?.ncCode || "",
            fiscalRisk: Boolean(line.fiscalRisk),
            uomCode: line.uomCode || formatUomOption(line.product?.uom),
            qty: String(line.qty ?? "0"),
            unitPrice: String(line.unitPrice ?? "0"),
            lineValue: String(line.lineValue ?? "0"),
            netWeightPerUnitKg: String(line.netWeightPerUnitKg ?? line.product?.netWeightKg ?? line.product?.grossWeightKg ?? "0"),
            netWeightTotalKg: String(line.netWeightTotalKg ?? "0"),
            grossWeightPerUnitKg: String(line.grossWeightPerUnitKg ?? line.product?.grossWeightKg ?? "0"),
            grossWeightTotalKg: String(line.grossWeightTotalKg ?? "0"),
            internalReference: line.internalReference || line.sku || "",
          }))
        : [makeLine(1)]
      setItems(nextItems)
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca notificarea.")
    } finally {
      setLoading(false)
    }
  }

  function patchLine(index: number, patch: Partial<NoticeItem>) {
    setItems((prev) => prev.map((line, currentIndex) => {
      if (currentIndex !== index) return line
      const next = { ...line, ...patch }
      const qty = toNumber(next.qty)
      const unitPrice = toNumber(next.unitPrice)
      const netWeightPerUnitKg = toNumber(next.netWeightPerUnitKg)
      const grossWeightPerUnitKg = toNumber(next.grossWeightPerUnitKg)
      return {
        ...next,
        lineValue: String(qty * unitPrice),
        netWeightTotalKg: String(qty * netWeightPerUnitKg),
        grossWeightTotalKg: String(qty * grossWeightPerUnitKg),
      }
    }))
  }

  function productMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []
    return products
      .filter((product) => {
        const haystack = [product.name, product.sku, product.ncCode].filter(Boolean).join(" ").toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, 8)
  }

  function chooseProduct(index: number, product: ProductOption) {
    const qty = toNumber(items[index]?.qty || 1) || 1
    const netWeightPerUnitKg = toNumber(product.netWeightKg || product.grossWeightKg || 0)
    const grossWeightPerUnitKg = toNumber(product.grossWeightKg || 0)
    const vatRate = toNumber(product.vatRate?.rate || 0)
    const productGrossPrice = toNumber(product.price || 0)
    const unitPrice = vatRate > 0 ? productGrossPrice / (1 + vatRate / 100) : productGrossPrice
    patchLine(index, {
      productId: product.id,
      sku: product.sku || "",
      name: product.name || "",
      ncCode: String(product.ncCode || ""),
      fiscalRisk: product.isFiscalRiskProduct === true,
      uomCode: formatUomOption(product.uom),
      qty: String(qty),
      unitPrice: String(unitPrice),
      netWeightPerUnitKg: String(netWeightPerUnitKg),
      netWeightTotalKg: String(qty * netWeightPerUnitKg),
      grossWeightPerUnitKg: String(grossWeightPerUnitKg),
      grossWeightTotalKg: String(qty * grossWeightPerUnitKg),
      internalReference: product.sku || product.name || "",
    })
  }

  function addLine() {
    setItems((prev) => [...prev, makeLine(prev.length + 1)])
  }

  function removeLine(index: number) {
    setItems((prev) =>
      prev.length === 1
        ? prev
        : prev.filter((_, currentIndex) => currentIndex !== index).map((line, lineIndex) => ({ ...line, lineNo: lineIndex + 1 }))
    )
  }

  async function lookupCompanyByCui(
    cui: string,
    setBusy: (value: boolean) => void,
    onDone: (company: CompanyLookupResult, normalizedCui: string) => void,
  ) {
    const normalizedCui = String(cui || "").trim().replace(/^RO/i, "").replace(/\D/g, "")
    if (!normalizedCui || !token) {
      setError("Completeaza mai intai CUI-ul.")
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(normalizedCui)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.company) throw new Error(data?.error || "Nu am putut obtine datele firmei dupa CUI.")
      onDone(data.company as CompanyLookupResult, normalizedCui)
      setMessage("Datele firmei au fost completate dupa CUI.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut obtine datele firmei dupa CUI.")
    } finally {
      setBusy(false)
    }
  }

  async function lookupPartnerByCui() {
    await lookupCompanyByCui(partnerAdr.companyCui, setPartnerLookupBusy, (company, normalizedCui) => {
      const next = companyToAdrForm(company, { companyCui: normalizedCui })
      setPartnerAdr((prev) => ({ ...prev, ...next, companyCui: normalizedCui }))
      setEndAdr(routeAdrFromParty({ ...next, companyCui: normalizedCui }))
      setHeader((prev) => ({
        ...prev,
        partnerCui: normalizedCui,
        partnerName: next.companyName,
        partnerCountry: next.country || prev.partnerCountry,
      }))
    })
  }

  async function lookupOrganizerByCui() {
    await lookupCompanyByCui(organizerAdr.companyCui, setOrganizerLookupBusy, (company, normalizedCui) => {
      const next = companyToAdrForm(company, { companyCui: normalizedCui })
      setOrganizerAdr((prev) => ({ ...prev, ...next, companyCui: normalizedCui }))
      setStartAdr(routeAdrFromParty({ ...next, companyCui: normalizedCui }))
      setHeader((prev) => ({
        ...prev,
        organizerCode: normalizedCui,
        organizerName: next.companyName,
        organizerCountry: next.country || prev.organizerCountry,
      }))
    })
  }

  async function lookupRouteAddress(side: "start" | "end") {
    const isStart = side === "start"
    const form = isStart ? startAdr : endAdr
    const setBusy = isStart ? setStartLookupBusy : setEndLookupBusy
    const setForm = isStart ? setStartAdr : setEndAdr
    await lookupCompanyByCui(form.companyCui, setBusy, (company, normalizedCui) => {
      const next = companyToAdrForm(company, { companyCui: normalizedCui })
      setForm((prev) => ({ ...prev, ...next, companyCui: normalizedCui }))
    })
  }

  function buildHeaderPayload() {
    return {
      ...header,
      sourceType: "MANUAL",
      partnerCountry: partnerAdr.country || header.partnerCountry || "RO",
      partnerCui: partnerAdr.companyCui || header.partnerCui,
      partnerName: partnerAdr.companyName || header.partnerName,
      partnerAddress: serializeAdrForm(partnerAdr),
      organizerCountry: organizerAdr.country || header.organizerCountry || "RO",
      organizerCode: organizerAdr.companyCui || header.organizerCode,
      organizerName: organizerAdr.companyName || header.organizerName,
      organizerAddress: serializeAdrForm(organizerAdr),
      startAddress: header.startScope === "ADR" ? serializeAdrForm(startAdr) : "",
      endAddress: header.endScope === "ADR" ? serializeAdrForm(endAdr) : "",
      totalGrossWeightKg: totals.totalGrossWeightKg,
      totalValueRon: totals.totalValueRon,
    }
  }

  async function saveNotice() {
    if (!token) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      let currentId = noticeId
      if (!currentId) {
        const createRes = await fetch(`${API}/api/v1/etransport/notices`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        const createData = await createRes.json().catch(() => ({}))
        if (!createRes.ok || !createData?.ok || !createData?.item?.id) {
          throw new Error(createData?.error || "Nu am putut crea notificarea.")
        }
        currentId = createData.item.id
      }

      const res = await fetch(`${API}/api/v1/etransport/notices/${currentId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          header: buildHeaderPayload(),
          items,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.item) {
        throw new Error(data?.error || "Nu am putut salva notificarea.")
      }
      setMessage(data?.message || "Notificarea a fost salvata.")
      navigate(`/e-transport/edit?id=${data.item.id}`, { replace: true })
      await loadItem(data.item.id)
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva notificarea.")
    } finally {
      setSaving(false)
    }
  }

  async function prepareXml() {
    if (!noticeId || !token) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const saveRes = await fetch(`${API}/api/v1/etransport/notices/${noticeId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ header: buildHeaderPayload(), items }),
      })
      const saveData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok || !saveData?.ok) throw new Error(saveData?.error || "Nu am putut salva notificarea inainte de generare.")

      const res = await fetch(`${API}/api/v1/etransport/notices/${noticeId}/prepare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut genera XML-ul.")
      setMessage(data?.message || "XML RO e-Transport generat.")
      await loadItem(noticeId)
    } catch (err: any) {
      setError(err?.message || "Nu am putut genera XML-ul.")
    } finally {
      setSaving(false)
    }
  }

  async function sendToAnaf() {
    if (!noticeId || !token) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const saveRes = await fetch(`${API}/api/v1/etransport/notices/${noticeId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ header: buildHeaderPayload(), items }),
      })
      const saveData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok || !saveData?.ok) throw new Error(saveData?.error || "Nu am putut salva notificarea inainte de trimitere.")

      const res = await fetch(`${API}/api/v1/etransport/notices/${noticeId}/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut trimite e-Transport la ANAF.")
      setMessage(data?.message || "RO e-Transport a fost trimis la ANAF.")
      await loadItem(noticeId)
    } catch (err: any) {
      setError(err?.message || "Nu am putut trimite e-Transport la ANAF.")
    } finally {
      setSaving(false)
    }
  }

  async function checkStatus() {
    if (!noticeId || !token) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/etransport/notices/${noticeId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut verifica starea in ANAF.")
      setMessage(data?.message || "Starea RO e-Transport a fost verificata.")
      await loadItem(noticeId)
    } catch (err: any) {
      setError(err?.message || "Nu am putut verifica starea in ANAF.")
    } finally {
      setSaving(false)
    }
  }

  async function downloadReceipt() {
    if (!noticeId || !token) return
    const res = await fetch(`${API}/api/v1/etransport/notices/${noticeId}/receipt`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data?.error || "Nu am putut descarca raspunsul ANAF.")
      return
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `RO-e-Transport-Raspuns-${header.noticeNo || noticeId}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
    await loadItem(noticeId)
  }

  async function downloadXml(id: string) {
    if (!token) return
    const res = await fetch(`${API}/api/v1/etransport/notices/${id}/xml`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data?.error || "Nu am putut descarca XML-ul.")
      return
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `RO-e-Transport-${header.noticeNo || id}.xml`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }

  if (isListMode) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Registru RO e-Transport"
          subtitle="Notificari salvate separat fata de transferuri, pentru livrari, exporturi sau completare manuala."
          badge="Transport"
        />
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate("/documente")} className={documentButtonSecondaryClass}>
            <ArrowLeft size={16} className="mr-2" />
            Inapoi
          </button>
          <button type="button" onClick={() => navigate("/e-transport/new")} className={documentButtonPrimaryClass}>
            <Plus size={16} className="mr-2" />
            Notificare noua
          </button>
        </div>

        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

        <div className="grid gap-3 md:grid-cols-3">
          <DocumentMetric title="Notificari" value={String(notices.length)} tone="blue" />
          <DocumentMetric title="Cu XML" value={String(notices.filter((item) => item.preparedXml).length)} tone="slate" />
          <DocumentMetric
            title="Valoare totala"
            value={`${notices.reduce((sum, item) => sum + toNumber(item.totalValueRon), 0).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`}
            tone="emerald"
          />
        </div>

        <DocumentSection title="Registru notificari">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2">Nr.</th>
                  <th className="px-3 py-2">Operatiune</th>
                  <th className="px-3 py-2">Partener</th>
                  <th className="px-3 py-2">Data transport</th>
                  <th className="px-3 py-2">Valoare</th>
                  <th className="px-3 py-2">UIT</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Se incarca notificarile...</td></tr>
                ) : notices.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Nu exista notificari salvate.</td></tr>
                ) : (
                  notices.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-900">{item.noticeNo}</td>
                      <td className="px-3 py-2 text-slate-600">{item.operationType || "-"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.partnerName || "-"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.declaredStart ? new Date(item.declaredStart).toLocaleString("ro-RO") : "-"}</td>
                      <td className="px-3 py-2 text-slate-600">{toNumber(item.totalValueRon).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON</td>
                      <td className="px-3 py-2 text-slate-600">{item.uit || "-"}</td>
                      <td className="px-3 py-2"><DocumentStatusPill status={item.status || "DRAFT"} /></td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button type="button" className={documentButtonSecondaryClass} onClick={() => navigate(`/e-transport/edit?id=${item.id}`)}>Deschide</button>
                          {item.preparedXml ? <button type="button" className={documentButtonSecondaryClass} onClick={() => downloadXml(item.id)}>XML</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DocumentSection>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={noticeId ? "Editare notificare RO e-Transport" : "Notificare noua RO e-Transport"}
        subtitle="Formular separat pentru livrare, export, import sau orice transport care nu vine din transferuri."
        badge="Transport"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate("/e-transport")} className={documentButtonSecondaryClass}>
          <ArrowLeft size={16} className="mr-2" />
          Inapoi
        </button>
        <button type="button" onClick={saveNotice} disabled={saving} className={documentButtonPrimaryClass}>
          <PackagePlus size={16} className="mr-2" />
          Salveaza
        </button>
        <button type="button" onClick={prepareXml} disabled={!noticeId || saving} className={documentButtonSecondaryClass}>
          <FileText size={16} className="mr-2" />
          Genereaza XML
        </button>
        <button type="button" onClick={sendToAnaf} disabled={!noticeId || saving} className={documentButtonSecondaryClass}>
          Trimite la ANAF
        </button>
        <button type="button" onClick={checkStatus} disabled={!noticeId || saving || !header.uploadIndex} className={documentButtonSecondaryClass}>
          Verifica stare
        </button>
        <button type="button" onClick={() => noticeId && downloadXml(noticeId)} disabled={!noticeId || !header.preparedXml} className={documentButtonSecondaryClass}>
          XML
        </button>
        <button type="button" onClick={downloadReceipt} disabled={!noticeId || !header.uploadIndex} className={documentButtonSecondaryClass}>
          Raspuns ANAF
        </button>
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {header.errorText ? <InlineNotice tone="info">{header.errorText}</InlineNotice> : null}

      <div className="grid gap-3 xl:grid-cols-5">
        <DocumentMetric title="Notificare" value={header.noticeNo || "-"} tone="blue" />
        <DocumentMetric title="Status" value={header.status || "DRAFT"} tone="slate" />
        <DocumentMetric title="UIT" value={header.uit || "-"} tone="emerald" />
        <DocumentMetric title="Greutate bruta" value={`${totals.totalGrossWeightKg.toLocaleString("ro-RO", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`} tone="emerald" />
        <DocumentMetric title="Valoare fara TVA" value={`${totals.totalValueRon.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`} tone="amber" />
      </div>

      <DocumentSection title="Date notificare">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Tip document transport</label>
            <select value={header.transportDocType} onChange={(e) => setHeader((prev) => ({ ...prev, transportDocType: e.target.value }))} className={documentInputClass}>
              <option value="FACTURA">Factura</option>
              <option value="CMR">CMR</option>
              <option value="AVIZ">Aviz</option>
              <option value="TRANSFER">Transfer</option>
              <option value="ALTELE">Alt document</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Nr. document transport</label>
            <input value={header.transportDocNo} onChange={(e) => setHeader((prev) => ({ ...prev, transportDocNo: e.target.value }))} className={documentInputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Data document transport</label>
            <input type="date" value={header.transportDocDate} onChange={(e) => setHeader((prev) => ({ ...prev, transportDocDate: e.target.value }))} className={documentInputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Tip operatiune</label>
            <select value={header.operationType} onChange={(e) => setHeader((prev) => ({ ...prev, operationType: e.target.value }))} className={documentInputClass}>
              {operationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Data transport</label>
            <input type="datetime-local" value={header.declaredStart} onChange={(e) => setHeader((prev) => ({ ...prev, declaredStart: e.target.value }))} className={documentInputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Referinta interna</label>
            <input value={header.internalRef} onChange={(e) => setHeader((prev) => ({ ...prev, internalRef: e.target.value }))} className={documentInputClass} placeholder="Ex: EXPORT-001" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Nr. vehicul</label>
            <input value={header.vehicleNo} onChange={(e) => setHeader((prev) => ({ ...prev, vehicleNo: e.target.value.toUpperCase() }))} className={documentInputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Nr. remorca</label>
            <input value={header.trailerNo} onChange={(e) => setHeader((prev) => ({ ...prev, trailerNo: e.target.value.toUpperCase() }))} className={documentInputClass} />
          </div>
          <div className="space-y-1 md:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-[#17324D]">Observatii document</label>
            <input value={header.transportDocNotes} onChange={(e) => setHeader((prev) => ({ ...prev, transportDocNotes: e.target.value }))} className={documentInputClass} />
          </div>
          <div className="space-y-1 md:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-[#17324D]">Informatii suplimentare</label>
            <input value={header.extraInfo} onChange={(e) => setHeader((prev) => ({ ...prev, extraInfo: e.target.value }))} className={documentInputClass} />
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Organizator si partener">
        <div className="grid gap-4 xl:grid-cols-2">
          <AddressEditor
            title="Organizator transport"
            form={organizerAdr}
            onChange={(patch) => {
              setOrganizerAdr((prev) => {
                const next = { ...prev, ...patch }
                setStartAdr(routeAdrFromParty(next))
                return next
              })
              if (patch.companyCui !== undefined || patch.companyName !== undefined || patch.country !== undefined) {
                setHeader((prev) => ({
                  ...prev,
                  organizerCode: patch.companyCui ?? prev.organizerCode,
                  organizerName: patch.companyName ?? prev.organizerName,
                  organizerCountry: patch.country ?? prev.organizerCountry,
                }))
              }
            }}
            onLookup={lookupOrganizerByCui}
            lookupBusy={organizerLookupBusy}
          />
          <AddressEditor
            title="Partener comercial"
            form={partnerAdr}
            onChange={(patch) => {
              setPartnerAdr((prev) => {
                const next = { ...prev, ...patch }
                setEndAdr(routeAdrFromParty(next))
                return next
              })
              if (patch.companyCui !== undefined || patch.companyName !== undefined || patch.country !== undefined) {
                setHeader((prev) => ({
                  ...prev,
                  partnerCui: patch.companyCui ?? prev.partnerCui,
                  partnerName: patch.companyName ?? prev.partnerName,
                  partnerCountry: patch.country ?? prev.partnerCountry,
                }))
              }
            }}
            onLookup={lookupPartnerByCui}
            lookupBusy={partnerLookupBusy}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#17324D]">Transportator / sofer / operator</label>
            <input value={header.operatorName} onChange={(e) => setHeader((prev) => ({ ...prev, operatorName: e.target.value }))} className={documentInputClass} />
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Loc start si loc final traseu">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3 rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Loc start</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#17324D]">Tip start</label>
                <select value={header.startScope} onChange={(e) => setHeader((prev) => ({ ...prev, startScope: e.target.value }))} className={documentInputClass}>
                  {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              {header.startScope === "PTF" ? (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Punct frontiera</label>
                  <select value={header.startBorderPoint} onChange={(e) => setHeader((prev) => ({ ...prev, startBorderPoint: e.target.value }))} className={documentInputClass}>
                    <option value="">Selecteaza</option>
                    {borderPoints.map((point) => <option key={point} value={point}>{point}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            {header.startScope === "ADR" ? (
              <AddressEditor
                title="Adresa loc start"
                form={startAdr}
                onChange={(patch) => setStartAdr((prev) => ({ ...prev, ...patch }))}
                showLookupRow={false}
              />
            ) : null}
          </div>

          <div className="space-y-3 rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Loc final</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#17324D]">Tip final</label>
                <select value={header.endScope} onChange={(e) => setHeader((prev) => ({ ...prev, endScope: e.target.value }))} className={documentInputClass}>
                  {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              {header.endScope === "PTF" ? (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Punct frontiera</label>
                  <select value={header.endBorderPoint} onChange={(e) => setHeader((prev) => ({ ...prev, endBorderPoint: e.target.value }))} className={documentInputClass}>
                    <option value="">Selecteaza</option>
                    {borderPoints.map((point) => <option key={point} value={point}>{point}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            {header.endScope === "ADR" ? (
              <AddressEditor
                title="Adresa loc final"
                form={endAdr}
                onChange={(patch) => setEndAdr((prev) => ({ ...prev, ...patch }))}
                showLookupRow={false}
              />
            ) : null}
          </div>
        </div>
      </DocumentSection>

      <DocumentSection
        title="Bunuri transportate"
        actions={
          <button type="button" onClick={addLine} className={documentButtonSecondaryClass}>
            <Plus size={16} className="mr-2" />
            Adauga produs
          </button>
        }
      >
        <div className="space-y-3">
          {items.map((line, index) => (
            <div key={line.id || `${line.lineNo}-${index}`} className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">Produs {index + 1}</div>
                <button type="button" onClick={() => removeLine(index)} className={documentButtonSecondaryClass}>Scoate</button>
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_140px_160px]">
                <div className="relative space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Cauta produs</label>
                  <input
                    value={line.name}
                    onChange={(e) => patchLine(index, { name: e.target.value, productId: "" })}
                    className={documentInputClass}
                    placeholder="Scrie numele, codul sau NC"
                  />
                  {line.name.trim().length >= 2 && !line.productId ? (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-[14px] border border-slate-200 bg-white p-1 shadow-xl">
                      {productMatches(line.name).length ? (
                        productMatches(line.name).map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => chooseProduct(index, product)}
                            className="flex w-full flex-col rounded-[10px] px-3 py-2 text-left hover:bg-slate-50"
                          >
                            <span className="text-sm font-semibold text-slate-900">{product.name}</span>
                            <span className="text-xs text-slate-500">
                              {[product.sku, product.ncCode, formatUomOption(product.uom)].filter(Boolean).join(" • ")}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-slate-500">Nu am gasit niciun produs.</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Cantitate</label>
                  <input value={line.qty} onChange={(e) => patchLine(index, { qty: e.target.value })} className={documentInputClass} />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Pret fara TVA</label>
                  <input value={line.unitPrice} onChange={(e) => patchLine(index, { unitPrice: e.target.value })} className={documentInputClass} />
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {labelValue("Cod produs", line.sku)}
                {labelValue("Cod NC", line.ncCode)}
                {labelValue("UM", line.uomCode)}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Greutate neta / UM (kg)</label>
                  <input
                    value={line.netWeightPerUnitKg}
                    onChange={(e) => patchLine(index, { netWeightPerUnitKg: e.target.value })}
                    className={documentInputClass}
                    placeholder="Ex: 0.25"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#17324D]">Greutate bruta / UM (kg)</label>
                  <input
                    value={line.grossWeightPerUnitKg}
                    onChange={(e) => patchLine(index, { grossWeightPerUnitKg: e.target.value })}
                    className={documentInputClass}
                    placeholder="Ex: 0.33"
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Valoare fara TVA: {toNumber(line.lineValue).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Greutate neta totala: {toNumber(line.netWeightTotalKg).toLocaleString("ro-RO", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Greutate bruta totala: {toNumber(line.grossWeightTotalKg).toLocaleString("ro-RO", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                </div>
                <label className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={line.fiscalRisk} onChange={(e) => patchLine(index, { fiscalRisk: e.target.checked })} />
                  Bun cu risc fiscal
                </label>
              </div>
            </div>
          ))}
        </div>
      </DocumentSection>
    </div>
  )
}
