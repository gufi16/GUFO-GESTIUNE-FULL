import { ArrowRight, Building2, Filter, RefreshCcw, Save, Settings2, Warehouse } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
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

type LocationItem = {
  id: string
  name: string
  code?: string
}

type WarehouseItem = {
  id: string
  locationId: string
  name: string
  code: string
  isDefault: boolean
  isActive: boolean
}

type ActiveTab = "general" | "display" | "structure"

const emptyConfigForm: WarehouseConfigForm = {
  multiWarehouseEnabled: false,
  warehouseFilterEnabled: false,
  requireWarehouseOnDocuments: false,
  autoSelectSingleWarehouse: true,
  warehouseLabel: "Gestiune",
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 rounded-[16px] border px-4 py-3 ${
        disabled ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"
      }`}
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
    </label>
  )
}

export default function SetariGestiunePage() {
  const token = getToken() || ""
  const nav = useNavigate()
  const [activeTab, setActiveTab] = useState<ActiveTab>("general")
  const [configForm, setConfigForm] = useState<WarehouseConfigForm>(emptyConfigForm)
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const [configRes, locationsRes, warehousesRes] = await Promise.all([
        fetch(`${API}/api/v1/company/warehouse-config`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/v1/meta/locations`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/v1/meta/warehouses`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      const configData = await configRes.json().catch(() => ({}))
      const locationsData = await locationsRes.json().catch(() => ({}))
      const warehousesData = await warehousesRes.json().catch(() => ({}))

      if (!configRes.ok || !configData?.ok) {
        throw new Error(configData?.error || "Nu am putut incarca configurarea.")
      }
      if (!locationsRes.ok) {
        throw new Error(locationsData?.error || "Nu am putut incarca locatiile.")
      }
      if (!warehousesRes.ok || !warehousesData?.ok) {
        throw new Error(warehousesData?.error || "Nu am putut incarca gestiunile.")
      }

      const nextConfig = {
        multiWarehouseEnabled: Boolean(configData?.settings?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(configData?.settings?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(configData?.settings?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: configData?.settings?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(configData?.settings?.warehouseLabel || "Gestiune"),
      }

      setConfigForm(nextConfig)
      persistWarehouseConfig(nextConfig)
      setLocations(Array.isArray(locationsData?.locations) ? locationsData.locations : [])
      setWarehouses(Array.isArray(warehousesData?.warehouses) ? warehousesData.warehouses : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca configurarea.")
    } finally {
      setLoading(false)
    }
  }

  async function saveConfig() {
    if (!token) return

    setSavingConfig(true)
    setError("")
    setMessage("")

    try {
      const payload = {
        ...configForm,
        warehouseLabel: String(configForm.warehouseLabel || "Gestiune").trim() || "Gestiune",
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
        throw new Error(data?.error || "Nu am putut salva configurarea.")
      }

      const nextConfig = {
        multiWarehouseEnabled: Boolean(data?.settings?.multiWarehouseEnabled),
        warehouseFilterEnabled: Boolean(data?.settings?.warehouseFilterEnabled),
        requireWarehouseOnDocuments: Boolean(data?.settings?.requireWarehouseOnDocuments),
        autoSelectSingleWarehouse: data?.settings?.autoSelectSingleWarehouse !== false,
        warehouseLabel: String(data?.settings?.warehouseLabel || "Gestiune"),
      }

      setConfigForm(nextConfig)
      persistWarehouseConfig(nextConfig)
      setMessage("Configurarea a fost salvata.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva configurarea.")
    } finally {
      setSavingConfig(false)
    }
  }

  const tabs: Array<{ key: ActiveTab; label: string; icon: any }> = [
    { key: "general", label: "Setari generale", icon: Settings2 },
    { key: "display", label: "Filtre si afisare", icon: Filter },
    { key: "structure", label: "Locatii si gestiuni", icon: Building2 },
  ]

  const activeWarehousesCount = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive).length, [warehouses])
  const defaultWarehousesCount = useMemo(() => warehouses.filter((warehouse) => warehouse.isDefault).length, [warehouses])

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Configurare gestiune"
        subtitle="Controlezi modul de lucru pentru locatii si gestiuni, de la selectia din topbar pana la structura operationala folosita consecvent in documente."
      />

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Mod" value={configForm.multiWarehouseEnabled ? "Multi-gestiune" : "Simplu"} tone="slate" />
        <DocumentMetric title="Locatii" value={locations.length} tone="blue" />
        <DocumentMetric title="Gestiuni active" value={activeWarehousesCount} tone="emerald" />
        <DocumentMetric title="Default" value={defaultWarehousesCount} tone="amber" />
      </div>

      <div className="flex flex-wrap gap-2 rounded-[18px] border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                active ? "bg-[#17324D] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "general" ? (
        <DocumentSection
          title="Setari generale"
          description="Alegi daca lucrezi simplu sau multi-gestiune si stabilesti regulile de baza care raman vizibile mai departe in documentele din ERP."
          actions={
            <>
              <button type="button" className={documentButtonSecondaryClass} onClick={loadAll} disabled={loading || savingConfig}>
                <RefreshCcw size={14} className="mr-1.5" />
                Reincarca
              </button>
              <button type="button" className={documentButtonPrimaryClass} onClick={saveConfig} disabled={loading || savingConfig}>
                <Save size={14} className="mr-1.5" />
                {savingConfig ? "Se salveaza..." : "Salveaza"}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ToggleRow
              label="Multi-gestiune"
              checked={configForm.multiWarehouseEnabled}
              onChange={(checked) => setConfigForm((prev) => ({ ...prev, multiWarehouseEnabled: checked }))}
            />
            <ToggleRow
              label="Gestiune obligatorie pe documente"
              checked={configForm.requireWarehouseOnDocuments}
              disabled={!configForm.multiWarehouseEnabled}
              onChange={(checked) => setConfigForm((prev) => ({ ...prev, requireWarehouseOnDocuments: checked }))}
            />
            <ToggleRow
              label="Auto-select pentru gestiune unica"
              checked={configForm.autoSelectSingleWarehouse}
              disabled={!configForm.multiWarehouseEnabled}
              onChange={(checked) => setConfigForm((prev) => ({ ...prev, autoSelectSingleWarehouse: checked }))}
            />
          </div>
        </DocumentSection>
      ) : null}

      {activeTab === "display" ? (
        <DocumentSection
          title="Filtre si afisare"
          description="Decizi cum apare selectorul de gestiune in ERP si ce eticheta foloseste echipa in topbar si in formularele operationale curente."
          actions={
            <button type="button" className={documentButtonPrimaryClass} onClick={saveConfig} disabled={loading || savingConfig}>
              <Save size={14} className="mr-1.5" />
              {savingConfig ? "Se salveaza..." : "Salveaza"}
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleRow
                label="Selector in topbar"
                checked={configForm.warehouseFilterEnabled}
                disabled={!configForm.multiWarehouseEnabled}
                onChange={(checked) => setConfigForm((prev) => ({ ...prev, warehouseFilterEnabled: checked }))}
              />
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <DocumentField label="Eticheta">
                <input
                  value={configForm.warehouseLabel}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, warehouseLabel: e.target.value }))}
                  className={documentInputClass}
                  placeholder="Gestiune"
                  maxLength={32}
                />
              </DocumentField>

              <div className="mt-4 rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700">
                Afisare in ERP: {configForm.warehouseLabel || "Gestiune"}
              </div>
            </div>
          </div>
        </DocumentSection>
      ) : null}

      {activeTab === "structure" ? (
        <DocumentSection
          title="Locatii si gestiuni"
          description="Revizuiesti rapid structura activa din companie si intri direct in administrarea completa a locatiilor si gestiunilor."
          actions={
            <button type="button" className={documentButtonPrimaryClass} onClick={() => nav("/gestiune/gestiuni")}>
              Deschide administrare
              <ArrowRight size={14} className="ml-1.5" />
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              {locations.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nu exista locatii disponibile.
                </div>
              ) : (
                locations.map((location) => {
                  const locationWarehouses = warehouses.filter((warehouse) => warehouse.locationId === location.id)
                  const defaultWarehouse = locationWarehouses.find((warehouse) => warehouse.isDefault)

                  return (
                    <div key={location.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-semibold text-slate-900">{location.code ? `${location.name} (${location.code})` : location.name}</div>
                          <div className="mt-1 text-sm text-slate-500">{locationWarehouses.length} gestiuni · default {defaultWarehouse?.name || "-"}</div>
                        </div>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                          {locationWarehouses.filter((warehouse) => warehouse.isActive).length} active
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#17324D]">
                <Warehouse size={18} />
                Administrare separata
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">Adaugare si structurare gestiuni</div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">Editare, stergere si curatare structura</div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">Setare gestiune default pe locatie</div>
                <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">Activare si dezactivare operationala</div>
              </div>

              <button type="button" className={`${documentButtonPrimaryClass} mt-4 w-full justify-center`} onClick={() => nav("/gestiune/gestiuni")}>
                Mergi la gestiuni
              </button>
            </div>
          </div>
        </DocumentSection>
      ) : null}
    </div>
  )
}
