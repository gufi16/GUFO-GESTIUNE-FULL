import { FormEvent, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Building2,
  Check,
  Copy,
  Crown,
  ExternalLink,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Store,
  X,
} from "lucide-react"
import { api } from "../../lib/api"
import { controlLogout, controlMe } from "../../lib/controlAuth"

type AdminClientItem = {
  id: string
  name: string
  slug: string
  subdomain?: string | null
  portalUrl?: string | null
  status: "active" | "suspended" | "expired" | "inactive"
  createdAt: string
  usersCount: number
  locationsCount: number
  terminalsCount: number
  company: {
    id: string
    name: string
    cui?: string | null
    email?: string | null
    phone?: string | null
  } | null
  license: {
    expiresAt?: string
    isSuspended?: boolean
    limits?: {
      locations?: number
      terminals?: number
      kdsDevices?: number
    }
    modules?: Record<string, boolean>
  } | null
  subscription: {
    billingStatus?: string
    billingCycle?: string
    price?: number
    currency?: string
    nextBillingDate?: string | null
    plan?: {
      name?: string
    } | null
  } | null
  activeModules: Array<{
    code: string
    name: string
  }>
  backupHealth?: {
    backupsCount?: number
    latestBackupAt?: string | null
    latestBackupFileExists?: boolean
    status?: "protected" | "missing_file" | "missing_backup" | string
  } | null
}

type AdminClientsResponse = {
  items?: unknown[]
}

type CreateClientPayload = {
  companyName: string
  subdomain?: string
  cui?: string
  regNo?: string
  address?: string
  email?: string
  phone?: string
  contactName?: string
  password?: string
  licenseKey: string
  limitLocations: number
  limitTerminals: number
  limitKdsDevices: number
  modules: {
    dashboard: boolean
    documents: boolean
    inventory: boolean
    nomenclature: boolean
    settings: boolean
    pos: boolean
    kds: boolean
    reports: boolean
  }
}

type CreateClientResponse = {
  item?: {
    name?: string
    subdomain?: string | null
    portalUrl?: string | null
    initialBackup?: {
      fileName?: string | null
    } | null
    erpUser?: {
      email?: string
      password?: string
    }
  }
}

const defaultModules = {
  dashboard: true,
  documents: true,
  inventory: true,
  nomenclature: true,
  settings: true,
  pos: true,
  kds: false,
  reports: false,
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function statusClass(status: string) {
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

function statusLabel(status: string) {
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

function backupTone(status?: string) {
  if (status === "protected") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "missing_file") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-rose-200 bg-rose-50 text-rose-700"
}

function backupLabel(status?: string) {
  if (status === "protected") return "Protejat"
  if (status === "missing_file") return "Fisier lipsa"
  return "Fara backup"
}

function billingCycleLabel(cycle?: string | null) {
  switch ((cycle || "").toLowerCase()) {
    case "monthly":
      return "luna"
    case "yearly":
      return "an"
    default:
      return cycle || "-"
  }
}

function normalizeClient(raw: any): AdminClientItem {
  return {
    id: typeof raw?.id === "string" ? raw.id : "",
    name: typeof raw?.name === "string" ? raw.name : "Client",
    slug: typeof raw?.slug === "string" ? raw.slug : "",
    subdomain: typeof raw?.subdomain === "string" ? raw.subdomain : null,
    portalUrl: typeof raw?.portalUrl === "string" ? raw.portalUrl : null,
    status: raw?.status || "inactive",
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    usersCount: Number(raw?.usersCount ?? 0),
    locationsCount: Number(raw?.locationsCount ?? 0),
    terminalsCount: Number(raw?.terminalsCount ?? 0),
    company: raw?.company
      ? {
          id: typeof raw.company.id === "string" ? raw.company.id : "",
          name: raw.company.name || raw?.name || "Client",
          cui: raw.company.cui ?? null,
          email: raw.company.email ?? null,
          phone: raw.company.phone ?? null,
        }
      : null,
    license: raw?.license
      ? {
          expiresAt: raw.license.expiresAt,
          isSuspended: Boolean(raw.license.isSuspended),
          limits: {
            locations: Number(raw.license?.limits?.locations ?? 0),
            terminals: Number(raw.license?.limits?.terminals ?? 0),
            kdsDevices: Number(raw.license?.limits?.kdsDevices ?? 0),
          },
          modules: raw.license.modules || {},
        }
      : null,
    subscription: raw?.subscription
      ? {
          billingStatus: raw.subscription.billingStatus,
          billingCycle: raw.subscription.billingCycle,
          price: Number(raw.subscription.price ?? 0),
          currency: raw.subscription.currency ?? "RON",
          nextBillingDate: raw.subscription.nextBillingDate ?? null,
          plan: raw.subscription.plan ? { name: raw.subscription.plan.name } : null,
        }
      : null,
    activeModules: Array.isArray(raw?.activeModules) ? raw.activeModules : [],
    backupHealth: raw?.backupHealth
      ? {
          backupsCount: Number(raw.backupHealth.backupsCount ?? 0),
          latestBackupAt: typeof raw.backupHealth.latestBackupAt === "string" ? raw.backupHealth.latestBackupAt : null,
          latestBackupFileExists: Boolean(raw.backupHealth.latestBackupFileExists),
          status: raw.backupHealth.status || "missing_backup",
        }
      : null,
  }
}

function summaryCard(label: string, value: number, helper: string) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{helper}</div>
    </div>
  )
}

function moduleLabel(key: string) {
  if (key === "dashboard") return "Dashboard"
  if (key === "documents") return "Documente"
  if (key === "inventory") return "Stoc"
  if (key === "nomenclature") return "Nomenclator"
  if (key === "settings") return "Setari"
  if (key === "pos") return "POS"
  if (key === "kds") return "KDS"
  if (key === "reports") return "Rapoarte"
  return key
}

export default function ControlPanelClients() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AdminClientItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | AdminClientItem["status"]>("all")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState("")
  const [loggingOut, setLoggingOut] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<{ clientName: string; email: string; password: string; portalUrl?: string | null } | null>(null)
  const [form, setForm] = useState<CreateClientPayload>({
    companyName: "",
    subdomain: "",
    cui: "",
    regNo: "",
    address: "",
    email: "",
    phone: "",
    contactName: "",
    password: "",
    licenseKey: "",
    limitLocations: 1,
    limitTerminals: 1,
    limitKdsDevices: 1,
    modules: defaultModules,
  })

  async function loadOwnerProfile() {
    try {
      const profile = await controlMe()
      setOwnerEmail(typeof (profile as any)?.email === "string" ? (profile as any).email : "Proprietar")
    } catch {
      setOwnerEmail("Proprietar")
    }
  }

  async function loadClients() {
    try {
      setLoading(true)
      setError(null)
      const data = await api<AdminClientsResponse>("/api/v1/admin/clients")
      const normalized = (Array.isArray(data?.items) ? data.items : []).map(normalizeClient)
      setItems(normalized)
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca lista de clienti.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOwnerProfile()
    loadClients()
  }, [])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false
      if (!term) return true
      const haystack = [
        item.company?.name,
        item.company?.cui,
        item.company?.email,
        item.company?.phone,
        item.name,
        item.slug,
        item.subdomain,
        item.portalUrl,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [items, search, statusFilter])

  const summary = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      risky: items.filter((item) => item.backupHealth?.status !== "protected").length,
      locations: items.reduce((sum, item) => sum + item.locationsCount, 0),
      terminals: items.reduce((sum, item) => sum + item.terminalsCount, 0),
    }),
    [items],
  )

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(`${label} copiat`)
      window.setTimeout(() => setMessage(null), 1800)
    } catch {
      setMessage("Nu am putut copia")
      window.setTimeout(() => setMessage(null), 1800)
    }
  }

  async function handleIesire() {
    try {
      setLoggingOut(true)
      await controlLogout()
      navigate("/cp/login", { replace: true })
    } finally {
      setLoggingOut(false)
    }
  }

  async function handleCreateClient(e: FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      setFormError(null)
      const response = await api<CreateClientResponse>("/api/v1/admin/clients", {
        method: "POST",
        body: JSON.stringify(form),
      })
      const erpUser = response?.item?.erpUser
      if (erpUser?.email && erpUser?.password) {
        setCreatedCredentials({
          clientName: response?.item?.name || form.companyName || "Client",
          email: erpUser.email,
          password: erpUser.password,
          portalUrl: response?.item?.portalUrl || null,
        })
      }
      setMessage(
        response?.item?.initialBackup?.fileName
          ? `Client creat cu snapshot initial: ${response.item.initialBackup.fileName}`
          : "Client creat.",
      )
      window.setTimeout(() => setMessage(null), 3000)
      setIsModalOpen(false)
      setForm({
        companyName: "",
        subdomain: "",
        cui: "",
        regNo: "",
        address: "",
        email: "",
        phone: "",
        contactName: "",
        password: "",
        licenseKey: "",
        limitLocations: 1,
        limitTerminals: 1,
        limitKdsDevices: 1,
        modules: defaultModules,
      })
      await loadClients()
    } catch (err: any) {
      setFormError(err?.message || "Nu am putut crea clientul.")
    } finally {
      setSaving(false)
    }
  }

  function handleAddCompany(clientId: string) {
    navigate(`/control-panel/clienti/${clientId}?adaugaFirma=1`)
  }

  const statusTabs: Array<["all" | AdminClientItem["status"], string]> = [
    ["all", "Toti"],
    ["active", "Activi"],
    ["suspended", "Suspendati"],
    ["expired", "Expirati"],
    ["inactive", "Inactivi"],
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#17324D] text-white">
                <Crown size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[#17324D]">{ownerEmail}</div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Administrare clienti</h1>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">
              Lucrezi pe o lista curata de clienti, vezi rapid statusul, licenta, backup-ul si intri direct in fisa clientului.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadClients}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              <RefreshCw size={15} />
              Reincarca
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2 text-sm font-semibold text-white"
            >
              <Plus size={15} />
              Client nou
            </button>
            <button
              onClick={handleIesire}
              disabled={loggingOut}
              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-60"
            >
              <LogOut size={15} />
              {loggingOut ? "..." : "Iesire"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {summaryCard("Clienti", summary.total, "total conturi")}
          {summaryCard("Activi", summary.active, "gata de operare")}
          {summaryCard("In risc", summary.risky, "backup lipsa sau invalid")}
          {summaryCard("Locatii", summary.locations, "puncte de lucru")}
          {summaryCard("POS", summary.terminals, "terminale active")}
        </div>
      </section>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {createdCredentials ? (
        <section className="rounded-[24px] border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-blue-800">{createdCredentials.clientName}</div>
              <div className="mt-1 text-sm text-blue-700">{createdCredentials.email}</div>
              {createdCredentials.portalUrl ? <div className="mt-1 text-sm text-blue-700">{createdCredentials.portalUrl}</div> : null}
              <div className="mt-1 font-mono text-sm text-blue-900">{createdCredentials.password}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => copyText(createdCredentials.email, "Email")} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                <Copy size={12} />
                Email
              </button>
              <button onClick={() => copyText(createdCredentials.password, "Parola")} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                <Copy size={12} />
                Parola
              </button>
              {createdCredentials.portalUrl ? (
                <button onClick={() => copyText(createdCredentials.portalUrl || "", "URL")} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                  <Copy size={12} />
                  URL
                </button>
              ) : null}
              <button onClick={() => setCreatedCredentials(null)} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                <Check size={12} />
                Inchide
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-2xl">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cauta firma, CUI, email, telefon sau subdomeniu"
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-[#17324D] focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {statusTabs.map(([status, label]) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                  statusFilter === status ? "bg-[#17324D] text-white" : "border border-slate-200 bg-white text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[16px] font-semibold text-[#17324D]">Lista clienti</div>
            <div className="mt-1 text-xs text-slate-500">{filteredItems.length} rezultate in contextul curent</div>
          </div>
        </div>

        {!loading && filteredItems.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
            Nu exista rezultate.
          </div>
        ) : null}

        <div className="mt-4 hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 xl:grid xl:grid-cols-[minmax(260px,1.5fr)_110px_180px_130px_130px_160px_250px] xl:gap-3">
          <div>Client</div>
          <div>Status</div>
          <div>Subdomeniu</div>
          <div>Licenta</div>
          <div>Backup</div>
          <div>Utilizare</div>
          <div>Actiuni</div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2">
          {(loading ? Array.from({ length: 8 }, (_, index) => ({ __skeleton: true as const, index })) : filteredItems).map((item) => {
            if ("__skeleton" in item) {
              return <div key={`skeleton-${item.index}`} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50/70" />
            }

            return (
              <div
                key={item.id}
                className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-slate-300 hover:bg-white xl:grid-cols-[minmax(260px,1.5fr)_110px_180px_130px_130px_160px_250px] xl:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[#17324D]">{item.company?.name || item.name}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {[item.company?.cui || "fara CUI", item.company?.email || "fara email", item.company?.phone || "fara telefon"].join(" | ")}
                  </div>
                </div>

                <div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>

                <div className="text-sm text-slate-700">{item.subdomain ? `${item.subdomain}.gufo.ink` : "-"}</div>

                <div className="text-sm text-slate-700">{formatDate(item.license?.expiresAt)}</div>

                <div className="min-w-0">
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${backupTone(item.backupHealth?.status)}`}>
                      {backupLabel(item.backupHealth?.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.backupHealth?.latestBackupAt)}</div>
                </div>

                <div className="text-sm text-slate-700">
                  <div>Useri {item.usersCount}</div>
                  <div>Locatii {item.locationsCount}/{item.license?.limits?.locations ?? 0}</div>
                  <div>POS {item.terminalsCount}/{item.license?.limits?.terminals ?? 0}</div>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <button
                    type="button"
                    onClick={() => navigate(`/control-panel/clienti/${item.id}`)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#17324D] px-3 py-2 text-sm font-semibold text-white"
                  >
                    Deschide
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddCompany(item.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    <Building2 size={14} />
                    Firma
                  </button>
                  {item.portalUrl ? (
                    <button
                      type="button"
                      onClick={() => copyText(item.portalUrl || "", "URL client")}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      <ExternalLink size={14} />
                      Portal
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Onboarding</div>
                <div className="mt-1 text-2xl font-semibold text-[#17324D]">Client nou</div>
                <div className="mt-1 text-sm text-slate-500">Completezi datele esentiale, limitele si modulele. Restul le administrezi dupa creare.</div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                <X size={16} />
              </button>
            </div>

            <form className="mt-5 space-y-5" onSubmit={handleCreateClient}>
              <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 text-sm font-semibold text-slate-900">Date client</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["companyName", "Firma", "SC Exemplu SRL"],
                    ["subdomain", "Subdomeniu", "coffee-cup"],
                    ["cui", "CUI", "RO12345678"],
                    ["regNo", "Reg. com.", "J40/1234/2026"],
                    ["email", "Email", "office@client.ro"],
                    ["phone", "Telefon", "+40 7xx xxx xxx"],
                    ["contactName", "Contact", "Administrator"],
                    ["password", "Parola ERP", "minim 6 caractere"],
                    ["licenseKey", "Cheie licenta", "GUFO-XXXX-XXXX"],
                  ].map(([field, label, placeholder]) => (
                    <label key={field} className="block">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                      <input
                        type={field === "password" ? "password" : "text"}
                        value={(form as any)[field] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={placeholder}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                      />
                    </label>
                  ))}
                </div>

                <label className="mt-3 block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Adresa</div>
                  <input
                    value={form.address || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                  />
                </label>
              </section>

              <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 text-sm font-semibold text-slate-900">Limite licenta</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatii</div>
                    <input
                      type="number"
                      min={1}
                      value={form.limitLocations}
                      onChange={(e) => setForm((prev) => ({ ...prev, limitLocations: Number(e.target.value || 1) }))}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">POS</div>
                    <input
                      type="number"
                      min={1}
                      value={form.limitTerminals}
                      onChange={(e) => setForm((prev) => ({ ...prev, limitTerminals: Number(e.target.value || 1) }))}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">KDS</div>
                    <input
                      type="number"
                      min={1}
                      value={form.limitKdsDevices}
                      onChange={(e) => setForm((prev) => ({ ...prev, limitKdsDevices: Number(e.target.value || 1) }))}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#17324D]"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 text-sm font-semibold text-slate-900">Module active</div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {Object.entries(form.modules).map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, modules: { ...prev.modules, [key]: !value } }))}
                      className={`rounded-2xl border px-3 py-3 text-left text-sm font-medium transition ${
                        value ? "border-[#17324D] bg-[#17324D] text-white" : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      {moduleLabel(key)}
                    </button>
                  ))}
                </div>
              </section>

              {formError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">
                  Inchide
                </button>
                <button type="submit" disabled={saving} className="rounded-2xl bg-[#17324D] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                  {saving ? "Se creeaza..." : "Creeaza client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
