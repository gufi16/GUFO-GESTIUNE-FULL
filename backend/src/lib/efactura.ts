type ValidationSeverity = "error" | "warning"

export type EFacturaValidationIssue = {
  severity: ValidationSeverity
  field: string
  message: string
}

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

function formatDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""))
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

function normalizeTextKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase()
}

function normalizeCountryCode(value: unknown, fallback = "RO") {
  const text = String(value || fallback).trim().toUpperCase()
  return /^[A-Z]{2}$/.test(text) ? text : fallback
}

function normalizeVatCategory(line: any) {
  const explicit = String(line?.vatCategoryCode || "").trim().toUpperCase()
  if (explicit) {
    // The current ERP data model does not carry full exemption metadata.
    // Map legacy "O" lines to zero-rated to avoid invalid "not subject to VAT" XML.
    if (explicit === "O") return "Z"
    return explicit
  }
  return toNumber(line?.vatRateValue) > 0 ? "S" : "Z"
}

function effectiveUnitPrice(line: any) {
  const qty = toNumber(line?.qty)
  if (qty <= 0) return toNumber(line?.unitPriceFc)
  return toNumber(line?.lineNetFc) / qty
}

const ROMANIA_COUNTY_CODES: Record<string, string> = {
  ALBA: "RO-AB",
  ARAD: "RO-AR",
  ARGES: "RO-AG",
  BACAU: "RO-BC",
  BIHOR: "RO-BH",
  "BISTRITA NASAUD": "RO-BN",
  BOTOSANI: "RO-BT",
  BRAILA: "RO-BR",
  BRASOV: "RO-BV",
  BUCURESTI: "RO-B",
  BUZAU: "RO-BZ",
  CALARASI: "RO-CL",
  "CARAS SEVERIN": "RO-CS",
  CLUJ: "RO-CJ",
  CONSTANTA: "RO-CT",
  COVASNA: "RO-CV",
  DAMBOVITA: "RO-DB",
  DIMBOVITA: "RO-DB",
  DOLJ: "RO-DJ",
  GALATI: "RO-GL",
  GIURGIU: "RO-GR",
  GORJ: "RO-GJ",
  HARGHITA: "RO-HR",
  HUNEDOARA: "RO-HD",
  IALOMITA: "RO-IL",
  IASI: "RO-IS",
  ILFOV: "RO-IF",
  MARAMURES: "RO-MM",
  MEHEDINTI: "RO-MH",
  MURES: "RO-MS",
  NEAMT: "RO-NT",
  OLT: "RO-OT",
  PRAHOVA: "RO-PH",
  SALAJ: "RO-SJ",
  "SATU MARE": "RO-SM",
  SIBIU: "RO-SB",
  SUCEAVA: "RO-SV",
  TELEORMAN: "RO-TR",
  TIMIS: "RO-TM",
  TULCEA: "RO-TL",
  VALCEA: "RO-VL",
  VILCEA: "RO-VL",
  VASLUI: "RO-VS",
  VRANCEA: "RO-VN",
}

const UOM_CODES: Record<string, string> = {
  BUC: "C62",
  BUCATA: "C62",
  BUCATI: "C62",
  PIECE: "C62",
  PCS: "C62",
  SET: "C62",
  C62: "C62",
  H87: "H87",
  KG: "KGM",
  KILOGRAM: "KGM",
  KGM: "KGM",
  G: "GRM",
  GR: "GRM",
  GRM: "GRM",
  L: "LTR",
  LITRU: "LTR",
  LITRI: "LTR",
  LTR: "LTR",
  ML: "MLT",
  MLT: "MLT",
  M: "MTR",
  METRU: "MTR",
  METRI: "MTR",
  MTR: "MTR",
  H: "HUR",
  ORA: "HUR",
  ORE: "HUR",
  HUR: "HUR",
}

const DIRECT_STANDARD_UOM_CODES = new Set([
  "10",
  "11",
  "13",
  "14",
  "15",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "27",
  "28",
  "2A",
  "2B",
  "2C",
  "40",
  "41",
  "4K",
  "4L",
  "5B",
  "5E",
  "5J",
  "A93",
  "ANN",
  "BAG",
  "BG",
  "BO",
  "BX",
  "C62",
  "CG",
  "CLT",
  "CMK",
  "CMQ",
  "CMT",
  "CS",
  "CTM",
  "DAY",
  "DLT",
  "DRM",
  "FOT",
  "GL",
  "GRM",
  "H87",
  "HLT",
  "HUR",
  "INH",
  "KGM",
  "KTM",
  "KWH",
  "LBR",
  "LTR",
  "MGM",
  "MIN",
  "MLT",
  "MMK",
  "MMQ",
  "MMT",
  "MON",
  "MTR",
  "MTK",
  "MTQ",
  "NAR",
  "PA",
  "PF",
  "PK",
  "PR",
  "RO",
  "SA",
  "SEC",
  "SET",
  "SMI",
  "T3",
  "TNE",
  "WEE",
  "XBX",
  "YRD",
])

function normalizeRomanianCountyCode(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return ""
  const upper = text.toUpperCase()
  if (/^RO-[A-Z]{1,2}$/.test(upper)) return upper
  return ROMANIA_COUNTY_CODES[normalizeTextKey(text)] || ""
}

function normalizeEndpointVatId(value: unknown) {
  const digits = String(value || "").replace(/^RO/i, "").replace(/\D+/g, "")
  if (!digits) return ""
  return `RO${digits}`
}

function normalizeLegalId(value: unknown) {
  return String(value || "").replace(/^RO/i, "").replace(/\D+/g, "")
}

function normalizeUomCode(value: unknown) {
  const text = normalizeTextKey(value)
  if (!text) return "C62"
  if (DIRECT_STANDARD_UOM_CODES.has(text)) return text
  return UOM_CODES[text] || "C62"
}

function resolveInvoiceLineUomCode(line: any) {
  return (
    line?.uomStandardCode ||
    line?.product?.uom?.standardCode ||
    line?.uomCode ||
    line?.uom ||
    ""
  )
}

function expandInvoiceLinesForEfactura(invoice: any) {
  const expanded: any[] = []

  for (const line of Array.isArray(invoice?.items) ? invoice.items : []) {
    expanded.push(line)

    const sgrTotalFc = toNumber(line?.sgrTotalFc)
    if (sgrTotalFc <= 0) continue

    const qty = Math.max(toNumber(line?.qty), 1)
    const sgrUnitFc = toNumber(line?.sgrUnitFc) > 0 ? toNumber(line?.sgrUnitFc) : sgrTotalFc / qty

    expanded.push({
      ...line,
      productCode: null,
      productName: `SGR ${String(line?.productName || "").trim()}`.trim(),
      qty,
      unitPriceFc: sgrUnitFc,
      vatRateValue: 0,
      vatCategoryCode: "Z",
      lineNetFc: sgrTotalFc,
      lineVatFc: 0,
      lineGrossFc: sgrTotalFc,
      discountAmountFc: 0,
      discountPercent: 0,
      sgrUnitFc: 0,
      sgrTotalFc: 0,
      discountAmountRon: 0,
      lineNetRon: toNumber(line?.sgrTotalRon),
      lineVatRon: 0,
      lineGrossRon: toNumber(line?.sgrTotalRon),
      sgrTotalRon: 0,
    })
  }

  return expanded
}

function isLikelyValidRomanianTaxId(value: unknown) {
  const digits = normalizeLegalId(value)
  return digits.length >= 2 && digits.length <= 10 && !/^0+$/.test(digits)
}

function resolveCustomerCounty(invoice: any) {
  return (
    invoice?.customer?.county ||
    invoice?.customer?.region ||
    invoice?.customerCounty ||
    invoice?.customerRegion ||
    ""
  )
}

function resolveCustomerCity(invoice: any) {
  return invoice?.customer?.city || invoice?.customerCity || ""
}

function resolveCustomerPostalCode(invoice: any) {
  return invoice?.customer?.postalCode || invoice?.customerPostalCode || ""
}

function resolveCustomerCountry(invoice: any) {
  return invoice?.customer?.country || invoice?.customerCountry || "RO"
}

export function validateInvoiceForEFactura(invoice: any, company: any) {
  const issues: EFacturaValidationIssue[] = []
  const supplierCity = company?.city || company?.efacturaSellerCity
  const supplierCounty = company?.county || company?.efacturaSellerCounty
  const supplierCountry = company?.country || company?.efacturaSellerCountryCode
  const supplierPostalCode = company?.postalCode || company?.efacturaSellerPostalCode
  const customerCounty = resolveCustomerCounty(invoice)
  const customerCountry = resolveCustomerCountry(invoice)

  if (!company?.name) issues.push({ severity: "error", field: "company.name", message: "Completeaza denumirea firmei emitente." })
  if (!company?.cui) issues.push({ severity: "error", field: "company.cui", message: "Completeaza CUI-ul firmei emitente." })
  else if (!isLikelyValidRomanianTaxId(company?.cui)) issues.push({ severity: "error", field: "company.cui", message: "CUI-ul firmei emitente nu este valid pentru e-Factura." })
  if (!company?.address) issues.push({ severity: "error", field: "company.address", message: "Completeaza adresa firmei emitente." })
  if (!supplierCity) issues.push({ severity: "warning", field: "company.city", message: "Adauga localitatea firmei pentru e-Factura." })
  if (!supplierCounty) issues.push({ severity: "warning", field: "company.county", message: "Adauga judetul firmei pentru e-Factura." })
  if (!supplierPostalCode) issues.push({ severity: "warning", field: "company.postalCode", message: "Adauga codul postal al firmei pentru e-Factura." })
  if (!supplierCountry) issues.push({ severity: "warning", field: "company.country", message: "Adauga tara firmei pentru e-Factura." })

  if (!invoice?.docNo) issues.push({ severity: "error", field: "invoice.docNo", message: "Factura nu are numar." })
  if (!invoice?.docDate) issues.push({ severity: "error", field: "invoice.docDate", message: "Factura nu are data." })
  if (!invoice?.customerName) issues.push({ severity: "error", field: "invoice.customerName", message: "Selecteaza clientul facturii." })
  if (!Array.isArray(invoice?.items) || !invoice.items.length) issues.push({ severity: "error", field: "invoice.items", message: "Factura trebuie sa aiba cel putin o linie." })

  if (invoice?.isEfacturaRequired !== false) {
    if (!invoice?.customerCif) {
      issues.push({ severity: "warning", field: "invoice.customerCif", message: "Clientul nu are CIF. Verifica daca factura trebuie transmisa in e-Factura." })
    } else if (!isLikelyValidRomanianTaxId(invoice?.customerCif)) {
      issues.push({ severity: "error", field: "invoice.customerCif", message: "CIF-ul clientului nu este valid pentru e-Factura." })
    }
    if (!invoice?.customerAddress) {
      issues.push({ severity: "warning", field: "invoice.customerAddress", message: "Clientul nu are adresa completata pe factura." })
    }
  }

  if (normalizeCountryCode(supplierCountry) === "RO" && !normalizeRomanianCountyCode(supplierCounty)) {
    issues.push({ severity: "error", field: "company.county", message: "Judetul firmei trebuie mapat la cod ISO 3166-2:RO, de tip RO-B sau RO-CJ." })
  }

  if (normalizeCountryCode(customerCountry) === "RO" && !normalizeRomanianCountyCode(customerCounty)) {
    issues.push({ severity: "error", field: "invoice.customer.county", message: "Judetul clientului trebuie mapat la cod ISO 3166-2:RO, de tip RO-B sau RO-CJ." })
  }

  for (const [index, line] of Array.isArray(invoice?.items) ? invoice.items.entries() : []) {
    const row = index + 1
    if (!line?.productName) issues.push({ severity: "error", field: `items.${index}.productName`, message: `Linia ${row} nu are denumirea produsului.` })
    if (toNumber(line?.qty) <= 0) issues.push({ severity: "error", field: `items.${index}.qty`, message: `Linia ${row} are cantitate invalida.` })
    if (toNumber(line?.unitPriceFc) < 0) issues.push({ severity: "error", field: `items.${index}.unitPriceFc`, message: `Linia ${row} are pret invalid.` })
    if (!resolveInvoiceLineUomCode(line)) issues.push({ severity: "warning", field: `items.${index}.uomCode`, message: `Linia ${row} nu are UM completata pe snapshot.` })
    if (!normalizeUomCode(resolveInvoiceLineUomCode(line))) {
      issues.push({ severity: "error", field: `items.${index}.uomCode`, message: `Linia ${row} are UM invalida pentru e-Factura.` })
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")

  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings,
  }
}

export function generateInvoiceEFacturaXml(invoice: any, company: any) {
  const issueDate = formatDate(invoice?.docDate)
  const dueDate = formatDate(invoice?.dueDate)
  const currency = String(invoice?.currency || "RON").toUpperCase()
  const supplierCountry = normalizeCountryCode(company?.country || company?.efacturaSellerCountryCode || "RO")
  const supplierCity = company?.city || company?.efacturaSellerCity
  const supplierPostalCode = company?.postalCode || company?.efacturaSellerPostalCode
  const supplierCounty = normalizeRomanianCountyCode(company?.county || company?.efacturaSellerCounty)
  const customerCountry = normalizeCountryCode(resolveCustomerCountry(invoice))
  const customerCounty = normalizeRomanianCountyCode(resolveCustomerCounty(invoice))
  const supplierVatId = normalizeEndpointVatId(company?.cui)
  const buyerVatId = normalizeEndpointVatId(invoice?.customerCif)
  const supplierLegalId = normalizeLegalId(company?.cui)
  const buyerLegalId = normalizeLegalId(invoice?.customerCif)
  const invoiceTypeCode = String(invoice?.invoiceTypeCode || "380")
  const endpointSchemeId = "9947"
  const expandedLines = expandInvoiceLinesForEfactura(invoice)
  const legalLineExtensionAmount =
    toNumber(invoice?.totalNetFc) + toNumber(invoice?.totalSgrFc)
  const legalTaxExclusiveAmount =
    toNumber(invoice?.totalNetFc) + toNumber(invoice?.totalSgrFc)
  const legalTaxInclusiveAmount =
    legalTaxExclusiveAmount + toNumber(invoice?.totalVatFc)

  const taxSubtotals = new Map<string, { taxable: number; tax: number; percent: number }>()
  for (const line of expandedLines) {
    const percent = toNumber(line?.vatRateValue)
    const key = `${normalizeVatCategory(line)}:${percent}`
    const current = taxSubtotals.get(key) || { taxable: 0, tax: 0, percent }
    current.taxable += toNumber(line?.lineNetFc)
    current.tax += toNumber(line?.lineVatFc)
    taxSubtotals.set(key, current)
  }

  const taxSubtotalXml = Array.from(taxSubtotals.entries())
    .map(([key, value]) => {
      const [category] = key.split(":")
      return [
        "<cac:TaxSubtotal>",
        `<cbc:TaxableAmount currencyID="${xmlEscape(currency)}">${decimal(value.taxable)}</cbc:TaxableAmount>`,
        `<cbc:TaxAmount currencyID="${xmlEscape(currency)}">${decimal(value.tax)}</cbc:TaxAmount>`,
        "<cac:TaxCategory>",
        `<cbc:ID>${xmlEscape(category)}</cbc:ID>`,
        `<cbc:Percent>${decimal(category === "Z" ? 0 : value.percent)}</cbc:Percent>`,
        "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
        "</cac:TaxCategory>",
        "</cac:TaxSubtotal>",
      ].join("")
    })
    .join("")

  const lineXml = expandedLines
    .map((line: any, index: number) => {
      const category = normalizeVatCategory(line)
      return [
        "<cac:InvoiceLine>",
        `<cbc:ID>${index + 1}</cbc:ID>`,
        `<cbc:InvoicedQuantity unitCode="${xmlEscape(normalizeUomCode(resolveInvoiceLineUomCode(line)))}">${decimal(line?.qty, 3)}</cbc:InvoicedQuantity>`,
        `<cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${decimal(line?.lineNetFc)}</cbc:LineExtensionAmount>`,
        "<cac:Item>",
        `<cbc:Name>${xmlEscape(line?.productName || "")}</cbc:Name>`,
        line?.productCode ? `<cac:SellersItemIdentification><cbc:ID>${xmlEscape(line.productCode)}</cbc:ID></cac:SellersItemIdentification>` : "",
        "<cac:ClassifiedTaxCategory>",
        `<cbc:ID>${xmlEscape(category)}</cbc:ID>`,
        `<cbc:Percent>${decimal(category === "Z" ? 0 : line?.vatRateValue)}</cbc:Percent>`,
        "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
        "</cac:ClassifiedTaxCategory>",
        "</cac:Item>",
        "<cac:Price>",
        `<cbc:PriceAmount currencyID="${xmlEscape(currency)}">${decimal(effectiveUnitPrice(line))}</cbc:PriceAmount>`,
        "</cac:Price>",
        "</cac:InvoiceLine>",
      ].join("")
    })
    .join("")

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">',
    `<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>`,
    `<cbc:ID>${xmlEscape(invoice?.docNo || "")}</cbc:ID>`,
    `<cbc:IssueDate>${xmlEscape(issueDate)}</cbc:IssueDate>`,
    dueDate ? `<cbc:DueDate>${xmlEscape(dueDate)}</cbc:DueDate>` : "",
    `<cbc:InvoiceTypeCode>${xmlEscape(invoiceTypeCode)}</cbc:InvoiceTypeCode>`,
    `<cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>`,
    "<cac:AccountingSupplierParty><cac:Party>",
    supplierVatId ? `<cbc:EndpointID schemeID="${endpointSchemeId}">${xmlEscape(supplierVatId)}</cbc:EndpointID>` : "",
    "<cac:PartyIdentification>",
    `<cbc:ID>${xmlEscape(supplierLegalId)}</cbc:ID>`,
    "</cac:PartyIdentification>",
    "<cac:PostalAddress>",
    `<cbc:StreetName>${xmlEscape(company?.address || "")}</cbc:StreetName>`,
    supplierCity ? `<cbc:CityName>${xmlEscape(supplierCity)}</cbc:CityName>` : "",
    supplierPostalCode ? `<cbc:PostalZone>${xmlEscape(supplierPostalCode)}</cbc:PostalZone>` : "",
    supplierCounty ? `<cbc:CountrySubentity>${xmlEscape(supplierCounty)}</cbc:CountrySubentity>` : "",
    `<cac:Country><cbc:IdentificationCode>${xmlEscape(supplierCountry)}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    supplierVatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(supplierVatId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(company?.name || "")}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    "</cac:Party></cac:AccountingSupplierParty>",
    "<cac:AccountingCustomerParty><cac:Party>",
    buyerVatId ? `<cbc:EndpointID schemeID="${endpointSchemeId}">${xmlEscape(buyerVatId)}</cbc:EndpointID>` : "",
    buyerLegalId ? `<cac:PartyIdentification><cbc:ID>${xmlEscape(buyerLegalId)}</cbc:ID></cac:PartyIdentification>` : "",
    "<cac:PostalAddress>",
    `<cbc:StreetName>${xmlEscape(invoice?.customerAddress || "")}</cbc:StreetName>`,
    resolveCustomerCity(invoice) ? `<cbc:CityName>${xmlEscape(resolveCustomerCity(invoice))}</cbc:CityName>` : "",
    resolveCustomerPostalCode(invoice) ? `<cbc:PostalZone>${xmlEscape(resolveCustomerPostalCode(invoice))}</cbc:PostalZone>` : "",
    customerCounty ? `<cbc:CountrySubentity>${xmlEscape(customerCounty)}</cbc:CountrySubentity>` : "",
    `<cac:Country><cbc:IdentificationCode>${xmlEscape(customerCountry)}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    buyerVatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(buyerVatId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(invoice?.customerName || "")}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    "</cac:Party></cac:AccountingCustomerParty>",
    "<cac:TaxTotal>",
    `<cbc:TaxAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalVatFc)}</cbc:TaxAmount>`,
    taxSubtotalXml,
    "</cac:TaxTotal>",
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${decimal(legalLineExtensionAmount)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${xmlEscape(currency)}">${decimal(legalTaxExclusiveAmount)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${xmlEscape(currency)}">${decimal(legalTaxInclusiveAmount)}</cbc:TaxInclusiveAmount>`,
    `<cbc:PayableAmount currencyID="${xmlEscape(currency)}">${decimal(legalTaxInclusiveAmount)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    lineXml,
    "</Invoice>",
  ].join("")
}
