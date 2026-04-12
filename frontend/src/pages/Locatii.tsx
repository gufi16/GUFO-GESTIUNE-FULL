import PageHeader from "../components/PageHeader"
import { useEffect, useMemo, useState } from "react"
import { Building2, RefreshCw } from "lucide-react"
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

type LocationItem = {
  id: string
  name: string
  code: string
}

export default function LocatiiPage() {
  const token = getToken() || ""

  const [items, setItems] = useState<LocationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [form, setForm] = useState({
    name: "",
    code: "",
  })

  const stats = useMemo(
    () => ({
      total: items.length,
      codes: items.filter((item) => item.code.trim()).length,
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
      setForm({ name: "", code: "" })
      loadLocations()
    } catch {
      setError("Nu pot salva locatia.")
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
        subtitle="Gestionezi magazinele, depozitele si punctele de lucru in acelasi stil curat cu restul ERP-ului."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Locatii" value={stats.total} tone="slate" />
        <DocumentMetric title="Cu cod" value={stats.codes} tone="blue" />
        <DocumentMetric title="Ultima din lista" value={stats.newest} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {success ? <InlineNotice tone="success">{success}</InlineNotice> : null}

      <DocumentSection
        title="Adauga locatie"
        description="Completezi rapid datele esentiale, iar lista de dedesubt se actualizează imediat."
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
        </div>
      </DocumentSection>

      <DocumentSection title="Locatii existente" description="Ai lista completa a locatiilor salvate si codurile lor operationale.">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DocumentSection>
    </div>
  )
}

