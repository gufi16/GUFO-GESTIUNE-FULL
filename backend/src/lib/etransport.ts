function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function decimal(value: unknown, digits = 2) {
  return toNumber(value).toFixed(digits)
}

function transportDecimal(value: unknown) {
  return decimal(value, 2)
}

function formatDateTimeLocal(value: unknown) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatDateOnly(value: unknown) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function normalizeText(value: unknown) {
  return String(value || "").trim()
}

type ETransportUomLike = {
  standardCode?: unknown
  code?: unknown
}

type ETransportProductLike = {
  name?: unknown
  ncCode?: unknown
  grossWeightKg?: unknown
  netWeightKg?: unknown
  isFiscalRiskProduct?: boolean | null
  uom?: ETransportUomLike | null
}

type ETransportLocationLike = {
  address?: unknown
  city?: unknown
  county?: unknown
  country?: unknown
}

type ETransportLineLike = {
  qty?: unknown
  unitPrice?: unknown
  lineValue?: unknown
  product?: ETransportProductLike | null
  productName?: unknown
  uom?: ETransportUomLike | null
  uomCode?: unknown
  uomStandardCode?: unknown
  ncCode?: unknown
  name?: unknown
  fiscalRisk?: boolean | null
  grossWeightPerUnitKg?: unknown
  grossWeightTotalKg?: unknown
  netWeightPerUnitKg?: unknown
  netWeightTotalKg?: unknown
}

type ETransportTransferDocLike = {
  items?: ETransportLineLike[] | null
  fromLocation?: ETransportLocationLike | null
  toLocation?: ETransportLocationLike | null
  eTransportDeclaredStart?: unknown
  eTransportOperationType?: unknown
  eTransportPartnerCui?: unknown
  eTransportPartnerName?: unknown
  vehicleNo?: unknown
  trailerNo?: unknown
  eTransportStartScope?: unknown
  eTransportStartBorderPoint?: unknown
  eTransportEndScope?: unknown
  eTransportEndBorderPoint?: unknown
  eTransportStartAddress?: unknown
  eTransportEndAddress?: unknown
  eTransportVehicleMaxMassKg?: unknown
  eTransportOrganizer?: unknown
  eTransportOperator?: unknown
  docDate?: unknown
  company?: { cui?: unknown; country?: unknown; name?: unknown } | null
  declarantCode?: unknown
  eTransportInternalRef?: unknown
  docNo?: unknown
  eTransportTransportDocType?: unknown
  eTransportPartnerCountry?: unknown
  eTransportTransportDocDate?: unknown
  eTransportTransportDocNo?: unknown
  eTransportTransportDocNotes?: unknown
}

type ETransportNoticeLike = {
  items?: ETransportLineLike[] | null
  declaredStart?: unknown
  operationType?: unknown
  partnerCui?: unknown
  partnerName?: unknown
  partnerCountry?: unknown
  vehicleNo?: unknown
  trailerNo?: unknown
  startScope?: unknown
  startBorderPoint?: unknown
  endScope?: unknown
  endBorderPoint?: unknown
  startAddress?: unknown
  endAddress?: unknown
  organizerName?: unknown
  operatorName?: unknown
  createdAt?: unknown
  transportDocDate?: unknown
  sourceType?: unknown
  transportDocType?: unknown
  company?: { cui?: unknown } | null
  organizerCode?: unknown
  internalRef?: unknown
  noticeNo?: unknown
  organizerCountry?: unknown
  transportDocNo?: unknown
  transportDocNotes?: unknown
}

const COUNTY_CODE_MAP: Record<string, string> = {
  ALBA: "1",
  ARAD: "2",
  ARGES: "3",
  BACAU: "4",
  BIHOR: "5",
  "BISTRITA-NASAUD": "6",
  BOTOSANI: "7",
  BRASOV: "8",
  BRAILA: "9",
  BUZAU: "10",
  "CARAS-SEVERIN": "11",
  CLUJ: "12",
  CONSTANTA: "13",
  COVASNA: "14",
  DAMBOVITA: "15",
  DOLJ: "16",
  GALATI: "17",
  GORJ: "18",
  HARGHITA: "19",
  HUNEDOARA: "20",
  IALOMITA: "21",
  IASI: "22",
  ILFOV: "23",
  MARAMURES: "24",
  MEHEDINTI: "25",
  MURES: "26",
  NEAMT: "27",
  OLT: "28",
  PRAHOVA: "29",
  "SATU-MARE": "30",
  SALAJ: "31",
  SIBIU: "32",
  SUCEAVA: "33",
  TELEORMAN: "34",
  TIMIS: "35",
  TULCEA: "36",
  VASLUI: "37",
  VALCEA: "38",
  VRANCEA: "39",
  BUCURESTI: "40",
  CALARASI: "41",
  GIURGIU: "42",
}

const ETRANSPORT_XMLNS = "mfp:anaf:dgti:eTransport:declaratie:v2"
const ETRANSPORT_SCHEMA_LOCATION = `${ETRANSPORT_XMLNS} file:/D:/formInteractive/_inLucru/_proiecte/eTransport/final/schema_ETR_v2_20221215.xsd`

const OPERATION_TYPE_CODE_MAP: Record<string, string> = {
  AIC: "10",
  LIH: "12",
  SCI: "14",
  LIC: "20",
  LHE: "22",
  SCE: "24",
  TTN: "30",
  IMP: "40",
  EXP: "50",
  ITD: "60",
  DIE: "70",
}

const TRANSPORT_DOCUMENT_TYPE_CODE_MAP: Record<string, string> = {
  CMR: "10",
  FACTURA: "20",
  AVIZ: "30",
  TRANSFER: "30",
  ALTELE: "9999",
  COMANDA: "9999",
}

function decodeStructuredAddress(value: unknown) {
  const text = normalizeText(value)
  if (!text.startsWith("ADRJSON:")) return null

  try {
    return JSON.parse(text.slice("ADRJSON:".length))
  } catch {
    return null
  }
}

function buildStructuredAddressText(value: unknown) {
  const parsed = decodeStructuredAddress(value)
  if (!parsed) return normalizeText(value)

  const streetLine = [
    normalizeText(parsed.street || parsed.address),
    normalizeText(parsed.streetNo),
  ]
    .filter(Boolean)
    .join(" ")

  const buildingLine = [
    normalizeText(parsed.building ? `Bl. ${parsed.building}` : ""),
    normalizeText(parsed.staircase ? `Sc. ${parsed.staircase}` : ""),
    normalizeText(parsed.floor ? `Et. ${parsed.floor}` : ""),
    normalizeText(parsed.apartment ? `Ap. ${parsed.apartment}` : ""),
  ]
    .filter(Boolean)
    .join(", ")

  return [
    normalizeText(parsed.companyName),
    streetLine,
    buildingLine,
    normalizeText(parsed.city),
    normalizeText(parsed.county),
    normalizeText(parsed.postalCode),
    normalizeText(parsed.country || "Romania"),
    normalizeText(parsed.details || parsed.extra),
  ]
    .filter(Boolean)
    .join(", ")
}

function normalizeCountyKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[./]/g, " ")
    .replace(/\s+/g, "-")
    .toUpperCase()
}

function normalizeCountryCode(value: unknown) {
  const raw = normalizeText(value)
  if (!raw) return "RO"
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()

  if (normalized === "RO" || normalized === "ROMANIA") return "RO"
  return raw.length <= 3 ? raw.toUpperCase() : raw
}

function resolveCountyCode(value: unknown) {
  const key = normalizeCountyKey(value)
  if (!key) return ""
  return COUNTY_CODE_MAP[key] || COUNTY_CODE_MAP[key.replace(/-/g, " ")] || ""
}

function resolveOperationTypeCode(value: unknown) {
  const raw = normalizeText(value).toUpperCase()
  if (!raw) return "30"
  return OPERATION_TYPE_CODE_MAP[raw] || raw
}

function resolveGoodsPurposeCode(operationTypeCode: string, _sourceType: unknown, _transportDocType: unknown) {
  const op = normalizeText(operationTypeCode)
  if (op === "30") return "101"
  if (op === "10" || op === "20") return "101"
  return "9999"
}

function resolveTransportDocumentTypeCode(value: unknown) {
  const raw = normalizeText(value).toUpperCase()
  if (!raw) return "9999"
  return TRANSPORT_DOCUMENT_TYPE_CODE_MAP[raw] || raw
}

function extractStructuredAddress(value: unknown) {
  const parsed = decodeStructuredAddress(value)
  if (parsed) {
    return {
      county: normalizeText(parsed.county),
      city: normalizeText(parsed.city),
      street: normalizeText(parsed.street || parsed.address),
      streetNo: normalizeText(parsed.streetNo),
      building: normalizeText(parsed.building),
      staircase: normalizeText(parsed.staircase),
      floor: normalizeText(parsed.floor),
      apartment: normalizeText(parsed.apartment),
      postalCode: normalizeText(parsed.postalCode),
      details: normalizeText(parsed.details || parsed.extra),
    }
  }

  return {
    county: "",
    city: "",
    street: normalizeText(value),
    streetNo: "",
    building: "",
    staircase: "",
    floor: "",
    apartment: "",
    postalCode: "",
    details: "",
  }
}

function buildLocationAttrs(adrValue: unknown) {
  const address = extractStructuredAddress(adrValue)
  const attrs = [
    `codJudet="${xmlEscape(resolveCountyCode(address.county))}"`,
    `denumireLocalitate="${xmlEscape(address.city)}"`,
    `denumireStrada="${xmlEscape(address.street)}"`,
  ]

  if (address.streetNo) attrs.push(`numar="${xmlEscape(address.streetNo)}"`)
  if (address.building) attrs.push(`bloc="${xmlEscape(address.building)}"`)
  if (address.staircase) attrs.push(`scara="${xmlEscape(address.staircase)}"`)
  if (address.floor) attrs.push(`etaj="${xmlEscape(address.floor)}"`)
  if (address.apartment) attrs.push(`apartament="${xmlEscape(address.apartment)}"`)
  if (address.details) attrs.push(`alteInfo="${xmlEscape(address.details)}"`)
  if (address.postalCode) attrs.push(`codPostal="${xmlEscape(address.postalCode)}"`)

  return attrs.join(" ")
}

function buildAddressPlaceXml(tagName: string, adrValue: unknown) {
  return `    <${tagName}>
      <locatie ${buildLocationAttrs(adrValue)} />
    </${tagName}>`
}

function buildBorderPlaceXml(tagName: string, borderPoint: unknown) {
  return `    <${tagName} codPtf="${xmlEscape(borderPoint || "")}"/>`
}

function resolveBorderPointCode(startScope: unknown, startBorderPoint: unknown, endScope: unknown, endBorderPoint: unknown) {
  if (normalizeText(startScope).toUpperCase() === "PTF" && normalizeText(startBorderPoint)) {
    return normalizeText(startBorderPoint)
  }
  if (normalizeText(endScope).toUpperCase() === "PTF" && normalizeText(endBorderPoint)) {
    return normalizeText(endBorderPoint)
  }
  return ""
}

function buildTransportAttrs(input: {
  vehicleNo?: unknown
  trailerNo?: unknown
  transportDate?: unknown
  transporterCountry?: unknown
  transporterCode?: unknown
  transporterName?: unknown
  startScope?: unknown
  startBorderPoint?: unknown
  endScope?: unknown
  endBorderPoint?: unknown
}) {
  const attrs = [
    `nrVehicul="${xmlEscape(input.vehicleNo || "")}"`,
    `codTaraOrgTransport="${xmlEscape(input.transporterCountry || "RO")}"`,
    `codOrgTransport="${xmlEscape(input.transporterCode || "")}"`,
    `denumireOrgTransport="${xmlEscape(input.transporterName || "")}"`,
    `dataTransport="${xmlEscape(formatDateOnly(input.transportDate))}"`,
  ]

  if (normalizeText(input.trailerNo)) attrs.push(`nrRemorca1="${xmlEscape(input.trailerNo || "")}"`)

  return attrs.join(" ")
}

function buildRoutePlacesXml(startScope: unknown, startAddress: unknown, startBorderPoint: unknown, endScope: unknown, endAddress: unknown, endBorderPoint: unknown) {
  const parts: string[] = []

  if (normalizeText(startScope).toUpperCase() === "PTF" && normalizeText(startBorderPoint)) {
    parts.push(buildBorderPlaceXml("locStartTraseuRutier", startBorderPoint))
  } else if (normalizeText(startScope).toUpperCase() === "ADR") {
    parts.push(buildAddressPlaceXml("locStartTraseuRutier", startAddress))
  }

  if (normalizeText(endScope).toUpperCase() === "PTF" && normalizeText(endBorderPoint)) {
    parts.push(buildBorderPlaceXml("locFinalTraseuRutier", endBorderPoint))
  } else if (normalizeText(endScope).toUpperCase() === "ADR") {
    parts.push(buildAddressPlaceXml("locFinalTraseuRutier", endAddress))
  }

  return parts.join("\n")
}

function resolveTransportUomCode(item: ETransportLineLike | null | undefined) {
  const standardCode = normalizeText(item?.uom?.standardCode || item?.product?.uom?.standardCode || item?.uomStandardCode)
  if (standardCode) return standardCode

  const internalCode = normalizeText(item?.uom?.code || item?.product?.uom?.code || item?.uomCode)
  if (!internalCode) return ""
  if (internalCode.includes("-")) {
    const parts = internalCode.split("-").map((part) => normalizeText(part)).filter(Boolean)
    const maybeStandardCode = parts[parts.length - 1]
    if (/^[A-Z0-9]{1,8}$/i.test(maybeStandardCode)) return maybeStandardCode.toUpperCase()
  }
  return internalCode.toUpperCase()
}

function buildLocationText(location: ETransportLocationLike | null | undefined) {
  if (!location) return ""
  return [location.address, location.city, location.county, location.country || "RO"]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(", ")
}

function buildNoticeAddressText(scope: unknown, adrValue: unknown, borderPoint: unknown) {
  return normalizeText(scope) === "PTF"
    ? normalizeText(borderPoint)
    : normalizeText(buildStructuredAddressText(adrValue))
}

function resolveNoticeTotals(items: ETransportLineLike[] | null | undefined) {
  const normalizedItems = Array.isArray(items) ? items : []
  const totalGrossWeightKg = normalizedItems.reduce((sum: number, item: ETransportLineLike) => {
    const qty = toNumber(item?.qty)
    const grossWeightPerUnitKg = toNumber(item?.grossWeightPerUnitKg || item?.product?.grossWeightKg || 0)
    return sum + qty * grossWeightPerUnitKg
  }, 0)
  const totalValueRon = normalizedItems.reduce((sum: number, item: ETransportLineLike) => sum + toNumber(item?.lineValue), 0)
  return { totalGrossWeightKg, totalValueRon }
}

export type ETransportValidationIssue = {
  severity: "error" | "warning"
  field: string
  message: string
}

export function validateTransferForETransport(doc: ETransportTransferDocLike | null | undefined) {
  const issues: ETransportValidationIssue[] = []
  const items = Array.isArray(doc?.items) ? doc.items : []

  if (!doc?.fromLocation) {
    issues.push({ severity: "error", field: "fromLocationId", message: "Locatia de incarcare lipseste." })
  }

  if (!doc?.toLocation) {
    issues.push({ severity: "error", field: "toLocationId", message: "Locatia de descarcare lipseste." })
  }

  if (!normalizeText(doc?.eTransportDeclaredStart)) {
    issues.push({ severity: "error", field: "eTransportDeclaredStart", message: "Completeaza data de start transport." })
  }

  if (!normalizeText(doc?.eTransportOperationType)) {
    issues.push({ severity: "error", field: "eTransportOperationType", message: "Selecteaza tipul operatiunii." })
  }

  if (!normalizeText(doc?.eTransportPartnerCui)) {
    issues.push({ severity: "error", field: "eTransportPartnerCui", message: "Completeaza CUI-ul partenerului." })
  }

  if (!normalizeText(doc?.eTransportPartnerName)) {
    issues.push({ severity: "error", field: "eTransportPartnerName", message: "Completeaza denumirea partenerului." })
  }

  if (!normalizeText(doc?.vehicleNo)) {
    issues.push({ severity: "error", field: "vehicleNo", message: "Completeaza numarul auto." })
  }

  if (normalizeText(doc?.eTransportStartScope) === "PTF" && !normalizeText(doc?.eTransportStartBorderPoint)) {
    issues.push({ severity: "error", field: "eTransportStartBorderPoint", message: "Selecteaza punctul de frontiera pentru start." })
  }

  if (normalizeText(doc?.eTransportEndScope) === "PTF" && !normalizeText(doc?.eTransportEndBorderPoint)) {
    issues.push({ severity: "error", field: "eTransportEndBorderPoint", message: "Selecteaza punctul de frontiera pentru final." })
  }

  if (normalizeText(doc?.eTransportStartScope) === "ADR" && !normalizeText(buildStructuredAddressText(doc?.eTransportStartAddress) || buildLocationText(doc?.fromLocation))) {
    issues.push({ severity: "error", field: "eTransportStartAddress", message: "Completeaza adresa de start a traseului." })
  }

  if (normalizeText(doc?.eTransportEndScope) === "ADR" && !normalizeText(buildStructuredAddressText(doc?.eTransportEndAddress) || buildLocationText(doc?.toLocation))) {
    issues.push({ severity: "error", field: "eTransportEndAddress", message: "Completeaza adresa finala a traseului." })
  }

  if (toNumber(doc?.eTransportVehicleMaxMassKg) < 2500) {
    issues.push({
      severity: "warning",
      field: "eTransportVehicleMaxMassKg",
      message: "Masa maxima a vehiculului este sub 2.500 kg sau nu este completata.",
    })
  }

  if (!normalizeText(doc?.eTransportOrganizer)) {
    issues.push({ severity: "warning", field: "eTransportOrganizer", message: "Completeaza organizatorul transportului." })
  }

  if (!normalizeText(doc?.eTransportOperator)) {
    issues.push({ severity: "warning", field: "eTransportOperator", message: "Completeaza transportatorul / operatorul." })
  }

  if (!items.length) {
    issues.push({ severity: "error", field: "items", message: "Transferul trebuie sa aiba cel putin o linie." })
  }

  items.forEach((item: ETransportLineLike, index: number) => {
    const label = `Linia ${index + 1}`
    if (!normalizeText(item?.product?.name || item?.productName)) {
      issues.push({ severity: "error", field: `items[${index}].product`, message: `${label}: lipseste produsul.` })
    }
    if (toNumber(item?.qty) <= 0) {
      issues.push({ severity: "error", field: `items[${index}].qty`, message: `${label}: cantitatea trebuie sa fie mai mare decat 0.` })
    }
    if (!normalizeText(item?.product?.ncCode)) {
      issues.push({
        severity: item?.product?.isFiscalRiskProduct ? "error" : "warning",
        field: `items[${index}].product.ncCode`,
        message: `${label}: produsul nu are Cod NC completat.`,
      })
    }
    if (toNumber(item?.product?.grossWeightKg || 0) <= 0) {
      issues.push({
        severity: "error",
        field: `items[${index}].product.grossWeightKg`,
        message: `${label}: produsul trebuie sa aiba greutate bruta / UM mai mare decat 0 pentru RO e-Transport.`,
      })
    }
    if (toNumber(item?.product?.netWeightKg || item?.product?.grossWeightKg || 0) <= 0) {
      issues.push({
        severity: "error",
        field: `items[${index}].product.netWeightKg`,
        message: `${label}: produsul trebuie sa aiba greutate neta / UM mai mare decat 0 pentru RO e-Transport.`,
      })
    }
  })

  return issues
}

export function generateTransferETransportXml(doc: ETransportTransferDocLike | null | undefined) {
  const items = Array.isArray(doc?.items) ? doc.items : []
  const transportDate = formatDateOnly(doc?.eTransportDeclaredStart || doc?.docDate)
  const transportDocDate = formatDateOnly(doc?.eTransportTransportDocDate || doc?.docDate)
  const operationTypeCode = resolveOperationTypeCode(doc?.eTransportOperationType)
  const goodsPurposeCode = resolveGoodsPurposeCode(operationTypeCode, "TRANSFER", doc?.eTransportTransportDocType || "TRANSFER")
  const declarantCode = normalizeText(doc?.company?.cui || doc?.declarantCode)
  const declarantRef = normalizeText(doc?.eTransportInternalRef || doc?.docNo)
  const documentTypeCode = resolveTransportDocumentTypeCode(doc?.eTransportTransportDocType || "TRANSFER")

  const linesXml = items
    .map((item: ETransportLineLike) => {
      const qty = toNumber(item?.qty)
      const unitPrice = toNumber(item?.unitPrice)
      const lineValue = toNumber(item?.lineValue)
      const netWeightKg = toNumber(item?.product?.netWeightKg || item?.product?.grossWeightKg || 0)
      const grossWeightKg = toNumber(item?.product?.grossWeightKg || 0)
      return `    <bunuriTransportate codScopOperatiune="${xmlEscape(goodsPurposeCode)}" codTarifar="${xmlEscape(item?.product?.ncCode || "")}" denumireMarfa="${xmlEscape(item?.product?.name || item?.productName || "")}" cantitate="${transportDecimal(qty)}" codUnitateMasura="${xmlEscape(resolveTransportUomCode(item))}" greutateNeta="${transportDecimal(qty * netWeightKg)}" greutateBruta="${transportDecimal(qty * grossWeightKg)}" valoareLeiFaraTva="${decimal(lineValue, 2)}"/>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<eTransport xmlns="${ETRANSPORT_XMLNS}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${xmlEscape(ETRANSPORT_SCHEMA_LOCATION)}"
  codDeclarant="${xmlEscape(declarantCode)}" refDeclarant="${xmlEscape(declarantRef)}">
  <notificare codTipOperatiune="${xmlEscape(operationTypeCode)}">
${linesXml}
    <partenerComercial codTara="${xmlEscape(normalizeCountryCode(doc?.eTransportPartnerCountry))}" cod="${xmlEscape(doc?.eTransportPartnerCui || "")}" denumire="${xmlEscape(doc?.eTransportPartnerName || "")}" />
    <dateTransport ${buildTransportAttrs({
      vehicleNo: doc?.vehicleNo,
      trailerNo: doc?.trailerNo,
      transportDate: doc?.eTransportDeclaredStart || doc?.docDate,
      transporterCountry: normalizeCountryCode(doc?.company?.country || "RO"),
      transporterCode: declarantCode,
      transporterName: doc?.eTransportOrganizer || doc?.company?.name || "",
      startScope: doc?.eTransportStartScope,
      startBorderPoint: doc?.eTransportStartBorderPoint,
      endScope: doc?.eTransportEndScope,
      endBorderPoint: doc?.eTransportEndBorderPoint,
    })} />
${buildRoutePlacesXml(
  doc?.eTransportStartScope,
  doc?.eTransportStartAddress,
  doc?.eTransportStartBorderPoint,
  doc?.eTransportEndScope,
  doc?.eTransportEndAddress,
  doc?.eTransportEndBorderPoint,
)}
    <documenteTransport tipDocument="${xmlEscape(documentTypeCode)}"${normalizeText(doc?.eTransportTransportDocNo || doc?.docNo) ? ` numarDocument="${xmlEscape(doc?.eTransportTransportDocNo || doc?.docNo || "")}"` : ""} dataDocument="${xmlEscape(transportDocDate)}"${normalizeText(doc?.eTransportTransportDocNotes) ? ` observatii="${xmlEscape(doc?.eTransportTransportDocNotes || "")}"` : ""} />
  </notificare>
</eTransport>`
}

export function validateNoticeForETransport(notice: ETransportNoticeLike | null | undefined) {
  const issues: ETransportValidationIssue[] = []
  const items = Array.isArray(notice?.items) ? notice.items : []

  if (!normalizeText(notice?.declaredStart)) {
    issues.push({ severity: "error", field: "declaredStart", message: "Completeaza data de start transport." })
  }

  if (!normalizeText(notice?.operationType)) {
    issues.push({ severity: "error", field: "operationType", message: "Selecteaza tipul operatiunii." })
  }

  if (!normalizeText(notice?.partnerCui)) {
    issues.push({ severity: "error", field: "partnerCui", message: "Completeaza CUI-ul partenerului." })
  }

  if (!normalizeText(notice?.partnerName)) {
    issues.push({ severity: "error", field: "partnerName", message: "Completeaza denumirea partenerului." })
  }

  if (!normalizeText(notice?.vehicleNo)) {
    issues.push({ severity: "error", field: "vehicleNo", message: "Completeaza numarul auto." })
  }

  if (normalizeText(notice?.startScope) === "PTF" && !normalizeText(notice?.startBorderPoint)) {
    issues.push({ severity: "error", field: "startBorderPoint", message: "Selecteaza punctul de frontiera pentru start." })
  }

  if (normalizeText(notice?.endScope) === "PTF" && !normalizeText(notice?.endBorderPoint)) {
    issues.push({ severity: "error", field: "endBorderPoint", message: "Selecteaza punctul de frontiera pentru final." })
  }

  if (normalizeText(notice?.startScope) === "ADR" && !buildNoticeAddressText(notice?.startScope, notice?.startAddress, notice?.startBorderPoint)) {
    issues.push({ severity: "error", field: "startAddress", message: "Completeaza adresa de start a traseului." })
  }

  if (normalizeText(notice?.endScope) === "ADR" && !buildNoticeAddressText(notice?.endScope, notice?.endAddress, notice?.endBorderPoint)) {
    issues.push({ severity: "error", field: "endAddress", message: "Completeaza adresa finala a traseului." })
  }

  if (!normalizeText(notice?.organizerName)) {
    issues.push({ severity: "warning", field: "organizerName", message: "Completeaza organizatorul transportului." })
  }

  if (!normalizeText(notice?.operatorName)) {
    issues.push({ severity: "warning", field: "operatorName", message: "Completeaza transportatorul / operatorul." })
  }

  if (!items.length) {
    issues.push({ severity: "error", field: "items", message: "Notificarea trebuie sa aiba cel putin o linie." })
  }

  items.forEach((item: ETransportLineLike, index: number) => {
    const label = `Linia ${index + 1}`
    if (!normalizeText(item?.name || item?.product?.name)) {
      issues.push({ severity: "error", field: `items[${index}].name`, message: `${label}: lipseste denumirea bunului.` })
    }
    if (toNumber(item?.qty) <= 0) {
      issues.push({ severity: "error", field: `items[${index}].qty`, message: `${label}: cantitatea trebuie sa fie mai mare decat 0.` })
    }
    if (!normalizeText(item?.ncCode || item?.product?.ncCode)) {
      issues.push({
        severity: item?.fiscalRisk || item?.product?.isFiscalRiskProduct ? "error" : "warning",
        field: `items[${index}].ncCode`,
        message: `${label}: produsul nu are Cod NC completat.`,
      })
    }
    if (!normalizeText(item?.uomCode || resolveTransportUomCode(item))) {
      issues.push({ severity: "warning", field: `items[${index}].uomCode`, message: `${label}: lipseste codul UM.` })
    }
    if (toNumber(item?.grossWeightPerUnitKg) <= 0 && toNumber(item?.grossWeightTotalKg) <= 0) {
      issues.push({
        severity: "error",
        field: `items[${index}].grossWeightPerUnitKg`,
        message: `${label}: completeaza o greutate bruta mai mare decat 0 pentru RO e-Transport.`,
      })
    }
    if (toNumber(item?.netWeightPerUnitKg) <= 0 && toNumber(item?.netWeightTotalKg) <= 0) {
      issues.push({
        severity: "error",
        field: `items[${index}].netWeightPerUnitKg`,
        message: `${label}: completeaza o greutate neta mai mare decat 0 pentru RO e-Transport.`,
      })
    }
  })

  return issues
}

export function generateETransportNoticeXml(notice: ETransportNoticeLike | null | undefined) {
  const items = Array.isArray(notice?.items) ? notice.items : []
  const transportDate = formatDateOnly(notice?.declaredStart || notice?.createdAt)
  const transportDocDate = formatDateOnly(notice?.transportDocDate)
  const operationTypeCode = resolveOperationTypeCode(notice?.operationType)
  const goodsPurposeCode = resolveGoodsPurposeCode(operationTypeCode, notice?.sourceType, notice?.transportDocType)
  const declarantCode = normalizeText(notice?.company?.cui || notice?.organizerCode)
  const declarantRef = normalizeText(notice?.internalRef || notice?.noticeNo)
  const documentTypeCode = resolveTransportDocumentTypeCode(notice?.transportDocType || "ALTELE")

  const linesXml = items
    .map((item: ETransportLineLike) => {
      const qty = toNumber(item?.qty)
      const lineValue = toNumber(item?.lineValue)
      const netWeightPerUnitKg = toNumber(item?.netWeightPerUnitKg || item?.grossWeightPerUnitKg || item?.product?.grossWeightKg || 0)
      const grossWeightPerUnitKg = toNumber(item?.grossWeightPerUnitKg || item?.product?.grossWeightKg || 0)
      return `    <bunuriTransportate codScopOperatiune="${xmlEscape(goodsPurposeCode)}" codTarifar="${xmlEscape(item?.ncCode || item?.product?.ncCode || "")}" denumireMarfa="${xmlEscape(item?.name || item?.product?.name || "")}" cantitate="${transportDecimal(qty)}" codUnitateMasura="${xmlEscape(resolveTransportUomCode(item))}" greutateNeta="${transportDecimal(toNumber(item?.netWeightTotalKg) || qty * netWeightPerUnitKg)}" greutateBruta="${transportDecimal(toNumber(item?.grossWeightTotalKg) || qty * grossWeightPerUnitKg)}" valoareLeiFaraTva="${decimal(lineValue, 2)}"/>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<eTransport xmlns="${ETRANSPORT_XMLNS}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${xmlEscape(ETRANSPORT_SCHEMA_LOCATION)}"
  codDeclarant="${xmlEscape(declarantCode)}" refDeclarant="${xmlEscape(declarantRef)}">
  <notificare codTipOperatiune="${xmlEscape(operationTypeCode)}">
${linesXml}
    <partenerComercial codTara="${xmlEscape(normalizeCountryCode(notice?.partnerCountry))}" cod="${xmlEscape(notice?.partnerCui || "")}" denumire="${xmlEscape(notice?.partnerName || "")}" />
    <dateTransport ${buildTransportAttrs({
      vehicleNo: notice?.vehicleNo,
      trailerNo: notice?.trailerNo,
      transportDate: notice?.declaredStart || notice?.createdAt,
      transporterCountry: normalizeCountryCode(notice?.organizerCountry || "RO"),
      transporterCode: notice?.organizerCode || "",
      transporterName: notice?.organizerName || "",
      startScope: notice?.startScope,
      startBorderPoint: notice?.startBorderPoint,
      endScope: notice?.endScope,
      endBorderPoint: notice?.endBorderPoint,
    })} />
${buildRoutePlacesXml(
  notice?.startScope,
  notice?.startAddress,
  notice?.startBorderPoint,
  notice?.endScope,
  notice?.endAddress,
  notice?.endBorderPoint,
)}
    <documenteTransport tipDocument="${xmlEscape(documentTypeCode)}"${normalizeText(notice?.transportDocNo) ? ` numarDocument="${xmlEscape(notice?.transportDocNo || "")}"` : ""} dataDocument="${xmlEscape(transportDocDate)}"${normalizeText(notice?.transportDocNotes) ? ` observatii="${xmlEscape(notice?.transportDocNotes || "")}"` : ""} />
  </notificare>
</eTransport>`
}
