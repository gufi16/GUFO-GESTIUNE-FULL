import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  HardDriveDownload,
  PlugZap,
  ShieldAlert,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { api } from "../../lib/api"
import { formatAuditDateTime, getAuditActionLabel, getAuditArea } from "../../lib/auditFormat"

type OverviewResponse = {
  ok?: boolean
  item?: {
    metrics?: {
      tenants?: number
      activeTenants?: number
      suspendedTenants?: number
      expiredTenants?: number
      users?: number
      locations?: number
      terminals?: number
      protectedTenants?: number
      riskyTenants?: number
    }
    platform?: {
      efacturaConfigured?: boolean
      efacturaEnvironment?: string
    }
    expiringLicenses?: Array<{
      id: string
      name: string
      status: string
      expiresAt?: string | null
      subdomain?: string | null
      portalUrl?: string | null
    }>
    backupRisks?: Array<{
      id: string
      name: string
      status: string
      backupStatus: string
      latestBackupAt?: string | null
      backupsCount?: number
      portalUrl?: string | null
    }>
    subscriptionAlerts?: Array<{
      id: string
      tenantId: string
      clientName: string
      status: string
      billingStatus: string
      billingCycle?: string
      price?: number
      currency?: string
      nextBillingDate?: string | null
      plan?: {
        id: string
        code: string
        name: string
      } | null
    }>
    recentAuditLogs?: Array<{
      id: string
      tenantId?: string | null
      actorType?: string
      actorId?: string | null
      action: string
      entityType: string
      entityId?: string | null
      createdAt: string
    }>
    recentBackups?: Array<{
      id: string
      tenantId: string
      clientName: string
      label?: string | null
      fileName: string
      fileSizeBytes?: number
      createdAt: string
    }>
  }
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

function formatBytes(value?: number) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function sectionCard(
  eyebrow: string,
  title: string,
  description: string,
  action?: ReactNode,
) {
  return (
    <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function metricCard(label: string, value: string | number, accent: "default" | "good" | "warn" = "default", icon?: ReactNode) {
  const theme =
    accent === "good"
      ? "border-emerald-200 bg-emerald-50"
      : accent === "warn"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-slate-50"

  return (
    <div className={`rounded-[22px] border px-4 py-4 ${theme}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  )
}

function statusPill(value: string, tone: "good" | "warn" | "bad" | "neutral") {
  const theme =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${theme}`}>{value}</span>
}

export default function ControlPanelDashboard() {
  const location = useLocation()
  const [data, setData] = useState<OverviewResponse["item"] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const response = await api<OverviewResponse>("/api/v1/admin/platform/overview")
        if (!mounted) return
        setData(response?.item || null)
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || "Nu am putut incarca panoul de control.")
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const mode = useMemo(() => {
    if (location.pathname.endsWith("/licente")) return "licenses"
    if (location.pathname.endsWith("/facturare")) return "billing"
    if (location.pathname.endsWith("/audit")) return "audit"
    return "overview"
  }, [location.pathname])

  const metrics = data?.metrics || {}
  const expiringLicenses = Array.isArray(data?.expiringLicenses) ? data!.expiringLicenses! : []
  const backupRisks = Array.isArray(data?.backupRisks) ? data!.backupRisks! : []
  const subscriptionAlerts = Array.isArray(data?.subscriptionAlerts) ? data!.subscriptionAlerts! : []
  const recentAuditLogs = Array.isArray(data?.recentAuditLogs) ? data!.recentAuditLogs! : []
  const recentBackups = Array.isArray(data?.recentBackups) ? data!.recentBackups! : []
  const efacturaConfigured = Boolean(data?.platform?.efacturaConfigured)
  const efacturaEnvironment = data?.platform?.efacturaEnvironment === "prod" ? "Productie" : "Test"

  const header =
    mode === "licenses"
      ? {
          eyebrow: "Licente",
          title: "Control licente",
          description: "Vezi rapid ce clienti expira, cine este suspendat si unde trebuie intervenit inainte sa se blocheze operarea.",
        }
      : mode === "billing"
        ? {
            eyebrow: "Facturare",
            title: "Control facturare",
            description: "Monitorizezi abonamentele cu risc, ciclurile de facturare si urmatoarele scadente dintr-un singur loc.",
          }
        : mode === "audit"
          ? {
              eyebrow: "Istoric",
              title: "Control audit",
              description: "Urmaresti activitatea recenta din platforma, backup-urile generate si miscarile care merita verificate.",
            }
          : {
              eyebrow: "Control Panel",
              title: "Centru de comanda",
              description: "Panoul owner pentru clienti, licente, backup, facturare si configurare centrala, cu vizibilitate reala pe risc si operare.",
            }

  return (
    <div className="space-y-4">
      {sectionCard(
        header.eyebrow,
        header.title,
        header.description,
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Reincarca
        </button>,
      )}

      {error ? (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {mode === "overview" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metricCard("Clienti", loading ? "..." : Number(metrics.tenants || 0), "default", <Building2 size={16} className="text-slate-400" />)}
            {metricCard("Activi", loading ? "..." : Number(metrics.activeTenants || 0), "good", <CheckCircle2 size={16} className="text-emerald-500" />)}
            {metricCard("In risc", loading ? "..." : Number(metrics.riskyTenants || 0), "warn", <ShieldAlert size={16} className="text-amber-500" />)}
            {metricCard("Locatii", loading ? "..." : Number(metrics.locations || 0), "default", <Store size={16} className="text-slate-400" />)}
            {metricCard("Utilizatori", loading ? "..." : Number(metrics.users || 0), "default", <Users size={16} className="text-slate-400" />)}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Risc operational</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Backup si licente</h2>
                </div>
                <Link to="/control-panel/clienti" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Clienti
                  <ArrowRight size={16} />
                </Link>
              </div>

              <div className="mt-5 space-y-3">
                {backupRisks.slice(0, 4).map((item) => (
                  <div key={`backup-${item.id}`} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{item.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          Backup {item.latestBackupAt ? formatDateTime(item.latestBackupAt) : "inexistent"}
                        </div>
                      </div>
                      {item.backupStatus === "missing_file"
                        ? statusPill("Fisier lipsa", "bad")
                        : item.backupStatus === "missing_backup"
                          ? statusPill("Fara backup", "bad")
                          : statusPill("Atentie", "warn")}
                    </div>
                  </div>
                ))}

                {expiringLicenses.slice(0, 4).map((item) => (
                  <div key={`license-${item.id}`} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{item.name}</div>
                        <div className="mt-1 text-sm text-slate-500">Expira la {formatDate(item.expiresAt)}</div>
                      </div>
                      {statusPill("Expirare apropiata", "warn")}
                    </div>
                  </div>
                ))}

                {!loading && backupRisks.length === 0 && expiringLicenses.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Nu exista alerte operationale acum.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Platforma</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Configurare centrala</h2>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-slate-500">ANAF e-Factura</div>
                        <div className="mt-1 font-semibold text-slate-950">{efacturaEnvironment}</div>
                      </div>
                      {efacturaConfigured ? statusPill("Configurat", "good") : statusPill("Lipsa config", "bad")}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-sm text-slate-500">Terminale POS + KDS</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-950">{loading ? "..." : Number(metrics.terminals || 0)}</div>
                  </div>

                  <Link
                    to="/control-panel/integrari"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#17324D] px-4 py-3 text-sm font-semibold text-white"
                  >
                    <PlugZap size={15} />
                    Deschide integrari
                  </Link>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Backup-uri recente</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Ultimele snapshot-uri</h2>

                <div className="mt-5 space-y-3">
                  {recentBackups.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-950">{item.clientName}</div>
                          <div className="mt-1 truncate text-sm text-slate-500">{item.label || item.fileName}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>{formatDateTime(item.createdAt)}</div>
                          <div className="mt-1">{formatBytes(item.fileSizeBytes)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {mode === "licenses" ? (
        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {metricCard("Active", loading ? "..." : Number(metrics.activeTenants || 0), "good", <ShieldCheck size={16} className="text-emerald-500" />)}
              {metricCard("Suspendate", loading ? "..." : Number(metrics.suspendedTenants || 0), "warn", <AlertTriangle size={16} className="text-amber-500" />)}
              {metricCard("Expirate", loading ? "..." : Number(metrics.expiredTenants || 0), "warn", <ShieldAlert size={16} className="text-amber-500" />)}
              {metricCard("Expira curand", loading ? "..." : expiringLicenses.length, "default", <CreditCard size={16} className="text-slate-400" />)}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Actiune rapida</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Clienti care cer atentie</h2>
            <div className="mt-5 space-y-3">
              {expiringLicenses.map((item) => (
                <Link key={item.id} to={`/control-panel/clienti/${item.id}`} className="block rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{item.name}</div>
                      <div className="mt-1 text-sm text-slate-500">Licenta expira la {formatDate(item.expiresAt)}</div>
                    </div>
                    {statusPill(item.status === "active" ? "Activ" : item.status, item.status === "active" ? "good" : "warn")}
                  </div>
                </Link>
              ))}
              {!loading && expiringLicenses.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nu exista expirari apropiate.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {mode === "billing" ? (
        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {metricCard("Abonamente cu risc", loading ? "..." : subscriptionAlerts.length, "warn", <CreditCard size={16} className="text-amber-500" />)}
              {metricCard("Clienti activi", loading ? "..." : Number(metrics.activeTenants || 0), "good", <Building2 size={16} className="text-emerald-500" />)}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Scadente si billing</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Abonamente de verificat</h2>
            <div className="mt-5 space-y-3">
              {subscriptionAlerts.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{item.clientName}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {item.plan?.name || "-"} • {Number(item.price || 0).toLocaleString("ro-RO")} {item.currency || "RON"}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">Scadenta {formatDate(item.nextBillingDate)}</div>
                    </div>
                    {item.billingStatus !== "OK"
                      ? statusPill(item.billingStatus, "bad")
                      : statusPill(item.status, "warn")}
                  </div>
                </div>
              ))}
              {!loading && subscriptionAlerts.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nu exista alerte de facturare.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {mode === "audit" ? (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Activitate 24h</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Evenimente recente</h2>
            <div className="mt-5 space-y-3">
              {recentAuditLogs.map((entry) => (
                <div key={entry.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{getAuditActionLabel(entry as never)}</div>
                      <div className="mt-1 text-sm text-slate-500">{getAuditArea(entry as never)}</div>
                    </div>
                    <div className="text-sm text-slate-500">{formatAuditDateTime(entry.createdAt)}</div>
                  </div>
                </div>
              ))}
              {!loading && recentAuditLogs.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nu exista activitate recenta.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Backup feed</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Snapshot-uri recente</h2>
            <div className="mt-5 space-y-3">
              {recentBackups.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">{item.clientName}</div>
                      <div className="mt-1 truncate text-sm text-slate-500">{item.label || item.fileName}</div>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <div>{formatDateTime(item.createdAt)}</div>
                      <div className="mt-1">{formatBytes(item.fileSizeBytes)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3">
        <Link to="/control-panel/clienti" className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Clienti</div>
              <div className="mt-2 text-xl font-semibold text-slate-950">Administrare clienti</div>
              <div className="mt-2 text-sm text-slate-500">Firme, subdomenii, useri, locatii si device-uri.</div>
            </div>
            <Building2 size={18} className="text-slate-400" />
          </div>
        </Link>

        <Link to="/control-panel/integrari" className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Integrari</div>
              <div className="mt-2 text-xl font-semibold text-slate-950">Configurare centrala</div>
              <div className="mt-2 text-sm text-slate-500">ANAF e-Factura si setari platforma.</div>
            </div>
            <PlugZap size={18} className="text-slate-400" />
          </div>
        </Link>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Protectie</div>
              <div className="mt-2 text-xl font-semibold text-slate-950">Backup coverage</div>
              <div className="mt-2 text-sm text-slate-500">
                {loading ? "..." : `${Number(metrics.protectedTenants || 0)} din ${Number(metrics.tenants || 0)} clienti au backup valid.`}
              </div>
            </div>
            <HardDriveDownload size={18} className="text-slate-400" />
          </div>
        </div>
      </section>
    </div>
  )
}
