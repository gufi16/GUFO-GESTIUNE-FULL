import { api } from "./api"

export type NumberingPreview = {
  nextNumber: number
  prefix: string
  value: string
}

export type NumberingSettings = {
  invoiceSeries: string
  purchaseSeries: string
  transferSeries: string
  inventorySeries: string
  productionSeries: string
  deteriorationSeries: string
  priceChangeSeries: string
  customerCodePrefix: string
  supplierCodePrefix: string
}

export type NumberingPayload = {
  ok: boolean
  settings: NumberingSettings
  previews: {
    invoice: NumberingPreview
    purchaseReceipt: NumberingPreview
    transfer: NumberingPreview
    inventory: NumberingPreview
    production: NumberingPreview
    deterioration: NumberingPreview
    priceChange: NumberingPreview
    customer: NumberingPreview
    supplier: NumberingPreview
  }
}

export async function getDocumentNumbering() {
  return api<NumberingPayload>("/api/v1/company/document-numbering")
}

export function getPreviewValue(
  previews: NumberingPayload["previews"] | null | undefined,
  key: keyof NumberingPayload["previews"]
) {
  return previews?.[key]?.value || ""
}
