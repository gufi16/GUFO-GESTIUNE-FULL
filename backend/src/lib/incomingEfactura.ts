// @ts-nocheck
import AdmZip from "adm-zip"
import { XMLParser } from "fast-xml-parser"

type AnyObj = Record<string, any>

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

export function readStringField(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ""
}

export function collectMessageItems(payload: any) {
  if (Array.isArray(payload)) return payload
  const keys = ["mesaje", "messages", "lista", "items", "facturi", "messageList"]
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key]
  }
  return []
}

export function extractUploadIndex(payload: any, rawText: string) {
  const direct = readStringField(payload, ["index_incarcare", "indexIncarcare", "uploadIndex", "id_incarcare"])
  if (direct) return direct
  const match = rawText.match(/(?:index_incarcare|id_incarcare)["'=:\s>]+([0-9]+)/i)
  return match?.[1] || ""
}

export function extractDownloadId(payload: any, rawText: string) {
  const direct = readStringField(payload, ["id_descarcare", "idDescarcare", "downloadId", "id"])
  if (direct) return direct
  const match = rawText.match(/(?:id_descarcare|downloadId|id)["'=:\s>]+([0-9]+)/i)
  return match?.[1] || ""
}

export function summarizeAnafResponse(payload: any, rawText: string) {
  return (
    readStringField(payload, ["message", "mesaj", "details", "detalii", "title"]) ||
    rawText.slice(0, 1000)
  )
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

function walkObject(value: any, visitor: (node: any) => boolean): any {
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

function textValue(value: any): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim()
  }
  if (typeof value === "object") {
    if (typeof value["#text"] === "string" || typeof value["#text"] === "number" || typeof value["#text"] === "boolean") {
      return String(value["#text"]).trim()
    }
    if (typeof value.text === "string" || typeof value.text === "number" || typeof value.text === "boolean") {
      return String(value.text).trim()
    }
  }
  return ""
}

function numberValue(value: any): number {
  const normalized = textValue(value).replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function firstDefined(...values: any[]) {
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

function findInvoiceNode(root: any) {
  return (
    root?.Invoice ||
    root?.CreditNote ||
    root?.["ns2:Invoice"] ||
    root?.["ns2:CreditNote"] ||
    walkObject(root, (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return false
      return Boolean(
        node.InvoiceLine ||
        node.CreditNoteLine ||
        node.AccountingSupplierParty ||
        node.LegalMonetaryTotal
      )
    }) ||
    root
  )
}

function scoreParsedInvoice(parsed: any) {
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
      .filter((item) => !item.isDirectory && item.entryName.toLowerCase().endsWith(".xml"))

    const scoredEntries = xmlEntries.map((item) => {
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

    const bestEntry = scoredEntries.sort((a, b) => b.score - a.score)[0]

    if (bestEntry?.xmlText) {
      return { xmlText: bestEntry.xmlText, rawDownloadText: rawText, rawDownloadPayload: payload }
    }
  }

  throw new Error("Nu am putut extrage XML-ul facturii din raspunsul ANAF.")
}

export function parseIncomingEInvoiceXml(xmlText: string) {
  const parsed = xmlParser.parse(xmlText) as AnyObj
  const invoice = findInvoiceNode(parsed)
  if (!invoice || typeof invoice !== "object") {
    throw new Error("XML-ul facturii nu a putut fi interpretat.")
  }

  const supplierParty = firstDefined(
    invoice.AccountingSupplierParty?.Party,
    invoice.AccountingSupplierParty
  ) as AnyObj | null
  const customerParty = firstDefined(
    invoice.AccountingCustomerParty?.Party,
    invoice.AccountingCustomerParty
  ) as AnyObj | null

  const supplierLegal = supplierParty?.PartyLegalEntity as AnyObj | undefined
  const customerLegal = customerParty?.PartyLegalEntity as AnyObj | undefined
  const supplierTax = supplierParty?.PartyTaxScheme as AnyObj | undefined
  const customerTax = customerParty?.PartyTaxScheme as AnyObj | undefined

  const lineNodes = asArray(firstDefined(invoice.InvoiceLine, invoice.CreditNoteLine))
  const lines = lineNodes.map((line: AnyObj, index) => {
    const item = line?.Item || {}
    const price = line?.Price || {}
    const classifiedTax = item?.ClassifiedTaxCategory || {}
    const invoicedQuantity = firstDefined(line?.InvoicedQuantity, line?.CreditedQuantity)
    const qty = numberValue(invoicedQuantity)
    const unitPrice = numberValue(firstDefined(price?.PriceAmount, line?.ItemPriceExtension?.Amount))
    const lineNet = numberValue(line?.LineExtensionAmount)
    const vatRate = numberValue(firstDefined(classifiedTax?.Percent, line?.TaxTotal?.TaxSubtotal?.TaxCategory?.Percent))
    const lineVat = lineNet * vatRate / 100
    const lineGross = lineNet + lineVat

    return {
      lineIndex: index + 1,
      productName: textValue(firstDefined(item?.Name, item?.Description)),
      productCode: textValue(firstDefined(item?.StandardItemIdentification?.ID, item?.SellersItemIdentification?.ID)),
      externalCode: textValue(item?.SellersItemIdentification?.ID),
      barcode: textValue(item?.StandardItemIdentification?.ID),
      uomCode: textValue(invoicedQuantity?.unitCode || invoicedQuantity?.["@_unitCode"] || invoicedQuantity?.["unitCode"]),
      qty,
      unitPrice,
      vatRate,
      lineNet,
      lineVat,
      lineGross,
    }
  })

  const legalTotals = invoice.LegalMonetaryTotal || {}
  const totalNet = numberValue(firstDefined(legalTotals.LineExtensionAmount, legalTotals.TaxExclusiveAmount))
  const totalGross = numberValue(firstDefined(legalTotals.PayableAmount, legalTotals.TaxInclusiveAmount))
  const totalVat = totalGross - totalNet

  return {
    invoiceNo: textValue(invoice.ID),
    invoiceDate: textValue(firstDefined(invoice.IssueDate, invoice.TaxPointDate)),
    currency: textValue(firstDefined(invoice.DocumentCurrencyCode, legalTotals.PayableAmount?.currencyID)) || "RON",
    totalNet,
    totalVat,
    totalGross,
    supplierName: textValue(firstDefined(supplierLegal?.RegistrationName, supplierParty?.PartyName?.Name)),
    supplierCif: normalizeCompanyCui(textValue(firstDefined(supplierTax?.CompanyID, supplierLegal?.CompanyID))),
    customerName: textValue(firstDefined(customerLegal?.RegistrationName, customerParty?.PartyName?.Name)),
    customerCif: normalizeCompanyCui(textValue(firstDefined(customerTax?.CompanyID, customerLegal?.CompanyID))),
    lines,
  }
}
