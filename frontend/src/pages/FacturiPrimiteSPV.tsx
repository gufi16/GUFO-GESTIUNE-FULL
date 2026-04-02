import { useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { ArrowRight, ChevronDown, ChevronUp, Download, FileCode2 } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { DocumentMetric, InlineNotice, documentButtonPrimaryClass, documentButtonSecondaryClass, documentInputClass } from "../components/DocumentUi"
import { API_BASE, getToken } from "../lib/api"
import { formatMoneyRo, formatQtyRo } from "../lib/format"
import { hasModule } from "../lib/modules"

type IncomingInvoiceItem = {
  id: string
  lineIndex: number
  productName: string
  productCode?: string | null
  externalCode?: string | null
  barcode?: string | null
  uomCode?: string | null
  qty?: number
  unitPrice?: number
  vatRate?: number
  lineGross?: number
  matchedProductId?: string | null
  matchedProduct?: {
    id: string
    name: string
    sku?: string | null
  } | null
}

type IncomingInvoice = {
  id: string
  invoiceNo?: string | null
  invoiceDate?: string | null
  supplierId?: string | null
  supplierName?: string | null
  supplierCode?: string | null
  supplierCif?: string | null
  currency: string
  totalGross: number
  spvDownloadId: string
  spvUploadIndex?: string | null
  linkedReceiptId?: string | null
  items: IncomingInvoiceItem[]
}

type IncomingFilter = "all" | "needs-supplier" | "partial" | "ready" | "linked"

type SpvClassicStatus = {
  mode: string
  authType: string
  implemented: boolean
  endpoints?: {
    listMessages?: string
    download?: string
  }
  requirements?: string[]
  message?: string
  diagnostics?: {
    cui?: string | null
    certSerialConfigured?: string | null
    hasCertificateFile?: boolean
    hasCertificatePassword?: boolean
    canUseServerCertificate?: boolean
  }
}

type SpvClassicTestResult = {
  ok: boolean
  title: string
  tone: "success" | "error"
  lines: string[]
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO")
}

export default function FacturiPrimiteSPVPage() {
  const navigate = useNavigate()
  const token = getToken() || ""
  const [items, setItems] = useState<IncomingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<IncomingFilter>("all")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [testingClassic, setTestingClassic] = useState(false)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [spvStatus, setSpvStatus] = useState<SpvClassicStatus | null>(null)
  const [spvTestResult, setSpvTestResult] = useState<SpvClassicTestResult | null>(null)
  const [spvModeMessage] = useState(
    "Ecranul acesta tine de SPV clasic (SPVWS2), separat de fluxul OAuth e-Factura. Tokenul ANAF activ nu este suficient singur pentru sincronizarea de aici."
  )

  useEffect(() => {
    void loadSpvStatus()
    void loadItems()
  }, [])

  async function loadSpvStatus() {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/spv-classic/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) return
      setSpvStatus(data.status || null)
    } catch {
      // Keep the page usable even if the status endpoint is temporarily unavailable.
    }
  }

  async function loadItems() {
    if (!token) {
      setError("Lipseste sesiunea de autentificare.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca facturile primite din SPV.")
      }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca facturile primite din SPV.")
    } finally {
      setLoading(false)
    }
  }

  async function syncItems() {
    if (!token) return
    setSyncing(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/spv-classic/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days: 30 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Nu am putut sincroniza facturile primite din SPV.")
      }
      setMessage(data?.message || "Sincronizarea SPV a fost finalizata.")
      await loadItems()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sincroniza facturile primite din SPV.")
    } finally {
      setSyncing(false)
    }
  }

  async function testClassicListMessages() {
    if (!token) return
    setTestingClassic(true)
    setError("")
    setMessage("")
    setSpvTestResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/spv-classic/test-list-messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days: 30 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut testa listaMesaje din SPV clasic.")
      }

      const summary = data?.summary || {}
      const diagnostics = data?.diagnostics || {}
      const lines = [
        `Rută testată: listaMesaje SPVWS2`,
        `CUI: ${diagnostics?.cui || "-"}`,
        `Fișier certificat pe server: ${diagnostics?.hasCertificateFile ? "Da" : "Nu"}`,
        `Parolă certificat: ${diagnostics?.hasCertificatePassword ? "Da" : "Nu"}`,
        `HTTP status: ${data?.response?.status ?? "-"}`,
      ]
      if (summary?.error) {
        setSpvTestResult({
          ok: false,
          title: "Test SPVWS2 cu răspuns de eroare",
          tone: "error",
          lines: [...lines, `Răspuns SPV: ${summary.error}`],
        })
        setMessage(`SPVWS2 a raspuns: ${summary.error}`)
      } else {
        setSpvTestResult({
          ok: true,
          title: "Test SPVWS2 reușit",
          tone: "success",
          lines: [
            ...lines,
            `Mesaje găsite: ${summary?.messageCount ?? 0}`,
            `Primul tip mesaj: ${summary?.firstMessageType || "-"}`,
            `Primul ID mesaj: ${summary?.firstMessageId || "-"}`,
          ],
        })
        setMessage(
          `Test SPVWS2 ok. Mesaje: ${summary?.messageCount ?? 0}${summary?.firstMessageType ? `, primul tip: ${summary.firstMessageType}` : ""}.`
        )
      }
    } catch (err: any) {
      const missingServerCert =
        spvStatus?.diagnostics && !spvStatus.diagnostics.canUseServerCertificate
      setSpvTestResult({
        ok: false,
        title: "Test SPVWS2 blocat",
        tone: "error",
        lines: [
          "Rută testată: listaMesaje SPVWS2",
          `CUI: ${spvStatus?.diagnostics?.cui || "-"}`,
          `Fișier certificat pe server: ${spvStatus?.diagnostics?.hasCertificateFile ? "Da" : "Nu"}`,
          `Parolă certificat: ${spvStatus?.diagnostics?.hasCertificatePassword ? "Da" : "Nu"}`,
          missingServerCert
            ? "Blocaj curent: serverul nu are un certificat client utilizabil pentru SPVWS2."
            : `Blocaj curent: ${err?.message || "Nu am putut testa listaMesaje din SPV clasic."}`,
        ],
      })
      setError(err?.message || "Nu am putut testa listaMesaje din SPV clasic.")
    } finally {
      setTestingClassic(false)
    }
  }

  async function openXml(id: string) {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming/${id}/xml`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener,noreferrer")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setError("Nu am putut deschide XML-ul facturii din SPV.")
    }
  }

  async function createSupplier(id: string) {
    if (!token) return
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming/${id}/create-supplier`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut crea furnizorul din factura SPV.")
      }
      setMessage("Furnizorul a fost creat si legat la factura SPV.")
      await loadItems()
    } catch (err: any) {
      setError(err?.message || "Nu am putut crea furnizorul din factura SPV.")
    }
  }

  function getInvoiceState(item: IncomingInvoice) {
    if (item.linkedReceiptId) return "linked" as const
    if (!item.supplierId) return "needs-supplier" as const
    const matchedLines = item.items.filter((line) => Boolean(line.matchedProductId)).length
    if (!item.items.length) return "partial" as const
    if (matchedLines === item.items.length) return "ready" as const
    return "partial" as const
  }

  function getInvoiceStateLabel(item: IncomingInvoice) {
    const state = getInvoiceState(item)
    if (state === "linked") return "Receptie creata"
    if (state === "needs-supplier") return "Furnizor lipsa"
    if (state === "ready") return "Gata de receptie"
    return "Mapare partiala"
  }

  function getInvoiceStateClass(item: IncomingInvoice) {
    const state = getInvoiceState(item)
    if (state === "linked") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    if (state === "needs-supplier") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
    if (state === "ready") return "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    let next = !q ? items : items.filter((item) =>
      [
        item.invoiceNo,
        item.supplierName,
        item.supplierCif,
        item.spvDownloadId,
        item.spvUploadIndex,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(q))
    )
    if (filter !== "all") {
      next = next.filter((item) => getInvoiceState(item) === filter)
    }
    return next
  }, [items, search, filter])

  const totalMatched = filteredItems.reduce(
    (sum, item) => sum + item.items.filter((line) => Boolean(line.matchedProductId)).length,
    0
  )

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]))
  }

  if (!hasModule("efactura")) {
    return <Navigate to="/documente" replace />
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="documente"
        title="Facturi primite SPV"
        subtitle="Sincronizezi facturile furnizorilor din SPV si deschizi receptia direct din ele."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Facturi primite" value={String(filteredItems.length)} tone="blue" />
        <DocumentMetric title="Linii mapate" value={String(totalMatched)} tone="slate" />
        <DocumentMetric
          title="Receptii create"
          value={String(filteredItems.filter((item) => item.linkedReceiptId).length)}
          tone="emerald"
        />
      </div>

      <InlineNotice>{spvModeMessage}</InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {spvTestResult ? (
        <div className={`rounded-[20px] border p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)] ${
          spvTestResult.tone === "success"
            ? "border-emerald-200 bg-emerald-50/70"
            : "border-rose-200 bg-rose-50/70"
        }`}>
          <div className={`text-sm font-semibold ${
            spvTestResult.tone === "success" ? "text-emerald-800" : "text-rose-800"
          }`}>
            {spvTestResult.title}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {spvTestResult.lines.map((line) => (
              <div
                key={line}
                className={`rounded-[14px] border px-3 py-2 text-sm ${
                  spvTestResult.tone === "success"
                    ? "border-emerald-200 bg-white text-emerald-900"
                    : "border-rose-200 bg-white text-rose-900"
                }`}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {spvStatus ? (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <DocumentMetric title="Mod SPV" value={String(spvStatus.mode || "-").toUpperCase()} tone="slate" />
          <DocumentMetric title="Autentificare" value={spvStatus.authType === "qualified_certificate" ? "Certificat calificat" : "-"} tone="blue" />
          <DocumentMetric
            title="Certificat server"
            value={spvStatus.diagnostics?.canUseServerCertificate ? "Pregatit" : "Lipsa"}
            tone={spvStatus.diagnostics?.canUseServerCertificate ? "emerald" : "amber"}
          />
        </div>
      ) : null}

      {spvStatus?.diagnostics ? (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <DocumentMetric title="Fisier certificat" value={spvStatus.diagnostics.hasCertificateFile ? "Da" : "Nu"} tone="slate" />
          <DocumentMetric title="Parola certificat" value={spvStatus.diagnostics.hasCertificatePassword ? "Da" : "Nu"} tone="slate" />
          <DocumentMetric title="CUI firma" value={spvStatus.diagnostics.cui || "-"} tone="blue" />
        </div>
      ) : null}

      {spvStatus?.requirements?.length ? (
        <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
          <div className="text-sm font-semibold text-slate-900">Ce cere SPV clasic acum</div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {spvStatus.requirements.map((entry) => (
              <div key={entry} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
                {entry}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[
          { value: "all", label: "Toate" },
          { value: "needs-supplier", label: "Furnizor lipsa" },
          { value: "partial", label: "Mapare partiala" },
          { value: "ready", label: "Gata de receptie" },
          { value: "linked", label: "Receptie creata" },
        ].map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setFilter(entry.value as IncomingFilter)}
            className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
              filter === entry.value
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Factura, furnizor, CIF, ID descarcare..."
            className={`${documentInputClass} md:max-w-md`}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void loadItems()} className={documentButtonSecondaryClass}>
              Reincarca
            </button>
            <button
              type="button"
              onClick={() => void testClassicListMessages()}
              className={documentButtonSecondaryClass}
              disabled={testingClassic}
            >
              {testingClassic ? "Testare..." : "Testeaza listaMesaje"}
            </button>
            <button
              type="button"
              onClick={() => void syncItems()}
              className={documentButtonPrimaryClass}
              disabled={syncing || (spvStatus ? !spvStatus.implemented : false)}
            >
              {syncing ? "Sincronizare..." : spvStatus?.implemented ? "Sincronizeaza SPV" : "SPVWS2 separat"}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Factura</th>
              <th className="px-3 py-2.5 text-left font-medium">Furnizor</th>
              <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
              <th className="px-3 py-2.5 text-left font-medium">SPV</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-left font-medium">Mapare</th>
              <th className="px-3 py-2.5 text-right font-medium">Actiuni</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  Se incarca facturile primite...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  Nu exista facturi primite sincronizate inca.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const matchedLines = item.items.filter((line) => Boolean(line.matchedProductId)).length
                const isExpanded = expandedIds.includes(item.id)
                return (
                  <>
                    <tr key={item.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(item.id)}
                            className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                            aria-label={isExpanded ? "Ascunde liniile" : "Arata liniile"}
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <div>
                            <div className="font-semibold text-slate-900">{item.invoiceNo || "-"}</div>
                            <div className="text-xs text-slate-500">{formatDate(item.invoiceDate)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="font-medium text-slate-900">{item.supplierName || "-"}</div>
                        <div className="text-xs text-slate-500">{item.supplierCif || "-"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="font-semibold text-slate-900">{formatMoneyRo(item.totalGross)} {item.currency}</div>
                        <div className="text-xs text-slate-500">{item.items.length} pozitii</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="text-xs text-slate-600">Download: {item.spvDownloadId}</div>
                        <div className="text-xs text-slate-500">Upload: {item.spvUploadIndex || "-"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getInvoiceStateClass(item)}`}>
                          {getInvoiceStateLabel(item)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="font-medium text-slate-900">{matchedLines}/{item.items.length}</div>
                        <div className="text-xs text-slate-500">linii mapate</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openXml(item.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                          >
                            <FileCode2 size={16} />
                            XML
                          </button>
                          {!item.supplierId ? (
                            <button
                              type="button"
                              onClick={() => void createSupplier(item.id)}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                            >
                              Furnizor
                            </button>
                          ) : null}
                          {item.linkedReceiptId ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/inregistrare-document/nir/edit?id=${item.linkedReceiptId}`)}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                            >
                              <Download size={16} />
                              Receptie
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => navigate(`/inregistrare-document/nir/new?incomingInvoiceId=${item.id}`)}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                            >
                              Creeaza receptie
                              <ArrowRight size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="rounded-2xl border border-slate-200 bg-white">
                            <div className="grid grid-cols-[minmax(220px,2fr)_120px_96px_120px_180px] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              <div>Produs SPV</div>
                              <div>UM</div>
                              <div>Cant.</div>
                              <div>Pret</div>
                              <div>Mapare ERP</div>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {item.items.map((line) => {
                                const isMapped = Boolean(line.matchedProductId)
                                return (
                                  <div
                                    key={line.id}
                                    className="grid grid-cols-[minmax(220px,2fr)_120px_96px_120px_180px] gap-0 px-3 py-2 text-sm"
                                  >
                                    <div>
                                      <div className="font-medium text-slate-900">{line.productName || "-"}</div>
                                      <div className="mt-0.5 text-xs text-slate-500">
                                        {[line.productCode, line.externalCode, line.barcode].filter(Boolean).join(" | ") || "Fara cod"}
                                      </div>
                                    </div>
                                    <div className="text-slate-700">{line.uomCode || "-"}</div>
                                    <div className="text-slate-700">{formatQtyRo(line.qty || 0)}</div>
                                    <div className="text-slate-700">
                                      {formatMoneyRo(line.unitPrice || 0, item.currency)} {item.currency}
                                    </div>
                                    <div>
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                          isMapped
                                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                            : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                                        }`}
                                      >
                                        {isMapped ? "Mapat" : "Nemapat"}
                                      </span>
                                      <div className="mt-1 text-xs text-slate-500">
                                        {line.matchedProduct?.name || "Alegi produsul in receptie"}
                                      </div>
                                      {line.matchedProduct?.sku ? (
                                        <div className="text-xs text-slate-400">SKU: {line.matchedProduct.sku}</div>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
