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

const STANDARD_UOM_OPTIONS = [
  { code: "C62", label: "Bucata" },
  { code: "SET", label: "Set" },
  { code: "KGM", label: "Kilogram" },
  { code: "GRM", label: "Gram" },
  { code: "LTR", label: "Litru" },
  { code: "MLT", label: "Mililitru" },
  { code: "MTR", label: "Metru" },
  { code: "MTK", label: "Metru patrat" },
  { code: "MTQ", label: "Metru cub" },
  { code: "H87", label: "Bucata alternativa" },
]

export default function UomPage() {
  const token = getToken() || ""

  const [list, setList] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [standardCode, setStandardCode] = useState("")
  const [standardSearch, setStandardSearch] = useState("")
  const [standardPickerOpen, setStandardPickerOpen] = useState(false)
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

  const filteredStandardOptions = useMemo(() => {
    const q = standardSearch.trim().toLowerCase()
    if (!q) return STANDARD_UOM_OPTIONS
    return STANDARD_UOM_OPTIONS.filter(
      (option) =>
        option.code.toLowerCase().includes(q) ||
        option.label.toLowerCase().includes(q)
    )
  }, [standardSearch])

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
    setStandardSearch("")
    setStandardPickerOpen(false)
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
      standardCode: standardCode.trim() || null,
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

    resetForm()
    setMessage(editingId ? "Unitatea de masura a fost actualizata." : "Unitatea de masura a fost adaugata.")
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
    setStandardSearch("")
    setStandardPickerOpen(false)
    setError("")
    setMessage("")
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Unitati de masura"
        subtitle="Unitati utilizate in produse si documente. Lista standard ramane usor de administrat si clara vizual."
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

          <div className="relative lg:w-60">
            <button
              type="button"
              onClick={() => setStandardPickerOpen((prev) => !prev)}
              className={`${documentInputClass} flex w-full items-center justify-between text-left`}
            >
              <span className={standardCode ? "text-slate-900" : "text-slate-400"}>
                {standardCode
                  ? `${standardCode} - ${STANDARD_UOM_OPTIONS.find((option) => option.code === standardCode)?.label || "Cod selectat"}`
                  : "Cod (ex: C62)"}
              </span>
              <span className="text-slate-400">▾</span>
            </button>

            {standardPickerOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <input
                  placeholder="Cauta cod..."
                  value={standardSearch}
                  onChange={(e) => setStandardSearch(e.target.value)}
                  className={`${documentInputClass} mb-2`}
                  autoFocus
                />

                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setStandardCode("")
                      setStandardSearch("")
                      setStandardPickerOpen(false)
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
                  >
                    <span>Fara cod</span>
                  </button>

                  {filteredStandardOptions.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      onClick={() => {
                        setStandardCode(option.code)
                        setStandardSearch("")
                        setStandardPickerOpen(false)
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <span className="font-medium">{option.code}</span>
                      <span className="text-slate-500">{option.label}</span>
                    </button>
                  ))}

                  {filteredStandardOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-400">Nu exista potriviri.</div>
                  ) : null}
                </div>
              </div>
            ) : null}
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
          Abrevierea ramane cea folosita in ERP si POS, iar <span className="font-semibold text-slate-700">Cod</span> este codul standard folosit la XML e-Factura.
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
