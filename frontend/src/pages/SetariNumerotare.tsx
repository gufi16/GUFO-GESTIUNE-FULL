import { useEffect, useState } from "react"
import { RefreshCcw, Save } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { api } from "../lib/api"
import type { NumberingPayload } from "../lib/numbering"

type FormState = {
  invoiceSeries: string
  invoiceNextNumber: string
  transferSeries: string
  transferNextNumber: string
  inventorySeries: string
  inventoryNextNumber: string
  productionSeries: string
  productionNextNumber: string
  deteriorationSeries: string
  deteriorationNextNumber: string
  priceChangeSeries: string
  priceChangeNextNumber: string
  customerCodePrefix: string
  customerNextNumber: string
  supplierCodePrefix: string
  supplierNextNumber: string
}

type RowConfig = {
  key: string
  label: string
  kind: "document" | "code"
  seriesKey: keyof FormState
  nextKey: keyof FormState
  preview: string
}

function emptyForm(): FormState {
  return {
    invoiceSeries: "FAC",
    invoiceNextNumber: "1",
    transferSeries: "TRF",
    transferNextNumber: "1",
    inventorySeries: "INV",
    inventoryNextNumber: "1",
    productionSeries: "PROD",
    productionNextNumber: "1",
    deteriorationSeries: "PVD",
    deteriorationNextNumber: "1",
    priceChangeSeries: "PVP",
    priceChangeNextNumber: "1",
    customerCodePrefix: "CLI",
    customerNextNumber: "1",
    supplierCodePrefix: "FUR",
    supplierNextNumber: "1",
  }
}

function toFormState(data: NumberingPayload): FormState {
  return {
    invoiceSeries: data.settings.invoiceSeries || "FAC",
    invoiceNextNumber: String(data.previews.invoice?.nextNumber || 1),
    transferSeries: data.settings.transferSeries || "TRF",
    transferNextNumber: String(data.previews.transfer?.nextNumber || 1),
    inventorySeries: data.settings.inventorySeries || "INV",
    inventoryNextNumber: String(data.previews.inventory?.nextNumber || 1),
    productionSeries: data.settings.productionSeries || "PROD",
    productionNextNumber: String(data.previews.production?.nextNumber || 1),
    deteriorationSeries: data.settings.deteriorationSeries || "PVD",
    deteriorationNextNumber: String(data.previews.deterioration?.nextNumber || 1),
    priceChangeSeries: data.settings.priceChangeSeries || "PVP",
    priceChangeNextNumber: String(data.previews.priceChange?.nextNumber || 1),
    customerCodePrefix: data.settings.customerCodePrefix || "CLI",
    customerNextNumber: String(data.previews.customer?.nextNumber || 1),
    supplierCodePrefix: data.settings.supplierCodePrefix || "FUR",
    supplierNextNumber: String(data.previews.supplier?.nextNumber || 1),
  }
}

function NumberingTable({
  rows,
  form,
  loading,
  saving,
  onChange,
}: {
  rows: RowConfig[]
  form: FormState
  loading: boolean
  saving: boolean
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-[#E8E3DA]">
      <table className="w-full text-[12px] md:text-[13px]">
        <thead className="bg-[#F8F5EF] text-slate-500">
          <tr>
            <th className="px-2.5 py-2 text-left font-medium">Tip</th>
            <th className="px-2.5 py-2 text-left font-medium">Serie / Prefix</th>
            <th className="px-2.5 py-2 text-left font-medium">Urmatorul numar</th>
            <th className="px-2.5 py-2 text-left font-medium">Preview</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[#E8E3DA] bg-white">
              <td className="px-2.5 py-2 align-middle">
                <div className="font-semibold text-[#17324D]">{row.label}</div>
                <div className="text-[11px] text-slate-400">
                  {row.kind === "code" ? "cod automat" : "document numerotat local"}
                </div>
              </td>
              <td className="px-2.5 py-2 align-middle">
                <input
                  value={form[row.seriesKey]}
                  onChange={(e) => onChange(row.seriesKey, e.target.value as never)}
                  className={documentInputClass}
                  disabled={loading || saving}
                />
              </td>
              <td className="px-2.5 py-2 align-middle">
                <input
                  value={form[row.nextKey]}
                  onChange={(e) => onChange(row.nextKey, e.target.value as never)}
                  className={documentInputClass}
                  inputMode="numeric"
                  disabled={loading || saving}
                />
              </td>
              <td className="px-2.5 py-2 align-middle">
                <div className="rounded-[12px] border border-[#E8E3DA] bg-[#FCFBF8] px-2.5 py-2 text-[13px] font-semibold text-[#17324D]">
                  {row.preview}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SetariNumerotare() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [previews, setPreviews] = useState<NumberingPayload["previews"] | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError("")
    setMessage("")
    try {
      const data = await api<NumberingPayload>("/api/v1/company/document-numbering")
      setPreviews(data.previews)
      setForm(toFormState(data))
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca setarile de numerotare.")
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const data = await api<NumberingPayload>("/api/v1/company/document-numbering", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          purchaseSeries: "NIR",
          purchaseReceiptNextNumber: 1,
          deteriorationNextNumber: Number(form.deteriorationNextNumber || 1),
          priceChangeNextNumber: Number(form.priceChangeNextNumber || 1),
        }),
      })
      setPreviews(data.previews)
      setForm(toFormState(data))
      setMessage("Numerotarea a fost salvata.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva setarile de numerotare.")
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const documentRows: RowConfig[] = [
    {
      key: "invoice",
      label: "Facturi",
      kind: "document",
      seriesKey: "invoiceSeries",
      nextKey: "invoiceNextNumber",
      preview: previews?.invoice?.value || "-",
    },
    {
      key: "transfer",
      label: "Transferuri",
      kind: "document",
      seriesKey: "transferSeries",
      nextKey: "transferNextNumber",
      preview: previews?.transfer?.value || "-",
    },
    {
      key: "inventory",
      label: "Inventare",
      kind: "document",
      seriesKey: "inventorySeries",
      nextKey: "inventoryNextNumber",
      preview: previews?.inventory?.value || "-",
    },
    {
      key: "production",
      label: "Productie",
      kind: "document",
      seriesKey: "productionSeries",
      nextKey: "productionNextNumber",
      preview: previews?.production?.value || "-",
    },
    {
      key: "deterioration",
      label: "PV deteriorare",
      kind: "document",
      seriesKey: "deteriorationSeries",
      nextKey: "deteriorationNextNumber",
      preview: previews?.deterioration?.value || "-",
    },
    {
      key: "priceChange",
      label: "PV schimbare pret",
      kind: "document",
      seriesKey: "priceChangeSeries",
      nextKey: "priceChangeNextNumber",
      preview: previews?.priceChange?.value || "-",
    },
  ]

  const codeRows: RowConfig[] = [
    {
      key: "customer",
      label: "Cod client",
      kind: "code",
      seriesKey: "customerCodePrefix",
      nextKey: "customerNextNumber",
      preview: previews?.customer?.value || "-",
    },
    {
      key: "supplier",
      label: "Cod furnizor",
      kind: "code",
      seriesKey: "supplierCodePrefix",
      nextKey: "supplierNextNumber",
      preview: previews?.supplier?.value || "-",
    },
  ]

  return (
    <div className="space-y-3">
      <PageHeader
        badge="simplificat"
        title="Serii si numerotare"
        subtitle="Schimbi rapid seria si urmatorul numar, fara carduri mari si fara pasi inutili."
      />

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Documente numerotate local"
        description="Aici configurezi seriile si numerele pentru documentele generate in aplicatie."
        actions={
          <>
            <button type="button" className={documentButtonSecondaryClass} onClick={load} disabled={loading || saving}>
              <RefreshCcw size={14} className="mr-1.5" />
              Reincarca
            </button>
            <button type="button" className={documentButtonPrimaryClass} onClick={save} disabled={loading || saving}>
              <Save size={14} className="mr-1.5" />
              {saving ? "Se salveaza..." : "Salveaza"}
            </button>
          </>
        }
      >
        <NumberingTable rows={documentRows} form={form} loading={loading} saving={saving} onChange={update} />
      </DocumentSection>

      <DocumentSection title="Coduri automate" description="Client si furnizor, intr-un singur loc.">
        <NumberingTable rows={codeRows} form={form} loading={loading} saving={saving} onChange={update} />
      </DocumentSection>
    </div>
  )
}
