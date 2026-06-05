type TransferRouteRecord = Record<string, unknown>

type EtransportMessageListResult = {
  items: unknown[]
  payload: unknown
  rawText: string
}

export function transferRouteNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function transferRouteFixed(value: unknown, digits = 2) {
  return transferRouteNumber(value).toFixed(digits)
}

export function transferRouteDate(value: unknown) {
  if (!value) return "-"
  if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO")
}

export function transferRouteDateTime(value: unknown) {
  if (!value) return "-"
  if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO")
}

export function safeTransferFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

export function transferRouteText(value: unknown) {
  const text = String(value || "").trim()
  return text || "-"
}

export function classifyEtransportStatus(payload: unknown, rawText: string) {
  const textBlob = `${JSON.stringify(payload || {})} ${rawText}`.toLowerCase()
  if (/(nok|respins|rejected|eroare|error|invalid)/i.test(textBlob)) return "REJECTED"
  if (/(ok|acceptat|accepted|validat|uit|disponibil|descarcare)/i.test(textBlob)) return "ACCEPTED"
  return "SENT"
}

export function explainEtransportAnafError(status: number, summary: string) {
  const message = String(summary || "").trim()
  if (status === 403 || /^forbidden$/i.test(message)) {
    return "ANAF a refuzat cererea RO e-Transport. Cel mai probabil aplicatia OAuth/tokenul curent nu are serviciul E-Transport activat in ANAF."
  }
  return message || "ANAF a respins operatiunea RO e-Transport."
}

export function extractUit(raw: string) {
  const match = String(raw || "").match(/\bUIT\b[^A-Z0-9]*([A-Z0-9\-]{6,})/i)
  return match?.[1] || ""
}

type SerializedLotAllocation = {
  id: string
  qty: number
  unitCost: number
  totalValue: number
  lotNo: string
  expiryDate: unknown
  sourceStockLotId: unknown
  destinationStockLotId: unknown
}

type SerializedTransferProduct = TransferRouteRecord & {
  price: number
  costPrice: number
  purchaseFactor: number
  grossWeightKg: number
  sgrValue: number
  vatRate?: TransferRouteRecord
}

type SerializedTransferItem = TransferRouteRecord & {
  qty: number
  unitPrice: number
  lineValue: number
  vatRateValue: number
  lotAllocations: SerializedLotAllocation[]
  product: SerializedTransferProduct | null
  vatRate?: TransferRouteRecord
}

function asRecord(value: unknown): TransferRouteRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as TransferRouteRecord
}

function serializeTransferProduct(product: unknown): SerializedTransferProduct | null {
  const record = asRecord(product)
  if (!record) return null
  const vatRate = asRecord(record.vatRate)
  return {
    ...record,
    price: transferRouteNumber(record.price),
    costPrice: transferRouteNumber(record.costPrice),
    purchaseFactor: transferRouteNumber(record.purchaseFactor || 1),
    grossWeightKg: transferRouteNumber(record.grossWeightKg || 0),
    sgrValue: transferRouteNumber(record.sgrValue),
    vatRate: vatRate
      ? {
          ...vatRate,
          rate: transferRouteNumber(vatRate.rate),
        }
      : undefined,
  }
}

export function serializeTransferDoc<T extends TransferRouteRecord | null | undefined>(doc: T) {
  const record = asRecord(doc)
  if (!record) return doc

  const items = Array.isArray(record.items)
    ? record.items.map((item) => {
        const itemRecord = asRecord(item) || {}
        const vatRate = asRecord(itemRecord.vatRate)
        const lotAllocations = Array.isArray(itemRecord.lotAllocations)
          ? itemRecord.lotAllocations.map((allocation) => {
              const allocationRecord = asRecord(allocation) || {}
              return {
                id: String(allocationRecord.id || ""),
                qty: transferRouteNumber(allocationRecord.qty),
                unitCost: transferRouteNumber(allocationRecord.unitCost),
                totalValue: transferRouteNumber(allocationRecord.totalValue),
                lotNo: String(allocationRecord.lotNo || "-"),
                expiryDate: allocationRecord.expiryDate || null,
                sourceStockLotId: allocationRecord.sourceStockLotId,
                destinationStockLotId: allocationRecord.destinationStockLotId || null,
              }
            })
          : []

        return {
          ...itemRecord,
          qty: transferRouteNumber(itemRecord.qty),
          unitPrice: transferRouteNumber(itemRecord.unitPrice),
          lineValue: transferRouteNumber(itemRecord.lineValue),
          vatRateValue: transferRouteNumber(itemRecord.vatRateValue),
          lotAllocations,
          product: serializeTransferProduct(itemRecord.product),
          vatRate: vatRate
            ? {
                ...vatRate,
                rate: transferRouteNumber(vatRate.rate),
              }
            : undefined,
        } satisfies SerializedTransferItem
      })
    : record.items

  return {
    ...record,
    eTransportVehicleMaxMassKg: transferRouteNumber(record.eTransportVehicleMaxMassKg || 0),
    eTransportStartAddress: String(record.eTransportStartAddress || ""),
    eTransportEndAddress: String(record.eTransportEndAddress || ""),
    eTransportStartBorderPoint: String(record.eTransportStartBorderPoint || ""),
    eTransportEndBorderPoint: String(record.eTransportEndBorderPoint || ""),
    eTransportTransportDocType: String(record.eTransportTransportDocType || ""),
    eTransportTransportDocNo: String(record.eTransportTransportDocNo || ""),
    eTransportTransportDocDate: record.eTransportTransportDocDate
      ? new Date(record.eTransportTransportDocDate as string | number | Date).toISOString()
      : "",
    eTransportTransportDocNotes: String(record.eTransportTransportDocNotes || ""),
    eTransportExtraInfo: String(record.eTransportExtraInfo || ""),
    totalQty: transferRouteNumber(record.totalQty),
    totalValue: transferRouteNumber(record.totalValue),
    items,
  }
}

export function buildETransportSummary(items: unknown[], vehicleMaxMassKg: number) {
  const normalizedItems = Array.isArray(items) ? items : []
  const totalGrossWeightKg = normalizedItems.reduce<number>((sum, item) => {
    const itemRecord = asRecord(item)
    const product = asRecord(itemRecord?.product)
    const qty = transferRouteNumber(itemRecord?.qty)
    const grossWeightKg = transferRouteNumber(product?.grossWeightKg || 0)
    return sum + qty * grossWeightKg
  }, 0)
  const totalValueRon = normalizedItems.reduce<number>((sum, item) => {
    const itemRecord = asRecord(item)
    return sum + transferRouteNumber(itemRecord?.lineValue)
  }, 0)
  const hasFiscalRiskProducts = normalizedItems.some((item) => {
    const itemRecord = asRecord(item)
    const product = asRecord(itemRecord?.product)
    return product?.isFiscalRiskProduct === true
  })
  const thresholdsReached = totalGrossWeightKg > 500 || totalValueRon > 10000
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
}

export async function resolveEtransportDownloadId(
  company: { cui?: string | null; efacturaOauthAccessToken?: string | null } | null | undefined,
  doc: { eTransportUploadIndex?: string | null; docNo?: string | null } | null | undefined,
  deps: {
    normalizeCompanyCui: (value: string | null | undefined) => string
    anafListEtransportMessages: (
      companyContext: { cui?: string | null; efacturaOauthAccessToken?: string | null },
      options: { days: number; cif: string }
    ) => Promise<EtransportMessageListResult>
    extractDownloadId: (payload: unknown, rawText: string) => string
  }
) {
  const cif = deps.normalizeCompanyCui(company?.cui)
  if (!cif || !company?.efacturaOauthAccessToken || !doc?.eTransportUploadIndex) {
    return ""
  }

  const listResult = await deps.anafListEtransportMessages(company, { days: 60, cif })
  const uploadIndex = String(doc.eTransportUploadIndex).toLowerCase()
  const docNo = String(doc.docNo || "").toLowerCase()

  const matched = listResult.items.find((item) => {
    const blob = JSON.stringify(item || {}).toLowerCase()
    return blob.includes(uploadIndex) || (docNo ? blob.includes(docNo) : false)
  })

  return (
    deps.extractDownloadId(matched, JSON.stringify(matched || {})) ||
    deps.extractDownloadId(listResult.payload, listResult.rawText)
  )
}
