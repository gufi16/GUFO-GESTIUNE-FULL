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

function normalizeVatCategory(line: any) {
  const explicit = String(line?.vatCategoryCode || "").trim().toUpperCase()
  if (explicit) return explicit
  return toNumber(line?.vatRateValue) > 0 ? "S" : "O"
}

function effectiveUnitPrice(line: any) {
  const qty = toNumber(line?.qty)
  if (qty <= 0) return toNumber(line?.unitPriceFc)
  return toNumber(line?.lineNetFc) / qty
}

export function validateInvoiceForEFactura(invoice: any, company: any) {
  const issues: EFacturaValidationIssue[] = []
  const supplierCity = company?.city || company?.efacturaSellerCity
  const supplierCounty = company?.county || company?.efacturaSellerCounty
  const supplierCountry = company?.country || company?.efacturaSellerCountryCode
  const supplierPostalCode = company?.postalCode || company?.efacturaSellerPostalCode

  if (!company?.name) issues.push({ severity: "error", field: "company.name", message: "Completeaza denumirea firmei emitente." })
  if (!company?.cui) issues.push({ severity: "error", field: "company.cui", message: "Completeaza CUI-ul firmei emitente." })
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
    }
    if (!invoice?.customerAddress) {
      issues.push({ severity: "warning", field: "invoice.customerAddress", message: "Clientul nu are adresa completata pe factura." })
    }
  }

  for (const [index, line] of Array.isArray(invoice?.items) ? invoice.items.entries() : []) {
    const row = index + 1
    if (!line?.productName) issues.push({ severity: "error", field: `items.${index}.productName`, message: `Linia ${row} nu are denumirea produsului.` })
    if (toNumber(line?.qty) <= 0) issues.push({ severity: "error", field: `items.${index}.qty`, message: `Linia ${row} are cantitate invalida.` })
    if (toNumber(line?.unitPriceFc) < 0) issues.push({ severity: "error", field: `items.${index}.unitPriceFc`, message: `Linia ${row} are pret invalid.` })
    if (!line?.uomCode) issues.push({ severity: "warning", field: `items.${index}.uomCode`, message: `Linia ${row} nu are UM completata pe snapshot.` })
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
  const supplierCountry = company?.country || company?.efacturaSellerCountryCode || "RO"
  const supplierCity = company?.city || company?.efacturaSellerCity
  const supplierPostalCode = company?.postalCode || company?.efacturaSellerPostalCode
  const supplierCounty = company?.county || company?.efacturaSellerCounty
  const customerCountry = invoice?.customer?.country || "RO"
  const invoiceTypeCode = String(invoice?.invoiceTypeCode || "380")

  const taxSubtotals = new Map<string, { taxable: number; tax: number; percent: number }>()
  for (const line of invoice?.items || []) {
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
        `<cbc:Percent>${decimal(value.percent)}</cbc:Percent>`,
        "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
        "</cac:TaxCategory>",
        "</cac:TaxSubtotal>",
      ].join("")
    })
    .join("")

  const lineXml = (invoice?.items || [])
    .map((line: any, index: number) =>
      [
        "<cac:InvoiceLine>",
        `<cbc:ID>${index + 1}</cbc:ID>`,
        `<cbc:InvoicedQuantity unitCode="${xmlEscape(line?.uomCode || "C62")}">${decimal(line?.qty, 3)}</cbc:InvoicedQuantity>`,
        `<cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${decimal(line?.lineNetFc)}</cbc:LineExtensionAmount>`,
        "<cac:Item>",
        `<cbc:Name>${xmlEscape(line?.productName || "")}</cbc:Name>`,
        line?.productCode ? `<cac:SellersItemIdentification><cbc:ID>${xmlEscape(line.productCode)}</cbc:ID></cac:SellersItemIdentification>` : "",
        "<cac:ClassifiedTaxCategory>",
        `<cbc:ID>${xmlEscape(normalizeVatCategory(line))}</cbc:ID>`,
        `<cbc:Percent>${decimal(line?.vatRateValue)}</cbc:Percent>`,
        "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
        "</cac:ClassifiedTaxCategory>",
        "</cac:Item>",
        "<cac:Price>",
        `<cbc:PriceAmount currencyID="${xmlEscape(currency)}">${decimal(effectiveUnitPrice(line))}</cbc:PriceAmount>`,
        "</cac:Price>",
        "</cac:InvoiceLine>",
      ].join(""),
    )
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
    `<cbc:EndpointID schemeID="CUI">${xmlEscape(company?.cui || "")}</cbc:EndpointID>`,
    "<cac:PartyIdentification>",
    `<cbc:ID>${xmlEscape(company?.cui || "")}</cbc:ID>`,
    "</cac:PartyIdentification>",
    "<cac:PostalAddress>",
    `<cbc:StreetName>${xmlEscape(company?.address || "")}</cbc:StreetName>`,
    supplierCity ? `<cbc:CityName>${xmlEscape(supplierCity)}</cbc:CityName>` : "",
    supplierPostalCode ? `<cbc:PostalZone>${xmlEscape(supplierPostalCode)}</cbc:PostalZone>` : "",
    supplierCounty ? `<cbc:CountrySubentity>${xmlEscape(supplierCounty)}</cbc:CountrySubentity>` : "",
    `<cac:Country><cbc:IdentificationCode>${xmlEscape(supplierCountry)}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(company?.cui || "")}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`,
    `<cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(company?.name || "")}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    "</cac:Party></cac:AccountingSupplierParty>",
    "<cac:AccountingCustomerParty><cac:Party>",
    invoice?.customerCif ? `<cbc:EndpointID schemeID="CUI">${xmlEscape(invoice.customerCif)}</cbc:EndpointID>` : "",
    invoice?.customerCif ? `<cac:PartyIdentification><cbc:ID>${xmlEscape(invoice.customerCif)}</cbc:ID></cac:PartyIdentification>` : "",
    "<cac:PostalAddress>",
    `<cbc:StreetName>${xmlEscape(invoice?.customerAddress || "")}</cbc:StreetName>`,
    invoice?.customer?.city ? `<cbc:CityName>${xmlEscape(invoice.customer.city)}</cbc:CityName>` : "",
    invoice?.customer?.postalCode ? `<cbc:PostalZone>${xmlEscape(invoice.customer.postalCode)}</cbc:PostalZone>` : "",
    invoice?.customer?.county ? `<cbc:CountrySubentity>${xmlEscape(invoice.customer.county)}</cbc:CountrySubentity>` : "",
    `<cac:Country><cbc:IdentificationCode>${xmlEscape(customerCountry)}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    invoice?.customerCif ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(invoice.customerCif)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(invoice?.customerName || "")}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    "</cac:Party></cac:AccountingCustomerParty>",
    "<cac:TaxTotal>",
    `<cbc:TaxAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalVatFc)}</cbc:TaxAmount>`,
    taxSubtotalXml,
    "</cac:TaxTotal>",
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalNetFc)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalNetFc)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalWithSgrFc || invoice?.totalGrossFc)}</cbc:TaxInclusiveAmount>`,
    `<cbc:PayableAmount currencyID="${xmlEscape(currency)}">${decimal(invoice?.totalWithSgrFc || invoice?.totalGrossFc)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    lineXml,
    "</Invoice>",
  ].join("")
}
