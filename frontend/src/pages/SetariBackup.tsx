import { useEffect, useState } from "react"
import { Archive, Download, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { API_BASE, api, authHeaders } from "../lib/api"
import { DocumentMetric, InlineNotice, documentButtonPrimaryClass, documentButtonSecondaryClass, documentInputClass } from "../components/DocumentUi"

type BackupItem = {
  id: string
  label?: string | null
  fileName: string
  fileSizeBytes: number
  tableCounts?: Record<string, number> | null
  createdAt: string
  fileExists?: boolean
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
  const latestAvailableBackup = items.find((item) => item.fileExists !== false) || null

  async function load() {
    try {
      setLoading(true)
      setError("")
      const data = await api<{ items?: BackupItem[] }>("/api/v1/settings/backups")
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca backup-urile clientului.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
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
      setMessage("Backup-ul clientului a fost creat.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut crea backup-ul clientului.")
    } finally {
      setCreating(false)
    }
  }

  async function handleRestoreLatest() {
    if (!window.confirm("Restaurezi complet ultimul backup de pe server? Datele curente vor fi suprascrise, iar inainte de restore se va crea automat un backup de siguranta.")) {
      return
    }

    try {
      setRestoringLatest(true)
      setError("")
      setMessage("")
      const data = await api<{ message?: string }>("/api/v1/settings/backups/restore-latest", {
        method: "POST",
      })
      setMessage(data?.message || "Ultimul backup a fost restaurat.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut restaura ultimul backup.")
    } finally {
      setRestoringLatest(false)
    }
  }

  async function handleRecoverLatestFiles() {
    if (!window.confirm("Recuperezi doar fisierele lipsa din ultimul backup? Nu se suprascriu datele si nu se ating fisierele existente.")) {
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
    } catch (err: any) {
      setError(err?.message || "Nu am putut recupera fisierele lipsa.")
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
    } catch (err: any) {
      setError(err?.message || "Nu am putut restaura backup-ul incarcat.")
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
    } catch (err: any) {
      setError(err?.message || "Nu am putut descarca backup-ul.")
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete(item: BackupItem) {
    if (!window.confirm(`Stergi backup-ul ${item.fileName}?`)) return
    try {
      setDeletingId(item.id)
      setError("")
      await api(`/api/v1/settings/backups/${item.id}`, { method: "DELETE" })
      setMessage("Backup-ul a fost sters.")
      await load()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sterge backup-ul.")
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRestore(item: BackupItem) {
    if (!window.confirm(`Restaurezi complet backup-ul ${item.fileName}? Datele curente de configurare, nomenclator si utilizatori vor fi suprascrise.`)) {
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
    } catch (err: any) {
      setError(err?.message || "Nu am putut restaura backup-ul.")
    } finally {
      setRestoringId(null)
    }
  }

  async function handleRecoverFiles(item: BackupItem) {
    if (!window.confirm(`Recuperezi doar fisierele lipsa din backup-ul ${item.fileName}? Nu se suprascriu fisierele existente si nu se ating datele din ERP.`)) {
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
    } catch (err: any) {
      setError(err?.message || "Nu am putut recupera fisierele lipsa din backup.")
    } finally {
      setRecoveringFilesId(null)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Backup client"
        subtitle="Salvezi, descarci si restaurezi copii complete ale datelor clientului, cu acces rapid la istoricul snapshot-urilor pastrate pe server."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Backup-uri salvate" value={loading ? "..." : String(items.length)} tone="slate" />
        <DocumentMetric title="Ultimul backup" value={latestAvailableBackup ? fmtDate(latestAvailableBackup.createdAt) : "-"} tone="blue" />
        <DocumentMetric title="Siguranta date" value="Activ" tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Creeaza backup nou</div>
            <div className="mt-1 text-sm font-semibold text-[#17324D]">Salvezi o copie completa a datelor clientului curent.</div>
            <div className="mt-2 text-sm text-slate-500">Sunt incluse datele importante si fisierele necesare, iar restaurarea se face direct din copiile salvate pe server.</div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Eticheta optionala: inainte-update, final-luna..."
              className={`${documentInputClass} min-w-[280px]`}
            />
            <button type="button" onClick={handleCreate} disabled={creating} className={documentButtonPrimaryClass}>
              <Archive size={16} className="mr-2" />
              {creating ? "Se creeaza..." : "Creeaza backup"}
            </button>
            <button
              type="button"
              onClick={handleRestoreLatest}
              disabled={restoringLatest || creating || !latestAvailableBackup}
              className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw size={16} className="mr-2" />
              {restoringLatest ? "Se restaureaza..." : "Restore complet"}
            </button>
            <button
              type="button"
              onClick={handleRecoverLatestFiles}
              disabled={recoveringLatestFiles || creating || !latestAvailableBackup}
              className="inline-flex items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={16} className="mr-2" />
              {recoveringLatestFiles ? "Se recupereaza..." : "Recupereaza fisiere lipsa"}
            </button>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-60">
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
              <RotateCcw size={16} className="mr-2" />
              {uploadRestoring ? "Se incarca..." : "Restore din ZIP"}
            </label>
            <button type="button" onClick={load} disabled={loading || creating} className={documentButtonSecondaryClass}>
              <RefreshCcw size={16} className="mr-2" />
              Reincarca
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Backup-uri disponibile</div>
          <div className="mt-1 text-sm font-semibold text-[#17324D]">Istoric snapshot-uri pentru acest client</div>
          <div className="mt-2 text-sm text-slate-500">Ai intr-un singur loc toate copiile disponibile, cu acces direct la descarcare, restaurare sau stergere.</div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Eticheta</th>
                <th className="px-3 py-2 text-left font-semibold">Fisier</th>
                <th className="px-3 py-2 text-left font-semibold">Marime</th>
                <th className="px-3 py-2 text-left font-semibold">Creat la</th>
                <th className="px-3 py-2 text-left font-semibold">Continut</th>
                <th className="px-3 py-2 text-right font-semibold">Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="px-3 py-3 font-semibold text-slate-900">{item.label || "-"}</td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{item.fileName}</div>
                    {item.fileExists === false ? (
                      <div className="mt-1 text-xs font-medium text-rose-600">Fisier lipsa de pe server</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{fmtBytes(item.fileSizeBytes)}</td>
                  <td className="px-3 py-3 text-slate-600">{fmtDate(item.createdAt)}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {item.tableCounts && typeof item.tableCounts === "object"
                      ? Object.entries(item.tableCounts).slice(0, 4).map(([key, value]) => `${key}: ${value}`).join(" | ")
                      : "-"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownload(item)}
                        disabled={downloadingId === item.id || item.fileExists === false}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Download size={15} />
                        {downloadingId === item.id ? "Se descarca..." : "Descarca"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRecoverFiles(item)}
                        disabled={recoveringFilesId === item.id || item.fileExists === false}
                        className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RefreshCcw size={15} />
                        {recoveringFilesId === item.id ? "Se recupereaza..." : "Fisiere lipsa"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRestore(item)}
                        disabled={restoringId === item.id || item.fileExists === false}
                        className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RotateCcw size={15} />
                        {restoringId === item.id ? "Se restaureaza..." : "Restore complet"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.id}
                        className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 size={15} />
                        {deletingId === item.id ? "Se sterge..." : "Sterge"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                    {loading ? "Se incarca backup-urile..." : "Nu exista backup-uri pentru acest client."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
