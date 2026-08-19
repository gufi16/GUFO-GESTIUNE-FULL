import AdmZip from "adm-zip"
import { XMLParser } from "fast-xml-parser"

type AnyObj = Record<string, unknown>
type MessagePayload = Record<string, unknown> | unknown[] | null
type ParsedInvoiceLine = {
  lineIndex: number
  productName: string
  productCode: string
  externalCode: string
  barcode: string
  uomCode: string
  uomRawCode: string
  description: string
  qty: number
  unitPrice: number
  vatRate: number
  lineNet: number
  lineVat: number
  lineGross: number
}
type ParsedInvoiceSummary = {
  invoiceNo?: string
  supplierName?: string
  supplierCif?: string
  totalGross?: number
  lines?: ParsedInvoiceLine[]
}
type ZipXmlEntry = {
  isDirectory: boolean
  entryName: string
  getData(): Buffer
}
type ScoredXmlEntry = {
  item: ZipXmlEntry
  xmlText: string
  score: number
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
})

export function normalizeCompanyCui(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/^RO/i, "")
    .replace(/\D+/g, "")
}

export function getEfacturaBaseUrl(environment: string | null | undefined) {
  return String(environment || "test").toLowerCase() === "prod"
    ? "https://webserviceapl.anaf.ro/prod/FCTEL/rest"
    : "https://webserviceapl.anaf.ro/test/FCTEL/rest"
}

export function parseAnafPayload(rawText: string) {
  try {
    return JSON.parse(rawText)
  } catch {
    return null
  }
}

export function readStringField(source: unknown, keys: string[]) {
  const record = source && typeof source === "object" ? (source as Record<string, unknown>) : null
  for (const key of keys) {
    const value = record?.[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ""
}

function looksLikeBase64Document(value: string) {
  const compact = String(value || "").trim().replace(/\s+/g, "")
  if (compact.length < 32 || compact.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/=]+$/.test(compact)
}

function tryDecodeBase64Document(value: string) {
  const compact = String(value || "").trim().replace(/\s+/g, "")
  if (!looksLikeBase64Document(compact)) return null
  try {
    return Buffer.from(compact, "base64")
  } catch {
    return null
  }
}

function findNestedPdfCandidate(source: unknown, seen = new Set<unknown>()): { buffer: Buffer; fileName: string | null } | null {
  if (!source || typeof source !== "object") return null
  if (seen.has(source)) return null
  seen.add(source)

  if (Array.isArray(source)) {
    for (const entry of source) {
      const found = findNestedPdfCandidate(entry, seen)
      if (found) return found
    }
    return null
  }

  for (const [key, rawValue] of Object.entries(source as Record<string, unknown>)) {
    if (typeof rawValue === "string") {
      const decoded = tryDecodeBase64Document(rawValue)
      if (!decoded) continue
      const nestedPdf = extractPdfFromAnafDownload(decoded)
      if (nestedPdf?.pdfBuffer) {
        const loweredKey = key.toLowerCase()
        const fileName =
          loweredKey.includes("name") || loweredKey.includes("filename")
            ? String(rawValue || "").trim() || null
            : null
        return {
          buffer: nestedPdf.pdfBuffer,
          fileName: fileName || nestedPdf.fileName || null,
        }
      }
    } else if (rawValue && typeof rawValue === "object") {
      const found = findNestedPdfCandidate(rawValue, seen)
      if (found) return found
    }
  }

  return null
}

export function collectMessageItems(payload: MessagePayload) {
  if (Array.isArray(payload)) return payload
  const keys = ["mesaje", "messages", "lista", "items", "facturi", "messageList"]
  for (const key of keys) {
    const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : null
    if (Array.isArray(value)) return value
  }
  return []
}

export function extractUploadIndex(payload: unknown, rawText: string) {
  const direct = readStringField(payload, ["index_incarcare", "indexIncarcare", "uploadIndex", "id_incarcare"])
  if (direct) return direct
  const match = rawText.match(/(?:index_incarcare|id_incarcare)["'=:\s>]+([0-9]+)/i)
  return match?.[1] || ""
}

export function extractDownloadId(payload: unknown, rawText: string) {
  const direct = readStringField(payload, ["id_descarcare", "idDescarcare", "downloadId", "id"])
  if (direct) return direct
  const match = rawText.match(/(?:id_descarcare|downloadId|id)["'=:\s>]+([0-9]+)/i)
  return match?.[1] || ""
}

export function summarizeAnafResponse(payload: unknown, rawText: string) {
  return (
    readStringField(payload, ["message", "mesaj", "details", "detalii", "title"]) ||
    rawText.slice(0, 1000)
  )
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

function walkObject(value: unknown, visitor: (node: unknown) => boolean): unknown {
  if (value === undefined || value === null) return null
  if (visitor(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkObject(item, visitor)
      if (found) return found
    }
    return null
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      const found = walkObject(child, visitor)
      if (found) return found
    }
  }
  return null
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim()
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record["#text"] === "string" || typeof record["#text"] === "number" || typeof record["#text"] === "boolean") {
      return String(record["#text"]).trim()
    }
    if (typeof record.text === "string" || typeof record.text === "number" || typeof record.text === "boolean") {
      return String(record.text).trim()
    }
  }
  return ""
}

function numberValue(value: unknown): number {
  const normalized = textValue(value).replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function attrValue(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  return textValue(record[key] ?? record[`@_${key}`])
}

function parseAddress(address: unknown) {
  if (!address || typeof address !== "object") return null
  const record = address as Record<string, unknown>
  return {
    street: textValue(record.StreetName),
    additionalStreet: textValue(record.AdditionalStreetName),
    city: textValue(record.CityName),
    postalCode: textValue(record.PostalZone),
    region: textValue(record.CountrySubentity),
    country: textValue((record.Country as Record<string, unknown> | undefined)?.IdentificationCode || (record.Country as Record<string, unknown> | undefined)?.Name),
  }
}

function parseContact(contact: unknown) {
  if (!contact || typeof contact !== "object") return null
  const record = contact as Record<string, unknown>
  return {
    name: textValue(record.Name),
    phone: textValue(record.Telephone),
    email: textValue(record.ElectronicMail),
  }
}

function firstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === "object") {
      if (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0) return value
      continue
    }
    if (textValue(value)) return value
  }
  return null
}

function findInvoiceNode(root: unknown) {
  const record = root && typeof root === "object" ? (root as Record<string, unknown>) : null
  return (
    record?.Invoice ||
    record?.CreditNote ||
    record?.["ns2:Invoice"] ||
    record?.["ns2:CreditNote"] ||
    walkObject(record, (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return false
      const nodeRecord = node as Record<string, unknown>
      return Boolean(nodeRecord.InvoiceLine || nodeRecord.CreditNoteLine || nodeRecord.AccountingSupplierParty || nodeRecord.LegalMonetaryTotal)
    }) ||
    root
  )
}

function scoreParsedInvoice(parsed: ParsedInvoiceSummary | null) {
  if (!parsed) return -1
  let score = 0
  if (String(parsed.invoiceNo || "").trim()) score += 10
  if (String(parsed.supplierName || "").trim()) score += 20
  if (String(parsed.supplierCif || "").trim()) score += 10
  if (Number(parsed.totalGross || 0) > 0) score += 20
  if (Array.isArray(parsed.lines) && parsed.lines.length > 0) score += 10 + parsed.lines.length
  return score
}

function isInvoiceLikeXml(xmlText: string) {
  const sample = String(xmlText || "").slice(0, 4000).toLowerCase()
  return (
    sample.includes("<invoice") ||
    sample.includes(":invoice") ||
    sample.includes("<creditnote") ||
    sample.includes(":creditnote") ||
    sample.includes("accountingsupplierparty") ||
    sample.includes("invoiceline")
  )
}

export function extractXmlFromAnafDownload(buffer: Buffer) {
  const rawText = buffer.toString("utf8")
  const trimmed = rawText.trim()

  if (trimmed.startsWith("<")) {
    return { xmlText: rawText, rawDownloadText: rawText, rawDownloadPayload: null }
  }

  const payload = parseAnafPayload(rawText)
  if (payload) {
    const directXml = readStringField(payload, ["xml", "content", "continut", "data", "document"])
    if (directXml.trim().startsWith("<")) {
      return { xmlText: directXml, rawDownloadText: rawText, rawDownloadPayload: payload }
    }

    const base64Content = readStringField(payload, ["base64", "contentBase64", "continutBase64", "documentBase64"])
    if (base64Content) {
      const decoded = Buffer.from(base64Content, "base64")
      return extractXmlFromAnafDownload(decoded)
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = new AdmZip(buffer)
    const xmlEntries = zip
      .getEntries()
      .filter((item: ZipXmlEntry) => !item.isDirectory && item.entryName.toLowerCase().endsWith(".xml"))

    const scoredEntries = xmlEntries.map((item: ZipXmlEntry): ScoredXmlEntry => {
      try {
        const xmlText = item.getData().toString("utf8")
        const parsed = parseIncomingEInvoiceXml(xmlText)
        return {
          item,
          xmlText,
          score: scoreParsedInvoice(parsed),
        }
      } catch {
        try {
          const xmlText = item.getData().toString("utf8")
          const name = item.entryName.toLowerCase()
          const score =
            (isInvoiceLikeXml(xmlText) ? 5 : 0) +
            (name.includes("semn") || name.includes("signature") ? -10 : 0) +
            Math.min(5, Math.floor(xmlText.length / 10000))
          return { item, xmlText, score }
        } catch {
          return { item, xmlText: "", score: -100 }
        }
      }
    })

    const bestEntry = scoredEntries.sort((a: ScoredXmlEntry, b: ScoredXmlEntry) => b.score - a.score)[0]

    if (bestEntry?.xmlText) {
      return { xmlText: bestEntry.xmlText, rawDownloadText: rawText, rawDownloadPayload: payload }
    }
  }

  throw new Error("Nu am putut extrage XML-ul facturii din raspunsul ANAF.")
}

export function extractPdfFromAnafDownload(buffer: Buffer): { pdfBuffer: Buffer; fileName: string } | null {
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { pdfBuffer: buffer, fileName: "factura-spv.pdf" }
  }

  const rawText = buffer.toString("utf8")
  const payload = parseAnafPayload(rawText)
  if (payload) {
    const base64Content = readStringField(payload, [
      "pdfBase64",
      "base64",
      "contentBase64",
      "continutBase64",
      "documentBase64",
      "continut",
      "content",
      "document",
      "fisier",
      "attachment",
    ])
    if (base64Content) {
      const decoded = tryDecodeBase64Document(base64Content)
      if (decoded) {
        const nestedPdf: { pdfBuffer: Buffer; fileName: string } | null = extractPdfFromAnafDownload(decoded)
        if (nestedPdf?.pdfBuffer) {
          return {
            pdfBuffer: nestedPdf.pdfBuffer,
            fileName: readStringField(payload, ["pdfFileName", "fileName"]) || nestedPdf.fileName || "factura-spv.pdf",
          }
        }
      }
    }

    const nestedCandidate = findNestedPdfCandidate(payload)
    if (nestedCandidate?.buffer) {
      return {
        pdfBuffer: nestedCandidate.buffer,
        fileName: nestedCandidate.fileName || readStringField(payload, ["pdfFileName", "fileName"]) || "factura-spv.pdf",
      }
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = new AdmZip(buffer)
    const pdfEntry = zip
      .getEntries()
      .find((item: ZipXmlEntry) => !item.isDirectory && item.entryName.toLowerCase().endsWith(".pdf"))

    if (pdfEntry) {
      return {
        pdfBuffer: pdfEntry.getData(),
        fileName: pdfEntry.entryName || "factura-spv.pdf",
      }
    }
  }

  return null
}

export function parseIncomingEInvoiceXml(xmlText: string) {
  const parsed = xmlParser.parse(xmlText) as AnyObj
  const invoice = findInvoiceNode(parsed) as AnyObj | null
  if (!invoice || typeof invoice !== "object") {
    throw new Error("XML-ul facturii nu a putut fi interpretat.")
  }

  const accountingSupplierParty = (invoice.AccountingSupplierParty ?? {}) as AnyObj
  const accountingCustomerParty = (invoice.AccountingCustomerParty ?? {}) as AnyObj
  const supplierParty = firstDefined(
    (accountingSupplierParty.Party as AnyObj | undefined),
    accountingSupplierParty
  ) as AnyObj | null
  const customerParty = firstDefined(
    (accountingCustomerParty.Party as AnyObj | undefined),
    accountingCustomerParty
  ) as AnyObj | null

  const supplierLegal = supplierParty?.PartyLegalEntity as AnyObj | undefined
  const customerLegal = customerParty?.PartyLegalEntity as AnyObj | undefined
  const supplierTax = supplierParty?.PartyTaxScheme as AnyObj | undefined
  const customerTax = customerParty?.PartyTaxScheme as AnyObj | undefined
  const supplierAddress = parseAddress(supplierParty?.PostalAddress)
  const customerAddress = parseAddress(customerParty?.PostalAddress)
  const supplierContact = parseContact(supplierParty?.Contact)
  const customerContact = parseContact(customerParty?.Contact)
  const paymentMeans = firstDefined(invoice.PaymentMeans) as AnyObj | null
  const paymentAccount = paymentMeans?.PayeeFinancialAccount as AnyObj | undefined
  const taxTotalNode = firstDefined(invoice.TaxTotal) as AnyObj | null
  const taxSubtotals = asArray(taxTotalNode?.TaxSubtotal).map((subtotal) => {
    const subtotalNode = (subtotal ?? {}) as AnyObj
    const taxCategory = (subtotalNode.TaxCategory ?? {}) as AnyObj
    const taxScheme = (taxCategory.TaxScheme ?? {}) as AnyObj
    return {
      taxableAmount: numberValue(subtotalNode.TaxableAmount),
      taxAmount: numberValue(subtotalNode.TaxAmount),
      categoryId: textValue(taxCategory.ID),
      vatRate: numberValue(taxCategory.Percent),
      taxCode: textValue(taxScheme.ID),
      exemptionReason: textValue(
        firstDefined(
          taxCategory.TaxExemptionReason,
          taxCategory.TaxExemptionReasonCode
        )
      ),
    }
  })

  const lineNodes = asArray(firstDefined(invoice.InvoiceLine, invoice.CreditNoteLine))
  const lines = lineNodes.map((line, index): ParsedInvoiceLine => {
    const lineNode = (line ?? {}) as AnyObj
    const item = (lineNode.Item ?? {}) as AnyObj
    const price = (lineNode.Price ?? {}) as AnyObj
    const classifiedTax = (item.ClassifiedTaxCategory ?? {}) as AnyObj
    const lineTaxTotal = (lineNode.TaxTotal ?? {}) as AnyObj
    const lineTaxSubtotal = (lineTaxTotal.TaxSubtotal ?? {}) as AnyObj
    const lineTaxCategory = (lineTaxSubtotal.TaxCategory ?? {}) as AnyObj
    const invoicedQuantity = firstDefined(lineNode.InvoicedQuantity, lineNode.CreditedQuantity)
    const qty = numberValue(invoicedQuantity)
    const unitPrice = numberValue(firstDefined(price.PriceAmount, (lineNode.ItemPriceExtension as AnyObj | undefined)?.Amount))
    const lineNet = numberValue(lineNode.LineExtensionAmount)
    const vatRate = numberValue(firstDefined(classifiedTax.Percent, lineTaxCategory.Percent))
    const lineVat = lineNet * vatRate / 100
    const lineGross = lineNet + lineVat

    return {
      lineIndex: index + 1,
      productName: textValue(firstDefined(item.Name, item.Description)),
      productCode: textValue(firstDefined((item.StandardItemIdentification as AnyObj | undefined)?.ID, (item.SellersItemIdentification as AnyObj | undefined)?.ID)),
      externalCode: textValue((item.SellersItemIdentification as AnyObj | undefined)?.ID),
      barcode: textValue((item.StandardItemIdentification as AnyObj | undefined)?.ID),
      uomCode: textValue(
        invoicedQuantity && typeof invoicedQuantity === "object"
          ? (invoicedQuantity as AnyObj).unitCode || (invoicedQuantity as AnyObj)["@_unitCode"] || (invoicedQuantity as AnyObj)["unitCode"]
          : undefined
      ),
      uomRawCode: attrValue(invoicedQuantity, "unitCode"),
      description: textValue(firstDefined(item.Description, item.Name)),
      qty,
      unitPrice,
      vatRate,
      lineNet,
      lineVat,
      lineGross,
    }
  })

  const legalTotals = (invoice.LegalMonetaryTotal ?? {}) as AnyObj
  const payableAmountNode = (legalTotals.PayableAmount ?? {}) as AnyObj
  const supplierPartyName = (supplierParty?.PartyName ?? {}) as AnyObj
  const customerPartyName = (customerParty?.PartyName ?? {}) as AnyObj
  const paymentMeansCode = (paymentMeans?.PaymentMeansCode ?? {}) as AnyObj
  const paymentTerms = (invoice.PaymentTerms ?? {}) as AnyObj
  const financialInstitutionBranch = (paymentAccount?.FinancialInstitutionBranch ?? {}) as AnyObj
  const totalNet = numberValue(firstDefined(legalTotals.LineExtensionAmount, legalTotals.TaxExclusiveAmount))
  const totalGross = numberValue(firstDefined(legalTotals.PayableAmount, legalTotals.TaxInclusiveAmount))
  const totalVat = numberValue(firstDefined(taxTotalNode?.TaxAmount)) || totalGross - totalNet

  return {
    invoiceNo: textValue(invoice.ID),
    invoiceDate: textValue(firstDefined(invoice.IssueDate, invoice.TaxPointDate)),
    dueDate: textValue(firstDefined(invoice.DueDate)),
    invoiceTypeCode: textValue(invoice.InvoiceTypeCode),
    currency: textValue(firstDefined(invoice.DocumentCurrencyCode, payableAmountNode.currencyID)) || "RON",
    totalNet,
    totalVat,
    totalGross,
    payableAmount: numberValue(legalTotals.PayableAmount),
    taxExclusiveAmount: numberValue(legalTotals.TaxExclusiveAmount),
    taxInclusiveAmount: numberValue(legalTotals.TaxInclusiveAmount),
    prepaidAmount: numberValue(legalTotals.PrepaidAmount),
    roundingAmount: numberValue(legalTotals.PayableRoundingAmount),
    supplierName: textValue(firstDefined(supplierLegal?.RegistrationName, supplierPartyName.Name)),
    supplierCif: normalizeCompanyCui(textValue(firstDefined(supplierTax?.CompanyID, supplierLegal?.CompanyID))),
    supplierIdentifier: textValue(firstDefined(supplierParty?.EndpointID, supplierTax?.CompanyID, supplierLegal?.CompanyID)),
    supplierAddress,
    supplierContact,
    customerName: textValue(firstDefined(customerLegal?.RegistrationName, customerPartyName.Name)),
    customerCif: normalizeCompanyCui(textValue(firstDefined(customerTax?.CompanyID, customerLegal?.CompanyID))),
    customerIdentifier: textValue(firstDefined(customerParty?.EndpointID, customerTax?.CompanyID, customerLegal?.CompanyID)),
    customerAddress,
    customerContact,
    paymentMeansCode: textValue(paymentMeans?.PaymentMeansCode),
    paymentMeansName: attrValue(paymentMeansCode, "name"),
    paymentId: textValue(paymentMeans?.PaymentID),
    iban: textValue(paymentAccount?.ID),
    bankCode: textValue(firstDefined(financialInstitutionBranch.ID, financialInstitutionBranch.Name)),
    paymentNote: textValue(firstDefined(paymentTerms.Note, invoice.Note)),
    taxBreakdown: taxSubtotals,
    lines,
  }
}
