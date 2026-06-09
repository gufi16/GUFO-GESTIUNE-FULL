import { useEffect, useMemo, useState } from "react"
import { Archive, Download, FileUp, HardDriveDownload, RefreshCcw, RotateCcw, ShieldCheck, Trash2 } from "lucide-react"
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

type BackupActionCardProps = {
  title: string
  description: string
  hint: string
  tone: "slate" | "emerald" | "sky" | "amber"
  icon: typeof Archive
  actionLabel: string
  loadingLabel: string
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  children?: React.ReactNode
}

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

function BackupActionCard({
  title,
  description,
  hint,
  tone,
  icon: Icon,
  actionLabel,
  loadingLabel,
  disabled,
  loading,
  onClick,
  children,
}: BackupActionCardProps) {
  const toneClasses: Record<BackupActionCardProps["tone"], string> = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-[linear-gradient(180deg,#F8FFFA_0%,#F0FAF3_100%)]",
    sky: "border-sky-200 bg-[linear-gradient(180deg,#F8FCFF_0%,#EEF8FF_100%)]",
    amber: "border-amber-200 bg-[linear-gradient(180deg,#FFFDF7_0%,#FBF4E9_100%)]",
  }

  const iconClasses: Record<BackupActionCardProps["tone"], string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    sky: "bg-sky-100 text-sky-700",
    amber: "bg-amber-100 text-amber-700",
  }

  return (
    <div className={`rounded-[22px] border p-4 shadow-sm shadow-slate-900/[0.03] ${toneClasses[tone]}`}>
      <div className="flex items-start gap-3">
        <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconClasses[tone]}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#17324D]">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
          <div className="mt-3 rounded-2xl border border-white/80 bg-white/80 px-3 py-2 text-xs leading-5 text-slate-500">
            {hint}
          </div>
        </div>
      </div>

      {children ? <div className="mt-4">{children}</div> : null}

      {onClick ? (
        <button type="button" onClick={onClick} disabled={disabled || loading} className={`${documentButtonPrimaryClass} mt-4 w-full`}>
          {loading ? loadingLabel : actionLabel}
        </button>
      ) : null}
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
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [label, setLabel] = useState("")
  const [items, setItems] = useState<BackupItem[]>([])

  const latestAvailableBackup = useMemo(
    () => items.find((item) => item.fileExists !== false) || null,
    [items],
  )
  const latestEntries = useMemo(() => getTableCountEntries(latestAvailableBackup), [latestAvailableBackup])
  const totalStoredSize = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.fileSizeBytes || 0), 0),
    [items],
  )
  const totalLatestRecords = useMemo(
    () => latestEntries.reduce((sum, [, count]) => sum + count, 0),
    [latestEntries],
  )

  async function load() {
    try {
      setLoading(true)
      setError("")
      const data = await api<{ items?: BackupItem[] }>("/api/v1/settings/backups")
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut incarca backup-urile clientului."))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Backup si recuperare date"
        subtitle="Aici lucrezi cu copiile salvate pe server pentru clientul curent. Pagina este organizata pe scenarii reale: creezi snapshot-uri, restaurezi complet ERP-ul sau recuperezi doar fisierele lipsa."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Snapshot-uri salvate" value={loading ? "..." : String(items.length)} tone="slate" />
        <DocumentMetric title="Ultimul backup valid" value={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"} tone="blue" />
        <DocumentMetric title="Date in ultimul backup" value={latestAvailableBackup ? totalLatestRecords.toLocaleString("ro-RO") : "-"} tone="emerald" />
        <DocumentMetric title="Spatiu ocupat" value={loading ? "..." : fmtBytes(totalStoredSize)} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <section className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#17324D_0%,#22486D_100%)] p-5 text-white shadow-sm shadow-slate-900/10">
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-100">
              Centru de recuperare
            </div>
            <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">Daca s-a pierdut ceva, de aici incepi</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">
              Pentru date ERP disparute folosesti restore complet dintr-un backup de pe server. Pentru documente sau atasamente lipsa folosesti recuperarea fisierelor.
              Daca ai un ZIP din alta sursa, il poti incarca si restaura manual.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Caz 1</div>
                <div className="mt-1 text-sm font-semibold">Au disparut date din ERP</div>
                <div className="mt-1 text-xs leading-5 text-slate-200">Folosesti restore complet dintr-un backup valid de pe server.</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Caz 2</div>
                <div className="mt-1 text-sm font-semibold">Lipsesc fisiere sau atasamente</div>
                <div className="mt-1 text-xs leading-5 text-slate-200">Folosesti recuperarea fisierelor lipsa fara sa suprascrii ERP-ul.</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Caz 3</div>
                <div className="mt-1 text-sm font-semibold">Ai un ZIP local</div>
                <div className="mt-1 text-xs leading-5 text-slate-200">Incarci arhiva si rulezi restore-ul controlat din ea.</div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <ShieldCheck size={20} />
              </div>
              <div>
                <div className="text-sm font-semibold">Ultimul backup disponibil pe server</div>
                <div className="mt-1 text-sm text-slate-200">
                  {latestAvailableBackup ? latestAvailableBackup.fileName : "Nu exista inca un backup valid pentru acest client."}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Creat la</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Marime</div>
                <div className="mt-1 text-sm font-semibold">{latestAvailableBackup ? fmtBytes(latestAvailableBackup.fileSizeBytes) : "-"}</div>
              </div>
            </div>

            <div className="mt-4 text-xs leading-5 text-slate-200">
              Restore-ul complet creeaza automat un backup de siguranta inainte sa suprascrie datele curente.
            </div>
          </div>
        </div>
      </section>

      <DocumentSection
        title="Actiuni rapide de recuperare"
        description="Foloseste actiunea potrivita pentru problema concreta, ca sa nu suprascrii inutil date bune."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={documentButtonSecondaryClass}>
            <RefreshCcw size={16} className="mr-2" />
            Reincarca
          </button>
        }
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <BackupActionCard
            title="Restore complet din ultimul backup de pe server"
            description="Refaci datele ERP ale clientului din cel mai recent snapshot valid pastrat pe server."
            hint="Foloseste aceasta optiune daca au disparut clienti, produse, utilizatori, configurari sau documente din ERP."
            tone="emerald"
            icon={HardDriveDownload}
            actionLabel="Restore complet din server"
            loadingLabel="Se restaureaza..."
            disabled={!latestAvailableBackup}
            loading={restoringLatest}
            onClick={() => void handleRestoreLatest()}
          />

          <BackupActionCard
            title="Recupereaza doar fisierele lipsa"
            description="Aduce inapoi doar fisierele de upload lipsa, fara sa suprascrie datele existente din ERP."
            hint="Foloseste aceasta optiune cand lipsesc atasamente, imagini sau fisiere, dar datele din ERP sunt in regula."
            tone="sky"
            icon={RefreshCcw}
            actionLabel="Recupereaza fisierele lipsa"
            loadingLabel="Se recupereaza..."
            disabled={!latestAvailableBackup}
            loading={recoveringLatestFiles}
            onClick={() => void handleRecoverLatestFiles()}
          />

          <BackupActionCard
            title="Restore dintr-un ZIP incarcat manual"
            description="Incarci un backup local si il restaurezi daca nu vrei sa folosesti direct ultimul snapshot de pe server."
            hint="Util daca ai exportat backup-ul in afara sistemului sau ai primit arhiva de la suport."
            tone="amber"
            icon={FileUp}
            actionLabel="Alege ZIP pentru restore"
            loadingLabel="Se incarca..."
            disabled={creating || uploadRestoring}
            loading={uploadRestoring}
          >
            <label className="block">
              <input
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                disabled={uploadRestoring || creating}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    void handleUploadRestore(file)
                  }
                  e.currentTarget.value = ""
                }}
              />
              <span className={`${documentButtonPrimaryClass} mt-4 flex w-full cursor-pointer ${uploadRestoring || creating ? "pointer-events-none" : ""}`}>
                {uploadRestoring ? "Se incarca..." : "Alege ZIP pentru restore"}
              </span>
            </label>
          </BackupActionCard>
        </div>
      </DocumentSection>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_1.2fr]">
        <DocumentSection
          title="Creeaza backup nou"
          description="Salvezi manual un snapshot complet al clientului curent pe server, ca punct sigur de revenire inainte de update-uri sau modificari mari."
        >
          <div className="grid gap-3 lg:grid-cols-[1.2fr_auto]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Eticheta optionala</div>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: inainte-update, final-luna, inainte-import-clienti"
                className={`${documentInputClass} mt-2`}
              />
              <div className="mt-2 text-xs leading-5 text-slate-500">
                Backup-ul este salvat in istoricul clientului si poate fi restaurat sau descarcat ulterior.
              </div>
            </div>
            <button type="button" onClick={() => void handleCreate()} disabled={creating} className={`${documentButtonPrimaryClass} h-11 px-5`}>
              <Archive size={16} className="mr-2" />
              {creating ? "Se creeaza..." : "Creeaza backup"}
            </button>
          </div>
        </DocumentSection>

        <DocumentSection
          title="Ce contine ultimul backup"
          description="Vedere rapida a principalelor colectii salvate in snapshot-ul cel mai recent disponibil."
        >
          {latestAvailableBackup ? (
            <div className="space-y-3">
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-3">
                <div className="text-sm font-semibold text-[#17324D]">{latestAvailableBackup.label || latestAvailableBackup.fileName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Creat la {fmtDate(latestAvailableBackup.createdAt)} · {fmtBytes(latestAvailableBackup.fileSizeBytes)}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {latestEntries.slice(0, 8).map(([key, value]) => (
                  <div key={key} className="rounded-[16px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{prettifyTableKey(key)}</div>
                    <div className="mt-1 text-base font-semibold text-[#17324D]">{value.toLocaleString("ro-RO")}</div>
                  </div>
                ))}
                {!latestEntries.length ? (
                  <div className="rounded-[16px] border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 sm:col-span-2">
                    Snapshot-ul nu are statistici de continut disponibile.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-slate-300 px-3.5 py-5 text-sm text-slate-500">
              Nu exista inca un backup valid din care sa putem afisa continutul.
            </div>
          )}
        </DocumentSection>
      </div>

      <DocumentSection
        title="Istoric backup-uri pe server"
        description="Fiecare snapshot poate fi descarcat, restaurat complet sau folosit doar pentru recuperarea fisierelor lipsa."
      >
        <div className="space-y-3">
          {items.map((item, index) => {
            const isLatest = latestAvailableBackup?.id === item.id
            const contentPreview = getTableCountEntries(item).slice(0, 5)

            return (
              <div
                key={item.id}
                className={`rounded-[22px] border p-4 shadow-sm shadow-slate-900/[0.03] ${
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
                      ) : null}
                    </div>

                    <div className="mt-1 text-sm text-slate-500">{item.fileName}</div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Creat la</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">{fmtDate(item.createdAt)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Marime</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">{fmtBytes(item.fileSizeBytes)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Status</div>
                        <div className="mt-1 text-sm font-semibold text-[#17324D]">{item.fileExists === false ? "Fisier indisponibil" : "Disponibil pe server"}</div>
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

                  <div className="grid gap-2 sm:grid-cols-2 xl:w-[320px]">
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
            <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              {loading ? "Se incarca backup-urile..." : "Nu exista inca backup-uri pentru acest client."}
            </div>
          ) : null}
        </div>
      </DocumentSection>
    </div>
  )
}
