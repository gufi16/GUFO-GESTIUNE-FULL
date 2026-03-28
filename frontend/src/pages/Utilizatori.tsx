import { FormEvent, useEffect, useMemo, useState } from "react"
import { EyeOff, KeyRound, Plus, RefreshCw, UserCog } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { api } from "../lib/api"

type UserItem = {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  createdAt: string
}

const roleLabels: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Ospatar / Casier",
  WAREHOUSE: "Magazioner",
}

const roleOptions = [
  { value: "ADMIN", label: "Administrator" },
  { value: "MANAGER", label: "Manager" },
  { value: "CASHIER", label: "Ospatar / Casier" },
  { value: "WAREHOUSE", label: "Magazioner" },
]

export default function Utilizatori() {
  const [items, setItems] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "CASHIER",
    password: "",
  })

  async function loadUsers() {
    setLoading(true)
    setError("")
    try {
      const data = await api<{ ok: boolean; items?: UserItem[] }>("/api/v1/users")
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca utilizatorii.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const summary = useMemo(() => ({
    total: items.length,
    active: items.filter((item) => item.isActive).length,
    waiters: items.filter((item) => item.role === "CASHIER").length,
    managers: items.filter((item) => item.role === "MANAGER" || item.role === "ADMIN").length,
  }), [items])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    setCredentials(null)

    try {
      const data = await api<{ ok: boolean; item?: UserItem; temporaryPassword?: string }>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify(form),
      })

      setMessage("Utilizatorul a fost creat.")
      if (data.item) {
        setItems((current) => [data.item as UserItem, ...current])
      } else {
        await loadUsers()
      }

      setCredentials({
        email: form.email.trim().toLowerCase(),
        password: data.temporaryPassword || form.password,
      })

      setForm({
        name: "",
        email: "",
        role: "CASHIER",
        password: "",
      })
    } catch (err: any) {
      setError(err?.message || "Nu am putut crea utilizatorul.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(user: UserItem) {
    setError("")
    setMessage("")
    try {
      const data = await api<{ ok: boolean; item?: UserItem }>(`/api/v1/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      setItems((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, ...(data.item || {}), isActive: !user.isActive } : item
        )
      )
      setMessage(`Utilizatorul ${user.isActive ? "a fost dezactivat" : "a fost reactivat"}.`)
    } catch (err: any) {
      setError(err?.message || "Nu am putut modifica statusul utilizatorului.")
    }
  }

  async function resetPassword(user: UserItem) {
    setError("")
    setMessage("")
    setCredentials(null)
    try {
      const data = await api<{ ok: boolean; temporaryPassword?: string }>(`/api/v1/users/${user.id}/reset-password`, {
        method: "POST",
      })
      setCredentials({
        email: user.email,
        password: data.temporaryPassword || "",
      })
      setMessage("Parola utilizatorului a fost resetata.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut reseta parola.")
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader badge="configurare" title="Utilizatori ERP" />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Total" value={summary.total} tone="slate" />
        <DocumentMetric title="Activi" value={summary.active} tone="emerald" />
        <DocumentMetric title="Ospatari" value={summary.waiters} tone="blue" />
        <DocumentMetric title="Admini / manageri" value={summary.managers} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {credentials ? (
        <InlineNotice tone="info">
          Credentiale temporare: <strong>{credentials.email}</strong> / <strong>{credentials.password}</strong>
        </InlineNotice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        <DocumentSection title="Utilizator nou">
          <form className="space-y-3" onSubmit={handleCreate}>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Nume</label>
              <input
                className={documentInputClass}
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Numele utilizatorului"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input
                className={documentInputClass}
                value={form.email}
                onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                placeholder="email@client.ro"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Rol</label>
              <select
                className={documentInputClass}
                value={form.role}
                onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Parola initiala</label>
              <input
                type="password"
                className={documentInputClass}
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                placeholder="Lasa gol pentru generare automata"
              />
            </div>

            <button className={documentButtonPrimaryClass} type="submit" disabled={saving}>
              <Plus size={16} className="mr-2" />
              {saving ? "Se creeaza..." : "Creeaza utilizator"}
            </button>
          </form>
        </DocumentSection>

        <DocumentSection
          title="Lista utilizatori"
          actions={
            <button className={documentButtonSecondaryClass} onClick={loadUsers} disabled={loading}>
              <RefreshCw size={16} className="mr-2" />
              Reincarca
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">Utilizator</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Creat</th>
                  <th className="px-3 py-2 text-right">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.email}</div>
                    </td>
                    <td className="px-3 py-3">{roleLabels[item.role] || item.role}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {item.isActive ? "Activ" : "Inactiv"}
                      </span>
                    </td>
                    <td className="px-3 py-3">{new Date(item.createdAt).toLocaleDateString("ro-RO")}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button className={documentButtonSecondaryClass} onClick={() => resetPassword(item)} type="button">
                          <KeyRound size={16} className="mr-2" />
                          Reseteaza parola
                        </button>
                        <button
                          className={item.isActive ? documentButtonDangerClass : documentButtonSecondaryClass}
                          onClick={() => toggleStatus(item)}
                          type="button"
                        >
                          {item.isActive ? <EyeOff size={16} className="mr-2" /> : <UserCog size={16} className="mr-2" />}
                          {item.isActive ? "Dezactiveaza" : "Reactiveaza"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                      Nu exista utilizatori definiti.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </DocumentSection>
      </div>
    </div>
  )
}
