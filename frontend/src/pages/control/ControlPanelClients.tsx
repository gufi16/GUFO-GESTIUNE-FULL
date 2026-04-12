import { FormEvent, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, Copy, Crown, LogOut, Plus, RefreshCw, Search, X } from "lucide-react"
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
}

type AdminClientsResponse = {
  items?: any[]
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
  licenseKey: string
  limitLocations: number
  limitTerminals: number
  modules: {
    dashboard: boolean
    documents: boolean
    inventory: boolean
    nomenclature: boolean
    settings: boolean
    pos: boolean
    reports: boolean
  }
}

type CreateClientResponse = {
  item?: {
    name?: string
    subdomain?: string | null
    portalUrl?: string | null
    erpUser?: {
      email?: string
      password?: string
    }
  }
}

type UpdateSubdomainResponse = {
  item?: {
    id?: string
    subdomain?: string | null
    portalUrl?: string | null
  }
}

const defaultModules = {
  dashboard: true,
  documents: true,
  inventory: true,
  nomenclature: true,
  settings: true,
  pos: true,
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
  }
}

function summaryCard(label: string, value: number) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  )
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
  const [subdomainDrafts, setSubdomainDrafts] = useState<Record<string, string>>({})
  const [savingSubdomainId, setSavingSubdomainId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateClientPayload>({
    companyName: "",
    subdomain: "",
    cui: "",
    regNo: "",
    address: "",
    email: "",
    phone: "",
    contactName: "",
    licenseKey: "",
    limitLocations: 1,
    limitTerminals: 1,
    modules: defaultModules,
  })

  async function loadOwnerProfile() {
    try {
      const profile = await controlMe()
      setOwnerEmail(typeof (profile as any)?.email === "string" ? (profile as any).email : "Owner")
    } catch {
      setOwnerEmail("Owner")
    }
  }

  async function loadClients() {
    try {
      setLoading(true)
      setError(null)
      const data = await api<AdminClientsResponse>("/api/v1/admin/clients")
      const normalized = (Array.isArray(data?.items) ? data.items : []).map(normalizeClient)
      setItems(normalized)
      setSubdomainDrafts(
        normalized.reduce<Record<string, string>>((acc, item) => {
          acc[item.id] = item.subdomain || ""
          return acc
        }, {}),
      )
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

  async function handleLogout() {
    try {
      setLoggingOut(true)
      controlLogout()
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
        licenseKey: "",
        limitLocations: 1,
        limitTerminals: 1,
        modules: defaultModules,
      })
      await loadClients()
    } catch (err: any) {
      setFormError(err?.message || "Nu am putut crea clientul.")
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateSubdomain(item: AdminClientItem) {
    const nextSubdomain = (subdomainDrafts[item.id] || "").trim()
    if (!nextSubdomain) {
      setMessage("Completeaza subdomeniul.")
      window.setTimeout(() => setMessage(null), 1800)
      return
    }

    try {
      setSavingSubdomainId(item.id)
      setError(null)
      const response = await api<UpdateSubdomainResponse>(`/api/v1/admin/clients/${item.id}/subdomain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: nextSubdomain }),
      })

      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                subdomain: response?.item?.subdomain || nextSubdomain,
                portalUrl: response?.item?.portalUrl || null,
                slug: response?.item?.subdomain || entry.slug,
              }
            : entry,
        ),
      )
      setSubdomainDrafts((prev) => ({
        ...prev,
        [item.id]: response?.item?.subdomain || nextSubdomain,
      }))
      setMessage("Subdomeniu salvat")
      window.setTimeout(() => setMessage(null), 1800)
    } catch (err: any) {
      setError(err?.message || "Nu am putut salva subdomeniul.")
    } finally {
      setSavingSubdomainId(null)
    }
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#17324D] text-white">
                <Crown size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[#17324D]">{ownerEmail}</div>
                <h1 className="text-2xl font-semibold text-slate-950">Clienti</h1>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={loadClients} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
              <RefreshCw size={15} />
              Refresh
            </button>
            <button onClick={() => setIsModalOpen(true)} className="inline-flex items-center gap-2 rounded-2xl bg-[#17324D] px-4 py-2 text-sm font-semibold text-white">
              <Plus size={15} />
              Client nou
            </button>
            <button onClick={handleLogout} disabled={loggingOut} className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-60">
              <LogOut size={15} />
              {loggingOut ? "..." : "Logout"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCard("Clienti", summary.total)}
          {summaryCard("Activi", summary.active)}
          {summaryCard("Locatii", summary.locations)}
          {summaryCard("POS", summary.terminals)}
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-xl">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cauta firma, CUI, email sau subdomeniu"
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

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="hidden grid-cols-[minmax(0,1.7fr)_170px_170px_280px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid">
          <div>Client</div>
          <div>Plan</div>
          <div>Utilizare</div>
          <div>Subdomeniu</div>
        </div>

        {!loading && filteredItems.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">Nu exista rezultate.</div>
        ) : null}

        {(loading ? Array.from({ length: 8 }, (_, index) => ({ __skeleton: true as const, index })) : filteredItems).map((item) => {
          if ("__skeleton" in item) {
            return <div key={`skeleton-${item.index}`} className="h-24 animate-pulse border-b border-slate-100 bg-slate-50/60 last:border-b-0" />
          }

          return (
            <article
              key={item.id}
              onClick={() => navigate(`/control-panel/clienti/${item.id}`)}
              className="cursor-pointer border-b border-slate-100 px-4 py-4 transition hover:bg-slate-50 last:border-b-0"
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_170px_170px_280px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-slate-950">{item.company?.name || item.name}</h2>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {[item.company?.cui, item.company?.email, item.company?.phone].filter(Boolean).join(" · ") || "-"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>Creat {formatDate(item.createdAt)}</span>
                    <span>Licenta {formatDate(item.license?.expiresAt)}</span>
                  </div>
                </div>

                <div className="text-sm">
                  <div className="font-semibold text-slate-900">{item.subscription?.plan?.name || "-"}</div>
                  <div className="mt-1 text-slate-500">
                    {item.subscription
                      ? `${Number(item.subscription.price ?? 0).toLocaleString("ro-RO")} ${item.subscription.currency || "RON"} / ${billingCycleLabel(item.subscription.billingCycle)}`
                      : "-"}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Useri</div>
                    <div className="mt-1 font-semibold text-slate-950">{item.usersCount}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Loc</div>
                    <div className="mt-1 font-semibold text-slate-950">
                      {item.locationsCount}/{item.license?.limits?.locations ?? 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">POS</div>
                    <div className="mt-1 font-semibold text-slate-950">
                      {item.terminalsCount}/{item.license?.limits?.terminals ?? 0}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div
                    className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      value={subdomainDrafts[item.id] ?? item.subdomain ?? ""}
                      onChange={(e) =>
                        setSubdomainDrafts((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      placeholder="coffee-cup"
                      className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
                    />
                    <span className="pl-2 text-xs text-slate-400">.gufo.ink</span>
                  </div>
                  <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleUpdateSubdomain(item)}
                      disabled={savingSubdomainId === item.id}
                      className="inline-flex h-9 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#17324D] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingSubdomainId === item.id ? "..." : "Salveaza"}
                    </button>
                    <div className="truncate text-xs text-slate-500">{item.portalUrl || "-"}</div>
                  </div>
                </div>

              </div>
            </article>
          )
        })}
      </section>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-[#17324D]">Client nou</div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                <X size={16} />
              </button>
            </div>

            <form className="mt-4 space-y-4" onSubmit={handleCreateClient}>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["companyName", "Firma", "SC Exemplu SRL"],
                  ["subdomain", "Subdomeniu", "coffee-cup"],
                  ["cui", "CUI", "RO12345678"],
                  ["email", "Email", "office@client.ro"],
                  ["phone", "Telefon", "+40 7xx xxx xxx"],
                  ["contactName", "Contact", "Administrator"],
                  ["licenseKey", "Cheie licenta", "GUFO-XXXX-XXXX"],
                ].map(([field, label, placeholder]) => (
                  <label key={field} className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                    <input
                      value={(form as any)[field] || ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                      placeholder={placeholder}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                    />
                  </label>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="block md:col-span-1">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Reg. com.</div>
                  <input
                    value={form.regNo || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, regNo: e.target.value }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Locatii</div>
                  <input
                    type="number"
                    min={1}
                    value={form.limitLocations}
                    onChange={(e) => setForm((prev) => ({ ...prev, limitLocations: Number(e.target.value || 1) }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">POS</div>
                  <input
                    type="number"
                    min={1}
                    value={form.limitTerminals}
                    onChange={(e) => setForm((prev) => ({ ...prev, limitTerminals: Number(e.target.value || 1) }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Adresa</div>
                <input
                  value={form.address || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#17324D] focus:bg-white"
                />
              </label>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(form.modules).map(([key, value]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, modules: { ...prev.modules, [key]: !value } }))}
                    className={`rounded-2xl border px-3 py-3 text-left text-sm font-medium transition ${
                      value ? "border-[#17324D] bg-[#17324D] text-white" : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>

              {formError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
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

