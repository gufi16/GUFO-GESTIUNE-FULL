import { ChevronDown, ChevronUp, Search } from "lucide-react"
import { useMemo, useState } from "react"

type Column<T> = {
  key: keyof T | string
  label: string
  sortable?: boolean
  className?: string
  render?: (row: T) => React.ReactNode
  type?: "status"
}

type DataTableProps<T> = {
  title?: string
  subtitle?: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  searchPlaceholder?: string
  pageSizeOptions?: number[]
  initialPageSize?: number
  emptyText?: string
}

function normalize(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "activ" : "inactiv"
  return String(value)
}

function StatusBadge({ value }: { value: unknown }) {
  const normalized = normalize(value).toLowerCase()

  const isActive =
    normalized === "activ" ||
    normalized === "active" ||
    normalized === "final" ||
    normalized === "posted" ||
    normalized === "true"

  const isWarning =
    normalized === "draft" ||
    normalized === "inactiv" ||
    normalized === "inactive" ||
    normalized === "false"

  const cls = isActive
    ? "bg-emerald-100 text-emerald-700"
    : isWarning
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-700"

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {normalize(value)}
    </span>
  )
}

export default function DataTable<T>({
  title,
  subtitle,
  columns,
  rows,
  rowKey,
  searchPlaceholder = "Caută în tabel...",
  pageSizeOptions = [10, 25, 50],
  initialPageSize = 10,
  emptyText = "Nu există date."
}: DataTableProps<T>) {
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows

    return rows.filter((row) =>
      columns.some((col) => {
        if (col.render) return false
        const value = normalize((row as Record<string, unknown>)[String(col.key)]).toLowerCase()
        return value.includes(q)
      })
    )
  }, [rows, columns, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered

    return [...filtered].sort((a, b) => {
      const av = normalize((a as Record<string, unknown>)[sortKey]).toLowerCase()
      const bv = normalize((b as Record<string, unknown>)[sortKey]).toLowerCase()
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages)

  const paged = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, currentPage, pageSize])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
    setPage(1)
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      {(title || subtitle) && (
        <div className="mb-5">
          {title ? <div className="text-lg font-semibold text-slate-900">{title}</div> : null}
          {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Pagini:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size} / pagină
              </option>
            ))}
          </select>
        </div>
      </div>

      {paged.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={String(col.key)}
                      className={`px-4 py-3 text-left font-medium ${col.className || ""}`}
                    >
                      {col.sortable === false || col.render ? (
                        col.label
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(String(col.key))}
                          className="inline-flex items-center gap-1 font-medium text-slate-500"
                        >
                          {col.label}
                          {sortKey === String(col.key) ? (
                            sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                          ) : null}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((row, index) => (
                  <tr key={rowKey(row, index)} className="border-t border-slate-200 hover:bg-slate-50/70">
                    {columns.map((col) => (
                      <td key={String(col.key)} className={`px-4 py-3 align-middle ${col.className || ""}`}>
                        {col.render ? (
                          col.render(row)
                        ) : col.type === "status" ? (
                          <StatusBadge value={(row as Record<string, unknown>)[String(col.key)]} />
                        ) : (
                          normalize((row as Record<string, unknown>)[String(col.key)])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-500">
              {sorted.length} rezultate • pagina {currentPage} din {totalPages}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Înapoi
              </button>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Înainte
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
