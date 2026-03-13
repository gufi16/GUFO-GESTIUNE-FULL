import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import DataTable from "../components/ui/DataTable"

const API = "http://localhost:3001"

type Uom = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export default function UomPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [list, setList] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const res = await fetch(`${API}/api/v1/meta/uom`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    const data = await res.json()
    setList(data.items || [])
    setLoading(false)
  }

  async function add() {
    if (!code || !name) return

    setSaving(true)

    const res = await fetch(`${API}/api/v1/meta/uom`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ code, name })
    })

    const data = await res.json()
    setSaving(false)

    if (!data.ok) {
      alert(data.error)
      return
    }

    setCode("")
    setName("")
    load()
  }

  async function toggle(item: Uom) {
    await fetch(`${API}/api/v1/meta/uom/${item.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        code: item.code,
        name: item.name,
        isActive: !item.isActive
      })
    })

    load()
  }

  async function remove(id: string) {
    if (!confirm("Ștergi unitatea?")) return

    await fetch(`${API}/api/v1/meta/uom/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    })

    load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Unități de măsură"
        subtitle="Unități utilizate în produse și documente. Lista standard este încărcată automat în sistem."
      />

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row">
          <input
            placeholder="Cod (ex: BUC)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 lg:w-40"
          />

          <input
            placeholder="Denumire (ex: Bucată)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />

          <button
            onClick={add}
            disabled={saving}
            className="h-11 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Se salvează..." : "Adaugă"}
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Se încarcă...</div>
        ) : (
          <DataTable
            title="Lista unităților"
            subtitle="Caută, sortează și administrează unitățile de măsură din sistem."
            rows={list}
            rowKey={(row) => row.id}
            searchPlaceholder="Caută după cod sau denumire..."
            initialPageSize={10}
            emptyText="Nu există unități de măsură."
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
                    <button
                      onClick={() => toggle(u)}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      {u.isActive ? "Dezactivează" : "Activează"}
                    </button>

                    <button
                      onClick={() => remove(u.id)}
                      className="rounded-xl bg-red-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-600"
                    >
                      Șterge
                    </button>
                  </div>
                )
              }
            ]}
          />
        )}
      </div>
    </div>
  )
}
