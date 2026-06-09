import { useEffect, useMemo, useState } from "react"
import { Archive, Download, FileUp, HardDriveDownload, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
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

const moduleOrder = ["company", "users", "customers", "suppliers", "catalog", "documents", "files"]

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

function ActionCard({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[#17324D]">{title}</div>
        {meta ? <div className="text-xs text-slate-400">{meta}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
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
  const totalStoredSize = useMemo(() => items.reduce((sum, item) => sum + Number(item.fileSizeBytes || 0), 0), [items])
  const selectedBackup = useMemo(() => items.find((item) => item.id === selectedBackupId) || null, [items, selectedBackupId])
  const latestEntries = useMemo(() => getTableCountEntries(latestAvailableBackup).slice(0, 4), [latestAvailableBackup])
  const orderedModules = useMemo(() => {
    return [...availableModules].sort((a, b) => {
      const aIndex = moduleOrder.indexOf(a.key)
      const bIndex = moduleOrder.indexOf(b.key)
      const safeA = aIndex === -1 ? moduleOrder.length : aIndex
      const safeB = bIndex === -1 ? moduleOrder.length : bIndex
      if (safeA !== safeB) return safeA - safeB
      return b.recordCount - a.recordCount
    })
  }, [availableModules])

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
        setError(getErrorMessage(error, "Nu am putut citi modulele din backup."))
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
      await api("/api/v1/settings/backups", {
        method: "POST",
        body: JSON.stringify({ label }),
      })
      setLabel("")
      setMessage("Backup creat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut crea backup-ul."))
    } finally {
      setCreating(false)
    }
  }

  async function handleRestoreLatest() {
    if (!window.confirm("Restore complet din ultimul backup valid?")) return

    try {
      setRestoringLatest(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/restore-latest", { method: "POST" })
      setMessage(data?.message || "Restore complet finalizat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura ultimul backup."))
    } finally {
      setRestoringLatest(false)
    }
  }

  async function handleRecoverLatestFiles() {
    if (!window.confirm("Recuperezi doar fisierele lipsa din ultimul backup?")) return

    try {
      setRecoveringLatestFiles(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/recover-files-latest", { method: "POST" })
      setMessage(data?.message || "Fisiere recuperate.")
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

      setMessage(data?.message || "Restore din ZIP finalizat.")
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
    if (!window.confirm(`Stergi ${item.fileName}?`)) return

    try {
      setDeletingId(item.id)
      setError("")
      setMessage("")
      await api(`/api/v1/settings/backups/${item.id}`, { method: "DELETE" })
      setMessage("Backup sters.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut sterge backup-ul."))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRestore(item: BackupItem) {
    if (!window.confirm(`Restore complet din ${item.fileName}?`)) return

    try {
      setRestoringId(item.id)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${item.id}/restore`, { method: "POST" })
      setMessage(data?.message || "Restore complet finalizat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura backup-ul."))
    } finally {
      setRestoringId(null)
    }
  }

  async function handleRecoverFiles(item: BackupItem) {
    if (!window.confirm(`Recuperezi fisierele lipsa din ${item.fileName}?`)) return

    try {
      setRecoveringFilesId(item.id)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${item.id}/recover-files`, { method: "POST" })
      setMessage(data?.message || "Fisiere recuperate.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut recupera fisierele lipsa din backup."))
    } finally {
      setRecoveringFilesId(null)
    }
  }

  async function handleRestoreSelectedModules() {
    if (!selectedBackup) {
      setError("Alege un backup.")
      return
    }

    if (!selectedModules.length) {
      setError("Selecteaza cel putin un modul.")
      return
    }

    if (!window.confirm(`Restore selectiv din ${selectedBackup.fileName}?`)) return

    try {
      setModuleRestoreLoading(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${selectedBackup.id}/restore-selected`, {
        method: "POST",
        body: JSON.stringify({ modules: selectedModules }),
      })
      setMessage(data?.message || "Restore selectiv finalizat.")
      await load()
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Nu am putut restaura modulele selectate."))
    } finally {
      setModuleRestoreLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader badge="backup" title="Backup" subtitle="" />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <DocumentMetric title="Total" value={loading ? "..." : String(items.length)} tone="slate" />
        <DocumentMetric title="Ultimul backup" value={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"} tone="blue" />
        <DocumentMetric title="Marime" value={loading ? "..." : fmtBytes(totalStoredSize)} tone="emerald" />
        <DocumentMetric title="Valid" value={latestAvailableBackup ? "Da" : "Nu"} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <DocumentSection
          title="Actiuni"
          description=""
          actions={
            <button type="button" onClick={() => void load()} disabled={loading} className={documentButtonSecondaryClass}>
              <RefreshCcw size={16} className="mr-2" />
              Reincarca
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <ActionCard title="Restore complet" meta={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : undefined}>
              <button
                type="button"
                onClick={() => void handleRestoreLatest()}
                disabled={!latestAvailableBackup || restoringLatest}
                className={`${documentButtonPrimaryClass} w-full`}
              >
                <HardDriveDownload size={16} className="mr-2" />
                {restoringLatest ? "Se restaureaza..." : "Ultimul backup"}
              </button>
            </ActionCard>

            <ActionCard title="Fisiere lipsa">
              <button
                type="button"
                onClick={() => void handleRecoverLatestFiles()}
                disabled={!latestAvailableBackup || recoveringLatestFiles}
                className={`${documentButtonSecondaryClass} w-full`}
              >
                <RefreshCcw size={16} className="mr-2" />
                {recoveringLatestFiles ? "Se recupereaza..." : "Recupereaza"}
              </button>
            </ActionCard>

            <ActionCard title="Backup nou">
              <div className="space-y-3">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Eticheta optionala"
                  className={documentInputClass}
                />
                <button type="button" onClick={() => void handleCreate()} disabled={creating} className={`${documentButtonPrimaryClass} w-full`}>
                  <Archive size={16} className="mr-2" />
                  {creating ? "Se creeaza..." : "Creeaza"}
                </button>
              </div>
            </ActionCard>

            <ActionCard title="Restore din ZIP">
              <label className="block">
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  disabled={uploadRestoring}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleUploadRestore(file)
                    e.currentTarget.value = ""
                  }}
                />
                <span className={`${documentButtonSecondaryClass} flex w-full cursor-pointer ${uploadRestoring ? "pointer-events-none" : ""}`}>
                  <FileUp size={16} className="mr-2" />
                  {uploadRestoring ? "Se incarca..." : "Alege ZIP"}
                </span>
              </label>
            </ActionCard>
          </div>
        </DocumentSection>

        <DocumentSection title="Ultimul backup" description="">
          {latestAvailableBackup ? (
            <div className="space-y-3">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="truncate text-sm font-semibold text-[#17324D]">{latestAvailableBackup.label || latestAvailableBackup.fileName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {fmtDate(latestAvailableBackup.createdAt)} | {fmtBytes(latestAvailableBackup.fileSizeBytes)}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {latestEntries.length ? (
                  latestEntries.map(([key, value]) => (
                    <div key={key} className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{prettifyTableKey(key)}</div>
                      <div className="mt-1 text-sm font-semibold text-[#17324D]">{value.toLocaleString("ro-RO")}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500 sm:col-span-2">
                    Fara statistici disponibile.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">Nu exista backup valid.</div>
          )}
        </DocumentSection>
      </div>

      <DocumentSection title="Restore selectiv" description="">
        <div className="grid gap-3 xl:grid-cols-[300px_1fr]">
          <div className="space-y-3">
            <select value={selectedBackupId} onChange={(e) => setSelectedBackupId(e.target.value)} className={documentInputClass}>
              <option value="">Selecteaza backup-ul</option>
              {items
                .filter((item) => item.fileExists !== false)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {fmtDate(item.createdAt)} | {item.label || item.fileName}
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={() => void handleRestoreSelectedModules()}
              disabled={!selectedBackup || !selectedModules.length || moduleLoading || moduleRestoreLoading}
              className={`${documentButtonPrimaryClass} w-full`}
            >
              <RotateCcw size={16} className="mr-2" />
              {moduleRestoreLoading ? "Se restaureaza..." : "Restore selectiv"}
            </button>
          </div>

          <div>
            {moduleLoading ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">Se incarca...</div>
            ) : !selectedBackup ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">Alege un backup.</div>
            ) : !orderedModules.length ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">Nu exista module disponibile.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {orderedModules.map((module) => {
                  const isSelected = selectedModules.includes(module.key)
                  return (
                    <label
                      key={module.key}
                      className={`cursor-pointer rounded-[18px] border px-3 py-3 ${
                        isSelected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
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
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-[#17324D]">{module.label}</div>
                            <div className="text-xs text-slate-500">{module.recordCount.toLocaleString("ro-RO")}</div>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{module.description}</div>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Istoric" description="">
        <div className="space-y-2">
          {items.length ? (
            items.map((item, index) => {
              const isLatest = latestAvailableBackup?.id === item.id
              return (
                <div key={item.id} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-[#17324D]">{item.label || `Backup ${index + 1}`}</div>
                        {isLatest ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                            Ultimul
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">{item.fileName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {fmtDate(item.createdAt)} | {fmtBytes(item.fileSizeBytes)}
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:flex">
                      <button
                        type="button"
                        onClick={() => void handleDownload(item)}
                        disabled={downloadingId === item.id || item.fileExists === false}
                        className={documentButtonSecondaryClass}
                      >
                        <Download size={15} className="mr-2" />
                        {downloadingId === item.id ? "..." : "Descarca"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRecoverFiles(item)}
                        disabled={recoveringFilesId === item.id || item.fileExists === false}
                        className={documentButtonSecondaryClass}
                      >
                        <RefreshCcw size={15} className="mr-2" />
                        {recoveringFilesId === item.id ? "..." : "Fisiere"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRestore(item)}
                        disabled={restoringId === item.id || item.fileExists === false}
                        className={documentButtonPrimaryClass}
                      >
                        <RotateCcw size={15} className="mr-2" />
                        {restoringId === item.id ? "..." : "Restore"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item)}
                        disabled={deletingId === item.id}
                        className="inline-flex h-10 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 size={15} className="mr-2" />
                        {deletingId === item.id ? "..." : "Sterge"}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              {loading ? "Se incarca..." : "Nu exista backup-uri."}
            </div>
          )}
        </div>
      </DocumentSection>
    </div>
  )
}
