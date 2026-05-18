import { LayoutPanelTop, MapPin, RefreshCcw, Save, ScanSearch, ShieldCheck, Warehouse } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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

function ConfigCard({
  icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`rounded-[20px] border bg-white p-4 shadow-sm transition ${
        disabled ? "cursor-not-allowed border-slate-200 opacity-60" : "cursor-pointer border-slate-200 hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-blue-50 text-blue-700">
          {icon}
        </span>

        <span className="pt-0.5">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4"
          />
        </span>
      </div>

      <div className="mt-4">
        <div className="text-[15px] font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
      </div>
    </label>
  )
}

function PreviewChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[#E8E3DA] bg-[#FCFBF8] px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-semibold text-[#17324D]">{value}</div>
    </div>
  )
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
      const payload = {
        ...form,
        warehouseLabel: String(form.warehouseLabel || "Gestiune").trim() || "Gestiune",
      }

      const res = await fetch(`${API}/api/v1/company/warehouse-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
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

  const previewMode = form.multiWarehouseEnabled ? "Multi-gestiune" : "Gestiune simpla"
  const previewTopbar = form.multiWarehouseEnabled && form.warehouseFilterEnabled ? "Selector activ in topbar" : "Fara selector global"
  const previewDocuments = form.multiWarehouseEnabled
    ? form.requireWarehouseOnDocuments
      ? `${form.warehouseLabel} obligatorie pe documente`
      : `${form.warehouseLabel} optionala pe documente`
    : "Documente fara selectie de gestiune"

  const operationalSummary = useMemo(() => {
    if (!form.multiWarehouseEnabled) {
      return "Clientul lucreaza simplu: o singura structura per locatie, fara selectie suplimentara in documente."
    }

    if (form.requireWarehouseOnDocuments) {
      return `Clientul lucreaza controlat: selecteaza explicit ${form.warehouseLabel.toLowerCase()}a pe documente, iar filtrul global poate ghida intreaga navigare.`
    }

    return `Clientul lucreaza flexibil: foloseste ${form.warehouseLabel.toLowerCase()}a unde are nevoie, dar fara sa blochezi fluxurile simple.`
  }, [form])

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Configurare gestiune"
        subtitle="Activezi modul de lucru cu gestiuni si controlezi cum se vede in ERP pentru client."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Mod de lucru" value={previewMode} tone="blue" />
        <DocumentMetric title="Filtru global" value={form.warehouseFilterEnabled ? "Activ" : "Oprit"} tone="slate" />
        <DocumentMetric title="Regula documente" value={form.requireWarehouseOnDocuments ? "Obligatorie" : "Flexibila"} tone="emerald" />
        <DocumentMetric title="Eticheta ERP" value={form.warehouseLabel || "Gestiune"} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Mod de lucru"
        description="Alegi daca firma lucreaza simplu, doar pe locatie, sau cu gestiuni separate in interiorul fiecarei locatii."
        actions={
          <>
            <button type="button" className={documentButtonSecondaryClass} onClick={loadSettings} disabled={loading || saving}>
              <RefreshCcw size={14} className="mr-1.5" />
              Reincarca
            </button>
            <button type="button" className={documentButtonPrimaryClass} onClick={saveSettings} disabled={loading || saving}>
              <Save size={14} className="mr-1.5" />
              {saving ? "Se salveaza..." : "Salveaza"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ConfigCard
            icon={<Warehouse size={20} />}
            title="Activeaza multi-gestiune"
            description="Fiecare locatie poate avea mai multe gestiuni: depozit, bar, bucatarie, marfa POS sau alte zone interne."
            checked={form.multiWarehouseEnabled}
            onChange={(checked) => update("multiWarehouseEnabled", checked)}
          />

          <ConfigCard
            icon={<LayoutPanelTop size={20} />}
            title="Arata selector global in topbar"
            description="Pune selectorul de gestiune sus, langa locatia activa, pentru filtrare rapida in ecranele importante."
            checked={form.warehouseFilterEnabled}
            disabled={!form.multiWarehouseEnabled}
            onChange={(checked) => update("warehouseFilterEnabled", checked)}
          />

          <ConfigCard
            icon={<ShieldCheck size={20} />}
            title="Fa gestiunea obligatorie pe documente"
            description="Cere selectie explicita pe NIR, bon consum si alte documente unde este important sa stii clar din ce gestiune intri sau scazi."
            checked={form.requireWarehouseOnDocuments}
            disabled={!form.multiWarehouseEnabled}
            onChange={(checked) => update("requireWarehouseOnDocuments", checked)}
          />

          <ConfigCard
            icon={<ScanSearch size={20} />}
            title="Auto-selecteaza singura gestiune disponibila"
            description="Daca o locatie are o singura gestiune, sistemul o selecteaza automat ca sa pastreze fluxul rapid si curat."
            checked={form.autoSelectSingleWarehouse}
            disabled={!form.multiWarehouseEnabled}
            onChange={(checked) => update("autoSelectSingleWarehouse", checked)}
          />
        </div>
      </DocumentSection>

      <DocumentSection
        title="Afisare in ERP"
        description="Poti folosi o eticheta mai potrivita pentru client, fara sa schimbi logica interna."
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,280px)_1fr]">
          <DocumentField label="Eticheta folosita in ERP">
            <input
              value={form.warehouseLabel}
              onChange={(e) => update("warehouseLabel", e.target.value)}
              className={documentInputClass}
              placeholder="Gestiune"
              maxLength={32}
            />
          </DocumentField>

          <div className="rounded-[20px] border border-[#E8E3DA] bg-[#FCFBF8] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-white text-[#17324D] shadow-sm">
                <MapPin size={18} />
              </span>
              <div>
                <div className="text-[15px] font-semibold text-slate-900">Cum se vede pentru client</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  Locatie = punctul mare de lucru. {form.warehouseLabel || "Gestiune"} = zona interna din locatie.
                </div>
                <div className="mt-3 text-sm text-slate-700">
                  Exemple bune: <span className="font-semibold">Gestiune</span>, <span className="font-semibold">Depozit</span>, <span className="font-semibold">Sectie</span>, <span className="font-semibold">Flux intern</span>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection
        title="Preview operational"
        description="Rezumatul de mai jos il ajuta pe client sa inteleaga imediat cum va lucra dupa salvare."
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <PreviewChip label="Topbar" value={previewTopbar} />
          <PreviewChip label="Documente" value={previewDocuments} />
          <PreviewChip label="Comportament" value={form.autoSelectSingleWarehouse ? "Selectie automata cand exista una singura" : "Selectie manuala in toate cazurile"} />
        </div>

        <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[15px] font-semibold text-slate-900">Recomandare practica</div>
          <div className="mt-2 text-sm leading-6 text-slate-600">{operationalSummary}</div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Locatie</div>
              <div className="mt-1">Restaurant, magazin, punct de lucru.</div>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">{form.warehouseLabel || "Gestiune"}</div>
              <div className="mt-1">Depozit materii prime, bar, bucatarie, marfa POS.</div>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Produs</div>
              <div className="mt-1">Nu se leaga de o singura gestiune. Stocul exista pe documente si pe gestiuni.</div>
            </div>
          </div>
        </div>
      </DocumentSection>
    </div>
  )
}
