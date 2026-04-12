import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import {
  Copy,
  Download,
  KeyRound,
  MapPin,
  PauseCircle,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
} from "lucide-react"
import { api } from "../../lib/api"

type User = {
  id: string
  email: string
  fullName: string
  role: string
}

type LocationDevice = {
  id: string
  deviceId?: string
  label?: string | null
  createdAt?: string
  licenseKey?: string
}

type LocationItem = {
  id: string
  name: string
  code?: string
  isActive?: boolean
  devices?: LocationDevice[]
}

type ClientDetailsResponse = {
  item?: any
}

type ResetPasswordResponse = {
  item?: {
    email?: string
    fullName?: string
    newPassword?: string
  }
}

type AdminUserMutationResponse = {
  item?: User
  temporaryPassword?: string
}

type CreateLocationResponse = {
  item?: {
    id: string
    name: string
    code: string
  }
}

type CreateDeviceResponse = {
  item?: {
    label?: string | null
    deviceId: string
    licenseKey: string
  }
}

type LicenseModules = {
  dashboard: boolean
  documents: boolean
  inventory: boolean
  nomenclature: boolean
  settings: boolean
  pos: boolean
  reports: boolean
}

const defaultModules: LicenseModules = {
  dashboard: false,
  documents: false,
  inventory: false,
  nomenclature: false,
  settings: false,
  pos: false,
  reports: false,
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function toInputDate(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

function statusLabel(status?: string) {
  switch (status) {
    case "active":
      return "Activ"
    case "suspended":
      return "Suspendat"
    case "expired":
      return "Expirat"
    default:
      return "Inactiv"
  }
}

function statusClass(status?: string) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "suspended":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "expired":
      return "border-rose-200 bg-rose-50 text-rose-700"
    default:
      return "border-slate-200 bg-slate-50 text-slate-600"
  }
}

function currencyFormat(value?: number, currency?: string) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-"
  return `${value.toLocaleString("ro-RO")} ${currency || "RON"}`
}

function metricCard(label: string, value: string | number) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#17324D]">{value}</div>
    </div>
  )
}

export default function ControlPanelClientDetails() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [client, setClient] = useState<any | null>(null)
  const [resetPassword, setResetPassword] = useState<string | null>(null)
  const [resetForUser, setResetForUser] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [efacturaBusy, setEfacturaBusy] = useState(false)
  const [deletingTerminalId, setDeletingTerminalId] = useState<string | null>(null)
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null)
  const [creatingLocation, setCreatingLocation] = useState(false)
  const [creatingDeviceFor, setCreatingDeviceFor] = useState<string | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [exportingClient, setExportingClient] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [newLocationName, setNewLocationName] = useState("")
  const [deviceForms, setDeviceForms] = useState<Record<string, { label: string }>>({})
  const [openDeviceLocationId, setOpenDeviceLocationId] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    role: "CASHIER",
    password: "",
    isActive: true,
  })
  const [licenseForm, setLicenseForm] = useState({
    expiresAt: "",
    limitLocations: 1,
    limitTerminals: 1,
    modules: defaultModules,
  })

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const data = await api<ClientDetailsResponse>(`/api/v1/admin/clients/${id}`)
      const item = data?.item || null
      setClient(item)
      setLicenseForm({
        expiresAt: toInputDate(item?.license?.expiresAt),
        limitLocations: Number(item?.license?.limits?.locations ?? 1),
        limitTerminals: Number(item?.license?.limits?.terminals ?? 1),
        modules: {
          dashboard: Boolean(item?.license?.modules?.dashboard),
          documents: Boolean(item?.license?.modules?.documents),
          inventory: Boolean(item?.license?.modules?.inventory),
          nomenclature: Boolean(item?.license?.modules?.nomenclature),
          settings: Boolean(item?.license?.modules?.settings),
          pos: Boolean(item?.license?.modules?.pos),
          reports: Boolean(item?.license?.modules?.reports),
        },
      })
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca detaliile clientului.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  const users = Array.isArray(client?.users) ? (client.users as User[]) : []
  const locations = Array.isArray(client?.locations) ? (client.locations as LocationItem[]) : []
  const activeModules = Array.isArray(client?.activeModules) ? client.activeModules : []
  const erpEnabled = Boolean(
    licenseForm.modules.dashboard ||
      licenseForm.modules.documents ||
      licenseForm.modules.inventory ||
      licenseForm.modules.nomenclature ||
      licenseForm.modules.settings ||
      licenseForm.modules.reports,
  )
  const principalUser = useMemo(
    () => users.find((u) => u.role === "OWNER") || users.find((u) => u.role === "ADMIN") || users[0] || null,
    [users],
  )
  const efacturaModuleEnabled = activeModules.some((module: any) => module.code === "efactura")

  async function copy(text: string, label = "Valoarea") {
    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage(`${label} copiata`)
      window.setTimeout(() => setCopyMessage(null), 1800)
    } catch {
      setCopyMessage(`Nu am putut copia ${label.toLowerCase()}`)
      window.setTimeout(() => setCopyMessage(null), 1800)
    }
  }

  async function handleReset(userId: string) {
    try {
      setResettingUserId(userId)
      const res = await api<ResetPasswordResponse>(`/api/v1/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      setResetPassword(res?.item?.newPassword || null)
      setResetForUser(res?.item?.email || res?.item?.fullName || "user")
      setMessage("Parola a fost resetata.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut reseta parola.")
    } finally {
      setResettingUserId(null)
    }
  }

  function beginCreateUser() {
    setEditingUserId(null)
    setUserError(null)
    setUserForm({
      name: "",
      email: "",
      role: "CASHIER",
      password: "",
      isActive: true,
    })
  }

  function beginEditUser(user: User) {
    setEditingUserId(user.id)
    setUserError(null)
    setUserForm({
      name: user.fullName || "",
      email: user.email || "",
      role: user.role || "CASHIER",
      password: "",
      isActive: true,
    })
  }

  async function handleSaveUser() {
    if (!id) return
    if (!userForm.name.trim() || !userForm.email.trim()) {
      setUserError("Completeaza numele si emailul utilizatorului.")
      return
    }

    try {
      setSavingUser(true)
      setUserError(null)
      setError(null)

      if (editingUserId) {
        await api<AdminUserMutationResponse>(`/api/v1/admin/users/${editingUserId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: userForm.name,
            email: userForm.email,
            role: userForm.role,
            isActive: userForm.isActive,
            password: userForm.password || undefined,
          }),
        })
        setMessage("Utilizatorul a fost actualizat.")
      } else {
        const res = await api<AdminUserMutationResponse>(`/api/v1/admin/clients/${id}/users`, {
          method: "POST",
          body: JSON.stringify({
            name: userForm.name,
            email: userForm.email,
            role: userForm.role,
            password: userForm.password || undefined,
          }),
        })
        setResetPassword(res?.temporaryPassword || userForm.password || null)
        setResetForUser(res?.item?.email || userForm.email)
        setMessage("Utilizatorul a fost creat.")
      }

      beginCreateUser()
      await load()
    } catch (err: any) {
      setUserError(err?.message || "Nu am putut salva utilizatorul.")
    } finally {
      setSavingUser(false)
    }
  }

  async function handleSaveLicense() {
    if (!id) return
    try {
      setLicenseBusy(true)
      setError(null)
      await api(`/api/v1/admin/clients/${id}/license`, {
        method: "PATCH",
        body: JSON.stringify({
          expiresAt: licenseForm.expiresAt || null,
          limitLocations: licenseForm.limitLocations,
          limitTerminals: licenseForm.limitTerminals,
          modules: licenseForm.modules,
        }),
      })
      setMessage("Licenta a fost actualizata.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut actualiza licenta.")
    } finally {
      setLicenseBusy(false)
    }
  }

  async function handleToggleLicenseSuspended() {
    if (!id || !client?.license?.id) return
    try {
      setLicenseBusy(true)
      setError(null)
      await api(`/api/v1/admin/clients/${id}/license`, {
        method: "PATCH",
        body: JSON.stringify({
          isSuspended: !client.license.isSuspended,
        }),
      })
      setMessage(client.license.isSuspended ? "Licenta ERP a fost reactivata." : "Licenta ERP a fost suspendata.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut actualiza statusul licentei.")
    } finally {
      setLicenseBusy(false)
    }
  }

  async function handleToggleEfactura() {
    if (!id) return
    try {
      setEfacturaBusy(true)
      setError(null)
      await api(`/api/v1/admin/clients/${id}/modules/efactura`, {
        method: "POST",
        body: JSON.stringify({ enabled: !efacturaModuleEnabled }),
      })
      setMessage(efacturaModuleEnabled ? "e-Factura dezactivata." : "e-Factura activata.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut actualiza modulul e-Factura.")
    } finally {
      setEfacturaBusy(false)
    }
  }

  async function handleCreateLocation() {
    if (!id) return
    const name = newLocationName.trim()
    if (!name) {
      setLocationError("Introdu numele locatiei.")
      return
    }
    try {
      setCreatingLocation(true)
      setLocationError(null)
      await api<CreateLocationResponse>(`/api/v1/admin/clients/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({ name }),
      })
      setNewLocationName("")
      setMessage("Locatia a fost adaugata.")
      await load()
    } catch (err: any) {
      setLocationError(err?.message || "Nu am putut crea locatia.")
    } finally {
      setCreatingLocation(false)
    }
  }

  async function handleCreateDevice(locationId: string, locationName: string) {
    const label = (deviceForms[locationId]?.label || "").trim()
    if (!label) {
      setDeviceError("Introdu label-ul device-ului.")
      return
    }
    try {
      setCreatingDeviceFor(locationId)
      setDeviceError(null)
      const res = await api<CreateDeviceResponse>(`/api/v1/admin/locations/${locationId}/devices`, {
        method: "POST",
        body: JSON.stringify({ label }),
      })
      setMessage(`Device generat pentru ${locationName}.`)
      setCopyMessage(null)
      setResetPassword(res?.item?.licenseKey || res?.item?.deviceId || null)
      setResetForUser(res?.item?.label || label)
      setDeviceForms((prev) => ({ ...prev, [locationId]: { label: "" } }))
      setOpenDeviceLocationId(null)
      await load()
    } catch (err: any) {
      setDeviceError(err?.message || "Nu am putut crea device-ul POS.")
    } finally {
      setCreatingDeviceFor(null)
    }
  }

  async function handleDeleteTerminal(terminalId: string, terminalLabel: string) {
    if (!window.confirm(`Stergi device-ul POS "${terminalLabel}"?`)) return
    try {
      setDeletingTerminalId(terminalId)
      setError(null)
      await api(`/api/v1/admin/terminals/${terminalId}`, { method: "DELETE" })
      setMessage("Device-ul POS a fost sters.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge device-ul POS.")
    } finally {
      setDeletingTerminalId(null)
    }
  }

  async function handleDeleteLocation(locationId: string, locationName: string) {
    if (!window.confirm(`Stergi locatia "${locationName}"?`)) return
    try {
      setDeletingLocationId(locationId)
      setError(null)
      await api(`/api/v1/admin/locations/${locationId}`, { method: "DELETE" })
      setMessage("Locatia a fost stearsa.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge locatia.")
    } finally {
      setDeletingLocationId(null)
    }
  }

  async function handleExportClient() {
    if (!id) return
    try {
      setExportingClient(true)
      setError(null)
      const response = await api<Response>(`/api/v1/admin/clients/${id}/export`, {
        raw: true,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Nu am putut genera exportul clientului.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const disposition = response.headers.get("content-disposition") || ""
      const match = disposition.match(/filename=\"?([^\";]+)\"?/)
      link.href = url
      link.download = match?.[1] || `tenant-export-${id}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setMessage("Exportul clientului a fost generat.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut genera exportul clientului.")
    } finally {
      setExportingClient(false)
    }
  }

  const infoRows = [
    ["Firma", client?.company?.name || "-"],
    ["CUI", client?.company?.cui || "-"],
    ["Reg. com.", client?.company?.regNo || "-"],
    ["Email", client?.company?.email || "-"],
    ["Telefon", client?.company?.phone || "-"],
    ["Adresa", client?.company?.address || "-"],
  ]

  const moduleLabels: Array<[keyof LicenseModules, string]> = [
    ["dashboard", "Dashboard"],
    ["documents", "Documente"],
    ["inventory", "Inventar"],
    ["nomenclature", "Nomenclator"],
    ["settings", "Setari"],
    ["pos", "POS"],
    ["reports", "Rapoarte"],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[#17324D]">{client?.company?.name || client?.name || "Client"}</h1>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(client?.status)}`}>
              {statusLabel(client?.status)}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {client?.company?.cui || "-"} | expirare {formatDate(client?.license?.expiresAt)} | tenant {client?.id || "-"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportClient}
            disabled={exportingClient || loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download size={15} />
            {exportingClient ? "Se pregateste..." : "Export client"}
          </button>
          <button
            onClick={handleToggleLicenseSuspended}
            disabled={!client?.license?.id || licenseBusy}
            className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PauseCircle size={15} />
            {client?.license?.isSuspended ? "Reactiveaza" : "Suspenda"}
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {locationError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{locationError}</div> : null}
      {deviceError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{deviceError}</div> : null}
      {copyMessage ? <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{copyMessage}</div> : null}
      {userError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{userError}</div> : null}

      {resetPassword ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <div className="font-semibold">{resetForUser || "Credentiale"}</div>
          <div className="mt-1 font-mono">{resetPassword}</div>
          <button
            onClick={() => copy(resetPassword, "Valoare")}
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Informatii client</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Date comerciale si contact</div>
            </div>
            <div className="text-xs text-slate-500">Vizual compact</div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {metricCard("Utilizatori", client?.usersCount ?? users.length)}
            {metricCard("Locatii", client?.locationsCount ?? locations.length)}
            {metricCard("POS", client?.terminalsCount ?? 0)}
          </div>

          <div className="mt-4 grid gap-x-4 gap-y-2 text-sm">
            {infoRows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-2 last:border-b-0">
                <div className="font-medium text-slate-400">{label}</div>
                <div className="break-words text-slate-800">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Licenta si module</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Limite, expirare si activare module</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
              <div>{erpEnabled ? "ERP activ" : "ERP inactiv"}</div>
              <div className="mt-1">{efacturaModuleEnabled ? "e-Factura activa" : "e-Factura inactiva"}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Expirare</div>
              <input
                type="date"
                value={licenseForm.expiresAt}
                onChange={(e) => setLicenseForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Limita locatii</div>
              <input
                type="number"
                min={1}
                value={licenseForm.limitLocations}
                onChange={(e) => setLicenseForm((prev) => ({ ...prev, limitLocations: Number(e.target.value || 1) }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Limita POS</div>
              <input
                type="number"
                min={1}
                value={licenseForm.limitTerminals}
                onChange={(e) => setLicenseForm((prev) => ({ ...prev, limitTerminals: Number(e.target.value || 1) }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {moduleLabels.map(([key, label]) => {
              const enabled = Boolean(licenseForm.modules[key])
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setLicenseForm((prev) => ({
                      ...prev,
                      modules: { ...prev.modules, [key]: !prev.modules[key] },
                    }))
                  }
                  className={`rounded-2xl border px-3 py-3 text-left text-sm font-medium transition ${
                    enabled
                      ? "border-[#17324D] bg-[#17324D] text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              )
            })}

            <button
              type="button"
              onClick={handleToggleEfactura}
              disabled={efacturaBusy}
              className={`rounded-2xl border px-3 py-3 text-left text-sm font-medium transition ${
                efacturaModuleEnabled
                  ? "border-[#F39C12]/40 bg-[#FFF1D6] text-[#B56800]"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {efacturaBusy ? "Se actualizeaza..." : "e-Factura"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-sm text-slate-500">Salveaza imediat dupa orice modificare de licenta sau modul.</div>
            <button
              onClick={handleSaveLicense}
              disabled={licenseBusy}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={15} />
              {licenseBusy ? "Se salveaza..." : "Salveaza"}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatii si POS</div><div className="mt-1 text-sm font-semibold text-[#17324D]">Administrare locatii, terminale si chei de licenta</div></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              placeholder="Locatie noua"
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />
            <button
              onClick={handleCreateLocation}
              disabled={creatingLocation}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={15} />
              {creatingLocation ? "Se creeaza..." : "Adauga locatie"}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="text-sm text-slate-400">Loading...</div>
          ) : locations.length === 0 ? (
            <div className="text-sm text-slate-400">Nu exista locatii.</div>
          ) : (
            locations.map((location) => (
              <div key={location.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <MapPin size={14} />
                      {location.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {location.code || "-"} | {(location.devices?.length || 0)} device-uri
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setOpenDeviceLocationId(openDeviceLocationId === location.id ? null : location.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700"
                    >
                      <Plus size={13} />
                      Device
                    </button>
                    <button
                      onClick={() => handleDeleteLocation(location.id, location.name)}
                      disabled={(location.devices?.length || 0) > 0 || deletingLocationId === location.id}
                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                      {deletingLocationId === location.id ? "..." : "Sterge"}
                    </button>
                  </div>
                </div>

                {openDeviceLocationId === location.id ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={deviceForms[location.id]?.label || ""}
                      onChange={(e) =>
                        setDeviceForms((prev) => ({ ...prev, [location.id]: { label: e.target.value } }))
                      }
                      placeholder="Label device"
                      className="h-10 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <button
                      onClick={() => handleCreateDevice(location.id, location.name)}
                      disabled={creatingDeviceFor === location.id}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Smartphone size={14} />
                      {creatingDeviceFor === location.id ? "Se genereaza..." : "Genereaza"}
                    </button>
                  </div>
                ) : null}

                {location.devices && location.devices.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold">Device</th>
                          <th className="px-2 py-2 text-left font-semibold">Licenta</th>
                          <th className="px-2 py-2 text-left font-semibold">Creat</th>
                          <th className="px-2 py-2 text-left font-semibold">Actiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {location.devices.map((device) => (
                          <tr key={device.id} className="border-t border-slate-200">
                            <td className="px-2 py-2 text-slate-800">{device.label || device.deviceId || "-"}</td>
                            <td className="px-2 py-2 font-mono text-slate-600">{device.licenseKey || device.deviceId || "-"}</td>
                            <td className="px-2 py-2 text-slate-500">{formatDate(device.createdAt)}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => copy(device.licenseKey || device.deviceId || "", "Licenta")}
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                                >
                                  <Copy size={12} />
                                  Copy
                                </button>
                                <button
                                  onClick={() => handleDeleteTerminal(device.id, device.label || device.deviceId || "Device POS")}
                                  disabled={deletingTerminalId === device.id}
                                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Trash2 size={12} />
                                  {deletingTerminalId === device.id ? "..." : "Sterge"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_0.75fr_1.3fr]">
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Acces ERP</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Adaugare, editare si resetare utilizatori</div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[#17324D]">
              {editingUserId ? "Editeaza utilizator" : "Adauga utilizator"}
            </div>
            {editingUserId ? (
              <button
                onClick={beginCreateUser}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              >
                Anuleaza editarea
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3">
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Nume</div>
              <input
                value={userForm.name}
                onChange={(e) => setUserForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nume complet"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Email</div>
              <input
                value={userForm.email}
                onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="user@client.ro"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Rol</div>
              <select
                value={userForm.role}
                onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="OWNER">Owner</option>
                <option value="ADMIN">Administrator</option>
                <option value="MANAGER">Manager</option>
                <option value="CASHIER">Ospatar / Casier</option>
                <option value="WAREHOUSE">Magazioner</option>
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {editingUserId ? "Parola noua (optional)" : "Parola initiala (optional)"}
              </div>
              <input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={editingUserId ? "Lasa gol daca nu o schimbi" : "Lasa gol pentru generare automata"}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </label>

            {editingUserId ? (
              <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={userForm.isActive}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                Utilizator activ
              </label>
            ) : null}

            <button
              onClick={handleSaveUser}
              disabled={savingUser}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={15} />
              {savingUser ? "Se salveaza..." : editingUserId ? "Salveaza utilizatorul" : "Creeaza utilizator"}
            </button>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Client summary</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Plan, billing si contact principal</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {metricCard("Plan", client?.subscription?.plan?.name || "-")}
            {metricCard("Pret", currencyFormat(client?.subscription?.price, client?.subscription?.currency))}
            {metricCard("Billing", client?.subscription?.billingStatus || "-")}
            {metricCard("Plata", formatDate(client?.subscription?.nextBillingDate))}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Contact principal</div>
            <div className="mt-1 font-medium text-slate-900">{principalUser?.fullName || client?.company?.name || "-"}</div>
            <div className="mt-1 break-all text-slate-600">{principalUser?.email || client?.company?.email || "-"}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm xl:col-span-3">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Utilizatori ERP</div><div className="mt-1 text-sm font-semibold text-[#17324D]">Operatori, administratori si resetari rapide</div></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Nume</th>
                  <th className="px-4 py-3 text-left font-semibold">Rol</th>
                  <th className="px-4 py-3 text-left font-semibold">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">Loading...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">Nu exista useri.</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{user.email}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{user.fullName}</td>
                      <td className="px-4 py-3 text-slate-600">{user.role}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => beginEditUser(user)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            <Save size={12} />
                            Editeaza
                          </button>
                          <button
                            onClick={() => handleReset(user.id)}
                            disabled={resettingUserId === user.id}
                            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <KeyRound size={12} />
                            {resettingUserId === user.id ? "..." : "Reset"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="font-semibold">Atentie:</span> locatia se poate sterge doar daca nu are device-uri POS.
      </div>

      {principalUser?.email ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          Contact principal: {principalUser.email}
        </div>
      ) : null}
    </div>
  )
}

