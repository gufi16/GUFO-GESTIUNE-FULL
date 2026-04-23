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
  isActive: boolean
}

export default function UomPage() {
  const token = getToken() || ""

  const [list, setList] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
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

  async function add() {
    if (!code.trim() || !name.trim()) {
      setError("Completeaza codul si denumirea.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    const res = await fetch(`${API}/api/v1/meta/uom`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code: code.trim(), name: name.trim() }),
    })

    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!data.ok) {
      setError(data.error || "Nu am putut salva unitatea.")
      return
    }

    setCode("")
    setName("")
    setMessage("Unitatea de masura a fost adaugata.")
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
            placeholder="Cod (ex: BUC)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${documentInputClass} lg:w-40`}
          />

          <input
            placeholder="Denumire (ex: Bucata)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${documentInputClass} flex-1`}
          />

          <button onClick={add} disabled={saving} className={documentButtonPrimaryClass}>
            {saving ? "Se salveaza..." : "Adauga"}
          </button>
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
              { key: "code", label: "Cod" },
              { key: "name", label: "Denumire" },
              { key: "isActive", label: "Status", type: "status" },
              {
                key: "actions",
                label: "",
                sortable: false,
                className: "text-right",
                render: (u) => (
                  <div className="flex justify-end gap-2">
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
