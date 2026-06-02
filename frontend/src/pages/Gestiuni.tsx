import { Building2, CheckCircle2, Pencil, Plus, RefreshCcw, Save, Trash2, Warehouse } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { getWarehouseConfig, subscribeToWarehouseConfig, type WarehouseConfig } from "../lib/warehouseConfig"

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
  type: string
  isDefault: boolean
  isActive: boolean
  location?: {
    id: string
    name: string
    code?: string
  } | null
}

type WarehouseEditorForm = {
  id: string
  locationId: string
  code: string
  name: string
  type: string
  isDefault: boolean
  isActive: boolean
}

const warehouseTypeOptions = [
  { value: "GENERAL", label: "General" },
  { value: "RAW_MATERIALS", label: "Materii prime" },
  { value: "FINISHED_GOODS", label: "Produse finite" },
  { value: "BAR", label: "Bar" },
  { value: "KITCHEN", label: "Bucatarie" },
  { value: "PACKAGING", label: "Ambalaje" },
]

function emptyWarehouseForm(locationId = ""): WarehouseEditorForm {
  return {
    id: "",
    locationId,
    code: "",
    name: "",
    type: "GENERAL",
    isDefault: false,
    isActive: true,
  }
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-[16px] border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
    </label>
  )
}

function WarehouseModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-[#17324D]">{title}</h2>
          <button type="button" onClick={onClose} className={documentButtonSecondaryClass}>
            Inchide
          </button>
        </div>
        <div className="max-h-[calc(92vh-84px)] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export default function GestiuniPage() {
  const token = getToken() || ""
  const [warehouseConfig, setWarehouseConfigState] = useState<WarehouseConfig>(() => getWarehouseConfig())
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState(() => getActiveLocationId())
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [warehouseForm, setWarehouseForm] = useState<WarehouseEditorForm>(emptyWarehouseForm())
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingWarehouseId, setDeletingWarehouseId] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    void loadLocations()
  }, [])

  useEffect(() => {
    const unsubscribeLocation = subscribeToActiveLocation((locationId) => {
      setSelectedLocationId(locationId)
    })
    const unsubscribeConfig = subscribeToWarehouseConfig((config) => {
      setWarehouseConfigState(config)
    })

    return () => {
      unsubscribeLocation()
      unsubscribeConfig()
    }
  }, [])

  useEffect(() => {
    if (!selectedLocationId) {
      setWarehouses([])
      return
    }
    void loadWarehouses(selectedLocationId)
  }, [selectedLocationId])

  async function loadLocations() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Nu am putut incarca locatiile.")
      }

      const nextLocations = Array.isArray(data?.locations) ? data.locations : []
      setLocations(nextLocations)
      setSelectedLocationId((current) => current || nextLocations[0]?.id || "")
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca locatiile.")
    } finally {
      setLoading(false)
    }
  }

  async function loadWarehouses(locationId: string) {
    if (!token || !locationId) return

    try {
      const res = await fetch(`${API}/api/v1/meta/warehouses?locationId=${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca gestiunile.")
      }
      setWarehouses(Array.isArray(data?.warehouses) ? data.warehouses : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca gestiunile.")
      setWarehouses([])
    }
  }

  function openCreateModal() {
    setWarehouseForm(emptyWarehouseForm(selectedLocationId))
    setModalOpen(true)
  }

  function openEditModal(warehouse: WarehouseItem) {
    setWarehouseForm({
      id: warehouse.id,
      locationId: warehouse.locationId,
      code: warehouse.code || "",
      name: warehouse.name || "",
      type: warehouse.type || "GENERAL",
      isDefault: Boolean(warehouse.isDefault),
      isActive: Boolean(warehouse.isActive),
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setWarehouseForm(emptyWarehouseForm(selectedLocationId))
  }

  async function saveWarehouse() {
    if (!token) return
    if (!warehouseForm.locationId) {
      setError("Selecteaza locatia.")
      return
    }
    if (!warehouseForm.code.trim()) {
      setError("Codul gestiunii este obligatoriu.")
      return
    }
    if (!warehouseForm.name.trim()) {
      setError("Numele gestiunii este obligatoriu.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const method = warehouseForm.id ? "PUT" : "POST"
      const path = warehouseForm.id
        ? `${API}/api/v1/meta/warehouses/${encodeURIComponent(warehouseForm.id)}`
        : `${API}/api/v1/meta/warehouses`

      const res = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          locationId: warehouseForm.locationId,
          code: warehouseForm.code.trim().toUpperCase(),
          name: warehouseForm.name.trim(),
          type: warehouseForm.type,
          isDefault: warehouseForm.isDefault,
          isActive: warehouseForm.isActive,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut salva gestiunea.")
      }

      setMessage(warehouseForm.id ? "Gestiunea a fost actualizata." : "Gestiunea a fost creata.")
      if (warehouseForm.locationId) {
        setActiveLocationId(warehouseForm.locationId)
        await loadWarehouses(warehouseForm.locationId)
      }
      closeModal()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva gestiunea.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteWarehouse(warehouse: WarehouseItem) {
    if (!token) return
    const confirmed = typeof window === "undefined" ? true : window.confirm(`Stergi gestiunea ${warehouse.name}?`)
    if (!confirmed) return

    setDeletingWarehouseId(warehouse.id)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/warehouses/${encodeURIComponent(warehouse.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut sterge gestiunea.")
      }

      setMessage("Gestiunea a fost stearsa.")
      await loadWarehouses(warehouse.locationId)
    } catch (e: any) {
      setError(e?.message || "Nu am putut sterge gestiunea.")
    } finally {
      setDeletingWarehouseId("")
    }
  }

  const selectedLocationName = useMemo(
    () => locations.find((location) => location.id === selectedLocationId)?.name || "Locatie",
    [locations, selectedLocationId],
  )

  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault)
  const activeCount = warehouses.filter((warehouse) => warehouse.isActive).length
  const typedCount = useMemo(
    () => ({
      raw: warehouses.filter((warehouse) => warehouse.type === "RAW_MATERIALS").length,
      finished: warehouses.filter((warehouse) => warehouse.type === "FINISHED_GOODS").length,
    }),
    [warehouses],
  )

  return (
    <div className="space-y-3">
      <PageHeader
        badge="operational"
        title="Gestiuni"
        subtitle="Configurezi gestiunile pe locatie, alegi default-ul operational si mentii clar separate materiile prime, produsele finite si stocurile auxiliare din companie."
      />

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Mod" value={warehouseConfig.multiWarehouseEnabled ? "Multi-gestiune" : "Simplu"} tone="slate" />
        <DocumentMetric title="Locatie activa" value={selectedLocationName} tone="blue" />
        <DocumentMetric title="Gestiuni active" value={activeCount} tone="emerald" />
        <DocumentMetric title="Default" value={defaultWarehouse?.name || "-"} tone="amber" />
      </div>

      <DocumentSection title="Locatii" description="Alegi rapid contextul activ pe care lucrezi si vezi doar gestiunile relevante pentru locatia selectata in operarea curenta.">
        <div className="flex flex-wrap gap-2">
          {locations.map((location) => {
            const active = location.id === selectedLocationId
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => {
                  setSelectedLocationId(location.id)
                  setActiveLocationId(location.id)
                }}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                  active ? "bg-[#17324D] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Building2 size={14} />
                {location.code ? `${location.name} (${location.code})` : location.name}
              </button>
            )
          })}
          {!locations.length && !loading ? (
            <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Nu exista locatii disponibile.
            </div>
          ) : null}
        </div>
      </DocumentSection>

      <DocumentSection
        title={`Lista gestiuni - ${selectedLocationName}`}
        description={`In contextul curent ai ${warehouses.length} gestiuni, dintre care ${typedCount.raw} pentru materii prime si ${typedCount.finished} pentru produse finite.`}
        actions={
          <>
            <button type="button" className={documentButtonSecondaryClass} onClick={() => selectedLocationId && loadWarehouses(selectedLocationId)} disabled={!selectedLocationId}>
              <RefreshCcw size={14} className="mr-1.5" />
              Reincarca
            </button>
            <button type="button" className={documentButtonPrimaryClass} onClick={openCreateModal} disabled={!selectedLocationId}>
              <Plus size={14} className="mr-1.5" />
              Adauga gestiune
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          {!warehouses.length ? (
            <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Nu exista gestiuni pe locatia selectata.
            </div>
          ) : (
            warehouses.map((warehouse) => (
              <div key={warehouse.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[15px] font-semibold text-slate-900">{warehouse.name}</div>
                      {warehouse.isDefault ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                          Default
                        </span>
                      ) : null}
                      {!warehouse.isActive ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                          Inactiva
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-500 md:grid-cols-3">
                      <div className="rounded-[14px] bg-slate-50 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Cod</div>
                        <div className="mt-1 font-semibold text-slate-700">{warehouse.code}</div>
                      </div>
                      <div className="rounded-[14px] bg-slate-50 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Tip</div>
                        <div className="mt-1 font-semibold text-slate-700">
                          {warehouseTypeOptions.find((option) => option.value === warehouse.type)?.label || warehouse.type}
                        </div>
                      </div>
                      <div className="rounded-[14px] bg-slate-50 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Status</div>
                        <div className="mt-1 font-semibold text-slate-700">{warehouse.isActive ? "Activa" : "Inactiva"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={documentButtonSecondaryClass} onClick={() => openEditModal(warehouse)}>
                      <Pencil size={14} className="mr-1.5" />
                      Editeaza
                    </button>
                    <button
                      type="button"
                      className={documentButtonDangerClass}
                      onClick={() => deleteWarehouse(warehouse)}
                      disabled={deletingWarehouseId === warehouse.id}
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      {deletingWarehouseId === warehouse.id ? "Se sterge..." : "Sterge"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </DocumentSection>

      {modalOpen ? (
        <WarehouseModal title={warehouseForm.id ? "Editeaza gestiune" : "Adauga gestiune"} onClose={closeModal}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DocumentField label="Locatie">
                <select
                  value={warehouseForm.locationId}
                  onChange={(e) => setWarehouseForm((prev) => ({ ...prev, locationId: e.target.value }))}
                  className={documentInputClass}
                >
                  <option value="">Selecteaza locatia</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code ? `${location.name} (${location.code})` : location.name}
                    </option>
                  ))}
                </select>
              </DocumentField>

              <DocumentField label="Tip">
                <select
                  value={warehouseForm.type}
                  onChange={(e) => setWarehouseForm((prev) => ({ ...prev, type: e.target.value }))}
                  className={documentInputClass}
                >
                  {warehouseTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </DocumentField>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DocumentField label="Cod">
                <input
                  value={warehouseForm.code}
                  onChange={(e) => setWarehouseForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  className={documentInputClass}
                  placeholder="DEP-MP"
                />
              </DocumentField>

              <DocumentField label="Nume">
                <input
                  value={warehouseForm.name}
                  onChange={(e) => setWarehouseForm((prev) => ({ ...prev, name: e.target.value }))}
                  className={documentInputClass}
                  placeholder="Depozit materii prime"
                />
              </DocumentField>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow
                label="Seteaza ca default"
                checked={warehouseForm.isDefault}
                onChange={(checked) => setWarehouseForm((prev) => ({ ...prev, isDefault: checked }))}
              />
              <ToggleRow
                label="Gestiune activa"
                checked={warehouseForm.isActive}
                onChange={(checked) => setWarehouseForm((prev) => ({ ...prev, isActive: checked }))}
              />
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <CheckCircle2 size={16} className="text-emerald-600" />
                Default curent: {defaultWarehouse?.name || "-"}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeModal} className={documentButtonSecondaryClass}>
                Renunta
              </button>
              <button type="button" className={documentButtonPrimaryClass} onClick={saveWarehouse} disabled={saving}>
                <Save size={14} className="mr-1.5" />
                {saving ? "Se salveaza..." : warehouseForm.id ? "Salveaza modificarile" : "Creeaza gestiunea"}
              </button>
            </div>
          </div>
        </WarehouseModal>
      ) : null}
    </div>
  )
}
