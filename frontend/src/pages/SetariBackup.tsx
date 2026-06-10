import { useEffect, useMemo, useState } from "react"
import { Archive, Download, FileSpreadsheet, FileUp, History, RefreshCcw, RotateCcw, Trash2, UploadCloud } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { API_BASE, api, authHeaders } from "../lib/api"
import {
  DocumentMetric,
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
}

type SyncGroup = {
  id: string
  label: string
  children: string[]
  modal?: boolean
}

type ExportGroup = {
  id: string
  label: string
}

const syncGroups: SyncGroup[] = [
  { id: "customers", label: "Clienti", children: ["customers"] },
  { id: "suppliers", label: "Furnizori", children: ["suppliers"] },
  { id: "products", label: "Produse", children: ["products"] },
  { id: "recipes", label: "Retete", children: ["recipes"] },
  { id: "categories", label: "Categorii", children: ["categories"] },
  { id: "departments", label: "Departamente", children: ["departments"] },
  { id: "locations", label: "Locatii", children: ["locations"] },
  { id: "uoms", label: "UM", children: ["uoms"] },
  { id: "vat_rates", label: "TVA", children: ["vat_rates"] },
  {
    id: "documents",
    label: "Documente",
    modal: true,
    children: [
      "documents_purchase_receipts",
      "documents_transfers",
      "documents_inventory",
      "documents_minutes",
      "documents_production",
      "documents_sales",
      "documents_consumption",
      "documents_sales_invoices",
      "documents_external_orders",
      "documents_sale_drafts",
      "documents_kitchen_tickets",
      "documents_stock",
    ],
  },
  { id: "files", label: "Fisiere", children: ["files"] },
]

const exportGroups: ExportGroup[] = [
  { id: "departments", label: "Departamente" },
  { id: "categories", label: "Categorii" },
  { id: "customers", label: "Clienti" },
  { id: "suppliers", label: "Furnizori" },
  { id: "products", label: "Produse" },
]

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

function Card({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[#17324D]">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function SetariBackupPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<BackupItem[]>([])
  const [selectedBackupId, setSelectedBackupId] = useState("")
  const [availableModules, setAvailableModules] = useState<BackupModuleSummary[]>([])
  const [selectedModules, setSelectedModules] = useState<string[]>([])
  const [moduleLoading, setModuleLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPickerOpen, setExportPickerOpen] = useState(false)
  const [selectedExportModules, setSelectedExportModules] = useState<string[]>(exportGroups.map((item) => item.id))
  const [importing, setImporting] = useState(false)
  const [uploadRestoring, setUploadRestoring] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [recoveringFilesId, setRecoveringFilesId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const latestAvailableBackup = useMemo(() => items.find((item) => item.fileExists !== false) || null, [items])
  const selectedBackup = useMemo(() => items.find((item) => item.id === selectedBackupId) || null, [items, selectedBackupId])
  const totalStoredSize = useMemo(() => items.reduce((sum, item) => sum + Number(item.fileSizeBytes || 0), 0), [items])
  const moduleMap = useMemo(() => new Map(availableModules.map((module) => [module.key, module])), [availableModules])
  const visibleGroups = useMemo(
    () => syncGroups.filter((group) => group.children.some((child) => moduleMap.has(child))),
    [moduleMap],
  )

  async function load() {
    try {
      setLoading(true)
      setError("")
      const data = await api<{ items?: BackupItem[] }>("/api/v1/settings/backups")
      const nextItems = Array.isArray(data?.items) ? data.items : []
      setItems(nextItems)
      setSelectedBackupId((current) => {
        if (current && nextItems.some((item) => item.id === current && item.fileExists !== false)) return current
        return nextItems.find((item) => item.fileExists !== false)?.id || ""
      })
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, "Nu am putut incarca backup-urile."))
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
      } catch (loadError: unknown) {
        setAvailableModules([])
        setSelectedModules([])
        setError(getErrorMessage(loadError, "Nu am putut incarca modulele backup-ului."))
      } finally {
        setModuleLoading(false)
      }
    }

    void loadModules()
  }, [selectedBackupId])

  async function handleCreateBackup() {
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
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut crea backup-ul."))
    } finally {
      setCreating(false)
    }
  }

  function getGroupChildren(group: SyncGroup) {
    return group.children.filter((child) => moduleMap.has(child))
  }

  function isGroupSelected(group: SyncGroup) {
    const children = getGroupChildren(group)
    return children.length > 0 && children.every((child) => selectedModules.includes(child))
  }

  function getGroupSelectedCount(group: SyncGroup) {
    return getGroupChildren(group).filter((child) => selectedModules.includes(child)).length
  }

  function toggleGroup(group: SyncGroup) {
    const children = getGroupChildren(group)
    if (!children.length) return

    setSelectedModules((current) => {
      const allSelected = children.every((child) => current.includes(child))
      if (allSelected) {
        return current.filter((item) => !children.includes(item))
      }
      return Array.from(new Set([...current, ...children]))
    })
  }

  async function handleSyncCloud() {
    if (!selectedBackup) {
      setError("Alege backup-ul sursa.")
      return
    }
    if (!selectedModules.length) {
      setError("Selecteaza cel putin un modul.")
      return
    }
    if (!window.confirm(`Sync Cloud din ${selectedBackup.fileName}?`)) return

    try {
      setSyncing(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/sync-cloud", {
        method: "POST",
        body: JSON.stringify({
          backupId: selectedBackup.id,
          modules: selectedModules,
        }),
      })
      setMessage(data?.message || "Sync Cloud finalizat.")
      await load()
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut rula Sync Cloud."))
    } finally {
      setSyncing(false)
    }
  }

  async function downloadResponse(response: Response, fileName: string) {
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  async function handleExportData() {
    try {
      setExporting(true)
      setError("")
      setMessage("")
      const params = new URLSearchParams()
      selectedExportModules.forEach((item) => params.append("modules", item))
      const response = await api<Response>(`/api/v1/settings/backups/data-export?${params.toString()}`, { raw: true })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Nu am putut genera exportul.")
      }
      const disposition = response.headers.get("content-disposition") || ""
      const fileNameMatch = disposition.match(/filename="(.+)"/i)
      await downloadResponse(response, fileNameMatch?.[1] || "gufo-data-export.zip")
      setMessage("Export Excel generat.")
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut genera exportul Excel."))
    } finally {
      setExporting(false)
    }
  }

  async function handleImportData(file: File) {
    const formData = new FormData()
    formData.append("file", file)

    try {
      setImporting(true)
      setError("")
      setMessage("")
      const response = await fetch(`${API_BASE}/api/v1/settings/backups/data-import`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut importa fisierul.")
      }
      setMessage(data?.message || "Import Excel finalizat.")
      await load()
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut importa fisierul Excel."))
    } finally {
      setImporting(false)
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
        throw new Error(data?.error || "Nu am putut restaura ZIP-ul.")
      }
      setMessage(data?.message || "Restore din ZIP finalizat.")
      await load()
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut restaura ZIP-ul incarcat."))
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
      await downloadResponse(response, item.fileName)
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut descarca backup-ul."))
    } finally {
      setDownloadingId(null)
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
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut restaura backup-ul."))
    } finally {
      setRestoringId(null)
    }
  }

  async function handleRecoverFiles(item: BackupItem) {
    if (!window.confirm(`Recuperezi doar fisierele lipsa din ${item.fileName}?`)) return

    try {
      setRecoveringFilesId(item.id)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>(`/api/v1/settings/backups/${item.id}/recover-files`, { method: "POST" })
      setMessage(data?.message || "Fisiere recuperate.")
      await load()
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut recupera fisierele."))
    } finally {
      setRecoveringFilesId(null)
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
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError, "Nu am putut sterge backup-ul."))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader badge="backup" title="Backup" subtitle="" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DocumentMetric title="Backup-uri" value={loading ? "..." : String(items.length)} tone="slate" />
        <DocumentMetric title="Ultimul backup" value={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"} tone="blue" />
        <DocumentMetric title="Spatiu" value={loading ? "..." : fmtBytes(totalStoredSize)} tone="emerald" />
        <DocumentMetric title="Sursa cloud" value={selectedBackup ? fmtDate(selectedBackup.createdAt) : "-"} tone="amber" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card
          title="Sync Cloud"
          action={
            <button type="button" onClick={() => void load()} disabled={loading} className={documentButtonSecondaryClass}>
              <RefreshCcw size={16} className="mr-2" />
              Reincarca
            </button>
          }
        >
          <div className="space-y-4">
            <select value={selectedBackupId} onChange={(e) => setSelectedBackupId(e.target.value)} className={documentInputClass}>
              <option value="">Selecteaza backup-ul sursa</option>
              {items
                .filter((item) => item.fileExists !== false)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {fmtDate(item.createdAt)} | {item.label || item.fileName}
                  </option>
                ))}
            </select>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedModules(Array.from(new Set(visibleGroups.flatMap((group) => getGroupChildren(group)))))}
                disabled={!visibleGroups.length}
                className={documentButtonSecondaryClass}
              >
                Selecteaza tot
              </button>
              <button
                type="button"
                onClick={() => setSelectedModules([])}
                disabled={!selectedModules.length}
                className={documentButtonSecondaryClass}
              >
                Reseteaza
              </button>
            </div>

            {moduleLoading ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">Se incarca modulele...</div>
            ) : !visibleGroups.length ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">Nu exista module disponibile.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {visibleGroups.map((group) => {
                  const checked = isGroupSelected(group)
                  const selectedCount = getGroupSelectedCount(group)
                  const totalCount = getGroupChildren(group).length
                  const primaryModule = moduleMap.get(getGroupChildren(group)[0] || "")
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        if (group.modal) {
                          setDocumentPickerOpen(true)
                          return
                        }
                        toggleGroup(group)
                      }}
                      className={`rounded-[18px] border px-3 py-3 text-left transition ${
                        checked ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[#17324D]">{group.label}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {group.modal
                              ? `${selectedCount}/${totalCount} tipuri selectate`
                              : primaryModule
                                ? `${primaryModule.recordCount.toLocaleString("ro-RO")} in backup`
                                : "Disponibil"}
                          </div>
                          {group.modal ? <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">Alege din popup</div> : null}
                        </div>
                        <div
                          className={`inline-flex min-w-[56px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            checked ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {group.modal ? `${selectedCount}/${totalCount}` : checked ? "Activ" : "Off"}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSyncCloud()}
              disabled={!selectedBackup || !selectedModules.length || syncing || moduleLoading}
              className={`${documentButtonPrimaryClass} w-full`}
            >
              <RefreshCcw size={16} className="mr-2" />
              {syncing ? "Se sincronizeaza..." : "Sync Cloud"}
            </button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card
            title="Import / Export"
            action={
              <button type="button" onClick={() => setHistoryOpen(true)} className={documentButtonSecondaryClass}>
                <History size={16} className="mr-2" />
                Istoric
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setExportPickerOpen((current) => !current)}
                  className={`${documentButtonSecondaryClass} w-full justify-between`}
                >
                  <span className="flex items-center">
                    <FileSpreadsheet size={16} className="mr-2" />
                    Alege exportul
                  </span>
                  <span className="text-xs text-slate-500">{selectedExportModules.length}/{exportGroups.length}</span>
                </button>

                {exportPickerOpen ? (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-2">
                      {exportGroups.map((group) => {
                        const checked = selectedExportModules.includes(group.id)
                        return (
                          <label key={group.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2">
                            <span className="text-sm font-medium text-[#17324D]">{group.label}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedExportModules((current) =>
                                  checked ? current.filter((item) => item !== group.id) : [...current, group.id],
                                )
                              }
                            />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleExportData()}
                  disabled={exporting || !selectedExportModules.length}
                  className={`${documentButtonPrimaryClass} w-full`}
                >
                  <FileSpreadsheet size={16} className="mr-2" />
                  {exporting ? "Se genereaza..." : "Export Excel"}
                </button>
              </div>

              <label className="block">
                <input
                  type="file"
                  accept=".zip,.xlsx,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleImportData(file)
                    e.currentTarget.value = ""
                  }}
                />
                <span className={`${documentButtonSecondaryClass} flex w-full cursor-pointer ${importing ? "pointer-events-none" : ""}`}>
                  <UploadCloud size={16} className="mr-2" />
                  {importing ? "Se importa..." : "Import Excel"}
                </span>
              </label>
            </div>
          </Card>

          <Card title="Backup server">
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void handleCreateBackup()} disabled={creating} className={`${documentButtonPrimaryClass} w-full`}>
                <Archive size={16} className="mr-2" />
                {creating ? "Se creeaza..." : "Creeaza backup"}
              </button>

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
                  {uploadRestoring ? "Se incarca..." : "Importa ZIP"}
                </span>
              </label>
            </div>
          </Card>

          <Card title="Ultimul backup">
            {latestAvailableBackup ? (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[#17324D]">{latestAvailableBackup.label || latestAvailableBackup.fileName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {fmtDate(latestAvailableBackup.createdAt)} | {fmtBytes(latestAvailableBackup.fileSizeBytes)}
                    </div>
                  </div>
                  <button type="button" onClick={() => setHistoryOpen(true)} className={documentButtonSecondaryClass}>
                    <History size={16} className="mr-2" />
                    Istoric
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">Nu exista backup valid.</div>
            )}
          </Card>
        </div>
      </div>

      {documentPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/15">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Sync Cloud</div>
                <div className="mt-1 text-lg font-semibold text-[#17324D]">Alege documentele</div>
              </div>
              <button type="button" onClick={() => setDocumentPickerOpen(false)} className={documentButtonSecondaryClass}>
                Inchide
              </button>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {syncGroups
                .find((group) => group.id === "documents")
                ?.children.filter((child) => moduleMap.has(child))
                .map((child) => {
                  const module = moduleMap.get(child)
                  const checked = selectedModules.includes(child)
                  if (!module) return null
                  return (
                    <label
                      key={child}
                      className={`cursor-pointer rounded-[18px] border px-3 py-3 transition ${
                        checked ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedModules((current) =>
                              event.target.checked ? Array.from(new Set([...current, child])) : current.filter((item) => item !== child),
                            )
                          }}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[#17324D]">{module.label.replace("Documente: ", "")}</div>
                          <div className="mt-1 text-xs text-slate-500">{module.recordCount.toLocaleString("ro-RO")} in backup</div>
                        </div>
                      </div>
                    </label>
                  )
                })}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const allDocumentChildren =
                    syncGroups.find((group) => group.id === "documents")?.children.filter((child) => moduleMap.has(child)) || []
                  setSelectedModules((current) => Array.from(new Set([...current, ...allDocumentChildren])))
                }}
                className={documentButtonSecondaryClass}
              >
                Selecteaza tot
              </button>
              <button
                type="button"
                onClick={() => {
                  const allDocumentChildren =
                    syncGroups.find((group) => group.id === "documents")?.children.filter((child) => moduleMap.has(child)) || []
                  setSelectedModules((current) => current.filter((item) => !allDocumentChildren.includes(item)))
                }}
                className={documentButtonSecondaryClass}
              >
                Reseteaza
              </button>
              <button type="button" onClick={() => setDocumentPickerOpen(false)} className={documentButtonPrimaryClass}>
                Salveaza selectia
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-950/15">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Istoric backup</div>
                <div className="mt-1 text-lg font-semibold text-[#17324D]">Backup-uri salvate pe server</div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Inchide
              </button>
            </div>

            <div className="max-h-[calc(88vh-88px)] space-y-3 overflow-y-auto px-6 py-5">
              {items.length ? (
                items.map((item, index) => {
                  const isLatest = latestAvailableBackup?.id === item.id
                  return (
                    <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-[#17324D]">{item.label || `Backup ${index + 1}`}</div>
                            {isLatest ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                                Ultimul
                              </span>
                            ) : null}
                            {item.fileExists === false ? (
                              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                                Fisier lipsa
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
                <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  {loading ? "Se incarca..." : "Nu exista backup-uri."}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
