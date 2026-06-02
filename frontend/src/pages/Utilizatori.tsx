import { FormEvent, useEffect, useMemo, useState } from "react"
import { EyeOff, KeyRound, Pencil, Plus, RefreshCw, UserCog, X } from "lucide-react"
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
import { API_BASE, api, authHeaders, resolvePublicAssetUrl } from "../lib/api"

type CompanyItem = {
  id: string
  name: string
  code?: string | null
  cui?: string | null
  isDefault?: boolean
}

type UserItem = {
  id: string
  email: string
  name: string
  imageUrl?: string | null
  role: string
  isActive: boolean
  hasPosPin?: boolean
  createdAt: string
  companies?: CompanyItem[]
}

const roleLabels: Record<string, string> = {
  OWNER: "Proprietar",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Ospatar / Casier",
  WAREHOUSE: "Magazioner",
  CHEF: "Bucatar",
  KITCHEN_HELPER: "Ajutor bucatar",
  KITCHEN_OPERATOR: "Operator bucatarie",
}

const roleOptions = [
  { value: "ADMIN", label: "Administrator" },
  { value: "MANAGER", label: "Manager" },
  { value: "CASHIER", label: "Ospatar / Casier" },
  { value: "WAREHOUSE", label: "Magazioner" },
  { value: "CHEF", label: "Bucatar" },
  { value: "KITCHEN_HELPER", label: "Ajutor bucatar" },
  { value: "KITCHEN_OPERATOR", label: "Operator bucatarie" },
]

type UserFormState = {
  name: string
  email: string
  imageUrl: string
  role: string
  password: string
  posPin: string
  companyIds: string[]
}

const emptyForm = (): UserFormState => ({
  name: "",
  email: "",
  imageUrl: "",
  role: "CASHIER",
  password: "",
  posPin: "",
  companyIds: [],
})

export default function Utilizatori() {
  const [items, setItems] = useState<UserItem[]>([])
  const [availableCompanies, setAvailableCompanies] = useState<CompanyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingCompaniesFor, setSavingCompaniesFor] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyForm)
  const [modalVersion, setModalVersion] = useState(0)
  const [editingCompaniesFor, setEditingCompaniesFor] = useState<string | null>(null)
  const [companySelection, setCompanySelection] = useState<string[]>([])
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  async function loadUsers() {
    setLoading(true)
    setError("")
    try {
      const data = await api<{ ok: boolean; items?: UserItem[]; availableCompanies?: CompanyItem[] }>("/api/v1/users")
      setItems(Array.isArray(data.items) ? data.items : [])
      setAvailableCompanies(Array.isArray(data.availableCompanies) ? data.availableCompanies : [])
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

  const summary = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) => item.isActive).length,
      waiters: items.filter((item) => item.role === "CASHIER").length,
      managers: items.filter((item) => item.role === "MANAGER" || item.role === "ADMIN").length,
      kitchen: items.filter((item) => ["CHEF", "KITCHEN_HELPER", "KITCHEN_OPERATOR"].includes(item.role)).length,
    }),
    [items]
  )

  function openCreateModal() {
    setEditingUserId(null)
    setForm(emptyForm())
    setModalVersion((current) => current + 1)
    setCredentials(null)
    setError("")
    setMessage("")
    setModalOpen(true)
  }

  function openEditModal(user: UserItem) {
    setEditingUserId(user.id)
    setForm({
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl || "",
      role: user.role,
      password: "",
      posPin: "",
      companyIds: (user.companies || []).map((company) => company.id),
    })
    setModalVersion((current) => current + 1)
    setCredentials(null)
    setError("")
    setMessage("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setEditingUserId(null)
    setForm(emptyForm())
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    setCredentials(null)

    try {
      if (editingUserId) {
        const data = await api<{ ok: boolean; item?: UserItem }>(`/api/v1/users/${editingUserId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...form,
            companyIds: form.role === "OWNER" || form.role === "ADMIN" ? [] : form.companyIds,
          }),
        })

        if (data.item) {
          setItems((current) => current.map((item) => (item.id === editingUserId ? (data.item as UserItem) : item)))
        } else {
          await loadUsers()
        }
        setMessage("Utilizatorul a fost actualizat.")
      } else {
        const data = await api<{ ok: boolean; item?: UserItem; temporaryPassword?: string }>("/api/v1/users", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            companyIds: form.role === "OWNER" || form.role === "ADMIN" ? [] : form.companyIds,
          }),
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
      }

      closeModal()
    } catch (err: any) {
      setError(err?.message || (editingUserId ? "Nu am putut actualiza utilizatorul." : "Nu am putut crea utilizatorul."))
    } finally {
      setSaving(false)
    }
  }

  async function saveCompanyAccess(user: UserItem) {
    try {
      setSavingCompaniesFor(user.id)
      setError("")
      setMessage("")
      const data = await api<{ ok: boolean; item?: { id: string; companies?: CompanyItem[] } }>(`/api/v1/users/${user.id}/companies`, {
        method: "PATCH",
        body: JSON.stringify({ companyIds: companySelection }),
      })

      setItems((current) =>
        current.map((item) =>
          item.id === user.id
            ? {
                ...item,
                companies: Array.isArray(data.item?.companies)
                  ? data.item.companies
                  : companySelection
                      .map((companyId) => availableCompanies.find((company) => company.id === companyId))
                      .filter(Boolean) as CompanyItem[],
              }
            : item
        )
      )
      setEditingCompaniesFor(null)
      setMessage("Accesul pe firme a fost actualizat.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut actualiza accesul pe firme.")
    } finally {
      setSavingCompaniesFor(null)
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

  async function configurePosPin(user: UserItem) {
    const value = window.prompt(
      user.hasPosPin
        ? "Introdu PIN nou pentru POS sau lasa gol pentru stergere."
        : "Introdu PIN-ul POS pentru acest utilizator.",
      ""
    )
    if (value === null) return

    setError("")
    setMessage("")
    try {
      const data = await api<{ ok: boolean; item?: { id: string; hasPosPin?: boolean } }>(`/api/v1/users/${user.id}/pos-pin`, {
        method: "POST",
        body: JSON.stringify({ posPin: value.trim() }),
      })
      setItems((current) =>
        current.map((item) => (item.id === user.id ? { ...item, hasPosPin: Boolean(data.item?.hasPosPin) } : item))
      )
      setMessage(value.trim() ? "PIN-ul POS a fost salvat." : "PIN-ul POS a fost sters.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva PIN-ul POS.")
    }
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append("image", file)
    setUploadingAvatar(true)
    setError("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/upload-avatar`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca poza utilizatorului.")
      }
      setForm((current) => ({ ...current, imageUrl: String(data.imageUrl || "") }))
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca poza utilizatorului.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Utilizatori ERP"
        subtitle="Administrezi utilizatorii ERP, rolurile, accesul pe firme, avatarul si credentialele folosite mai departe in POS sau KDS."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
        <DocumentMetric title="Total" value={summary.total} tone="slate" />
        <DocumentMetric title="Activi" value={summary.active} tone="emerald" />
        <DocumentMetric title="Ospatari" value={summary.waiters} tone="blue" />
        <DocumentMetric title="Admini / manageri" value={summary.managers} tone="amber" />
        <DocumentMetric title="Roluri KDS" value={summary.kitchen} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {credentials ? (
        <InlineNotice tone="info">
          Credentiale temporare: <strong>{credentials.email}</strong> / <strong>{credentials.password}</strong>
        </InlineNotice>
      ) : null}

      <DocumentSection
        title="Lista utilizatori"
        description="Vezi rapid utilizatorii activi sau inactivi, accesul pe firme si actiunile esentiale de administrare dintr-un singur registru clar."
        actions={
          <>
            <button className={documentButtonSecondaryClass} onClick={loadUsers} disabled={loading}>
              <RefreshCw size={16} className="mr-2" />
              Reincarca
            </button>
            <button className={documentButtonPrimaryClass} onClick={openCreateModal} type="button">
              <Plus size={16} className="mr-2" />
              Adauga utilizator
            </button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">Utilizator</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">PIN acces POS / KDS</th>
                <th className="px-3 py-2">Firme</th>
                <th className="px-3 py-2">Creat</th>
                <th className="px-3 py-2 text-right">Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <img src={resolvePublicAssetUrl(item.imageUrl)} alt={item.name} className="h-10 w-10 rounded-full border border-slate-200 object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17324D] text-sm font-semibold text-white">
                          {item.name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase() || "U"}
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{roleLabels[item.role] || item.role}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {item.isActive ? "Activ" : "Inactiv"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        item.hasPosPin ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {item.hasPosPin ? "Setat" : "Lipsa"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {item.role === "OWNER" || item.role === "ADMIN" ? (
                      <span className="text-xs font-medium text-slate-500">Toate firmele</span>
                    ) : editingCompaniesFor === item.id ? (
                      <div className="min-w-[250px] space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        {availableCompanies.map((company) => (
                          <label key={company.id} className="flex items-start gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#17324D]"
                              checked={companySelection.includes(company.id)}
                              onChange={(e) =>
                                setCompanySelection((current) =>
                                  e.target.checked ? [...current, company.id] : current.filter((id) => id !== company.id)
                                )
                              }
                            />
                            <span>
                              <span className="font-medium text-slate-900">{company.name}</span>
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {[company.code, company.cui].filter(Boolean).join(" • ") || "Firma ERP"}
                              </span>
                            </span>
                          </label>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <button className={documentButtonPrimaryClass} type="button" disabled={savingCompaniesFor === item.id} onClick={() => saveCompanyAccess(item)}>
                            {savingCompaniesFor === item.id ? "Se salveaza..." : "Salveaza"}
                          </button>
                          <button className={documentButtonSecondaryClass} type="button" onClick={() => setEditingCompaniesFor(null)}>
                            Renunta
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1.5">
                          {(item.companies || []).length ? (
                            (item.companies || []).map((company) => (
                              <span key={company.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                {company.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">Toate firmele</span>
                          )}
                        </div>
                        <button
                          className="text-xs font-semibold text-[#17324D] underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => {
                            setEditingCompaniesFor(item.id)
                            setCompanySelection((item.companies || []).map((company) => company.id))
                          }}
                        >
                          Modifica accesul
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">{new Date(item.createdAt).toLocaleDateString("ro-RO")}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button className={documentButtonSecondaryClass} onClick={() => openEditModal(item)} type="button">
                        <Pencil size={16} className="mr-2" />
                        Editeaza
                      </button>
                      <button className={documentButtonSecondaryClass} onClick={() => configurePosPin(item)} type="button">
                        <KeyRound size={16} className="mr-2" />
                        {item.hasPosPin ? "Schimba PIN POS / KDS" : "Seteaza PIN POS / KDS"}
                      </button>
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
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                    Nu exista utilizatori definiti.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DocumentSection>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#17324D]">{editingUserId ? "Editeaza utilizator" : "Adauga utilizator"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {editingUserId
                    ? "Modifici nume, email, rol, parola, PIN-ul de acces POS / KDS si accesul pe firme."
                    : "Completezi utilizatorul si il salvezi direct in lista."}
                </p>
              </div>
              <button type="button" onClick={closeModal} className={documentButtonSecondaryClass}>
                <X size={16} className="mr-2" />
                Inchide
              </button>
            </div>

            <form key={modalVersion} className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Nume</label>
                  <input
                    name={editingUserId ? "edit-user-name" : "create-user-name"}
                    autoComplete="off"
                    className={documentInputClass}
                    value={form.name}
                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Ex: Ervin Varga"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
                  <input
                    name={editingUserId ? "edit-user-email" : "create-user-email"}
                    autoComplete="off"
                    className={documentInputClass}
                    value={form.email}
                    onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                    placeholder="email@client.ro"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-700">Poza profil</label>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    {form.imageUrl ? (
                      <img src={resolvePublicAssetUrl(form.imageUrl)} alt={form.name || "Avatar"} className="h-16 w-16 rounded-full border border-slate-200 object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#17324D] text-lg font-semibold text-white">
                        {(form.name || "U")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase() || "U"}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className={documentButtonSecondaryClass}>
                        {uploadingAvatar ? "Se incarca..." : "Incarca poza"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingAvatar}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void uploadAvatar(file)
                            e.currentTarget.value = ""
                          }}
                        />
                      </label>
                      {form.imageUrl ? (
                        <button
                          type="button"
                          className={documentButtonSecondaryClass}
                          onClick={() => setForm((current) => ({ ...current, imageUrl: "" }))}
                        >
                          Sterge poza
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Rol</label>
                  <select
                    className={documentInputClass}
                    value={form.role}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        role: e.target.value,
                        companyIds: e.target.value === "ADMIN" || e.target.value === "OWNER" ? [] : current.companyIds,
                      }))
                    }
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    {editingUserId ? "Parola noua" : "Parola initiala"}
                  </label>
                  <input
                    type="password"
                    name={editingUserId ? "edit-user-password" : "create-user-password"}
                    autoComplete="new-password"
                    className={documentInputClass}
                    value={form.password}
                    onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                    placeholder={editingUserId ? "Lasa gol ca sa ramana neschimbata" : "Lasa gol pentru generare automata"}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">PIN acces POS / KDS</label>
                <input
                  type="password"
                  name={editingUserId ? "edit-user-pos-pin" : "create-user-pos-pin"}
                  autoComplete="new-password"
                  className={documentInputClass}
                  value={form.posPin}
                  onChange={(e) => setForm((current) => ({ ...current, posPin: e.target.value }))}
                  placeholder={editingUserId ? "Lasa gol pentru stergere sau neschimbat prin butonul dedicat" : "Ex: 1234"}
                />
                <div className="mt-1 text-xs text-slate-500">Atat GuFo POS, cat si GuFo KDS folosesc numele utilizatorului din ERP si PIN-ul de aici.</div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Acces firme</label>
                {form.role === "OWNER" || form.role === "ADMIN" ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Rolul selectat are acces complet la toate firmele.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                    {availableCompanies.map((company) => {
                      const checked = form.companyIds.includes(company.id)
                      return (
                        <label key={company.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#17324D]"
                            checked={checked}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                companyIds: e.target.checked
                                  ? [...current.companyIds, company.id]
                                  : current.companyIds.filter((id) => id !== company.id),
                              }))
                            }
                          />
                          <span>
                            <span className="font-medium text-slate-900">{company.name}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {[company.code, company.cui].filter(Boolean).join(" • ") || "Firma ERP"}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} className={documentButtonSecondaryClass}>
                  Renunta
                </button>
                <button className={documentButtonPrimaryClass} type="submit" disabled={saving}>
                  {saving ? "Se salveaza..." : editingUserId ? "Salveaza modificarile" : "Creeaza utilizator"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
