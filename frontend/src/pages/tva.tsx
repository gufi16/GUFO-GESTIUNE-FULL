import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import DataTable from "../components/ui/DataTable"

const API = "http://localhost:3001"

type Vat = {
  id: string
  name: string
  rate: number
  isActive: boolean
}

export default function TvaPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [list, setList] = useState<Vat[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rate, setRate] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/vat`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setLoading(false)
        return
      }

      setList(Array.isArray(data.items) ? data.items : Array.isArray(data.vat) ? data.vat : [])
    } catch {
      setError("Nu pot încărca cotele TVA.")
      setList([])
    } finally {
      setLoading(false)
    }
  }

  async function addVat() {
    if (!token) {
      setError("Nu există token de autentificare. Fă login din nou.")
      return
    }

    const numericRate = Number(rate)
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      setError("Introdu o cotă TVA validă.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/vat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ rate: numericRate })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        setSaving(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut salva cota TVA.")
        setSaving(false)
        return
      }

      setRate("")
      setMessage("Cota TVA a fost salvată.")
      await load()
    } catch {
      setError("Nu am putut salva cota TVA.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleVat(item: Vat) {
    try {
      const res = await fetch(`${API}/api/v1/meta/vat/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rate: item.rate,
          isActive: !item.isActive
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        alert(data.error || "Nu am putut actualiza cota TVA.")
        return
      }

      await load()
    } catch {
      alert("Nu am putut actualiza cota TVA.")
    }
  }

  async function deleteVat(id: string) {
    const ok = window.confirm("Ștergi această cotă TVA?")
    if (!ok) return

    try {
      const res = await fetch(`${API}/api/v1/meta/vat/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        alert(data.error || "Nu am putut șterge cota TVA.")
        return
      }

      await load()
    } catch {
      alert("Nu am putut șterge cota TVA.")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Cote TVA"
        subtitle="Adaugă și gestionează cotele TVA utilizate în aplicație."
      />

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      ) : null}

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Ex: 19"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 lg:w-40"
          />

          <button
            onClick={addVat}
            disabled={saving}
            className="h-11 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Se salvează..." : "Adaugă"}
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Se încarcă cotele TVA...</div>
        ) : (
          <DataTable
            title="Lista cotelor TVA"
            subtitle="Caută, sortează și administrează cotele TVA din sistem."
            rows={list}
            rowKey={(row) => row.id}
            searchPlaceholder="Caută după cotă sau denumire..."
            initialPageSize={10}
            emptyText="Nu există cote TVA definite."
            columns={[
              { key: "rate", label: "Cotă TVA" },
              { key: "name", label: "Denumire" },
              { key: "isActive", label: "Status", type: "status" },
              {
                key: "actions",
                label: "",
                sortable: false,
                className: "text-right",
                render: (item) => (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => toggleVat(item)}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      {item.isActive ? "Dezactivează" : "Activează"}
                    </button>

                    <button
                      onClick={() => deleteVat(item.id)}
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
