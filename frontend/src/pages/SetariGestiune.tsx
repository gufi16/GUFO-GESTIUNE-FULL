import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { setWarehouseConfig as persistWarehouseConfig } from "../lib/warehouseConfig"

type WarehouseConfigForm = {
  multiWarehouseEnabled: boolean
  warehouseFilterEnabled: boolean
  requireWarehouseOnDocuments: boolean
  autoSelectSingleWarehouse: boolean
  warehouseLabel: string
}

const emptyForm: WarehouseConfigForm = {
  multiWarehouseEnabled: false,
  warehouseFilterEnabled: false,
  requireWarehouseOnDocuments: false,
  autoSelectSingleWarehouse: true,
  warehouseLabel: "Gestiune",
}

export default function SetariGestiunePage() {
  const token = getToken() || ""
  const [form, setForm] = useState<WarehouseConfigForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    void loadSettings()
  }, [])

  async function loadSettings() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/warehouse-config`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Nu am putut incarca setarile de gestiune.")
        return
      }

      const nextForm = {
        multiWarehouseEnabled: Boolean(data?.settings?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(data?.settings?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(data?.settings?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: data?.settings?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(data?.settings?.warehouseLabel || "Gestiune"),
      }
      setForm(nextForm)
      persistWarehouseConfig(nextForm)
    } catch {
      setError("Nu am putut incarca setarile de gestiune.")
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/warehouse-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          warehouseLabel: String(form.warehouseLabel || "Gestiune").trim() || "Gestiune",
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Nu am putut salva setarile de gestiune.")
        return
      }

      const nextForm = {
        multiWarehouseEnabled: Boolean(data?.settings?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(data?.settings?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(data?.settings?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: data?.settings?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(data?.settings?.warehouseLabel || "Gestiune"),
      }
      setForm(nextForm)
      persistWarehouseConfig(nextForm)
      setMessage("Configurarea de gestiune a fost salvata.")
    } catch {
      setError("Nu am putut salva setarile de gestiune.")
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof WarehouseConfigForm>(key: K, value: WarehouseConfigForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="space-y-3">
      <PageHeader badge="configurare" title="Configurare gestiune" />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Mod lucru" value={form.multiWarehouseEnabled ? "Multi-gestiune" : "Gestiune simpla"} tone="blue" />
        <DocumentMetric title="Filtru global" value={form.warehouseFilterEnabled ? "Activ" : "Oprit"} tone="slate" />
        <DocumentMetric title="Alegere pe documente" value={form.requireWarehouseOnDocuments ? "Obligatorie" : "Optionala"} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Cum functioneaza"
        description="Locatia este punctul mare de lucru. Gestiunea este zona interna din locatie: depozit, bar, bucatarie, marfa POS."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Activeaza multi-gestiune</div>
                <div className="mt-1 text-sm text-slate-500">
                  Daca este activ, ERP-ul lucreaza cu gestiuni separate in interiorul fiecarei locatii.
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.multiWarehouseEnabled}
                onChange={(e) => update("multiWarehouseEnabled", e.target.checked)}
                className="mt-1 h-4 w-4"
              />
            </div>
          </label>

          <label className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Arata selector global in topbar</div>
                <div className="mt-1 text-sm text-slate-500">
                  Pune filtrul de gestiune sus, langa locatia activa, pentru navigare si selectie rapida.
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.warehouseFilterEnabled}
                onChange={(e) => update("warehouseFilterEnabled", e.target.checked)}
                className="mt-1 h-4 w-4"
                disabled={!form.multiWarehouseEnabled}
              />
            </div>
          </label>

          <label className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Fa gestiunea obligatorie pe documente</div>
                <div className="mt-1 text-sm text-slate-500">
                  Cere selectie explicita pe NIR, bon consum, transfer si alte documente unde gestiunea conteaza.
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.requireWarehouseOnDocuments}
                onChange={(e) => update("requireWarehouseOnDocuments", e.target.checked)}
                className="mt-1 h-4 w-4"
                disabled={!form.multiWarehouseEnabled}
              />
            </div>
          </label>

          <label className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Auto-selecteaza singura gestiune disponibila</div>
                <div className="mt-1 text-sm text-slate-500">
                  Daca o locatie are o singura gestiune, sistemul o selecteaza automat ca sa fie mai rapid.
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.autoSelectSingleWarehouse}
                onChange={(e) => update("autoSelectSingleWarehouse", e.target.checked)}
                className="mt-1 h-4 w-4"
                disabled={!form.multiWarehouseEnabled}
              />
            </div>
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,260px)_1fr]">
          <DocumentField label="Eticheta folosita in ERP">
            <input
              value={form.warehouseLabel}
              onChange={(e) => update("warehouseLabel", e.target.value)}
              className={documentInputClass}
              placeholder="Gestiune"
              maxLength={32}
            />
          </DocumentField>

          <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Exemple bune pentru eticheta:
            <div className="mt-2 font-medium text-slate-700">Gestiune, Depozit, Sectie, Flux intern</div>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection
        title="Recomandare practica"
        description="Pentru majoritatea clientilor Horeca, configurarea cea mai clara este multi-gestiune activ + selector global in topbar + auto-select pentru locatiile simple."
      >
        <div className="space-y-2 text-sm text-slate-600">
          <div>Locatie = restaurant / magazin / punct de lucru.</div>
          <div>{form.warehouseLabel || "Gestiune"} = depozit materii prime / bar / bucatarie / marfa POS.</div>
          <div>Produsul nu se leaga fix de o singura gestiune. Stocul produsului exista pe gestiune prin documente, nu prin definirea produsului.</div>
        </div>
      </DocumentSection>

      <div className="flex flex-wrap gap-3">
        <button type="button" className={documentButtonPrimaryClass} onClick={saveSettings} disabled={loading || saving}>
          {saving ? "Se salveaza..." : "Salveaza configurarea"}
        </button>
        <button type="button" className={documentButtonSecondaryClass} onClick={loadSettings} disabled={loading || saving}>
          Reincarca
        </button>
      </div>
    </div>
  )
}
