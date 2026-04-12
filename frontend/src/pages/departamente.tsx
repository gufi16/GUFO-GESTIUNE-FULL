import { useEffect, useMemo, useState, type CSSProperties } from "react"
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

type Department = {
  id: string
  name: string
  isActive: boolean
}

export default function DepartamentePage() {
  const token = getToken() || ""

  const [list, setList] = useState<Department[]>([])
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const stats = useMemo(
    () => ({
      total: list.length,
      active: list.filter((item) => item.isActive).length,
      inactive: list.filter((item) => !item.isActive).length,
    }),
    [list]
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/meta/departments`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json().catch(() => ({}))
      setList(data.items || [])
    } catch {
      setError("Nu am putut încărca departamentele.")
      setList([])
    } finally {
      setLoading(false)
    }
  }

  async function add() {
    if (!name.trim()) {
      setError("Completează numele departamentului.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")

    try {
      await fetch(`${API}/api/v1/meta/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      })

      setName("")
      setSuccess("Departamentul a fost adăugat.")
      load()
    } catch {
      setError("Nu am putut salva departamentul.")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(department: Department) {
    setError("")
    setSuccess("")

    await fetch(`${API}/api/v1/meta/departments/${department.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: department.name,
        isActive: !department.isActive,
      }),
    })

    setSuccess(department.isActive ? "Departamentul a fost dezactivat." : "Departamentul a fost activat.")
    load()
  }

  async function remove(id: string) {
    if (!confirm("Ștergi departamentul?")) return

    setError("")
    setSuccess("")

    await fetch(`${API}/api/v1/meta/departments/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })

    setSuccess("Departamentul a fost șters.")
    load()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Departamente" subtitle="Organizare produse pe departamente, într-un ecran mai clar și mai rapid de folosit." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DocumentMetric title="Departamente" value={stats.total} tone="slate" />
        <DocumentMetric title="Active" value={stats.active} tone="emerald" />
        <DocumentMetric title="Inactive" value={stats.inactive} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {success ? <InlineNotice tone="success">{success}</InlineNotice> : null}

      <DocumentSection
        title="Adaugă departament"
        description="Introduci numele și îl trimiți direct în nomenclator, fără pași inutili."
        actions={
          <>
            <button type="button" onClick={load} className={documentButtonSecondaryClass}>
              Reincarca
            </button>
            <button type="button" onClick={add} className={documentButtonPrimaryClass} disabled={saving}>
              {saving ? "Se salvează..." : "Adaugă"}
            </button>
          </>
        }
      >
        <DocumentField label="Departament">
          <input placeholder="Departament" value={name} onChange={(e) => setName(e.target.value)} className={documentInputClass} />
        </DocumentField>
      </DocumentSection>

      <DocumentSection title="Listă departamente" description="Vezi rapid statusul și poți activa, dezactiva sau șterge direct din listă.">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se încarcă...
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Departament</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {list.map((department) => (
                  <tr key={department.id} className="border-t border-slate-200">
                    <td className="px-4 py-4 font-semibold text-slate-900">{department.name}</td>
                    <td className="px-4 py-4">
                      <span
                        className={
                          department.isActive
                            ? "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : "inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {department.isActive ? "Activ" : "Inactiv"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => toggle(department)} className={documentButtonSecondaryClass}>
                          {department.isActive ? "Dezactivează" : "Activează"}
                        </button>
                        <button type="button" onClick={() => remove(department.id)} className={documentButtonDangerClass}>
                          Șterge
                        </button>
                      </div>
                    </td>
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

