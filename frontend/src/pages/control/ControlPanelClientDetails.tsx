import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  Copy,
  Download,
  Filter,
  History,
  KeyRound,
  MapPin,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react"
import { api } from "../../lib/api"
import {
  formatAuditDateTime,
  getAuditActionLabel,
  getAuditActorLabel,
  getAuditArea,
} from "../../lib/auditFormat"

type User = {
  id: string
  email: string
  fullName: string
  role: string
  companies?: Array<{
    id: string
    name: string
    code?: string | null
    cui?: string | null
    isDefault?: boolean
  }>
}

type LocationDevice = {
  id: string
  deviceId?: string
  deviceType?: string | null
  label?: string | null
  createdAt?: string
  licenseKey?: string
  companyId?: string | null
  company?: {
    id: string
    name: string
    code?: string | null
  } | null
}

type LocationItem = {
  id: string
  name: string
  code?: string
  isActive?: boolean
  address?: string | null
  street?: string | null
  streetNo?: string | null
  building?: string | null
  staircase?: string | null
  floor?: string | null
  apartment?: string | null
  details?: string | null
  city?: string | null
  county?: string | null
  country?: string | null
  postalCode?: string | null
  companyId?: string | null
  company?: {
    id: string
    name: string
    code?: string | null
  } | null
  devices?: LocationDevice[]
}

type AuditLogItem = {
  id: string
  actorType?: string
  actorId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  actorRole?: string | null
  action: string
  entityType: string
  entityId?: string | null
  payload?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
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
    address?: string | null
    street?: string | null
    streetNo?: string | null
    building?: string | null
    staircase?: string | null
    floor?: string | null
    apartment?: string | null
    details?: string | null
    city?: string | null
    county?: string | null
    country?: string | null
    postalCode?: string | null
    companyId?: string | null
  }
}

type CreateDeviceResponse = {
  item?: {
    label?: string | null
    deviceId: string
    deviceType?: string | null
    licenseKey: string
    companyId?: string | null
  }
}

type UpdateDeviceResponse = {
  item?: {
    id: string
    label?: string | null
    deviceId: string
    deviceType?: string | null
    licenseKey?: string
    companyId?: string | null
  }
}

function isRouteMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /Cannot\s+(PATCH|PUT|POST)\s+/i.test(message) || /not found/i.test(message)
}

type CreateCompanyResponse = {
  item?: {
    id: string
    name: string
    code?: string | null
    cui?: string | null
    regNo?: string | null
    address?: string | null
    email?: string | null
    phone?: string | null
    isDefault?: boolean
    createdAt?: string
  }
}

type UpdateTenantSubdomainResponse = {
  item?: {
    id?: string
    subdomain?: string | null
    portalUrl?: string | null
  }
}

type LicenseModules = {
  dashboard: boolean
  documents: boolean
  inventory: boolean
  nomenclature: boolean
  settings: boolean
  pos: boolean
  kds: boolean
  reports: boolean
}

type DynamicModuleItem = {
  code: string
  name: string
  description?: string | null
  target?: string | null
  area?: string | null
  enabled?: boolean
  limitValue?: number | null
  relationId?: string | null
  source?: string | null
  defaultEnabled?: boolean
  overrideEnabled?: boolean | null
  inheritedFrom?: string[]
}

type ClientTab = "overview" | "license" | "locations" | "users"

const defaultModules: LicenseModules = {
  dashboard: false,
  documents: false,
  inventory: false,
  nomenclature: false,
  settings: false,
  pos: false,
  kds: false,
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

type LocationFormState = {
  name: string
  country: string
  county: string
  city: string
  postalCode: string
  street: string
  streetNo: string
  building: string
  staircase: string
  floor: string
  apartment: string
  details: string
}

const emptyLocationForm = (): LocationFormState => ({
  name: "",
  country: "Romania",
  county: "",
  city: "",
  postalCode: "",
  street: "",
  streetNo: "",
  building: "",
  staircase: "",
  floor: "",
  apartment: "",
  details: "",
})

function splitLocationAddress(value?: string | null) {
  const text = String(value || "").trim()
  if (!text) {
    return {
      street: "",
      streetNo: "",
      building: "",
      staircase: "",
      floor: "",
      apartment: "",
      details: "",
    }
  }

  const nrMatch = text.match(/^(.*?)(?:,\s*)?Nr\.\s*([^,]+)(.*)$/i)
  if (!nrMatch) {
    return {
      street: text,
      streetNo: "",
      building: "",
      staircase: "",
      floor: "",
      apartment: "",
      details: "",
    }
  }

  const suffix = String(nrMatch[3] || "")
  const extract = (pattern: RegExp) => suffix.match(pattern)?.[1]?.trim() || ""

  return {
    street: nrMatch[1].trim(),
    streetNo: nrMatch[2].trim(),
    building: extract(/Bl\.\s*([^,]+)/i),
    staircase: extract(/Sc\.\s*([^,]+)/i),
    floor: extract(/Et\.\s*([^,]+)/i),
    apartment: extract(/Ap\.\s*([^,]+)/i),
    details: "",
  }
}

function buildLocationAddressSummary(location?: Partial<LocationItem> | null) {
  if (!location) return "-"
  const parsed = splitLocationAddress(location.address)
  const lineOne = [location.street || parsed.street, location.streetNo || parsed.streetNo].filter(Boolean).join(" ")
  const lineTwo = [
    (location.building || parsed.building) ? `Bl. ${location.building || parsed.building}` : "",
    (location.staircase || parsed.staircase) ? `Sc. ${location.staircase || parsed.staircase}` : "",
    (location.floor || parsed.floor) ? `Et. ${location.floor || parsed.floor}` : "",
    (location.apartment || parsed.apartment) ? `Ap. ${location.apartment || parsed.apartment}` : "",
  ]
    .filter(Boolean)
    .join(", ")
  const locality = [location.city, location.county, location.postalCode].filter(Boolean).join(", ")
  const extra = [location.details || parsed.details, location.country].filter(Boolean).join(" | ")
  return [lineOne, lineTwo, locality, extra].filter(Boolean).join(" | ") || location.address || "-"
}

function buildLocationFormFromItem(location?: Partial<LocationItem> | null): LocationFormState {
  const parsed = splitLocationAddress(location?.address)
  return {
    name: String(location?.name || ""),
    country: String(location?.country || "Romania"),
    county: String(location?.county || ""),
    city: String(location?.city || ""),
    postalCode: String(location?.postalCode || ""),
    street: String(location?.street || parsed.street || ""),
    streetNo: String(location?.streetNo || parsed.streetNo || ""),
    building: String(location?.building || parsed.building || ""),
    staircase: String(location?.staircase || parsed.staircase || ""),
    floor: String(location?.floor || parsed.floor || ""),
    apartment: String(location?.apartment || parsed.apartment || ""),
    details: String(location?.details || parsed.details || ""),
  }
}

function metricCard(label: string, value: string | number) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#17324D]">{value}</div>
    </div>
  )
}

function tabButton(label: string, selected: boolean, onClick: () => void, badge?: string | number) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
        selected
          ? "border-[#17324D] bg-[#17324D] text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      <span>{label}</span>
      {badge !== undefined ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            selected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function moduleLabelsCount(modules: LicenseModules) {
  return Object.values(modules).filter(Boolean).length
}

function moduleAreaLabel(area?: string | null) {
  switch (area) {
    case "catalog":
      return "Catalog"
    case "settings":
      return "Setari"
    case "stock":
      return "Stoc"
    case "documents":
      return "Documente"
    case "fiscal":
      return "Fiscal"
    case "reports":
      return "Rapoarte"
    case "pos":
      return "POS"
    default:
      return "Module"
  }
}

function moduleTargetLabel(target?: string | null) {
  if (target === "POS") return "POS"
  if (target === "BOTH") return "ERP + POS"
  return "ERP"
}

function moduleStatusLabel(module: DynamicModuleItem) {
  if (module.enabled && module.overrideEnabled) return "Activ explicit"
  if (module.enabled && module.defaultEnabled) return "Activ din pachet"
  if (!module.enabled && module.overrideEnabled === false) return "Oprit explicit"
  return "Inactiv"
}

export default function ControlPanelClientDetails() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [client, setClient] = useState<any | null>(null)
  const [resetPassword, setResetPassword] = useState<string | null>(null)
  const [resetForUser, setResetForUser] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [moduleBusyCode, setModuleBusyCode] = useState<string | null>(null)
  const [deletingTerminalId, setDeletingTerminalId] = useState<string | null>(null)
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null)
  const [creatingLocation, setCreatingLocation] = useState(false)
  const [creatingDeviceFor, setCreatingDeviceFor] = useState<string | null>(null)
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [exportingClient, setExportingClient] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [newLocationCompanyId, setNewLocationCompanyId] = useState("")
  const [locationForm, setLocationForm] = useState<LocationFormState>(emptyLocationForm())
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [deviceForms, setDeviceForms] = useState<Record<string, { label: string; deviceType: "POS" | "KDS" }>>({})
  const [openDeviceLocationId, setOpenDeviceLocationId] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [showCompanyForm, setShowCompanyForm] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [licenseModalOpen, setLicenseModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ClientTab>("overview")
  const [subdomainDraft, setSubdomainDraft] = useState("")
  const [savingSubdomain, setSavingSubdomain] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingClient, setDeletingClient] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")
  const [historyDateFrom, setHistoryDateFrom] = useState("")
  const [historyDateTo, setHistoryDateTo] = useState("")
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    role: "CASHIER",
    password: "",
    posPin: "",
    isActive: true,
  })
  const [companyForm, setCompanyForm] = useState({
    name: "",
    cui: "",
    regNo: "",
    address: "",
    email: "",
    phone: "",
  })
  const [licenseForm, setLicenseForm] = useState({
    expiresAt: "",
    limitLocations: 1,
    limitTerminals: 1,
    limitKdsDevices: 1,
    modules: defaultModules,
  })
  const companySectionRef = useRef<HTMLDivElement | null>(null)

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const data = await api<ClientDetailsResponse>(`/api/v1/admin/clients/${id}`)
      const item = data?.item || null
      setClient(item)
      setSubdomainDraft(String(item?.subdomain || ""))
      setLicenseForm({
        expiresAt: toInputDate(item?.license?.expiresAt),
        limitLocations: Number(item?.license?.limits?.locations ?? 1),
        limitTerminals: Number(item?.license?.limits?.terminals ?? 1),
        limitKdsDevices: Number(item?.license?.limits?.kdsDevices ?? 1),
        modules: {
          dashboard: Boolean(item?.license?.modules?.dashboard),
          documents: Boolean(item?.license?.modules?.documents),
          inventory: Boolean(item?.license?.modules?.inventory),
          nomenclature: Boolean(item?.license?.modules?.nomenclature),
          settings: Boolean(item?.license?.modules?.settings),
          pos: Boolean(item?.license?.modules?.pos),
          kds: Boolean(item?.license?.modules?.kds),
          reports: Boolean(item?.license?.modules?.reports),
        },
      })
      setNewLocationCompanyId((item?.companies || []).find((company: any) => company?.isDefault)?.id || item?.companies?.[0]?.id || "")
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca detaliile clientului.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  useEffect(() => {
    if (searchParams.get("adaugaFirma") !== "1") return
    setShowCompanyForm(true)
    window.setTimeout(() => {
      companySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }, [searchParams])

  const users = Array.isArray(client?.users) ? (client.users as User[]) : []
  const locations = Array.isArray(client?.locations) ? (client.locations as LocationItem[]) : []
  const auditLogs = Array.isArray(client?.auditLogs) ? (client.auditLogs as AuditLogItem[]) : []
  const companies = Array.isArray(client?.companies) ? client.companies : []
  const dynamicModules = Array.isArray(client?.dynamicModules) ? (client.dynamicModules as DynamicModuleItem[]) : []
  const devices = locations.flatMap((location) => (Array.isArray(location.devices) ? location.devices : []))
  const posDevicesCount = devices.filter((device) => (device.deviceType || "POS") === "POS").length
  const kdsDevicesCount = devices.filter((device) => (device.deviceType || "POS") === "KDS").length
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
  const usersByCompany = useMemo(() => {
    return companies.map((company: any) => {
      const assignedUsers = users.filter((user) => {
        if (user.role === "OWNER" || user.role === "ADMIN") return true
        return Array.isArray(user.companies) && user.companies.some((entry) => entry.id === company.id)
      })

      return {
        company,
        users: assignedUsers,
      }
    })
  }, [companies, users])
  const enabledDynamicModules = dynamicModules.filter((module) => module.enabled).length
  const enabledCoreModules = moduleLabelsCount(licenseForm.modules)
  const explicitlyEnabledDynamicModules = dynamicModules.filter((module) => module.enabled && module.overrideEnabled).length
  const inheritedDynamicModules = dynamicModules.filter(
    (module) => module.enabled && module.defaultEnabled && !module.overrideEnabled,
  ).length
  const totalEnabledModules = enabledCoreModules + enabledDynamicModules
  const groupedDynamicModules = useMemo(() => {
    const groups = new Map<string, DynamicModuleItem[]>()
    for (const module of dynamicModules) {
      const key = module.area || "other"
      const list = groups.get(key) || []
      list.push(module)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
      .map(([area, items]) => ({
        area,
        label: moduleAreaLabel(area),
        items: [...items].sort((left, right) => left.name.localeCompare(right.name, "ro")),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ro"))
  }, [dynamicModules])
  const canDeleteClient = client?.status && client.status !== "active"
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((entry) => {
      const normalized = historyQuery.trim().toLowerCase()
      const matchesQuery =
        !normalized ||
        [getAuditActorLabel(entry), getAuditActionLabel(entry), getAuditArea(entry)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized)

      const createdAt = new Date(entry.createdAt)
      if (Number.isNaN(createdAt.getTime())) return matchesQuery

      const afterStart = historyDateFrom ? createdAt >= new Date(`${historyDateFrom}T00:00:00`) : true
      const beforeEnd = historyDateTo ? createdAt <= new Date(`${historyDateTo}T23:59:59.999`) : true

      return matchesQuery && afterStart && beforeEnd
    })
  }, [auditLogs, historyDateFrom, historyDateTo, historyQuery])

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
      posPin: "",
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
      posPin: "",
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
            posPin: userForm.posPin.trim() || undefined,
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
            posPin: userForm.posPin.trim() || undefined,
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

  async function handleCreateCompany() {
    if (!id) return
    if (!companyForm.name.trim()) {
      setCompanyError("Completeaza numele firmei.")
      return
    }

    try {
      setCreatingCompany(true)
      setCompanyError(null)
      setError(null)
      await api<CreateCompanyResponse>(`/api/v1/admin/clients/${id}/companies`, {
        method: "POST",
        body: JSON.stringify(companyForm),
      })
      setCompanyForm({
        name: "",
        cui: "",
        regNo: "",
        address: "",
        email: "",
        phone: "",
      })
      setShowCompanyForm(false)
      if (searchParams.get("adaugaFirma") === "1") {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete("adaugaFirma")
        setSearchParams(nextParams, { replace: true })
      }
      setMessage("Firma suplimentara a fost adaugata.")
      await load()
    } catch (err: any) {
      setCompanyError(err?.message || "Nu am putut adauga firma.")
    } finally {
      setCreatingCompany(false)
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
          limitKdsDevices: licenseForm.limitKdsDevices,
          modules: licenseForm.modules,
        }),
      })
      setMessage("Licenta a fost actualizata.")
      await load()
      return true
    } catch (err: any) {
      setError(err?.message || "Nu am putut actualiza licenta.")
      return false
    } finally {
      setLicenseBusy(false)
    }
  }

  async function handleSaveSubdomain() {
    if (!id) return
    const nextSubdomain = subdomainDraft.trim()
    if (!nextSubdomain) {
      setError("Completeaza subdomeniul clientului.")
      return
    }

    try {
      setSavingSubdomain(true)
      setError(null)
      const response = await api<UpdateTenantSubdomainResponse>(`/api/v1/admin/clients/${id}/subdomain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: nextSubdomain }),
      })

      setClient((prev: any) =>
        prev
          ? {
              ...prev,
              subdomain: response?.item?.subdomain || nextSubdomain,
              portalUrl: response?.item?.portalUrl || null,
              slug: response?.item?.subdomain || prev.slug,
            }
          : prev,
      )
      setSubdomainDraft(response?.item?.subdomain || nextSubdomain)
      setMessage("Subdomeniul clientului a fost salvat.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva subdomeniul clientului.")
    } finally {
      setSavingSubdomain(false)
    }
  }

  async function handleDeleteClient() {
    if (!id) return

    try {
      setDeletingClient(true)
      setError(null)
      await api(`/api/v1/admin/clients/${id}`, {
        method: "DELETE",
      })
      navigate("/control-panel/clienti", { replace: true })
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge clientul.")
    } finally {
      setDeletingClient(false)
      setDeleteDialogOpen(false)
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

  async function handleToggleDynamicModule(module: DynamicModuleItem) {
    if (!id || !module?.code) return
    try {
      setModuleBusyCode(module.code)
      setError(null)
      await api(`/api/v1/admin/clients/${id}/modules/${module.code}`, {
        method: "POST",
        body: JSON.stringify({ enabled: !module.enabled }),
      })
      setMessage(module.enabled ? `Modulul ${module.name} a fost dezactivat.` : `Modulul ${module.name} a fost activat.`)
      await load()
    } catch (err: any) {
      setError(err?.message || `Nu am putut actualiza modulul ${module.name}.`)
    } finally {
      setModuleBusyCode(null)
    }
  }

  async function handleCreateLocation() {
    if (!id) return
    const name = locationForm.name.trim()
    if (!name) {
      setLocationError("Introdu numele locatiei.")
      return
    }
    if (!newLocationCompanyId) {
      setLocationError("Selecteaza firma pentru care vrei sa creezi locatia.")
      return
    }
    try {
      setCreatingLocation(true)
      setLocationError(null)
      await api<CreateLocationResponse>(`/api/v1/admin/clients/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({
          name,
          companyId: newLocationCompanyId,
          country: locationForm.country.trim() || "Romania",
          county: locationForm.county.trim(),
          city: locationForm.city.trim(),
          postalCode: locationForm.postalCode.trim(),
          street: locationForm.street.trim(),
          streetNo: locationForm.streetNo.trim(),
          building: locationForm.building.trim(),
          staircase: locationForm.staircase.trim(),
          floor: locationForm.floor.trim(),
          apartment: locationForm.apartment.trim(),
          details: locationForm.details.trim(),
        }),
      })
      setLocationForm(emptyLocationForm())
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
    const deviceType = deviceForms[locationId]?.deviceType || "POS"
    if (!label) {
      setDeviceError("Introdu label-ul device-ului.")
      return
    }
    try {
      setCreatingDeviceFor(locationId)
      setDeviceError(null)
      const res = await api<CreateDeviceResponse>(`/api/v1/admin/locations/${locationId}/devices`, {
        method: "POST",
        body: JSON.stringify({ label, deviceType }),
      })
      setMessage(`Device-ul ${deviceType} a fost generat pentru ${locationName}.`)
      setCopyMessage(null)
      setResetPassword(res?.item?.licenseKey || res?.item?.deviceId || null)
      setResetForUser(res?.item?.label || label)
      setDeviceForms((prev) => ({ ...prev, [locationId]: { label: "", deviceType: "POS" } }))
      setOpenDeviceLocationId(null)
      await load()
    } catch (err: any) {
      setDeviceError(err?.message || "Nu am putut crea device-ul.")
    } finally {
      setCreatingDeviceFor(null)
    }
  }

  async function handleDeleteTerminal(terminalId: string, terminalLabel: string) {
    if (!window.confirm(`Stergi device-ul "${terminalLabel}"?`)) return
    try {
      setDeletingTerminalId(terminalId)
      setError(null)
      await api(`/api/v1/admin/terminals/${terminalId}`, { method: "DELETE" })
      setMessage("Device-ul a fost sters.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge device-ul.")
    } finally {
      setDeletingTerminalId(null)
    }
  }

  function beginEditTerminal(device: LocationDevice) {
    setDeviceError(null)
    setEditingDeviceId(device.id)
    setDeviceForms((prev) => ({
      ...prev,
      [device.id]: {
        label: String(device.label || device.deviceId || "").trim(),
        deviceType: (String(device.deviceType || "POS").toUpperCase() === "KDS" ? "KDS" : "POS") as "POS" | "KDS",
      },
    }))
  }

  async function handleUpdateTerminal(device: LocationDevice) {
    const form = deviceForms[device.id]
    const label = (form?.label || "").trim()
    const deviceType = form?.deviceType || "POS"
    if (!label) {
      setDeviceError("Introdu label-ul device-ului.")
      return
    }

    try {
      setSavingDeviceId(device.id)
      setDeviceError(null)
      try {
        await api<UpdateDeviceResponse>(`/api/v1/admin/terminals/${device.id}`, {
          method: "PATCH",
          body: JSON.stringify({ label, deviceType }),
        })
      } catch (err) {
        if (!isRouteMissingError(err)) throw err
        await api<UpdateDeviceResponse>(`/api/v1/admin/terminals/${device.id}/update`, {
          method: "POST",
          body: JSON.stringify({ label, deviceType }),
        })
      }
      setMessage("Device-ul a fost actualizat.")
      setEditingDeviceId(null)
      await load()
    } catch (err: any) {
      setDeviceError(err?.message || "Nu am putut actualiza device-ul.")
    } finally {
      setSavingDeviceId(null)
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
    ["kds", "KDS"],
    ["reports", "Rapoarte"],
  ]

  function openCompanyForm() {
    setShowCompanyForm(true)
    window.setTimeout(() => {
      companySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }

  async function handleUpdateLocation() {
    if (!editingLocationId) return
    const name = locationForm.name.trim()
    if (!name) {
      setLocationError("Introdu numele locatiei.")
      return
    }
    if (!newLocationCompanyId) {
      setLocationError("Selecteaza firma pentru care vrei sa actualizezi locatia.")
      return
    }
    try {
      setCreatingLocation(true)
      setLocationError(null)
      await api<CreateLocationResponse>(`/api/v1/admin/locations/${editingLocationId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          companyId: newLocationCompanyId,
          country: locationForm.country.trim() || "Romania",
          county: locationForm.county.trim(),
          city: locationForm.city.trim(),
          postalCode: locationForm.postalCode.trim(),
          street: locationForm.street.trim(),
          streetNo: locationForm.streetNo.trim(),
          building: locationForm.building.trim(),
          staircase: locationForm.staircase.trim(),
          floor: locationForm.floor.trim(),
          apartment: locationForm.apartment.trim(),
          details: locationForm.details.trim(),
        }),
      })
      setMessage("Locatia a fost actualizata.")
      closeLocationModal()
      await load()
    } catch (err: any) {
      setLocationError(err?.message || "Nu am putut actualiza locatia.")
    } finally {
      setCreatingLocation(false)
    }
  }

  function openCreateLocationModal() {
    setEditingLocationId(null)
    setLocationError(null)
    setLocationForm(emptyLocationForm())
    setLocationModalOpen(true)
  }

  function openEditLocationModal(location: LocationItem) {
    setEditingLocationId(location.id)
    setNewLocationCompanyId(location.companyId || location.company?.id || "")
    setLocationError(null)
    setLocationForm(buildLocationFormFromItem(location))
    setLocationModalOpen(true)
  }

  function closeLocationModal() {
    setLocationModalOpen(false)
    setEditingLocationId(null)
    setLocationError(null)
    setLocationForm(emptyLocationForm())
  }

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
          <div className="mt-2 text-xs text-slate-500">
            {client?.portalUrl || "Portalul clientului apare dupa salvarea subdomeniului."}
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
            Reincarca
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            <History size={15} />
            Istoric
          </button>
          <button
            type="button"
            onClick={openCompanyForm}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0F2740] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={15} />
            Adauga firma
          </button>
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={!canDeleteClient || deletingClient}
            className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} />
            Sterge client
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricCard("Utilizatori", client?.usersCount ?? users.length)}
        {metricCard("Locatii", client?.locationsCount ?? locations.length)}
        {metricCard("POS", posDevicesCount)}
        {metricCard("KDS", kdsDevicesCount)}
        {metricCard("Backup-uri", client?.backupHealth?.backupsCount ?? 0)}
      </section>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {locationError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{locationError}</div> : null}
      {deviceError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{deviceError}</div> : null}
      {copyMessage ? <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{copyMessage}</div> : null}
      {userError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{userError}</div> : null}
      {companyError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{companyError}</div> : null}
      {client?.backupHealth?.status !== "protected" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Acest client nu are backup valid de tenant pe server. Recovery-ul este nesigur pana nu exista un snapshot disponibil.
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Ultimul backup valid: {formatDate(client?.backupHealth?.latestBackupAt)}  -  snapshot-uri totale {client?.backupHealth?.backupsCount ?? 0}
        </div>
      )}

      <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Control panel client</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Navighezi rapid intre overview, licenta, locatii si utilizatori</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabButton("General", activeTab === "overview", () => setActiveTab("overview"))}
            {tabButton("Licenta", activeTab === "license", () => setActiveTab("license"), totalEnabledModules)}
            {tabButton("Locatii", activeTab === "locations", () => setActiveTab("locations"), locations.length)}
            {tabButton("Utilizatori", activeTab === "users", () => setActiveTab("users"), users.length)}
          </div>
        </div>
      </section>

      {activeTab === "overview" ? (
        <div ref={companySectionRef} className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Profil client</div>
                  <div className="mt-1 text-base font-semibold text-[#17324D]">Date comerciale, portal si identificare</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-4 lg:w-[520px]">
                  {metricCard("Status", statusLabel(client?.status))}
                  {metricCard("Expira", formatDate(client?.license?.expiresAt))}
                  {metricCard("Firme ERP", companies.length)}
                  {metricCard("Backup-uri", client?.backupHealth?.backupsCount ?? 0)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 xl:grid-cols-3">
                {infoRows.map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-medium text-slate-800">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Subdomeniu</div>
                      <div className="mt-1 text-sm font-semibold text-[#17324D]">Legatura directa catre portalul clientului</div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {subdomainDraft.trim() || "fara-subdomeniu"}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={subdomainDraft}
                      onChange={(e) => setSubdomainDraft(e.target.value)}
                      placeholder="subdomeniu-client"
                      className="h-10 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveSubdomain}
                      disabled={savingSubdomain}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#17324D] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save size={15} />
                      {savingSubdomain ? "Se salveaza..." : "Salveaza"}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Portal client</div>
                  <div className="mt-1 text-sm font-semibold text-[#17324D]">Acces, export si operare rapida</div>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                    {client?.portalUrl || "Portalul clientului apare dupa salvarea subdomeniului."}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copy(client?.portalUrl || "", "URL portal")}
                      disabled={!client?.portalUrl}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Copy size={15} />
                      Copiaza URL
                    </button>
                    <button
                      type="button"
                      onClick={handleExportClient}
                      disabled={exportingClient || loading}
                      className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download size={15} />
                      {exportingClient ? "Se pregateste..." : "Export client"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(true)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    >
                      <History size={15} />
                      Istoric
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Firme ERP</div>
                  <div className="mt-1 text-base font-semibold text-[#17324D]">Lista simpla si control rapid pe firme</div>
                </div>
                <button
                  type="button"
                  onClick={openCompanyForm}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0F2740]"
                >
                  <Plus size={15} />
                  Adauga firma
                </button>
              </div>

              {showCompanyForm ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <input
                      value={companyForm.name}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Nume firma"
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <input
                      value={companyForm.cui}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, cui: e.target.value }))}
                      placeholder="CUI"
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <input
                      value={companyForm.regNo}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, regNo: e.target.value }))}
                      placeholder="Nr. reg. com."
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <input
                      value={companyForm.email}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="Email"
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <input
                      value={companyForm.phone}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="Telefon"
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <input
                      value={companyForm.address}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Adresa"
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCompanyForm(false)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
                    >
                      Inchide
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCompany}
                      disabled={creatingCompany}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save size={15} />
                      {creatingCompany ? "Se salveaza..." : "Salveaza firma"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[minmax(0,1.5fr)_120px_180px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  <div>Firma</div>
                  <div>CUI</div>
                  <div>Email</div>
                  <div>Status</div>
                </div>
                {companies.length ? (
                  <div className="max-h-[260px] overflow-auto">
                    {companies.map((company: any) => (
                      <div
                        key={company.id}
                        className="grid grid-cols-[minmax(0,1.5fr)_120px_180px_110px] gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[#17324D]">{company.name}</div>
                          <div className="truncate text-xs text-slate-500">{company.code || "Firma ERP"}</div>
                        </div>
                        <div className="text-slate-600">{company.cui || "-"}</div>
                        <div className="truncate text-slate-600">{company.email || "-"}</div>
                        <div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${company.isDefault ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                          >
                            {company.isDefault ? "Implicita" : "Activa"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-500">Nu exista firme configurate pentru acest client.</div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-3">
            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Licenta si module</div>
                  <div className="mt-1 text-base font-semibold text-[#17324D]">Pachete active si module vandabile</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
                  <div>{erpEnabled ? "ERP activ" : "ERP inactiv"}</div>
                  <div className="mt-1">{enabledDynamicModules} module fine active</div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {metricCard("Pachete baza", enabledCoreModules)}
                {metricCard("Module fine", enabledDynamicModules)}
                {metricCard("Locatii incluse", licenseForm.limitLocations)}
                {metricCard("POS incluse", licenseForm.limitTerminals)}
                {metricCard("KDS incluse", licenseForm.limitKdsDevices)}
                {metricCard("Utilizatori", client?.usersCount ?? users.length)}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {moduleLabels.map(([key, label]) => {
                  const enabled = Boolean(licenseForm.modules[key])
                  return (
                    <span
                      key={key}
                      className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${enabled ? "border-[#17324D] bg-[#17324D] text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}
                    >
                      {label}
                    </span>
                  )
                })}
              </div>

              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                {groupedDynamicModules.map((group) => (
                  <div key={group.area} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#17324D]">{group.label}</div>
                      <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        {group.items.filter((item) => item.enabled).length}/{group.items.length}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.items.map((module) => (
                        <div
                          key={module.code}
                          className={`rounded-2xl border px-3 py-2 text-xs ${module.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
                        >
                          <div className="font-semibold">{module.name}</div>
                          <div className="mt-1 text-[11px] opacity-80">
                            {moduleTargetLabel(module.target)} | {moduleStatusLabel(module)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div className="text-sm text-slate-500">
                  {explicitlyEnabledDynamicModules} explicit si {inheritedDynamicModules} mostenite din pachet.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("license")
                    setLicenseModalOpen(true)
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <Pencil size={15} />
                  Configureaza licenta
                </button>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Operare rapida</div>
              <div className="mt-1 text-base font-semibold text-[#17324D]">Actiuni uzuale pentru acest client</div>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
                >
                  <RefreshCw size={15} />
                  Reincarca datele clientului
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
                >
                  <History size={15} />
                  Deschide istoricul
                </button>
                <button
                  type="button"
                  onClick={handleToggleLicenseSuspended}
                  disabled={!client?.license?.id || licenseBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PauseCircle size={15} />
                  {client?.license?.isSuspended ? "Reactiveaza licenta" : "Suspenda licenta"}
                </button>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Backup si siguranta</div>
              <div className="mt-1 text-base font-semibold text-[#17324D]">Stare backup si actiuni sensibile</div>

              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {metricCard("Ultimul backup", formatDate(client?.backupHealth?.latestBackupAt))}
                  {metricCard("Snapshot-uri", client?.backupHealth?.backupsCount ?? 0)}
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {client?.backupHealth?.status === "protected"
                    ? "Clientul are backup valid pe server."
                    : "Clientul nu are backup valid. Recovery-ul nu este sigur pana nu exista un snapshot."}
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-rose-800">Stergerea clientului</div>
                    <div className="mt-1 text-sm text-rose-700">
                      Sistemul face backup final, apoi sterge tenantul si datele operationale.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={!canDeleteClient || deletingClient}
                    className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                    Sterge client
                  </button>
                </div>

                {!canDeleteClient ? (
                  <div className="mt-3 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">
                    Clientul este activ. Suspenda sau lasa licenta sa expire inainte de stergere.
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}
      {activeTab === "license" ? (
        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Licenta</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Stare curenta pentru ERP, POS, KDS si module</div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {metricCard("Expirare", formatDate(client?.license?.expiresAt))}
              {metricCard("Status", client?.license?.isSuspended ? "Suspendat" : "Activ")}
              {metricCard("Locatii", licenseForm.limitLocations)}
              {metricCard("POS", licenseForm.limitTerminals)}
              {metricCard("KDS", licenseForm.limitKdsDevices)}
              {metricCard("Module fine", enabledDynamicModules)}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Actiuni rapide</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLicenseModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <Pencil size={15} />
                  Editeaza licenta
                </button>
                <button
                  type="button"
                  onClick={handleToggleLicenseSuspended}
                  disabled={!client?.license?.id || licenseBusy}
                  className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PauseCircle size={15} />
                  {client?.license?.isSuspended ? "Reactiveaza" : "Suspenda licenta"}
                </button>
                <button
                  type="button"
                  onClick={() => setLicenseModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Module fine
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Module vandute</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Vezi rapid ce vine din pachet si ce ai activat special pe client</div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Pachete baza</div>
                <div className="mt-3 grid gap-2">
                  {moduleLabels.map(([key, label]) => {
                    const enabled = Boolean(licenseForm.modules[key])
                    return (
                      <div
                        key={key}
                        className={`rounded-2xl border px-3 py-3 text-sm font-medium ${
                          enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-500"
                        }`}
                      >
                        {label}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Module fine</div>
                  <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    {enabledDynamicModules}/{dynamicModules.length}
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {groupedDynamicModules.map((group) => (
                    <div key={group.area}>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{group.label}</div>
                      <div className="grid gap-2">
                        {group.items.map((module) => (
                          <div
                            key={module.code}
                            className={`rounded-2xl border px-3 py-3 ${
                              module.enabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-500"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium">{module.name}</div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
                                {moduleTargetLabel(module.target)}
                              </div>
                            </div>
                            <div className="mt-1 text-xs opacity-80">{moduleStatusLabel(module)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "locations" ? (
      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatii si device-uri</div><div className="mt-1 text-sm font-semibold text-[#17324D]">Administrare locatii, device-uri POS / KDS si chei de licenta</div></div>
            <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={openCreateLocationModal}
              disabled={creatingLocation}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={15} />
              Adauga locatie
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="text-sm text-slate-400">Se incarca...</div>
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
                        {location.company?.name ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {location.company.name}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[location.code || "-", location.company?.code || null, `${location.devices?.length || 0} device-uri`].filter(Boolean).join(" | ")}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{buildLocationAddressSummary(location)}</div>
                    </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => openEditLocationModal(location)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setOpenDeviceLocationId(openDeviceLocationId === location.id ? null : location.id)
                        setDeviceForms((prev) => ({ ...prev, [location.id]: prev[location.id] || { label: "", deviceType: "POS" } }))
                      }}
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
                        setDeviceForms((prev) => ({ ...prev, [location.id]: { ...(prev[location.id] || { deviceType: "POS" }), label: e.target.value } }))
                      }
                      placeholder="Label device"
                      className="h-10 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                    <select
                      value={deviceForms[location.id]?.deviceType || "POS"}
                      onChange={(e) =>
                        setDeviceForms((prev) => ({
                          ...prev,
                          [location.id]: { ...(prev[location.id] || { label: "" }), deviceType: e.target.value as "POS" | "KDS" },
                        }))
                      }
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    >
                      <option value="POS">POS</option>
                      <option value="KDS">KDS</option>
                    </select>
                    <button
                      type="button"
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
                          <th className="px-2 py-2 text-left font-semibold">Tip</th>
                          <th className="px-2 py-2 text-left font-semibold">Licenta</th>
                          <th className="px-2 py-2 text-left font-semibold">Creat</th>
                          <th className="px-2 py-2 text-left font-semibold">Actiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {location.devices.map((device) => (
                            <tr key={device.id} className="border-t border-slate-200">
                              <td className="px-2 py-2 text-slate-800">
                                {editingDeviceId === device.id ? (
                                  <input
                                    value={deviceForms[device.id]?.label || ""}
                                    onChange={(e) =>
                                      setDeviceForms((prev) => ({
                                        ...prev,
                                        [device.id]: {
                                          ...(prev[device.id] || {
                                            label: String(device.label || device.deviceId || "").trim(),
                                            deviceType: (String(device.deviceType || "POS").toUpperCase() === "KDS" ? "KDS" : "POS") as "POS" | "KDS",
                                          }),
                                          label: e.target.value,
                                        },
                                      }))
                                    }
                                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                                  />
                                ) : (
                                  <div className="font-medium">{device.label || device.deviceId || "-"}</div>
                                )}
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <span>{device.company?.name || "Device activ"}</span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {(editingDeviceId === device.id ? deviceForms[device.id]?.deviceType : device.deviceType) || "POS"}
                                  </span>
                                </div>
                              </td>
                            <td className="px-2 py-2 text-slate-600">
                              {editingDeviceId === device.id ? (
                                <select
                                  value={deviceForms[device.id]?.deviceType || "POS"}
                                  onChange={(e) =>
                                    setDeviceForms((prev) => ({
                                      ...prev,
                                      [device.id]: {
                                        ...(prev[device.id] || {
                                          label: String(device.label || device.deviceId || "").trim(),
                                          deviceType: "POS",
                                        }),
                                        deviceType: e.target.value as "POS" | "KDS",
                                      },
                                    }))
                                  }
                                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                                >
                                  <option value="POS">POS</option>
                                  <option value="KDS">KDS</option>
                                </select>
                              ) : (
                                device.deviceType || "POS"
                              )}
                            </td>
                            <td className="px-2 py-2 font-mono text-slate-600">{device.licenseKey || device.deviceId || "-"}</td>
                            <td className="px-2 py-2 text-slate-500">{formatDate(device.createdAt)}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-2">
                                {editingDeviceId === device.id ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateTerminal(device)}
                                      disabled={savingDeviceId === device.id}
                                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <Save size={12} />
                                      {savingDeviceId === device.id ? "..." : "Salveaza"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingDeviceId(null)}
                                      disabled={savingDeviceId === device.id}
                                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Anuleaza
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => beginEditTerminal(device)}
                                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                                  >
                                    <Pencil size={12} />
                                    Edit
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => copy(device.licenseKey || device.deviceId || "", "Licenta")}
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                                >
                                  <Copy size={12} />
                                  Copiaza
                                </button>
                                <button
                                  type="button"
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
      ) : null}

      {activeTab === "users" ? (
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
                            <option value="OWNER">Proprietar</option>
                            <option value="ADMIN">Administrator</option>
                            <option value="MANAGER">Manager</option>
                            <option value="CASHIER">Ospatar / Casier</option>
                            <option value="WAREHOUSE">Magazioner</option>
                            <option value="CHEF">Bucatar</option>
                            <option value="KITCHEN_HELPER">Ajutor bucatar</option>
                            <option value="KITCHEN_OPERATOR">Operator bucatarie</option>
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

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">PIN acces POS / KDS</div>
              <input
                value={userForm.posPin}
                onChange={(e) => setUserForm((prev) => ({ ...prev, posPin: e.target.value }))}
                placeholder={editingUserId ? "Lasa gol daca il pastrezi" : "Ex: 1234"}
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
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Rezumat client</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Plan, facturare si contact principal</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {metricCard("Plan", client?.subscription?.plan?.name || "-")}
            {metricCard("Pret", currencyFormat(client?.subscription?.price, client?.subscription?.currency))}
            {metricCard("Facturare", client?.subscription?.billingStatus || "-")}
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
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">Se incarca...</td>
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
                      <td className="px-4 py-3 text-slate-600">
                        <div>{({ OWNER: "Proprietar", ADMIN: "Administrator", MANAGER: "Manager", CASHIER: "Ospatar / Casier", WAREHOUSE: "Magazioner", CHEF: "Bucatar", KITCHEN_HELPER: "Ajutor bucatar", KITCHEN_OPERATOR: "Operator bucatarie" } as Record<string, string>)[user.role] || user.role}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {user.role === "OWNER" || user.role === "ADMIN" ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              Toate firmele
                            </span>
                          ) : Array.isArray(user.companies) && user.companies.length ? (
                            user.companies.map((company) => (
                              <span key={`${user.id}-${company.id}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                {company.name}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                              Fara firme alocate
                            </span>
                          )}
                        </div>
                      </td>
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
      ) : null}

      {resetPassword ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-blue-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Credentiale</div>
                <div className="mt-1 text-lg font-semibold text-[#17324D]">{resetForUser || "Credentiale generate"}</div>
                <div className="mt-1 text-sm text-slate-500">Parola sau cheia generata este afisata o singura data. Copiaz-o acum.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResetPassword(null)
                  setResetForUser(null)
                }}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
              >
                Inchide
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
              <div className="font-mono text-sm text-blue-900 break-all">{resetPassword}</div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => copy(resetPassword, "Valoare")}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Copy size={14} />
                Copiaza
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {licenseModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Licenta si module</div>
                <div className="mt-1 text-xl font-semibold text-[#17324D]">Configurezi pachetul de baza si modulele fine ale clientului</div>
                <div className="mt-1 text-sm text-slate-500">Intai stabilesti pachetul mare, apoi activezi sau opresti modulele concrete pe care le vinzi clientului.</div>
              </div>
              <button
                type="button"
                onClick={() => setLicenseModalOpen(false)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
              >
                Inchide
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
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
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatii</div>
                <input
                  type="number"
                  min={1}
                  value={licenseForm.limitLocations}
                  onChange={(e) => setLicenseForm((prev) => ({ ...prev, limitLocations: Number(e.target.value || 1) }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">POS</div>
                <input
                  type="number"
                  min={1}
                  value={licenseForm.limitTerminals}
                  onChange={(e) => setLicenseForm((prev) => ({ ...prev, limitTerminals: Number(e.target.value || 1) }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">KDS</div>
                <input
                  type="number"
                  min={1}
                  value={licenseForm.limitKdsDevices}
                  onChange={(e) => setLicenseForm((prev) => ({ ...prev, limitKdsDevices: Number(e.target.value || 1) }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </label>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {groupedDynamicModules.map((group) => (
                <div key={group.area} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#17324D]">{group.label}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {group.items.filter((item) => item.enabled).length} din {group.items.length} active
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                      {group.items.filter((item) => item.overrideEnabled).length} explicite
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {group.items.map((module) => (
                      <button
                        key={module.code}
                        type="button"
                        onClick={() => handleToggleDynamicModule(module)}
                        disabled={moduleBusyCode === module.code}
                        className={`rounded-2xl border px-3 py-3 text-left transition ${
                          module.enabled
                            ? "border-[#F39C12]/40 bg-[#FFF1D6] text-[#17324D]"
                            : "border-slate-200 bg-white text-slate-700"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">
                              {moduleBusyCode === module.code ? "Se actualizeaza..." : module.name}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{module.description || "Modul configurabil pe client."}</div>
                          </div>
                          <div className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
                            {moduleTargetLabel(module.target)}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                          <span>{moduleStatusLabel(module)}</span>
                          {Array.isArray(module.inheritedFrom) && module.inheritedFrom.length ? (
                            <span className="text-slate-400">Din: {module.inheritedFrom.join(", ")}</span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleToggleLicenseSuspended}
                disabled={!client?.license?.id || licenseBusy}
                className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PauseCircle size={15} />
                {client?.license?.isSuspended ? "Reactiveaza licenta" : "Suspenda licenta"}
              </button>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLicenseModalOpen(false)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
                >
                  Renunta
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleSaveLicense()
                    if (ok) setLicenseModalOpen(false)
                  }}
                  disabled={licenseBusy}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={15} />
                  {licenseBusy ? "Se salveaza..." : "Salveaza licenta"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {locationModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatie</div>
                <div className="mt-1 text-xl font-semibold text-[#17324D]">
                  {editingLocationId ? "Editeaza locatia" : "Adauga locatie noua"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Salvezi o singura data adresa completa, iar apoi o poti refolosi in ERP si e-Transport.
                </div>
              </div>
              <button
                type="button"
                onClick={closeLocationModal}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
              >
                Inchide
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <select
                value={newLocationCompanyId}
                onChange={(e) => setNewLocationCompanyId(e.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              >
                <option value="">Selecteaza firma</option>
                {companies.map((company: any) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <input
                value={locationForm.name}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nume locatie"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.country}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, country: e.target.value }))}
                placeholder="Tara"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.county}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, county: e.target.value }))}
                placeholder="Judet"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.city}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="Oras / Localitate"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.postalCode}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, postalCode: e.target.value }))}
                placeholder="Cod postal"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.street}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, street: e.target.value }))}
                placeholder="Strada"
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.streetNo}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, streetNo: e.target.value }))}
                placeholder="Nr."
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.building}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, building: e.target.value }))}
                placeholder="Bl."
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.staircase}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, staircase: e.target.value }))}
                placeholder="Sc."
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.floor}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, floor: e.target.value }))}
                placeholder="Et."
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
              <input
                value={locationForm.apartment}
                onChange={(e) => setLocationForm((prev) => ({ ...prev, apartment: e.target.value }))}
                placeholder="Ap."
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
              />
            </div>

            <textarea
              value={locationForm.details}
              onChange={(e) => setLocationForm((prev) => ({ ...prev, details: e.target.value }))}
              placeholder="Detalii suplimentare"
              rows={3}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
            />

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={closeLocationModal}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                Renunta
              </button>
              <button
                type="button"
                onClick={editingLocationId ? handleUpdateLocation : handleCreateLocation}
                disabled={creatingLocation}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={15} />
                {creatingLocation ? "Se salveaza..." : editingLocationId ? "Salveaza modificarile" : "Adauga locatia"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="font-semibold">Atentie:</span> locatia se poate sterge doar daca nu are device-uri POS.
      </div>

      {principalUser?.email ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          Contact principal: {principalUser.email}
        </div>
      ) : null}

      {deleteDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">Confirmare stergere</div>
            <div className="mt-1 text-xl font-semibold text-[#17324D]">Stergi definitiv clientul din platforma</div>
            <div className="mt-2 text-sm text-slate-600">
              Se creeaza automat un backup final, apoi se sterg tenantul, firmele, utilizatorii, locatiile si datele operationale ale clientului.
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div><span className="font-semibold">Client:</span> {client?.company?.name || client?.name || "-"}</div>
              <div className="mt-1"><span className="font-semibold">Status:</span> {statusLabel(client?.status)}</div>
            </div>

            {!canDeleteClient ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Clientul este activ si nu poate fi sters.
              </div>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(false)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                Renunta
              </button>
              <button
                type="button"
                onClick={handleDeleteClient}
                disabled={!canDeleteClient || deletingClient}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={15} />
                {deletingClient ? "Se sterge..." : "Sterge definitiv"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Istoric client</div>
                <div className="mt-1 text-lg font-semibold text-[#17324D]">Activitatea din ERP pentru acest client</div>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Inchide
              </button>
            </div>

            <div className="max-h-[72vh] overflow-auto">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder="Cauta dupa nume, actiune sau zona"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                    />
                  </div>
                  <input
                    type="date"
                    value={historyDateFrom}
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                    className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  />
                  <input
                    type="date"
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
                    className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <div className="inline-flex items-center gap-2">
                    <Filter size={13} />
                    {filteredAuditLogs.length} evenimente afisate
                  </div>
                  <button
                    onClick={() => {
                      setHistoryQuery("")
                      setHistoryDateFrom("")
                      setHistoryDateTo("")
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600"
                  >
                    Reseteaza filtrele
                  </button>
                </div>
              </div>

              {filteredAuditLogs.length === 0 ? (
                <div className="px-5 py-8 text-sm text-slate-500">Nu exista evenimente in istoric.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredAuditLogs.map((entry) => (
                    <div key={entry.id} className="grid gap-3 px-5 py-3 lg:grid-cols-[220px_minmax(0,1fr)_180px] lg:items-start">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{getAuditActorLabel(entry)}</div>
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#17324D]">{getAuditActionLabel(entry)}</div>
                        <div className="mt-1 text-sm text-slate-600">{getAuditArea(entry)}</div>
                      </div>

                      <div className="text-sm text-slate-500 lg:text-right">{formatAuditDateTime(entry.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
