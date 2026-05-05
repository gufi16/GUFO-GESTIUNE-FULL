import PageHeader from "../components/PageHeader"
import { useEffect, useMemo, useState } from "react"
import { Building2, MapPin, Pencil, RefreshCw } from "lucide-react"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"

type LocationItem = {
  id: string
  name: string
  code: string
  address?: string | null
  street?: string | null
  streetNo?: string | null
  building?: string | null
  staircase?: string | null
  floor?: string | null
  apartment?: string | null
  details?: string | null
  city?: string | null
  county?: string | null
  country?: string | null
  postalCode?: string | null
  isActive?: boolean
}

type LocationForm = {
  name: string
  code: string
  street: string
  streetNo: string
  building: string
  staircase: string
  floor: string
  apartment: string
  details: string
  city: string
  county: string
  country: string
  postalCode: string
}

const emptyForm: LocationForm = {
  name: "",
  code: "",
  street: "",
  streetNo: "",
  building: "",
  staircase: "",
  floor: "",
  apartment: "",
  details: "",
  city: "",
  county: "",
  country: "RO",
  postalCode: "",
}

function buildLocationAddressLabel(item: {
  address?: string | null
  street?: string | null
  streetNo?: string | null
  building?: string | null
  staircase?: string | null
  floor?: string | null
  apartment?: string | null
  details?: string | null
  city?: string | null
  county?: string | null
  country?: string | null
  postalCode?: string | null
}) {
  const streetLine = [item.street, item.streetNo ? `Nr. ${item.streetNo}` : null].filter(Boolean).join(" ").trim()
  const extraLine = [
    item.building ? `Bl. ${item.building}` : null,
    item.staircase ? `Sc. ${item.staircase}` : null,
    item.floor ? `Et. ${item.floor}` : null,
    item.apartment ? `Ap. ${item.apartment}` : null,
  ]
    .filter(Boolean)
    .join(", ")
    .trim()

  return [streetLine || item.address, extraLine, item.details, item.city, item.county, item.country, item.postalCode]
    .filter(Boolean)
    .join(", ")
}

export default function LocatiiPage() {
  const token = getToken() || ""

  const [items, setItems] = useState<LocationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showEdit, setShowEdit] = useState(false)
  const [editingItem, setEditingItem] = useState<LocationItem | null>(null)
  const [form, setForm] = useState<LocationForm>(emptyForm)

  const stats = useMemo(
    () => ({
      total: items.length,
      complete: items.filter((item) => item.address && item.city && item.county).length,
      newest: items[items.length - 1]?.name || "-",
    }),
    [items]
  )

  async function loadLocations() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setItems([])
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot incarca locatiile.")
        setItems([])
        return
      }

      setItems(Array.isArray(data.locations) ? data.locations : [])
    } catch {
      setError("Nu pot incarca locatiile.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm(emptyForm)
  }

  function openEdit(item: LocationItem) {
    setEditingItem(item)
    setForm({
      name: item.name || "",
      code: item.code || "",
      street: item.street || "",
      streetNo: item.streetNo || "",
      building: item.building || "",
      staircase: item.staircase || "",
      floor: item.floor || "",
      apartment: item.apartment || "",
      details: item.details || "",
      city: item.city || "",
      county: item.county || "",
      country: item.country || "RO",
      postalCode: item.postalCode || "",
    })
    setShowEdit(true)
  }

  function closeEdit() {
    setEditingItem(null)
    setShowEdit(false)
    resetForm()
  }

  async function saveLocation() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!form.name.trim()) {
      setError("Completeaza numele locatiei.")
      return
    }

    if (!form.code.trim()) {
      setError("Completeaza codul locatiei.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot salva locatia.")
        return
      }

      setSuccess("Locatia a fost salvata.")
      resetForm()
      loadLocations()
    } catch {
      setError("Nu pot salva locatia.")
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!token || !editingItem) return

    if (!form.name.trim()) {
      setError("Completeaza numele locatiei.")
      return
    }

    if (!form.code.trim()) {
      setError("Completeaza codul locatiei.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")

    try {
      const res = await fetch(`${API}/api/v1/meta/locations/${editingItem.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          isActive: editingItem.isActive !== false,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu pot actualiza locatia.")
        return
      }

      setSuccess("Locatia a fost actualizata.")
      closeEdit()
      loadLocations()
    } catch {
      setError("Nu pot actualiza locatia.")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadLocations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Locatii"
        subtitle="Gestionezi gestiunile si completezi datele de adresa necesare inclusiv pentru fluxurile RO e-Transport."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Locatii" value={stats.total} tone="slate" />
        <DocumentMetric title="Cu adresa completa" value={stats.complete} tone="blue" />
        <DocumentMetric title="Ultima din lista" value={stats.newest} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {success ? <InlineNotice tone="success">{success}</InlineNotice> : null}

      <DocumentSection
        title="Adauga locatie"
        description="Completezi locatia cu datele operationale si adresa folosita pe documente si transport."
        actions={
          <>
            <button type="button" onClick={loadLocations} className={documentButtonSecondaryClass}>
              <RefreshCw size={16} className="mr-2" />
              {loading ? "Se incarca..." : "Reincarca"}
            </button>
            <button type="button" onClick={saveLocation} className={documentButtonPrimaryClass} disabled={saving}>
              {saving ? "Se salveaza..." : "Salveaza locatia"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <DocumentField label="Nume locatie">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={documentInputClass}
              placeholder="Ex: Depozit principal"
            />
          </DocumentField>

          <DocumentField label="Cod locatie">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className={documentInputClass}
              placeholder="Ex: DEP01"
            />
          </DocumentField>

          <div className="grid grid-cols-1 gap-3 md:col-span-2 xl:grid-cols-[minmax(0,1fr)_120px_110px_110px_110px_110px]">
            <DocumentField label="Strada">
              <input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} className={documentInputClass} placeholder="Ex: Calea Floresti" />
            </DocumentField>
            <DocumentField label="Nr.">
              <input value={form.streetNo} onChange={(e) => setForm({ ...form, streetNo: e.target.value })} className={documentInputClass} />
            </DocumentField>
            <DocumentField label="Bl.">
              <input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} className={documentInputClass} />
            </DocumentField>
            <DocumentField label="Sc.">
              <input value={form.staircase} onChange={(e) => setForm({ ...form, staircase: e.target.value })} className={documentInputClass} />
            </DocumentField>
            <DocumentField label="Et.">
              <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className={documentInputClass} />
            </DocumentField>
            <DocumentField label="Ap.">
              <input value={form.apartment} onChange={(e) => setForm({ ...form, apartment: e.target.value })} className={documentInputClass} />
            </DocumentField>
          </div>

          <div className="grid grid-cols-1 gap-3 md:col-span-2 sm:grid-cols-2 xl:grid-cols-5">
            <DocumentField label="Localitate">
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className={documentInputClass}
              />
            </DocumentField>

            <DocumentField label="Judet">
              <input
                value={form.county}
                onChange={(e) => setForm({ ...form, county: e.target.value })}
                className={documentInputClass}
              />
            </DocumentField>

            <DocumentField label="Tara">
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className={documentInputClass}
              />
            </DocumentField>

            <DocumentField label="Cod postal">
              <input
                value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                className={documentInputClass}
              />
            </DocumentField>

            <div className="sm:col-span-2 xl:col-span-5">
              <DocumentField label="Detalii suplimentare">
                <textarea
                  value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                  className={documentTextareaClass}
                  rows={2}
                  placeholder="Repere, cladire, corp, observatii utile"
                />
              </DocumentField>
            </div>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Locatii existente" description="Ai lista completa a locatiilor si poti deschide rapid editarea lor.">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se incarca locatiile...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Nu exista locatii salvate.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[16px] border border-slate-200">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Locatie</th>
                  <th className="px-3 py-2.5 text-left font-medium">Cod</th>
                  <th className="px-3 py-2.5 text-left font-medium">Adresa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-blue-50 text-blue-700">
                          <Building2 size={18} />
                        </span>
                        <span className="font-semibold text-slate-900">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{item.code}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                        <div className="flex items-start gap-2">
                          <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" />
                          <span>
                          {buildLocationAddressLabel(item) || "-"}
                          </span>
                        </div>
                      </td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => openEdit(item)} className={documentButtonSecondaryClass}>
                        <Pencil size={16} className="mr-2" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DocumentSection>

      {showEdit && editingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-3xl rounded-[20px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold text-slate-900">Editare locatie</div>
                <div className="text-sm text-slate-500">{editingItem.name}</div>
              </div>
              <button type="button" onClick={closeEdit} className={documentButtonSecondaryClass}>
                Inchide
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <DocumentField label="Nume locatie">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Cod locatie">
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={documentInputClass} />
              </DocumentField>
              <div className="grid grid-cols-1 gap-3 md:col-span-2 xl:grid-cols-[minmax(0,1fr)_120px_110px_110px_110px_110px]">
                <DocumentField label="Strada">
                  <input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Nr.">
                  <input value={form.streetNo} onChange={(e) => setForm({ ...form, streetNo: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Bl.">
                  <input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Sc.">
                  <input value={form.staircase} onChange={(e) => setForm({ ...form, staircase: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Et.">
                  <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Ap.">
                  <input value={form.apartment} onChange={(e) => setForm({ ...form, apartment: e.target.value })} className={documentInputClass} />
                </DocumentField>
              </div>
              <div className="grid grid-cols-1 gap-3 md:col-span-2 sm:grid-cols-2 xl:grid-cols-5">
                <DocumentField label="Localitate">
                  <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Judet">
                  <input value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Tara">
                  <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <DocumentField label="Cod postal">
                  <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} className={documentInputClass} />
                </DocumentField>
                <div className="sm:col-span-2 xl:col-span-5">
                  <DocumentField label="Detalii suplimentare">
                    <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className={documentTextareaClass} rows={2} />
                  </DocumentField>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeEdit} className={documentButtonSecondaryClass}>
                Renunta
              </button>
              <button type="button" onClick={saveEdit} className={documentButtonPrimaryClass} disabled={saving}>
                {saving ? "Se salveaza..." : "Salveaza modificarile"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
