import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import DataTable from "../components/ui/DataTable"
import {
  DocumentMetric,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"

type Uom = {
  id: string
  code: string
  name: string
  standardCode?: string | null
  isActive: boolean
}

const STANDARD_UOM_LABELS: Record<string, string> = {
  C62: "Bucata",
  H87: "Bucata alternativa",
  SET: "Set",
  KGM: "Kilogram",
  GRM: "Gram",
  LTR: "Litru",
  MLT: "Mililitru",
  MTR: "Metru",
  MMT: "Milimetru",
  CMK: "Centimetru patrat",
  MTK: "Metru patrat",
  CMQ: "Centimetru cub",
  MTQ: "Metru cub",
  INH: "Inch",
  FOT: "Picior",
  YRD: "Yard",
  TNE: "Tona",
  LBR: "Livra",
  HUR: "Ora",
  MIN: "Minut",
  SEC: "Secunda",
  DAY: "Zi",
  WEE: "Saptamana",
  MON: "Luna",
  ANN: "An",
  NAR: "Numar articole",
  BG: "Sac",
  BX: "Cutie",
  BO: "Sticla",
  PK: "Pachet",
  SA: "Saci",
  XBX: "Bax",
  CLT: "Centilitru",
  DLT: "Decilitru",
  HLT: "Hectolitru",
  MMQ: "Milimetru cub",
  MGM: "Miligram",
  KWH: "Kilowatt ora",
}

const STANDARD_UOM_OPTIONS = [
  "10",
  "11",
  "13",
  "14",
  "15",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "27",
  "28",
  "2A",
  "2B",
  "2C",
  "40",
  "41",
  "4K",
  "4L",
  "5B",
  "5E",
  "5J",
  "A93",
  "ANN",
  "BAG",
  "BG",
  "BO",
  "BX",
  "C62",
  "CG",
  "CLT",
  "CMK",
  "CMQ",
  "CMT",
  "CS",
  "CTM",
  "DAY",
  "DLT",
  "DRM",
  "FOT",
  "GL",
  "GRM",
  "H87",
  "HLT",
  "HUR",
  "INH",
  "KGM",
  "KTM",
  "KWH",
  "LBR",
  "LTR",
  "MGM",
  "MIN",
  "MLT",
  "MMK",
  "MMQ",
  "MMT",
  "MON",
  "MTR",
  "MTK",
  "MTQ",
  "NAR",
  "PA",
  "PF",
  "PK",
  "PR",
  "RO",
  "SA",
  "SEC",
  "SET",
  "SMI",
  "T3",
  "TNE",
  "WEE",
  "XBX",
  "YRD",
].map((code) => ({ code, label: STANDARD_UOM_LABELS[code] || "Cod standard ANAF" }))

function normalizeStandardCode(value: string) {
  return value.trim().toUpperCase()
}

export default function UomPage() {
  const token = getToken() || ""

  const [list, setList] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [standardCode, setStandardCode] = useState("")
  const [editingId, setEditingId] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

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
      const res = await fetch(`${API}/api/v1/meta/uom`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json().catch(() => ({}))
      setList(data.items || [])
    } catch {
      setError("Nu am putut incarca unitatile de masura.")
      setList([])
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setCode("")
    setName("")
    setStandardCode("")
    setEditingId("")
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError("Completeaza abrevierea si denumirea.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    const currentItem = editingId ? list.find((item) => item.id === editingId) : null
    const payload = {
      code: code.trim(),
      name: name.trim(),
      standardCode: normalizeStandardCode(standardCode) || null,
    }

    const res = await fetch(`${API}/api/v1/meta/uom${editingId ? `/${editingId}` : ""}`, {
      method: editingId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(editingId ? { ...payload, isActive: currentItem?.isActive ?? true } : payload),
    })

    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!data.ok) {
      setError(data.error || "Nu am putut salva unitatea.")
      return
    }

    const wasEditing = Boolean(editingId)
    resetForm()
    setMessage(wasEditing ? "Unitatea de masura a fost actualizata." : "Unitatea de masura a fost adaugata.")
    load()
  }

  async function toggle(item: Uom) {
    setError("")
    setMessage("")

    await fetch(`${API}/api/v1/meta/uom/${item.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        code: item.code,
        name: item.name,
        standardCode: item.standardCode || null,
        isActive: !item.isActive,
      }),
    })

    setMessage(item.isActive ? "Unitatea a fost dezactivata." : "Unitatea a fost activata.")
    load()
  }

  async function remove(id: string) {
    if (!confirm("Stergi unitatea?")) return

    setError("")
    setMessage("")

    await fetch(`${API}/api/v1/meta/uom/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })

    setMessage("Unitatea a fost stearsa.")
    load()
  }

  function startEdit(item: Uom) {
    setEditingId(item.id)
    setCode(item.code || "")
    setName(item.name || "")
    setStandardCode(item.standardCode || "")
    setError("")
    setMessage("")
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Unitati de masura"
        subtitle="Unitati utilizate in produse si documente. Codul salvat aici se foloseste mai departe pentru e-Factura."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DocumentMetric title="UM" value={stats.total} tone="slate" />
        <DocumentMetric title="Active" value={stats.active} tone="emerald" />
        <DocumentMetric title="Inactive" value={stats.inactive} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2.5 lg:flex-row">
          <input
            placeholder="Abreviere (ex: BUC)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${documentInputClass} lg:w-40`}
          />

          <div className="lg:w-56">
            <input
              list="uom-standard-codes"
              placeholder="Cod (ex: H87)"
              value={standardCode}
              onChange={(e) => setStandardCode(normalizeStandardCode(e.target.value))}
              className={documentInputClass}
            />
            <datalist id="uom-standard-codes">
              {STANDARD_UOM_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} - {option.label}
                </option>
              ))}
            </datalist>
          </div>

          <input
            placeholder="Denumire (ex: Bucata)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${documentInputClass} flex-1`}
          />

          <button onClick={save} disabled={saving} className={documentButtonPrimaryClass}>
            {saving ? "Se salveaza..." : editingId ? "Salveaza" : "Adauga"}
          </button>

          {editingId ? (
            <button onClick={resetForm} type="button" className={documentButtonSecondaryClass}>
              Renunta
            </button>
          ) : null}
        </div>

        <div className="mb-4 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Cod</span> este codul standard folosit in XML-ul e-Factura. Poti cauta direct in lista sau poti scrie manual.
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Se incarca...</div>
        ) : (
          <DataTable
            title="Lista unitatilor"
            subtitle="Cauta, sorteaza si administreaza unitatile de masura din sistem."
            rows={list}
            rowKey={(row) => row.id}
            searchPlaceholder="Cauta dupa cod sau denumire..."
            initialPageSize={10}
            emptyText="Nu exista unitati de masura."
            columns={[
              { key: "code", label: "Abreviere" },
              { key: "standardCode", label: "Cod", render: (u) => u.standardCode || "-" },
              { key: "name", label: "Denumire" },
              { key: "isActive", label: "Status", type: "status" },
              {
                key: "actions",
                label: "",
                sortable: false,
                className: "text-right",
                render: (u) => (
                  <div className="flex justify-end gap-2">
                    <button onClick={() => startEdit(u)} className={documentButtonSecondaryClass}>
                      Editeaza
                    </button>

                    <button onClick={() => toggle(u)} className={documentButtonSecondaryClass}>
                      {u.isActive ? "Dezactiveaza" : "Activeaza"}
                    </button>

                    <button onClick={() => remove(u.id)} className={documentButtonDangerClass}>
                      Sterge
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}
