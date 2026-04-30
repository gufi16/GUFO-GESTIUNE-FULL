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

function formatDateTimeLocal(value: unknown) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function normalizeText(value: unknown) {
  return String(value || "").trim()
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

  return [
    normalizeText(parsed.companyName),
    normalizeText(parsed.address),
    normalizeText(parsed.city),
    normalizeText(parsed.county),
    normalizeText(parsed.postalCode),
    normalizeText(parsed.country || "Romania"),
    normalizeText(parsed.extra),
  ]
    .filter(Boolean)
    .join(", ")
}

function buildLocationText(location: any) {
  if (!location) return ""
  return [location.address, location.city, location.county, location.country || "RO"]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(", ")
}

export type ETransportValidationIssue = {
  severity: "error" | "warning"
  field: string
  message: string
}

export function validateTransferForETransport(doc: any) {
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

  items.forEach((item: any, index: number) => {
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
  })

  return issues
}

export function generateTransferETransportXml(doc: any) {
  const items = Array.isArray(doc?.items) ? doc.items : []
  const totalGrossWeightKg = items.reduce((sum: number, item: any) => {
    return sum + toNumber(item?.qty) * toNumber(item?.product?.grossWeightKg || 0)
  }, 0)
  const totalValueRon = items.reduce((sum: number, item: any) => sum + toNumber(item?.lineValue), 0)
  const startText = formatDateTimeLocal(doc?.eTransportDeclaredStart)
  const loadingAddress = normalizeText(doc?.eTransportStartScope) === "PTF"
    ? normalizeText(doc?.eTransportStartBorderPoint)
    : normalizeText(buildStructuredAddressText(doc?.eTransportStartAddress) || buildLocationText(doc?.fromLocation))
  const unloadingAddress = normalizeText(doc?.eTransportEndScope) === "PTF"
    ? normalizeText(doc?.eTransportEndBorderPoint)
    : normalizeText(buildStructuredAddressText(doc?.eTransportEndAddress) || buildLocationText(doc?.toLocation))

  const linesXml = items
    .map((item: any, index: number) => {
      const qty = toNumber(item?.qty)
      const unitPrice = toNumber(item?.unitPrice)
      const lineValue = toNumber(item?.lineValue)
      const grossWeightKg = toNumber(item?.product?.grossWeightKg || 0)
      return `    <Line index="${index + 1}">
      <Sku>${xmlEscape(item?.product?.sku || "")}</Sku>
      <Name>${xmlEscape(item?.product?.name || item?.productName || "")}</Name>
      <NcCode>${xmlEscape(item?.product?.ncCode || "")}</NcCode>
      <FiscalRisk>${item?.product?.isFiscalRiskProduct ? "true" : "false"}</FiscalRisk>
      <Uom>${xmlEscape(item?.uom?.code || item?.product?.uom?.code || item?.uomCode || "")}</Uom>
      <Quantity>${decimal(qty, 3)}</Quantity>
      <UnitPriceRon>${decimal(unitPrice, 2)}</UnitPriceRon>
      <LineValueRon>${decimal(lineValue, 2)}</LineValueRon>
      <GrossWeightPerUnitKg>${decimal(grossWeightKg, 3)}</GrossWeightPerUnitKg>
      <GrossWeightTotalKg>${decimal(qty * grossWeightKg, 3)}</GrossWeightTotalKg>
    </Line>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<ROeTransportDraft>
  <Document>
    <Type>TRANSFER</Type>
    <Number>${xmlEscape(doc?.docNo || "")}</Number>
    <Date>${xmlEscape(String(doc?.docDate || "").slice(0, 10))}</Date>
    <Status>${xmlEscape(doc?.eTransportStatus || "PREPARED")}</Status>
  </Document>
  <Transport>
    <OperationType>${xmlEscape(doc?.eTransportOperationType || "")}</OperationType>
    <DeclaredStart>${xmlEscape(startText)}</DeclaredStart>
    <VehicleNo>${xmlEscape(doc?.vehicleNo || "")}</VehicleNo>
    <TrailerNo>${xmlEscape(doc?.trailerNo || "")}</TrailerNo>
    <VehicleMaxMassKg>${decimal(doc?.eTransportVehicleMaxMassKg || 0, 2)}</VehicleMaxMassKg>
    <Organizer>${xmlEscape(doc?.eTransportOrganizer || "")}</Organizer>
    <Operator>${xmlEscape(doc?.eTransportOperator || "")}</Operator>
  </Transport>
  <LoadingPlace>
    <Scope>${xmlEscape(doc?.eTransportStartScope || "")}</Scope>
    <Code>${xmlEscape(doc?.fromLocation?.code || "")}</Code>
    <Name>${xmlEscape(doc?.fromLocation?.name || "")}</Name>
    <Address>${xmlEscape(loadingAddress)}</Address>
  </LoadingPlace>
  <UnloadingPlace>
    <Scope>${xmlEscape(doc?.eTransportEndScope || "")}</Scope>
    <Code>${xmlEscape(doc?.toLocation?.code || "")}</Code>
    <Name>${xmlEscape(doc?.toLocation?.name || "")}</Name>
    <Address>${xmlEscape(unloadingAddress)}</Address>
  </UnloadingPlace>
  <Summary>
    <Candidate>${doc?.eTransportCandidate ? "true" : "false"}</Candidate>
    <Required>${doc?.eTransportRequired ? "true" : "false"}</Required>
    <TotalGrossWeightKg>${decimal(totalGrossWeightKg, 3)}</TotalGrossWeightKg>
    <TotalValueRon>${decimal(totalValueRon, 2)}</TotalValueRon>
  </Summary>
  <Partner>
    <Country>${xmlEscape(doc?.eTransportPartnerCountry || "RO")}</Country>
    <Cui>${xmlEscape(doc?.eTransportPartnerCui || "")}</Cui>
    <Name>${xmlEscape(doc?.eTransportPartnerName || "")}</Name>
    <InternalReference>${xmlEscape(doc?.eTransportInternalRef || "")}</InternalReference>
  </Partner>
  <Lines>
${linesXml}
  </Lines>
</ROeTransportDraft>`
}
