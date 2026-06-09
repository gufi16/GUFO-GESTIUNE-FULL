import { useEffect, useMemo, useState } from "react"
import {
  Archive,
  CheckCircle2,
  Download,
  FileUp,
  HardDriveDownload,
  Layers3,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react"
import PageHeader from "../components/PageHeader"
import { API_BASE, api, authHeaders } from "../lib/api"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"

type BackupItem = {
  id: string
  label?: string | null
  fileName: string
  fileSizeBytes: number
  tableCounts?: Record<string, number> | null
  createdAt: string
  fileExists?: boolean
}

type BackupModuleSummary = {
  key: string
  label: string
  description: string
  recordCount: number
  breakdown?: Array<{
    key: string
    count: number
  }>
}

type BackupActionCardProps = {
  title: string
  description: string
  tone: "slate" | "emerald" | "sky" | "amber"
  icon: typeof Archive
  children?: React.ReactNode
}

const selectiveRestoreRecommendedOrder = ["company", "users", "customers", "suppliers", "catalog", "documents", "files"]

function fmtBytes(value: number) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO")
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function getTableCountEntries(item: BackupItem | null | undefined) {
  if (!item?.tableCounts || typeof item.tableCounts !== "object") return []
  return Object.entries(item.tableCounts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1])
}

function prettifyTableKey(value: string) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function BackupActionCard({ title, description, tone, icon: Icon, children }: BackupActionCardProps) {
  const toneClasses: Record<BackupActionCardProps["tone"], string> = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-[linear-gradient(180deg,#FCFFFD_0%,#F1FBF5_100%)]",
    sky: "border-sky-200 bg-[linear-gradient(180deg,#FBFEFF_0%,#EEF8FF_100%)]",
    amber: "border-amber-200 bg-[linear-gradient(180deg,#FFFEFB_0%,#FCF4E8_100%)]",
  }

  const iconClasses: Record<BackupActionCardProps["tone"], string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    sky: "bg-sky-100 text-sky-700",
    amber: "bg-amber-100 text-amber-700",
  }

  return (
    <div className={`rounded-[24px] border p-4 shadow-sm shadow-slate-900/[0.03] ${toneClasses[tone]}`}>
      <div className="flex items-start gap-3">
        <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconClasses[tone]}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#17324D]">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function BackupStep({
  step,
  title,
  description,
  active,
}: {
  step: string
  title: string
  description: string
  active?: boolean
}) {
  return (
    <div
      className={`rounded-[20px] border px-4 py-3.5 ${
        active ? "border-[#17324D] bg-[#17324D] text-white" : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${active ? "text-slate-200" : "text-slate-400"}`}>{step}</div>
      <div className="mt-1 text-sm font-semibold">{title}</div>
      <div className={`mt-1 text-xs leading-5 ${active ? "text-slate-200" : "text-slate-500"}`}>{description}</div>
    </div>
  )
}

export default function SetariBackupPage() {
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoringLatest, setRestoringLatest] = useState(false)
  const [recoveringLatestFiles, setRecoveringLatestFiles] = useState(false)
  const [uploadRestoring, setUploadRestoring] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [recoveringFilesId, setRecoveringFilesId] = useState<string | null>(null)
  const [selectedBackupId, setSelectedBackupId] = useState("")
  const [moduleLoading, setModuleLoading] = useState(false)
  const [moduleRestoreLoading, setModuleRestoreLoading] = useState(false)
  const [availableModules, setAvailableModules] = useState<BackupModuleSummary[]>([])
  const [selectedModules, setSelectedModules] = useState<string[]>([])
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [label, setLabel] = useState("")
  const [items, setItems] = useState<BackupItem[]>([])

  const latestAvailableBackup = useMemo(() => items.find((item) => item.fileExists !== false) || null, [items])
  const latestEntries = useMemo(() => getTableCountEntries(latestAvailableBackup), [latestAvailableBackup])
  const totalStoredSize = useMemo(() => items.reduce((sum, item) => sum + Number(item.fileSizeBytes || 0), 0), [items])
  const totalLatestRecords = useMemo(() => latestEntries.reduce((sum, [, count]) => sum + count, 0), [latestEntries])
  const selectedBackup = useMemo(() => items.find((item) => item.id === selectedBackupId) || null, [items, selectedBackupId])
  const orderedModules = useMemo(() => {
    return [...availableModules].sort((a, b) => {
      const indexA = selectiveRestoreRecommendedOrder.indexOf(a.key)
      const indexB = selectiveRestoreRecommendedOrder.indexOf(b.key)
      const safeA = indexA === -1 ? selectiveRestoreRecommendedOrder.length : indexA
      const safeB = indexB === -1 ? selectiveRestoreRecommendedOrder.length : indexB
      if (safeA !== safeB) return safeA - safeB
      return b.recordCount - a.recordCount
    })
  }, [availableModules])
  const selectedModuleCount = selectedModules.length
  const selectedModuleRecords = useMemo(
    () =>
      orderedModules
        .filter((module) => selectedModules.includes(module.key))
        .reduce((sum, module) => sum + module.recordCount, 0),
    [orderedModules, selectedModules],
  )
  const existingFilesCount = useMemo(() => items.filter((item) => item.fileExists !== false).length, [items])

  async function load() {
    try {
      setLoading(true)
      setError("")
      const data = await api<{ items?: BackupItem[] }>("/api/v1/settings/backups")
      const nextItems = Array.isArray(data?.items) ? data.items : []
      setItems(nextItems)
      setSelectedBackupId((current) => (current && nextItems.some((item) => item.id === current) ? current : ""))
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut incarca backup-urile clientului."))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    async function loadModules() {
      if (!selectedBackupId) {
        setAvailableModules([])
        setSelectedModules([])
        return
      }

      try {
        setModuleLoading(true)
        const data = await api<{ modules?: BackupModuleSummary[] }>(`/api/v1/settings/backups/${selectedBackupId}/modules`)
        const modules = Array.isArray(data?.modules) ? data.modules : []
        setAvailableModules(modules)
        setSelectedModules((current) => current.filter((key) => modules.some((module) => module.key === key)))
      } catch (error: unknown) {
        setAvailableModules([])
        setSelectedModules([])
        setError(getErrorMessage(error, "Nu am putut citi modulele disponibile din backup."))
      } finally {
        setModuleLoading(false)
      }
    }

    void loadModules()
  }, [selectedBackupId])

  async function handleCreate() {
    try {
      setCreating(true)
      setError("")
      setMessage("")
      await api<{ item?: BackupItem }>("/api/v1/settings/backups", {
        method: "POST",
        body: JSON.stringify({ label }),
      })
      setLabel("")
      setMessage("Backup-ul clientului a fost creat si salvat pe server.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut crea backup-ul clientului."))
    } finally {
      setCreating(false)
    }
  }

  async function handleRestoreLatest() {
    if (
      !window.confirm(
        "Restaurezi complet ultimul backup valid de pe server? Datele ERP curente vor fi suprascrise, iar inainte de restore se creeaza automat un backup de siguranta.",
      )
    ) {
      return
    }

    try {
      setRestoringLatest(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/restore-latest", {
        method: "POST",
      })
      setMessage(data?.message || "Ultimul backup valid a fost restaurat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura ultimul backup."))
    } finally {
      setRestoringLatest(false)
    }
  }

  async function handleRecoverLatestFiles() {
    if (
      !window.confirm(
        "Recuperezi doar fisierele lipsa din ultimul backup? Datele din ERP nu sunt suprascrise, iar fisierele deja existente raman intacte.",
      )
    ) {
      return
    }

    try {
      setRecoveringLatestFiles(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/recover-files-latest", {
        method: "POST",
      })
      setMessage(data?.message || "Fisierele lipsa au fost recuperate.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut recupera fisierele lipsa."))
    } finally {
      setRecoveringLatestFiles(false)
    }
  }

  async function handleUploadRestore(file: File) {
    const formData = new FormData()
    formData.append("backup", file)

    try {
      setUploadRestoring(true)
      setError("")
      setMessage("")

      const response = await fetch(`${API_BASE}/api/v1/settings/backups/upload-restore`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut restaura backup-ul incarcat.")
      }

      setMessage(data?.message || "Backup-ul incarcat a fost restaurat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura backup-ul incarcat."))
    } finally {
      setUploadRestoring(false)
    }
  }

  async function handleDownload(item: BackupItem) {
    try {
      setDownloadingId(item.id)
      setError("")
      const response = await api<Response>(`/api/v1/settings/backups/${item.id}/download`, { raw: true })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Nu am putut descarca backup-ul.")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = item.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut descarca backup-ul."))
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete(item: BackupItem) {
    if (!window.confirm(`Stergi backup-ul ${item.fileName}? Actiunea elimina fisierul din istoricul acestui client.`)) return

    try {
      setDeletingId(item.id)
      setError("")
      setMessage("")
      await api(`/api/v1/settings/backups/${item.id}`, { method: "DELETE" })
      setMessage("Backup-ul a fost sters.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut sterge backup-ul."))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRestore(item: BackupItem) {
    if (
      !window.confirm(
        `Restaurezi complet backup-ul ${item.fileName}? Datele ERP curente se suprascriu, iar sistemul creeaza inainte un backup de siguranta.`,
      )
    ) {
      return
    }

    try {
      setRestoringId(item.id)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${item.id}/restore`, {
        method: "POST",
      })
      setMessage(data?.message || "Backup-ul a fost restaurat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura backup-ul."))
    } finally {
      setRestoringId(null)
    }
  }

  async function handleRecoverFiles(item: BackupItem) {
    if (
      !window.confirm(
        `Recuperezi doar fisierele lipsa din backup-ul ${item.fileName}? ERP-ul nu este suprascris si fisierele existente nu sunt atinse.`,
      )
    ) {
      return
    }

    try {
      setRecoveringFilesId(item.id)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${item.id}/recover-files`, {
        method: "POST",
      })
      setMessage(data?.message || "Fisierele lipsa au fost recuperate din backup.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut recupera fisierele lipsa din backup."))
    } finally {
      setRecoveringFilesId(null)
    }
  }

  async function handleRestoreSelectedModules() {
    if (!selectedBackup) {
      setError("Alege un backup din care vrei sa restaurezi modulele.")
      return
    }

    if (!selectedModules.length) {
      setError("Selecteaza cel putin un modul pentru restore.")
      return
    }

    if (
      !window.confirm(
        `Restaurezi selectiv din ${selectedBackup.fileName} modulele: ${selectedModules.join(", ")}? Sistemul creeaza mai intai un backup de siguranta.`,
      )
    ) {
      return
    }

    try {
      setModuleRestoreLoading(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${selectedBackup.id}/restore-selected`, {
        method: "POST",
        body: JSON.stringify({ modules: selectedModules }),
      })
      setMessage(data?.message || "Modulele selectate au fost restaurate din backup.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura modulele selectate din backup."))
    } finally {
      setModuleRestoreLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="recovery center"
        title="Backup si recuperare date"
        subtitle="Pagina de backup este organizata ca un centru clar de salvare si restaurare: vezi rapid starea, alegi scenariul corect si actionezi fara sa te incurci."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Backup-uri in istoric" value={loading ? "..." : String(items.length)} tone="slate" />
        <DocumentMetric title="Backup-uri valide" value={loading ? "..." : String(existingFilesCount)} tone="blue" />
        <DocumentMetric title="Ultimul snapshot" value={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"} tone="emerald" />
        <DocumentMetric title="Spatiu ocupat" value={loading ? "..." : fmtBytes(totalStoredSize)} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,#EFF7FF_0%,#F7FBFF_32%,#FFFFFF_72%)] shadow-sm shadow-slate-900/[0.04]">
        <div className="grid gap-0 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="p-5 md:p-6">
            <div className="inline-flex rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Stare protectie date
            </div>
            <h2 className="mt-3 text-[26px] font-semibold tracking-[-0.02em] text-[#17324D]">Backup-ul trebuie sa fie simplu de folosit in momentul critic</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Ai toate scenariile importante in aceeasi pagina: restore complet din server, recuperare doar pentru fisiere lipsa, restore selectiv pe module si creare rapida de snapshot inainte de schimbari mari.
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <BackupStep
                step="Pas 1"
                title="Verifici sursa buna"
                description="Alegi backup-ul potrivit si vezi imediat daca are continutul pe care vrei sa-l readuci."
                active={!selectedBackup}
              />
              <BackupStep
                step="Pas 2"
                title="Alegi tipul de recuperare"
                description="Full restore, restore selectiv sau doar fisiere lipsa, in functie de incident."
                active={Boolean(selectedBackup)}
              />
              <BackupStep
                step="Pas 3"
                title="Sistemul isi face plasa de siguranta"
                description="Inainte de restore se creeaza automat un backup de siguranta pentru revenire."
                active={false}
              />
            </div>
          </div>

          <div className="border-t border-slate-200 bg-[#17324D] p-5 text-white xl:border-l xl:border-t-0">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white">
                <ShieldCheck size={22} />
              </div>
              <div>
                <div className="text-sm font-semibold">Ultimul backup disponibil pe server</div>
                <div className="mt-1 text-sm text-slate-200">
                  {latestAvailableBackup ? latestAvailableBackup.label || latestAvailableBackup.fileName : "Nu exista inca un backup valid pentru acest client."}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Creat la</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Marime</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? fmtBytes(latestAvailableBackup.fileSizeBytes) : "-"}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Continut estimat</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? totalLatestRecords.toLocaleString("ro-RO") : "-"}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Status</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? "Pregatit pentru recovery" : "Nu exista sursa valida"}</div>
              </div>
            </div>

            <div className="mt-4 rounded-[18px] border border-emerald-300/30 bg-emerald-400/10 px-3.5 py-3 text-sm leading-6 text-emerald-50">
              Restore-ul complet si restore-ul selectiv creeaza automat un backup de siguranta inainte sa modifice datele curente.
            </div>
          </div>
        </div>
      </section>

      <DocumentSection
        title="Recuperare rapida"
        description="Alege direct scenariul potrivit fara sa intri in istoricul complet."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={documentButtonSecondaryClass}>
            <RefreshCcw size={16} className="mr-2" />
            Reincarca
          </button>
        }
      >
        <div className="grid gap-3 xl:grid-cols-3">
          <BackupActionCard
            title="Restore complet din server"
            description="Refaci tot ERP-ul clientului din ultimul backup valid salvat pe server."
            tone="emerald"
            icon={HardDriveDownload}
          >
            <div className="rounded-[18px] border border-white/80 bg-white/80 px-3 py-2.5 text-xs leading-5 text-slate-500">
              Recomandat cand lipsesc clienti, produse, utilizatori, configurari sau documente din ERP.
            </div>
            <button
              type="button"
              onClick={() => void handleRestoreLatest()}
              disabled={!latestAvailableBackup || restoringLatest}
              className={`${documentButtonPrimaryClass} mt-4 w-full`}
            >
              {restoringLatest ? "Se restaureaza..." : "Restore complet din ultimul backup"}
            </button>
          </BackupActionCard>

          <BackupActionCard
            title="Recuperare doar fisiere"
            description="Aduce inapoi doar upload-urile lipsa fara sa atinga datele existente din ERP."
            tone="sky"
            icon={RefreshCcw}
          >
            <div className="rounded-[18px] border border-white/80 bg-white/80 px-3 py-2.5 text-xs leading-5 text-slate-500">
              Recomandat pentru atasamente, imagini, PDF-uri sau fisiere care lipsesc din sistem, dar datele din ERP sunt bune.
            </div>
            <button
              type="button"
              onClick={() => void handleRecoverLatestFiles()}
              disabled={!latestAvailableBackup || recoveringLatestFiles}
              className={`${documentButtonPrimaryClass} mt-4 w-full`}
            >
              {recoveringLatestFiles ? "Se recupereaza..." : "Recupereaza fisierele lipsa"}
            </button>
          </BackupActionCard>

          <BackupActionCard
            title="Restore din ZIP incarcat"
            description="Incarci manual o arhiva de backup si rulezi restaurarea din ea."
            tone="amber"
            icon={UploadCloud}
          >
            <div className="rounded-[18px] border border-white/80 bg-white/80 px-3 py-2.5 text-xs leading-5 text-slate-500">
              Util cand backup-ul nu vine din istoricul acestui tenant, ci dintr-o arhiva locala sau din suport.
            </div>
            <label className="mt-4 block">
              <input
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                disabled={uploadRestoring || creating}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleUploadRestore(file)
                  e.currentTarget.value = ""
                }}
              />
              <span className={`${documentButtonPrimaryClass} flex w-full cursor-pointer ${uploadRestoring || creating ? "pointer-events-none" : ""}`}>
                {uploadRestoring ? "Se incarca..." : "Alege ZIP pentru restore"}
              </span>
            </label>
          </BackupActionCard>
        </div>
      </DocumentSection>

      <DocumentSection
        title="Restore selectiv ghidat"
        description="Flow in 3 pasi pentru cazurile in care vrei sa readuci doar anumite module dintr-un backup."
      >
        <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pas 1</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Alege backup-ul sursa</div>
              <select
                value={selectedBackupId}
                onChange={(e) => setSelectedBackupId(e.target.value)}
                className={`${documentInputClass} mt-3`}
              >
                <option value="">Selecteaza backup-ul</option>
                {items
                  .filter((item) => item.fileExists !== false)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {fmtDate(item.createdAt)} | {item.label || item.fileName}
                    </option>
                  ))}
              </select>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pas 2</div>
              <div className="mt-1 text-sm font-semibold text-[#17324D]">Verifici daca backup-ul chiar te ajuta</div>
              {selectedBackup ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                    Backup selectat: <span className="font-semibold">{selectedBackup.label || selectedBackup.fileName}</span>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                    Daca vezi valori `0` pe modulele care te intereseaza, backup-ul ales este deja de dupa incident si nu are ce sa readuca.
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-[16px] border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                  Selecteaza un backup ca sa vezi modulele disponibile.
                </div>
              )}
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-[#17324D] p-4 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Pas 3</div>
              <div className="mt-1 text-sm font-semibold">Ruleaza restore-ul selectiv</div>
              <div className="mt-2 text-sm text-slate-200">
                {selectedModuleCount
                  ? `${selectedModuleCount} module selectate, aproximativ ${selectedModuleRecords.toLocaleString("ro-RO")} inregistrari.`
                  : "Nu ai selectat inca niciun modul."}
              </div>
              <button
                type="button"
                onClick={() => void handleRestoreSelectedModules()}
                disabled={!selectedBackup || !selectedModules.length || moduleLoading || moduleRestoreLoading}
                className={`${documentButtonPrimaryClass} mt-4 w-full bg-white text-[#17324D] hover:bg-slate-100`}
              >
                {moduleRestoreLoading ? "Se restaureaza modulele..." : "Restore modulele selectate"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {moduleLoading ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                Se incarca modulele disponibile din backup...
              </div>
            ) : !selectedBackup ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                Alege mai intai un backup din lista din stanga.
              </div>
            ) : !orderedModules.length ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                Backup-ul ales nu are module disponibile pentru restore selectiv.
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {orderedModules.map((module) => {
                    const isSelected = selectedModules.includes(module.key)
                    return (
                      <label
                        key={module.key}
                        className={`cursor-pointer rounded-[22px] border p-4 shadow-sm shadow-slate-900/[0.03] ${
                          isSelected ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelectedModules((current) =>
                                e.target.checked ? [...current, module.key] : current.filter((item) => item !== module.key),
                              )
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-[#17324D]">{module.label}</div>
                                <div className="mt-1 text-xs leading-5 text-slate-500">{module.description}</div>
                              </div>
                              <div
                                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                                  isSelected
                                    ? "border-emerald-200 bg-white text-emerald-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500"
                                }`}
                              >
                                {module.recordCount.toLocaleString("ro-RO")}
                              </div>
                            </div>

                            {module.breakdown?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {module.breakdown
                                  .filter((entry) => entry.count > 0)
                                  .slice(0, 5)
                                  .map((entry) => (
                                    <span
                                      key={entry.key}
                                      className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                                    >
                                      {prettifyTableKey(entry.key)}: {entry.count.toLocaleString("ro-RO")}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-200 text-slate-700">
                      <Layers3 size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#17324D]">Rezumat selectie</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {selectedModuleCount
                          ? `Ai selectat ${selectedModuleCount} module. Totalul estimat este de ${selectedModuleRecords.toLocaleString("ro-RO")} inregistrari.`
                          : "Bifeaza modulele pe care vrei sa le readuci din backup."}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DocumentSection>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.25fr]">
        <DocumentSection
          title="Creeaza backup nou"
          description="Snapshot manual rapid inainte de update-uri, importuri, schimbari de stoc sau alte operatiuni sensibile."
        >
          <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Eticheta optionala</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: inainte-update, final-luna, import-clienti"
              className={`${documentInputClass} mt-3`}
            />
            <div className="mt-2 text-xs leading-5 text-slate-500">
              Eticheta te ajuta sa gasesti rapid snapshot-ul potrivit in istoric cand trebuie sa revii la un moment clar.
            </div>
            <button type="button" onClick={() => void handleCreate()} disabled={creating} className={`${documentButtonPrimaryClass} mt-4 w-full`}>
              <Archive size={16} className="mr-2" />
              {creating ? "Se creeaza..." : "Creeaza backup manual"}
            </button>
          </div>
        </DocumentSection>

        <DocumentSection
          title="Ce contine ultimul backup"
          description="Previzualizare rapida a celor mai importante colectii salvate in ultimul snapshot valid."
        >
          {latestAvailableBackup ? (
            <div className="space-y-3">
              <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[#17324D]">{latestAvailableBackup.label || latestAvailableBackup.fileName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Creat la {fmtDate(latestAvailableBackup.createdAt)} | {fmtBytes(latestAvailableBackup.fileSizeBytes)}
                    </div>
                  </div>
                  <div className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    Ultimul valid
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {latestEntries.slice(0, 8).map(([key, value]) => (
                  <div key={key} className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{prettifyTableKey(key)}</div>
                    <div className="mt-1 text-base font-semibold text-[#17324D]">{value.toLocaleString("ro-RO")}</div>
                  </div>
                ))}
                {!latestEntries.length ? (
                  <div className="rounded-[18px] border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 sm:col-span-2 xl:col-span-4">
                    Snapshot-ul nu are statistici de continut disponibile.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
              Nu exista inca un backup valid din care sa putem afisa continutul.
            </div>
          )}
        </DocumentSection>
      </div>

      <DocumentSection
        title="Istoric backup-uri"
        description="Toate snapshot-urile disponibile pentru acest client, cu status clar si actiuni rapide pe fiecare."
      >
        <div className="space-y-3">
          {items.map((item, index) => {
            const isLatest = latestAvailableBackup?.id === item.id
            const contentPreview = getTableCountEntries(item).slice(0, 5)

            return (
              <div
                key={item.id}
                className={`rounded-[24px] border p-4 shadow-sm shadow-slate-900/[0.03] ${
                  isLatest ? "border-emerald-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F5FBF6_100%)]" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-[#17324D]">{item.label || `Backup ${index + 1}`}</div>
                      {isLatest ? (
                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                          Ultimul valid
                        </span>
                      ) : null}
                      {item.fileExists === false ? (
                        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                          Fisier lipsa
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                          Disponibil pe server
                        </span>
                      )}
                    </div>

                    <div className="mt-1 break-all text-sm text-slate-500">{item.fileName}</div>

                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Creat la</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">{fmtDate(item.createdAt)}</div>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Marime</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">{fmtBytes(item.fileSizeBytes)}</div>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Preview continut</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">
                          {contentPreview.length ? `${contentPreview.length} categorii` : "Fara preview"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {contentPreview.length ? (
                        contentPreview.map(([key, value]) => (
                          <span key={key} className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                            {prettifyTableKey(key)}: {value.toLocaleString("ro-RO")}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">Nu exista preview de continut pentru acest backup.</span>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:w-[340px]">
                    <button
                      type="button"
                      onClick={() => void handleDownload(item)}
                      disabled={downloadingId === item.id || item.fileExists === false}
                      className={documentButtonSecondaryClass}
                    >
                      <Download size={15} className="mr-2" />
                      {downloadingId === item.id ? "Se descarca..." : "Descarca"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleRecoverFiles(item)}
                      disabled={recoveringFilesId === item.id || item.fileExists === false}
                      className="inline-flex h-10 items-center justify-center rounded-[12px] border border-sky-200 bg-sky-50 px-3.5 text-[13px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCcw size={15} className="mr-2" />
                      {recoveringFilesId === item.id ? "Se recupereaza..." : "Fisiere lipsa"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleRestore(item)}
                      disabled={restoringId === item.id || item.fileExists === false}
                      className="inline-flex h-10 items-center justify-center rounded-[12px] border border-emerald-200 bg-emerald-50 px-3.5 text-[13px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw size={15} className="mr-2" />
                      {restoringId === item.id ? "Se restaureaza..." : "Restore complet"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      disabled={deletingId === item.id}
                      className="inline-flex h-10 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 size={15} className="mr-2" />
                      {deletingId === item.id ? "Se sterge..." : "Sterge"}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {!items.length ? (
            <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              {loading ? "Se incarca backup-urile..." : "Nu exista inca backup-uri pentru acest client."}
            </div>
          ) : null}
        </div>
      </DocumentSection>

      <DocumentSection
        title="Verificare rapida"
        description="Rezumat operational pentru utilizatorii care vor sa stie imediat daca pot recupera datele."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[22px] border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#17324D]">Restore complet</div>
                <div className="mt-1 text-sm text-slate-600">Pentru date ERP disparute dupa deploy, import sau eroare operationala.</div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <FileUp size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#17324D]">Restore selectiv</div>
                <div className="mt-1 text-sm text-slate-600">Pentru clienti, furnizori, produse sau alte module pierdute punctual.</div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <UploadCloud size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#17324D]">Recuperare fisiere</div>
                <div className="mt-1 text-sm text-slate-600">Pentru upload-uri si atasamente lipsa fara sa rescrii restul datelor.</div>
              </div>
            </div>
          </div>
        </div>
      </DocumentSection>
    </div>
  )
}
