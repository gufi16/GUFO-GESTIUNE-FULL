import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Printer } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  InlineNotice,
  documentButtonPrimaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { openPdfInNewTab } from "../lib/pdf"
import { formatMoneyRo } from "../lib/format"

function formatDate(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString("ro-RO")
}

function formatMoney(value: any, currency = "RON") {
  return formatMoneyRo(value, currency)
}

function normalizeResponse(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.receipts)) return data.receipts
  if (Array.isArray(data?.data)) return data.data
  return []
}

function statusClass(status: string) {
  if (status === "POSTED") {
    return "bg-emerald-100 text-emerald-700 border border-emerald-200"
  }

  if (status === "CANCELLED") {
    return "bg-red-100 text-red-700 border border-red-200"
  }

  return "bg-slate-100 text-slate-700 border border-slate-200"
}

function sourceBadge(row: any) {
  if (row?.sourceIncomingEInvoiceId || row?.spvDownloadId || row?.spvUploadIndex) {
    return {
      label: "SPV",
      className: "bg-blue-50 text-blue-700 border border-blue-200",
    }
  }

  return {
    label: "Local",
    className: "bg-slate-100 text-slate-700 border border-slate-200",
  }
}

const PAGE_SIZE = 10

export default function NirListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = getToken() || ""

  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState(() => searchParams.get("q") || "")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [supplierFilter, setSupplierFilter] = useState("ALL")
  const [locationFilter, setLocationFilter] = useState("ALL")
  const [activeLocationId, setActiveLocationIdState] = useState(getActiveLocationId())
  const [page, setPage] = useState(1)

  useEffect(() => {
    loadRows()
    return subscribeToActiveLocation((locationId) => setActiveLocationIdState(locationId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const nextQuery = searchParams.get("q") || ""
    setSearch((prev) => (prev === nextQuery ? prev : nextQuery))
  }, [searchParams])

  useEffect(() => {
    const current = searchParams.get("q") || ""
    const normalized = search.trim()
    if (current === normalized) return
    const next = new URLSearchParams(searchParams)
    if (normalized) next.set("q", normalized)
    else next.delete("q")
    setSearchParams(next, { replace: true })
  }, [search, searchParams, setSearchParams])

  async function loadRows() {
    setLoading(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts`, {
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {},
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setRows([])
        setLoading(false)
        return
      }

      const list = normalizeResponse(data)

      if (!res.ok) {
        setError(data?.error || "Nu am putut incarca receptiile NIR.")
        setRows([])
        setLoading(false)
        return
      }

      setRows(list)
    } catch {
      setError("Nu pot incarca lista NIR din backend.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function openReceiptPdf(id: string) {
    try {
      const res = await fetch(`${API}/api/v1/purchase-receipts/${id}/pdf`, {
        headers: authHeaders(),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Nu am putut genera PDF-ul receptiei.")
      }

      await openPdfInNewTab(res)
    } catch (e: any) {
      setError(e?.message || "Nu am putut genera PDF-ul receptiei.")
    }
  }

  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>()
    rows.forEach((row) => {
      const name =
        row?.supplier?.name ||
        row?.supplierName ||
        row?.vendor?.name ||
        "Furnizor necunoscut"
      if (!map.has(name)) map.set(name, name)
    })
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const locationOptions = useMemo(() => {
    const map = new Map<string, string>()
    rows.forEach((row) => {
      const name = row?.location?.name || row?.warehouse?.name || "Fara locatie"
      if (!map.has(name)) map.set(name, name)
    })
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()

    return rows.filter((row) => {
      const docNo = String(row?.docNo || row?.number || "").toLowerCase()
      const supplier = String(
        row?.supplier?.name || row?.supplierName || row?.vendor?.name || ""
      ).toLowerCase()
      const location = String(
        row?.location?.name || row?.warehouse?.name || ""
      ).toLowerCase()
      const status = String(row?.status || "DRAFT").toUpperCase()

      const matchesSearch = !q || docNo.includes(q) || supplier.includes(q) || location.includes(q)
      const matchesStatus = statusFilter === "ALL" || status === statusFilter

      const supplierName =
        row?.supplier?.name ||
        row?.supplierName ||
        row?.vendor?.name ||
        "Furnizor necunoscut"

      const locationName = row?.location?.name || row?.warehouse?.name || "Fara locatie"

      const matchesSupplier = supplierFilter === "ALL" || supplierName === supplierFilter
      const matchesLocation =
        (locationFilter === "ALL" || locationName === locationFilter) &&
        (!activeLocationId || String(row?.location?.id || row?.warehouse?.id || "") === activeLocationId)

      return matchesSearch && matchesStatus && matchesSupplier && matchesLocation
    })
  }, [rows, search, statusFilter, supplierFilter, locationFilter, activeLocationId])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, supplierFilter, locationFilter, activeLocationId])

  useEffect(() => {
    if (searchParams.get("open") !== "1" || !search.trim() || filteredRows.length === 0) return
    const needle = search.trim().toLowerCase()
    const match =
      filteredRows.find((row) => String(row?.docNo || row?.number || "").trim().toLowerCase() === needle) ||
      filteredRows.find((row) =>
        [
          row?.docNo || row?.number || "",
          row?.supplier?.name || row?.supplierName || row?.vendor?.name || "",
          row?.location?.name || row?.warehouse?.name || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )

    if (!match?.id) return

    const next = new URLSearchParams(searchParams)
    next.delete("open")
    setSearchParams(next, { replace: true })
    navigate(`/inregistrare-document/nir/edit?id=${match.id}`)
  }, [filteredRows, navigate, search, searchParams, setSearchParams])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [filteredRows, safePage])

  const stats = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        const total =
          Number(row?.totalGrossRon) ||
          Number(row?.totalRon) ||
          Number(row?.grandTotal) ||
          Number(row?.total) ||
          0

        acc.count += 1
        acc.total += total

        if ((row?.status || "DRAFT") === "POSTED") acc.posted += 1
        if ((row?.status || "DRAFT") === "DRAFT") acc.draft += 1
        if ((row?.status || "DRAFT") === "CANCELLED") acc.cancelled += 1

        return acc
      },
      { count: 0, total: 0, posted: 0, draft: 0, cancelled: 0 }
    )
  }, [filteredRows])

  return (
    <div className="space-y-3">
      <PageHeader
        badge="Operatiuni"
        title="Receptii NIR"
        subtitle="Monitorizeaza receptiile de marfa, filtreaza rapid documentele postate sau ramase in draft si intra direct in registrele care cer actiune."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Documente" value={stats.count} tone="slate" />
        <DocumentMetric title="Draft" value={stats.draft} tone="amber" />
        <DocumentMetric title="Postate" value={stats.posted} tone="emerald" />
        <DocumentMetric title="Total" value={formatMoney(stats.total)} tone="blue" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(220px,1.1fr)_180px_200px_minmax(240px,1fr)_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cauta dupa numar, furnizor sau locatie..."
            className={documentInputClass}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={documentInputClass}
          >
            <option value="ALL">Toate statusurile</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className={documentInputClass}
          >
            <option value="ALL">Toti furnizorii</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className={documentInputClass}
            >
              <option value="ALL">Toate locatiile</option>
              {locationOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigate("/inregistrare-document/nir/new")}
              className={documentButtonPrimaryClass}
            >
              NIR nou
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-[1040px] w-full text-[13px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Numar</th>
              <th className="px-3 py-2.5 text-left font-medium">Data</th>
              <th className="px-3 py-2.5 text-left font-medium">Furnizor</th>
              <th className="px-3 py-2.5 text-left font-medium">Locatie / gestiune</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
              <th className="px-3 py-2.5 text-right font-medium">Actiune</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  Se incarca lista NIR...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  Nu exista documente care sa corespunda filtrelor.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const supplier =
                  row?.supplier?.name ||
                  row?.supplierName ||
                  row?.vendor?.name ||
                  "Furnizor necunoscut"

                const location = row?.location?.name || "Fara locatie"
                const warehouse = row?.warehouse?.name || "-"

                const status = row?.status || "DRAFT"

                const total =
                  Number(row?.totalGrossRon) ||
                  Number(row?.totalRon) ||
                  Number(row?.grandTotal) ||
                  Number(row?.total) ||
                  0

                const currency = row?.currency || "RON"
                const source = sourceBadge(row)

                return (
                  <tr key={row?.id || `${row?.docNo}-${row?.docDate}`} className="border-t border-slate-200">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row?.docNo || row?.number || "-"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{row?.note || row?.series || "Receptie NIR"}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${source.className}`}>
                          {source.label}
                        </span>
                        {row?.spvDownloadId ? <span>ID desc.: {row.spvDownloadId}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(row?.docDate || row?.date)}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{supplier}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row?.supplier?.code || row?.supplierCode || row?.supplier?.cif || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{location}</div>
                      <div className="mt-1 text-xs text-slate-500">{warehouse}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(status)}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div className="font-semibold text-slate-900">{formatMoney(total, currency)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row?.itemsCount || row?.linesCount || row?.itemCount || 0} linii
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-max flex-nowrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/inregistrare-document/nir/edit?id=${row?.id}`)}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                          Deschide
                          <ArrowRight size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openReceiptPdf(row?.id)}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          <Printer size={16} />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredRows.length > PAGE_SIZE ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-500">
            Pagina <span className="font-semibold text-slate-700">{safePage}</span> din{" "}
            <span className="font-semibold text-slate-700">{totalPages}</span> · {filteredRows.length} rezultate
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Inapoi
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Urmator
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
