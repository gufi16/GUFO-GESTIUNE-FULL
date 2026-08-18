import { useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { ArrowRight, ChevronDown, ChevronUp, Download, FileCode2, FileText, X } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { DocumentMetric, InlineNotice, documentButtonPrimaryClass, documentButtonSecondaryClass, documentInputClass } from "../components/DocumentUi"
import { API_BASE, getToken } from "../lib/api"
import { formatMoneyRo, formatQtyRo } from "../lib/format"
import { hasModule } from "../lib/modules"
import { downloadPdfFile } from "../lib/pdf"

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
  lineNet?: number
  lineVat?: number
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
  spvCommunicationDate?: string | null
  supplierId?: string | null
  supplierName?: string | null
  supplierCode?: string | null
  supplierCif?: string | null
  currency: string
  totalNet?: number
  totalVat?: number
  totalGross: number
  spvDownloadId: string
  spvUploadIndex?: string | null
  linkedReceiptId?: string | null
  items: IncomingInvoiceItem[]
}

type OutgoingInvoice = {
  id: string
  invoiceNo?: string | null
  invoiceDate?: string | null
  spvCommunicationDate?: string | null
  customerName: string
  customerCif?: string | null
  supplierName?: string | null
  supplierCif?: string | null
  currency: string
  totalNet?: number
  totalVat?: number
  totalGross: number
  spvDownloadId: string
  spvUploadIndex?: string | null
}

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

type BridgeSpvMessage = {
  id: string
  tip?: string | null
  cif?: string | null
  data_creare?: string | null
  detalii?: string | null
}

type EfacturaBridgeConfig = {
  accessToken: string
  cif: string
  environment: "prod" | "test"
  expiresAt?: string | null
}

type BridgeMessageFilter = "all" | "invoice" | "receipt"
type SpvInvoiceView = "incoming" | "outgoing"
type LocalAgentPairing = {
  bridgeUrl: string
  bridgeToken: string
}

const SPV_BRIDGE_URL_KEY = "gufo_spv_bridge_url"
const DEFAULT_SPV_BRIDGE_URL = "http://127.0.0.1:48521"
const RAW_MESSAGES_PAGE_SIZE = 20
const IMPORTED_INVOICES_PAGE_SIZE = 15

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ro-RO")
}

function getCurrentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function parseSpvMessageDate(value?: string | null) {
  const raw = String(value || "").trim()
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/)
  if (match) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = match
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[T\s]?(\d{2})(\d{2})(\d{2})?)?$/)
  if (!compactMatch) return null
  const [, yyyy, mm, dd, hh = "00", mi = "00", ss = "00"] = compactMatch
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss))
  return Number.isNaN(date.getTime()) ? null : date
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function parseInvoiceMonthKey(value?: string | null) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return getMonthKey(parsed)
  }
  const compactMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}`
  return ""
}

function getInvoiceSelectedMonthKey(item: IncomingInvoice) {
  return (
    parseInvoiceMonthKey(item.spvCommunicationDate) ||
    parseInvoiceMonthKey(item.invoiceDate) ||
    ""
  )
}

function filterMessagesForMonth(messages: any[], monthValue: string) {
  if (!monthValue) return messages
  return messages.filter((entry) => {
    const parsedDate = parseSpvMessageDate(entry?.data_creare)
    if (!parsedDate) return false
    return getMonthKey(parsedDate) === monthValue
  })
}

function getDaysNeededForMonth(monthValue: string) {
  if (!monthValue) return 30
  const [yearRaw, monthRaw] = monthValue.split("-")
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 30
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()
  const days = Math.ceil(diffMs / 86_400_000) + 1
  return Math.max(1, Math.min(365, days))
}

function isEfacturaInvoiceMessage(entry: any) {
  const tip = String(entry?.tip || "").trim().toUpperCase()
  const raw = JSON.stringify(entry || {}).toLowerCase()
  if (tip.includes("RECIPISA")) return false
  return Boolean(String(entry?.id || "").trim()) && (tip.includes("FACTURA") || raw.includes("id_descarcare") || raw.includes("download"))
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getUnitPriceWithVat(line: IncomingInvoiceItem) {
  const net = Number(line.unitPrice || 0)
  const vatRate = Number(line.vatRate || 0)
  return net + (net * vatRate) / 100
}

function getInvoiceGrossValue(item: Pick<IncomingInvoice, "totalGross" | "totalNet" | "totalVat">) {
  const gross = Number(item.totalGross || 0)
  if (gross > 0) return gross
  return Number(item.totalNet || 0) + Number(item.totalVat || 0)
}

function efacturaStatusClass(status?: string | null) {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "ACCEPTED") return "bg-[#E5F3E8] text-[#215D2A]"
  if (normalized === "SENT") return "bg-[#E8F0FB] text-[#244A7C]"
  if (normalized === "PREPARED" || normalized === "READY_TO_SEND") return "bg-slate-100 text-slate-700"
  if (normalized === "REJECTED" || normalized === "ERROR") return "bg-red-100 text-red-700"
  return "bg-[#F8F5EF] text-[#17324D]"
}

export default function FacturiPrimiteSPVPage() {
  const navigate = useNavigate()
  const token = getToken() || ""
  const [items, setItems] = useState<IncomingInvoice[]>([])
  const [outgoingItems, setOutgoingItems] = useState<OutgoingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState("")
  const [activeView, setActiveView] = useState<SpvInvoiceView>("incoming")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [testingClassic, setTestingClassic] = useState(false)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [spvStatus, setSpvStatus] = useState<SpvClassicStatus | null>(null)
  const [spvTestResult, setSpvTestResult] = useState<SpvClassicTestResult | null>(null)
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_SPV_BRIDGE_URL)
  const [bridgeToken, setBridgeToken] = useState("")
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue())
  const [bridgeMessages, setBridgeMessages] = useState<BridgeSpvMessage[]>([])
  const [bridgeMessageFilter, setBridgeMessageFilter] = useState<BridgeMessageFilter>("invoice")
  const [bridgeMessagesPage, setBridgeMessagesPage] = useState(1)
  const [importedInvoicesPage, setImportedInvoicesPage] = useState(1)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const isDebugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugSpv") === "1"
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBridgeUrl(window.localStorage.getItem(SPV_BRIDGE_URL_KEY) || DEFAULT_SPV_BRIDGE_URL)
    }
    void discoverLocalAgent()
    void loadSpvStatus()
    void loadItems()
    void loadOutgoingItems()
  }, [])

  async function discoverLocalAgent(preferredUrl?: string) {
    const trimmedBridgeUrl = (preferredUrl || bridgeUrl || DEFAULT_SPV_BRIDGE_URL).trim().replace(/\/+$/, "")
    try {
      const res = await fetch(`${trimmedBridgeUrl}/agent/pairing`, {
        headers: { Accept: "application/json" },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.agent?.bridgeToken) {
        return null
      }
      const nextBridgeUrl = String(data.agent.bridgeUrl || trimmedBridgeUrl).trim() || trimmedBridgeUrl
      const nextBridgeToken = String(data.agent.bridgeToken || "").trim()
      setBridgeUrl(nextBridgeUrl)
      setBridgeToken(nextBridgeToken)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SPV_BRIDGE_URL_KEY, nextBridgeUrl)
      }
      return {
        bridgeUrl: nextBridgeUrl,
        bridgeToken: nextBridgeToken,
      } satisfies LocalAgentPairing
    } catch {
      return null
    }
  }

  async function getLocalAgentConnection() {
    const trimmedBridgeUrl = bridgeUrl.trim().replace(/\/+$/, "") || DEFAULT_SPV_BRIDGE_URL
    const trimmedBridgeToken = bridgeToken.trim()
    if (trimmedBridgeToken) {
      return {
        bridgeUrl: trimmedBridgeUrl,
        bridgeToken: trimmedBridgeToken,
      } satisfies LocalAgentPairing
    }
    return discoverLocalAgent(trimmedBridgeUrl)
  }

  async function loadBridgeConfig() {
    const res = await fetch(`${API_BASE}/api/v1/efactura/incoming/bridge-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok || !data?.bridgeConfig?.accessToken) {
      throw new Error(data?.error || "Nu am putut pregati tokenul ANAF pentru bridge.")
    }
    return data.bridgeConfig as EfacturaBridgeConfig
  }

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
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming?_=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca facturile primite din SPV.")
      }
      setItems(Array.isArray(data.items) ? data.items : [])
      setImportedInvoicesPage(1)
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca facturile primite din SPV.")
    } finally {
      setLoading(false)
    }
  }

  async function loadOutgoingItems() {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/outgoing?_=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca facturile trimise din SPV.")
      }
      setOutgoingItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setOutgoingItems([])
    }
  }

  async function syncItems() {
    if (!token) return
    setSyncing(true)
    setError("")
    setMessage("")
    setBridgeMessages([])
    setBridgeMessagesPage(1)
    try {
      const localAgent = await getLocalAgentConnection()
      if (localAgent?.bridgeToken) {
        const trimmedBridgeUrl = localAgent.bridgeUrl
        const requestedDays = getDaysNeededForMonth(selectedMonth)
        const bridgeConfig = await loadBridgeConfig()
        const existingDownloadIds = new Set(
          [...items, ...outgoingItems]
            .map((entry) => String(entry.spvDownloadId || "").trim())
            .filter(Boolean)
        )
        const bridgeHeaders = {
          Authorization: `Bearer ${localAgent.bridgeToken}`,
          "Content-Type": "application/json",
        }
        let listData: any = null
        let payload: any = {}
        let downloadsById = new Map<string, any>()

        const syncBatchRes = await fetch(`${trimmedBridgeUrl}/api/v1/efactura/sync-batch`, {
          method: "POST",
          headers: bridgeHeaders,
          body: JSON.stringify({
            days: requestedDays,
            accessToken: bridgeConfig.accessToken,
            cif: bridgeConfig.cif,
            environment: bridgeConfig.environment,
            existingIds: Array.from(existingDownloadIds),
          }),
        })
        const syncBatchData = await syncBatchRes.json().catch(() => ({}))
        const shouldFallbackToLegacyBridge =
          !syncBatchRes.ok &&
          (syncBatchRes.status === 404 ||
            String(syncBatchData?.error || "")
              .trim()
              .toLowerCase()
              .includes("ruta necunoscuta"))

        if (!shouldFallbackToLegacyBridge) {
          if (!syncBatchRes.ok || !syncBatchData?.ok || !syncBatchData?.response?.list?.ok) {
            throw new Error(syncBatchData?.response?.list?.error || syncBatchData?.error || "Bridge-ul local nu a putut sincroniza e-Factura.")
          }
          listData = syncBatchData
          payload = (() => {
            const rawContent = String(listData?.response?.list?.content || "").trim()
            if (!rawContent) return {}
            try {
              return JSON.parse(rawContent)
            } catch {
              return {}
            }
          })()
          downloadsById = new Map<string, any>(
            (Array.isArray(listData?.response?.items) ? listData.response.items : []).map((entry: any) => [
              String(entry?.id || "").trim(),
              entry,
            ])
          )
        } else {
          const listRes = await fetch(`${trimmedBridgeUrl}/api/v1/efactura/list-messages`, {
            method: "POST",
            headers: bridgeHeaders,
            body: JSON.stringify({
              days: requestedDays,
              accessToken: bridgeConfig.accessToken,
              cif: bridgeConfig.cif,
              environment: bridgeConfig.environment,
            }),
          })
          listData = await listRes.json().catch(() => ({}))
          if (!listRes.ok || !listData?.ok || !listData?.response?.ok) {
            throw new Error(listData?.response?.error || listData?.error || "Bridge-ul local nu a putut lista mesajele e-Factura.")
          }
          payload = listData?.response?.parsedContent || {}
        }

        const messages = filterMessagesForMonth(Array.isArray(payload?.mesaje) ? payload.mesaje : [], selectedMonth)
        setBridgeMessages(
          messages.map((entry: any) => ({
            id: String(entry?.id || ""),
            tip: entry?.tip || null,
            cif: entry?.cif || null,
            data_creare: entry?.data_creare || null,
            detalii: entry?.detalii || null,
          }))
        )

        const invoiceMessages = messages.filter((entry: any) => isEfacturaInvoiceMessage(entry))
        const newInvoiceMessages = invoiceMessages.filter((entry: any) => !existingDownloadIds.has(String(entry?.id || "").trim()))

        if (!invoiceMessages.length) {
          setMessage(`Bridge local conectat, dar in e-Factura nu exista facturi de importat pentru ${selectedMonth}.`)
          setSpvTestResult({
            ok: true,
            title: "Bridge local e-Factura conectat cu succes",
            tone: "success",
            lines: [
              "Rută testată: bridge local -> sincronizare SPVWS2",
              `Bridge URL: ${trimmedBridgeUrl}`,
              `Luna selectata: ${selectedMonth}`,
              `Mediu ANAF: ${bridgeConfig.environment}`,
              `CUI: ${bridgeConfig.cif}`,
              `Mesaje totale: ${messages.length}`,
              "Facturi importabile: 0",
            ],
          })
          await loadItems()
          return
        }

        if (!newInvoiceMessages.length) {
          setMessage(`Facturile pentru ${selectedMonth} sunt deja sincronizate in Gufo.`)
          setSpvTestResult({
            ok: true,
            title: "Facturile din e-Factura sunt deja in Gufo",
            tone: "success",
            lines: [
              "Ruta testata: bridge local -> listaMesaje + verificare duplicat",
              `Bridge URL: ${trimmedBridgeUrl}`,
              `Luna selectata: ${selectedMonth}`,
              `Mediu ANAF: ${bridgeConfig.environment}`,
              `CUI: ${bridgeConfig.cif}`,
              `Mesaje totale: ${messages.length}`,
              `Facturi gasite: ${invoiceMessages.length}`,
              "Facturi noi de importat: 0",
            ],
          })
          await loadItems()
          return
        }

        let imported = 0
        let skipped = 0
        let lastImportedInvoiceNo = "-"
        const importErrors: string[] = []

        if (shouldFallbackToLegacyBridge) {
          const downloadIds = newInvoiceMessages
            .map((message: any) => String(message?.id || "").trim())
            .filter(Boolean)

          const batchDownloadRes = await fetch(`${trimmedBridgeUrl}/api/v1/efactura/download-many`, {
            method: "POST",
            headers: bridgeHeaders,
            body: JSON.stringify({
              ids: downloadIds,
              accessToken: bridgeConfig.accessToken,
              environment: bridgeConfig.environment,
            }),
          })
          const batchDownloadData = await batchDownloadRes.json().catch(() => ({}))
          if (!batchDownloadRes.ok || !batchDownloadData?.ok || !batchDownloadData?.response?.items) {
            throw new Error(batchDownloadData?.error || "Bridge-ul local nu a putut descarca lotul de facturi e-Factura.")
          }
          downloadsById = new Map<string, any>(
            (Array.isArray(batchDownloadData.response.items) ? batchDownloadData.response.items : []).map((entry: any) => [
              String(entry?.id || "").trim(),
              entry,
            ])
          )
        }

        for (const message of newInvoiceMessages) {
          const messageId = String(message?.id || "").trim()
          const downloadData = downloadsById.get(messageId)
          if (!messageId || !downloadData?.ok || !downloadData?.base64Content) {
            skipped += 1
            continue
          }

          const importRes = await fetch(`${API_BASE}/api/v1/efactura/incoming/import-from-spv-bridge`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              downloadBase64: downloadData.base64Content,
            }),
          })
          const importData = await importRes.json().catch(() => ({}))
          if (!importRes.ok || !importData?.ok) {
            skipped += 1
            if (importErrors.length < 3) {
              importErrors.push(importData?.error || `Importul a esuat pentru mesajul ${messageId}.`)
            }
            continue
          }

          imported += 1
          lastImportedInvoiceNo = importData?.invoiceNo || importData?.spvDownloadId || lastImportedInvoiceNo
        }

        setSpvTestResult({
          ok: imported > 0,
          title: imported > 0 ? "Sincronizare e-Factura prin bridge finalizata" : "Sincronizare e-Factura fara facturi noi",
          tone: imported > 0 ? "success" : "error",
          lines: [
            "Rută testată: bridge local -> listaMesaje + descarcare + import Gufo",
            `Bridge URL: ${trimmedBridgeUrl}`,
            `Luna selectata: ${selectedMonth}`,
            `Mediu ANAF: ${bridgeConfig.environment}`,
            `CUI: ${bridgeConfig.cif}`,
            `Mesaje totale: ${messages.length}`,
            `Facturi gasite: ${invoiceMessages.length}`,
            `Facturi noi de importat: ${newInvoiceMessages.length}`,
            `Facturi importate: ${imported}`,
            `Mesaje sărite/eroare: ${skipped}`,
            `Ultima factura importata: ${lastImportedInvoiceNo}`,
            ...(importErrors.length ? [`Prima eroare: ${importErrors[0]}`] : []),
          ],
        })

        if (imported > 0) {
          setMessage(`Sincronizare e-Factura finalizata prin bridge local pentru ${selectedMonth}. Facturi importate: ${imported}.`)
        } else {
          setError(importErrors[0] || `Bridge-ul a raspuns, dar nu am importat nicio factura noua din e-Factura pentru ${selectedMonth}.`)
        }

        await loadItems()
        await loadOutgoingItems()
        return
      }

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

  async function syncItemsDirectAnaf() {
    if (!token) return
    setSyncing(true)
    setError("")
    setMessage("")
    setBridgeMessages([])
    setBridgeMessagesPage(1)
    try {
      const requestedDays = getDaysNeededForMonth(selectedMonth)
      const res = await fetch(`${API_BASE}/api/v1/efactura/incoming/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days: requestedDays }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Nu am putut sincroniza facturile primite direct din ANAF.")
      }

      const stats = data?.stats || {}
      setSpvTestResult({
        ok: true,
        title: "Sincronizare e-Factura ANAF finalizata",
        tone: "success",
        lines: [
          "Ruta folosita: ERP -> ANAF OAuth -> listaMesajeFactura + descarcare",
          `Luna selectata: ${selectedMonth}`,
          `Zile interogate: ${requestedDays}`,
          `Mesaje totale: ${stats.totalMessages ?? 0}`,
          `Mesaje factura: ${stats.invoiceMessages ?? 0}`,
          `Facturi descarcate: ${stats.downloaded ?? 0}`,
          `Facturi importate: ${stats.imported ?? 0}`,
          `Facturi primite importate: ${stats.importedIncoming ?? 0}`,
          `Facturi trimise importate: ${stats.importedOutgoing ?? 0}`,
          `Mesaje sarite: ${stats.skipped ?? 0}`,
          ...(Array.isArray(stats.errors) && stats.errors.length ? [`Prima eroare: ${stats.errors[0]}`] : []),
        ],
      })
      setMessage(data?.message || "Sincronizarea e-Factura a fost finalizata.")
      await loadItems()
      await loadOutgoingItems()
    } catch (err: any) {
      setError(err?.message || "Nu am putut sincroniza facturile primite direct din ANAF.")
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
    setBridgeMessages([])
    setBridgeMessagesPage(1)
    try {
      const localAgent = await getLocalAgentConnection()
      if (localAgent?.bridgeToken) {
        const trimmedBridgeUrl = localAgent.bridgeUrl
        const requestedDays = getDaysNeededForMonth(selectedMonth)
        const bridgeConfig = await loadBridgeConfig()
        const bridgeRes = await fetch(`${trimmedBridgeUrl}/api/v1/efactura/list-messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localAgent.bridgeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            days: requestedDays,
            accessToken: bridgeConfig.accessToken,
            cif: bridgeConfig.cif,
            environment: bridgeConfig.environment,
          }),
        })
        const bridgeData = await bridgeRes.json().catch(() => ({}))
        if (!bridgeRes.ok) {
          throw new Error(bridgeData?.error || "Bridge-ul local nu a raspuns corect.")
        }

        const trace = Array.isArray(bridgeData?.response?.trace) ? bridgeData.response.trace : []
        const parsedContent = bridgeData?.response?.parsedContent || {}
        const messages = filterMessagesForMonth(Array.isArray(parsedContent?.mesaje) ? parsedContent.mesaje : [], selectedMonth)
        const firstMessage = messages[0] || null
        setBridgeMessages(
          messages.map((entry: any) => ({
            id: String(entry?.id || ""),
            tip: entry?.tip || null,
            cif: entry?.cif || null,
            data_creare: entry?.data_creare || null,
            detalii: entry?.detalii || null,
          }))
        )

        if (!bridgeData?.ok || !bridgeData?.response?.ok) {
          const lines = [
            `Rută testată: bridge local -> listaMesaje SPVWS2`,
            `Bridge URL: ${trimmedBridgeUrl}`,
            `Luna selectata: ${selectedMonth}`,
            `Final URL: ${bridgeData?.response?.finalUrl || "-"}`,
            `HTTP status SPV: ${bridgeData?.response?.status ?? "-"}`,
            `Eroare: ${bridgeData?.response?.error || "Necunoscuta"}`,
          ]
          trace.slice(0, 4).forEach((step: any, index: number) => {
            lines.push(`Pas ${index + 1}: ${step?.status ?? "-"} -> ${step?.resolvedLocation || step?.location || step?.url || "-"}`)
          })
          setSpvTestResult({
            ok: false,
            title: "Bridge local conectat, dar e-Factura a raspuns cu eroare",
            tone: "error",
            lines,
          })
          setError(bridgeData?.response?.error || "Bridge-ul local nu a finalizat listaMesajeFactura.")
          return
        }

        setSpvTestResult({
          ok: true,
          title: "Bridge local e-Factura conectat cu succes",
          tone: "success",
          lines: [
            "Rută testată: bridge local -> listaMesaje SPVWS2",
            `Bridge URL: ${trimmedBridgeUrl}`,
            `Luna selectata: ${selectedMonth}`,
            `HTTP status SPV: ${bridgeData?.response?.status ?? "-"}`,
            `Mesaje găsite: ${messages.length}`,
            `Primul tip mesaj: ${firstMessage?.tip || "-"}`,
            `Primul ID mesaj: ${firstMessage?.id || "-"}`,
            `Serial certificat: ${bridgeData?.certificate?.serialNumber || "-"}`,
          ],
        })
        setMessage(
          `Bridge local conectat. e-Factura a raspuns cu ${messages.length} mesaje pentru ${selectedMonth}${firstMessage?.tip ? `, primul tip: ${firstMessage.tip}` : ""}.`
        )
        return
      }

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

  function saveBridgeSettings() {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SPV_BRIDGE_URL_KEY, bridgeUrl.trim() || DEFAULT_SPV_BRIDGE_URL)
    setMessage("Adresa agentului local a fost salvata in browser.")
    setError("")
    void discoverLocalAgent(bridgeUrl.trim() || DEFAULT_SPV_BRIDGE_URL)
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

  async function openOutgoingXml(id: string) {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/efactura/outgoing/${id}/xml`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener,noreferrer")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setError("Nu am putut deschide XML-ul facturii trimise din SPV.")
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
    const hasSupplierIdentity = Boolean(item.supplierId || String(item.supplierName || "").trim())
    if (!hasSupplierIdentity) return "needs-supplier" as const
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
    let next = items.filter((item) => {
      if (!selectedMonth) return true
      return getInvoiceSelectedMonthKey(item) === selectedMonth
    })
    next = !q ? next : next.filter((item) =>
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
    return next
  }, [items, search, selectedMonth])

  const filteredOutgoingItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    let next = outgoingItems.filter((item) => {
      if (!selectedMonth) return true
      return (
        parseInvoiceMonthKey(item.spvCommunicationDate) ||
        parseInvoiceMonthKey(item.invoiceDate)
      ) === selectedMonth
    })
    next = !q
      ? next
      : next.filter((item) =>
          [item.invoiceNo, item.customerName, item.customerCif, item.spvDownloadId, item.spvUploadIndex]
            .map((value) => String(value || "").toLowerCase())
            .some((value) => value.includes(q))
        )
    return next
  }, [outgoingItems, search, selectedMonth])

  const totalMatched = filteredItems.reduce(
    (sum, item) => sum + item.items.filter((line) => Boolean(line.matchedProductId)).length,
    0
  )
  const totalVisibleInvoices = filteredItems.length

  const filteredBridgeMessages = useMemo(() => {
    if (bridgeMessageFilter === "all") return bridgeMessages
    if (bridgeMessageFilter === "invoice") {
      return bridgeMessages.filter((entry) => isEfacturaInvoiceMessage(entry))
    }
    return bridgeMessages.filter((entry) => String(entry.tip || "").toUpperCase() === "RECIPISA")
  }, [bridgeMessages, bridgeMessageFilter])

  const bridgeMessagesPageCount = Math.max(1, Math.ceil(filteredBridgeMessages.length / RAW_MESSAGES_PAGE_SIZE))
  const importedInvoicesPageCount = Math.max(1, Math.ceil(filteredItems.length / IMPORTED_INVOICES_PAGE_SIZE))

  const paginatedBridgeMessages = useMemo(() => {
    const start = (bridgeMessagesPage - 1) * RAW_MESSAGES_PAGE_SIZE
    return filteredBridgeMessages.slice(start, start + RAW_MESSAGES_PAGE_SIZE)
  }, [filteredBridgeMessages, bridgeMessagesPage])

  const paginatedImportedItems = useMemo(() => {
    const start = (importedInvoicesPage - 1) * IMPORTED_INVOICES_PAGE_SIZE
    return filteredItems.slice(start, start + IMPORTED_INVOICES_PAGE_SIZE)
  }, [filteredItems, importedInvoicesPage])

  const selectedInvoice = useMemo(
    () => items.find((entry) => entry.id === selectedInvoiceId) || null,
    [items, selectedInvoiceId]
  )

  useEffect(() => {
    setBridgeMessagesPage(1)
  }, [bridgeMessageFilter, selectedMonth, bridgeMessages.length])

  useEffect(() => {
    setImportedInvoicesPage(1)
  }, [search, items.length])

  useEffect(() => {
    if (bridgeMessagesPage > bridgeMessagesPageCount) {
      setBridgeMessagesPage(bridgeMessagesPageCount)
    }
  }, [bridgeMessagesPage, bridgeMessagesPageCount])

  useEffect(() => {
    if (importedInvoicesPage > importedInvoicesPageCount) {
      setImportedInvoicesPage(importedInvoicesPageCount)
    }
  }, [importedInvoicesPage, importedInvoicesPageCount])

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]))
  }

  function openInvoiceDetails(id: string) {
    setSelectedInvoiceId(id)
    setExpandedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  function closeInvoiceDetails() {
    setSelectedInvoiceId(null)
  }

  async function downloadInvoicePdf(item: IncomingInvoice) {
    if (!token) return
    try {
      const localAgent = await getLocalAgentConnection()
      if (localAgent?.bridgeToken && String(item.spvDownloadId || "").trim()) {
        const bridgeConfig = await loadBridgeConfig()
        const bridgeRes = await fetch(`${localAgent.bridgeUrl.replace(/\/+$/, "")}/api/v1/efactura/download-message`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localAgent.bridgeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: item.spvDownloadId,
            accessToken: bridgeConfig.accessToken,
            environment: bridgeConfig.environment,
          }),
        })
        const bridgeData = await bridgeRes.json().catch(() => ({}))
        const originalPdfBase64 = String(bridgeData?.response?.artifacts?.pdfBase64 || "").trim()
        if (bridgeRes.ok && bridgeData?.ok && originalPdfBase64) {
          const bytes = Uint8Array.from(atob(originalPdfBase64), (char) => char.charCodeAt(0))
          const blob = new Blob([bytes], { type: "application/pdf" })
          const url = window.URL.createObjectURL(blob)
          const link = document.createElement("a")
          link.href = url
          link.download = `factura-spv-${item.invoiceNo || item.spvDownloadId}.pdf`
          document.body.appendChild(link)
          link.click()
          link.remove()
          window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
          return
        }
      }

      const fallbackRes = await fetch(`${API_BASE}/api/v1/efactura/incoming/${item.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!fallbackRes.ok) {
        throw new Error("Nu am putut genera PDF-ul facturii din XML.")
      }
      await downloadPdfFile(fallbackRes, `factura-spv-${item.invoiceNo || item.spvDownloadId}.pdf`)
    } catch (err: any) {
      setError(err?.message || "Nu am putut descarca PDF-ul facturii.")
    }
  }

  async function downloadOutgoingInvoicePdf(item: OutgoingInvoice) {
    if (!token) return
    try {
      const fallbackRes = await fetch(`${API_BASE}/api/v1/efactura/outgoing/${item.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!fallbackRes.ok) {
        throw new Error("Nu am putut genera PDF-ul facturii trimise din XML.")
      }
      await downloadPdfFile(fallbackRes, `factura-trimisa-spv-${item.invoiceNo || item.spvDownloadId}.pdf`)
    } catch (err: any) {
      setError(err?.message || "Nu am putut descarca PDF-ul facturii trimise.")
    }
  }

  if (!hasModule("efactura")) {
    return <Navigate to="/documente" replace />
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="documente"
        title="Facturi primite SPV"
        subtitle="Sincronizezi facturile furnizorilor din SPV, verifici ce a venit din ANAF si deschizi receptia direct din documentele importate pentru firma activa."
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveView("incoming")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeView === "incoming"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Facturi primite
        </button>
        <button
          type="button"
          onClick={() => setActiveView("outgoing")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeView === "outgoing"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Facturi trimise
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {activeView === "incoming" ? (
          <>
            <DocumentMetric title="Facturi primite" value={String(filteredItems.length)} tone="blue" />
            <DocumentMetric title="Linii mapate" value={String(totalMatched)} tone="slate" />
            <DocumentMetric
              title="Receptii create"
              value={String(filteredItems.filter((item) => item.linkedReceiptId).length)}
              tone="emerald"
            />
          </>
        ) : (
          <>
            <DocumentMetric title="Facturi trimise" value={String(filteredOutgoingItems.length)} tone="blue" />
            <DocumentMetric
              title="Trimise la ANAF"
              value={String(filteredOutgoingItems.length)}
              tone="slate"
            />
            <DocumentMetric
              title="Cu PDF/XML"
              value={String(filteredOutgoingItems.filter((item) => item.spvDownloadId).length)}
              tone="emerald"
            />
          </>
        )}
      </div>

      {isDebugMode ? <InlineNotice>Vizualizarea tehnica SPV este activa.</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {isDebugMode && spvTestResult ? (
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

      {isDebugMode && spvStatus ? (
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

      {isDebugMode && spvStatus?.diagnostics ? (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <DocumentMetric title="Fisier certificat" value={spvStatus.diagnostics.hasCertificateFile ? "Da" : "Nu"} tone="slate" />
          <DocumentMetric title="Parola certificat" value={spvStatus.diagnostics.hasCertificatePassword ? "Da" : "Nu"} tone="slate" />
          <DocumentMetric title="CUI firma" value={spvStatus.diagnostics.cui || "-"} tone="blue" />
        </div>
      ) : null}

      {isDebugMode && spvStatus?.requirements?.length ? (
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

      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_auto] md:items-end">
            <div>
              <div className="mb-1 text-sm font-semibold text-slate-900">Luna facturilor</div>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className={documentInputClass}
              />
            </div>
            <div className="text-xs text-slate-500">
              Dupa sincronizare vezi doar facturile importate si lucrezi direct pe ele.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void loadItems()
                void loadOutgoingItems()
              }}
              className={documentButtonSecondaryClass}
            >
              Reincarca
            </button>
            {isDebugMode ? (
              <button
                type="button"
                onClick={() => void testClassicListMessages()}
                className={documentButtonSecondaryClass}
                disabled={testingClassic}
              >
                {testingClassic ? "Testare..." : bridgeToken.trim() ? "Testeaza agentul local" : "Testeaza conexiunea locala"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void syncItemsDirectAnaf()}
              className={documentButtonPrimaryClass}
              disabled={syncing}
            >
              {syncing ? "Sincronizare..." : "Sincronizeaza SPV"}
            </button>
          </div>
        </div>
        {isDebugMode ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold text-slate-900">Setari bridge local Windows</div>
              <div className="text-xs text-slate-500">
                Daca bridge-ul ruleaza pe acest PC, testul din pagina merge direct prin certificatul local.
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(280px,1fr)_auto]">
              <input
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="http://127.0.0.1:48521"
                className={documentInputClass}
              />
              <button type="button" onClick={saveBridgeSettings} className={documentButtonSecondaryClass}>
                Salveaza agent
              </button>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Tokenul local este descoperit automat din Gufo e-Factura daca agentul este configurat pe acest PC.
            </div>
          </div>
        ) : null}
      </div>

      {isDebugMode && activeView === "incoming" && bridgeMessages.length ? (
        <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">
              Mesaje returnate din e-Factura pentru luna selectata
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { value: "all", label: "Toate" },
                { value: "invoice", label: "Facturi" },
                { value: "receipt", label: "Recipise" },
              ].map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setBridgeMessageFilter(entry.value as BridgeMessageFilter)}
                  className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
                    bridgeMessageFilter === entry.value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">ID</th>
                <th className="px-3 py-2.5 text-left font-medium">Tip</th>
                <th className="px-3 py-2.5 text-left font-medium">CUI</th>
                <th className="px-3 py-2.5 text-left font-medium">Data</th>
                <th className="px-3 py-2.5 text-left font-medium">Detalii</th>
              </tr>
            </thead>
            <tbody>
              {paginatedBridgeMessages.map((entry) => (
                <tr key={`${entry.id}-${entry.data_creare || ""}`} className="border-t border-slate-200">
                  <td className="px-3 py-2.5 text-slate-700">{entry.id || "-"}</td>
                  <td className="px-3 py-2.5 text-slate-700">{entry.tip || "-"}</td>
                  <td className="px-3 py-2.5 text-slate-700">{entry.cif || "-"}</td>
                  <td className="px-3 py-2.5 text-slate-700">{entry.data_creare || "-"}</td>
                  <td className="px-3 py-2.5 text-slate-700">{entry.detalii || "-"}</td>
                </tr>
              ))}
              {!paginatedBridgeMessages.length ? (
                <tr className="border-t border-slate-200">
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nu exista mesaje pentru filtrul selectat.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {filteredBridgeMessages.length ? (
            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <div>
                Pagina {bridgeMessagesPage} din {bridgeMessagesPageCount} · {filteredBridgeMessages.length} mesaje
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBridgeMessagesPage((prev) => Math.max(1, prev - 1))}
                  disabled={bridgeMessagesPage <= 1}
                  className={documentButtonSecondaryClass}
                >
                  Inapoi
                </button>
                <button
                  type="button"
                  onClick={() => setBridgeMessagesPage((prev) => Math.min(bridgeMessagesPageCount, prev + 1))}
                  disabled={bridgeMessagesPage >= bridgeMessagesPageCount}
                  className={documentButtonSecondaryClass}
                >
                  Inainte
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeView === "incoming" ? (
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {activeView === "incoming" ? "Facturi primite" : "Facturi trimise"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {activeView === "incoming"
                  ? "Deschizi factura, vezi continutul complet si poti crea receptia direct din ea."
                  : "Vezi facturile trimise catre clienti prin e-Factura, fara sa iesi din zona SPV."}
              </div>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={activeView === "incoming" ? "Factura, furnizor, CIF, ID descarcare..." : "Factura, client, CIF, ID incarcare..."}
              className={`${documentInputClass} md:max-w-md`}
            />
          </div>
        </div>
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
              paginatedImportedItems.map((item) => {
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
                          <button
                            type="button"
                            onClick={() => openInvoiceDetails(item.id)}
                            className="text-left font-semibold text-slate-900 underline-offset-2 hover:text-[#17324D] hover:underline"
                          >
                            {item.invoiceNo || "-"}
                            </button>
                            <div className="text-xs text-slate-500">{formatDate(item.invoiceDate)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="font-medium text-slate-900">{item.supplierName || "-"}</div>
                        <div className="text-xs text-slate-500">{item.supplierCif || "-"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="font-semibold text-slate-900">{formatMoneyRo(getInvoiceGrossValue(item), item.currency)}</div>
                        <div className="text-xs text-slate-500">
                          Net {formatMoneyRo(item.totalNet || 0, item.currency)} • TVA {formatMoneyRo(item.totalVat || 0, item.currency)}
                        </div>
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
                            onClick={() => openInvoiceDetails(item.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                          >
                            {isExpanded && selectedInvoiceId === item.id ? "Deschis" : "Deschide"}
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
                            <div className="grid grid-cols-[minmax(220px,2fr)_88px_88px_120px_120px_120px_180px] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              <div>Produs SPV</div>
                              <div>UM</div>
                              <div>Cant.</div>
                              <div>Pret fara TVA</div>
                              <div>Pret cu TVA</div>
                              <div>Total cu TVA</div>
                              <div>Mapare ERP</div>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {item.items.map((line) => {
                                const isMapped = Boolean(line.matchedProductId)
                                return (
                                  <div
                                    key={line.id}
                                    className="grid grid-cols-[minmax(220px,2fr)_88px_88px_120px_120px_120px_180px] gap-0 px-3 py-2 text-sm"
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
                                      {formatMoneyRo(line.unitPrice || 0, item.currency)}
                                    </div>
                                    <div className="text-slate-700">
                                      {formatMoneyRo(getUnitPriceWithVat(line), item.currency)}
                                    </div>
                                    <div className="text-slate-700">
                                      {formatMoneyRo(line.lineGross || 0, item.currency)}
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
        {filteredItems.length ? (
          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <div>
              Pagina {importedInvoicesPage} din {importedInvoicesPageCount} · {filteredItems.length} facturi
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImportedInvoicesPage((prev) => Math.max(1, prev - 1))}
                disabled={importedInvoicesPage <= 1}
                className={documentButtonSecondaryClass}
              >
                Inapoi
              </button>
              <button
                type="button"
                onClick={() => setImportedInvoicesPage((prev) => Math.min(importedInvoicesPageCount, prev + 1))}
                disabled={importedInvoicesPage >= importedInvoicesPageCount}
                className={documentButtonSecondaryClass}
              >
                Inainte
              </button>
            </div>
          </div>
        ) : null}
      </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Factura</th>
                <th className="px-3 py-2.5 text-left font-medium">Client</th>
                <th className="px-3 py-2.5 text-left font-medium">Valoare</th>
                <th className="px-3 py-2.5 text-left font-medium">SPV</th>
                <th className="px-3 py-2.5 text-left font-medium">e-Factura</th>
                <th className="px-3 py-2.5 text-left font-medium">Data</th>
                <th className="px-3 py-2.5 text-right font-medium">Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Se incarca facturile trimise...
                  </td>
                </tr>
              ) : filteredOutgoingItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Nu exista facturi trimise catre clienti in SPV pentru filtrul selectat.
                  </td>
                </tr>
              ) : (
                filteredOutgoingItems.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200">
                    <td className="px-3 py-2.5 text-slate-700">
                      <div className="font-semibold text-slate-900">{item.invoiceNo || "-"}</div>
                      <div className="text-xs text-slate-500">{formatDate(item.invoiceDate)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <div className="font-medium text-slate-900">{item.customerName || "-"}</div>
                      <div className="text-xs text-slate-500">{item.customerCif || "-"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <div className="font-semibold text-slate-900">{formatMoneyRo(item.totalGross, item.currency)}</div>
                      <div className="text-xs text-slate-500">
                        Net {formatMoneyRo(item.totalNet || 0, item.currency)} - TVA {formatMoneyRo(item.totalVat || 0, item.currency)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <div className="text-xs text-slate-600">Download: {item.spvDownloadId || "-"}</div>
                      <div className="text-xs text-slate-500">Upload: {item.spvUploadIndex || "-"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${efacturaStatusClass("ACCEPTED")}`}>
                        Sincronizat SPV
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{formatDate(item.spvCommunicationDate)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void downloadOutgoingInvoicePdf(item)}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                        >
                          <FileText size={16} />
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => void openOutgoingXml(item.id)}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#17324D] transition hover:bg-[#F4F7FB]"
                        >
                          <FileCode2 size={16} />
                          XML
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedInvoice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Factura primita</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{selectedInvoice.invoiceNo || "-"}</div>
              </div>
              <button
                type="button"
                onClick={closeInvoiceDetails}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-white"
                aria-label="Inchide"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-84px)] overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <DocumentMetric title="Factura" value={selectedInvoice.invoiceNo || "-"} tone="blue" />
                <DocumentMetric title="Data" value={formatDate(selectedInvoice.invoiceDate)} tone="slate" />
                <DocumentMetric title="Furnizor" value={selectedInvoice.supplierName || "-"} tone="slate" />
                <DocumentMetric title="Total" value={formatMoneyRo(selectedInvoice.totalGross, selectedInvoice.currency)} tone="emerald" />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <DocumentMetric title="Total fara TVA" value={formatMoneyRo(selectedInvoice.totalNet || 0, selectedInvoice.currency)} tone="slate" />
                <DocumentMetric title="TVA" value={formatMoneyRo(selectedInvoice.totalVat || 0, selectedInvoice.currency)} tone="slate" />
                <DocumentMetric title="Pozitii" value={String(selectedInvoice.items.length)} tone="blue" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Furnizor</div>
                  <div className="mt-2 text-sm text-slate-700">{selectedInvoice.supplierName || "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">CIF: {selectedInvoice.supplierCif || "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">Cod: {selectedInvoice.supplierCode || "-"}</div>
                </div>
                <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">SPV</div>
                  <div className="mt-2 text-xs text-slate-500">Download ID</div>
                  <div className="text-sm text-slate-700">{selectedInvoice.spvDownloadId || "-"}</div>
                  <div className="mt-2 text-xs text-slate-500">Upload ID</div>
                  <div className="text-sm text-slate-700">{selectedInvoice.spvUploadIndex || "-"}</div>
                </div>
                <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Actiuni</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void downloadInvoicePdf(selectedInvoice)}
                      className={documentButtonSecondaryClass}
                    >
                      <FileText size={16} />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => openXml(selectedInvoice.id)}
                      className={documentButtonSecondaryClass}
                    >
                      <FileCode2 size={16} />
                      XML
                    </button>
                    {!selectedInvoice.supplierId ? (
                      <button
                        type="button"
                        onClick={() => void createSupplier(selectedInvoice.id)}
                        className={documentButtonSecondaryClass}
                      >
                        Furnizor
                      </button>
                    ) : null}
                    {selectedInvoice.linkedReceiptId ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/inregistrare-document/nir/edit?id=${selectedInvoice.linkedReceiptId}`)}
                        className={documentButtonPrimaryClass}
                      >
                        Receptie
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate(`/inregistrare-document/nir/new?incomingInvoiceId=${selectedInvoice.id}`)}
                        className={documentButtonPrimaryClass}
                      >
                        Creeaza receptie
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                  Continut factura
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">Produs</th>
                      <th className="px-3 py-2.5 text-left font-medium">Coduri</th>
                      <th className="px-3 py-2.5 text-left font-medium">UM</th>
                      <th className="px-3 py-2.5 text-left font-medium">Cant.</th>
                      <th className="px-3 py-2.5 text-left font-medium">Pret fara TVA</th>
                      <th className="px-3 py-2.5 text-left font-medium">Pret cu TVA</th>
                      <th className="px-3 py-2.5 text-left font-medium">TVA</th>
                      <th className="px-3 py-2.5 text-left font-medium">Total cu TVA</th>
                      <th className="px-3 py-2.5 text-left font-medium">Mapare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.items.map((line) => (
                      <tr key={line.id} className="border-t border-slate-200">
                        <td className="px-3 py-2.5 text-slate-700">
                          <div className="font-medium text-slate-900">{line.productName || "-"}</div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {[line.productCode, line.externalCode, line.barcode].filter(Boolean).join(" | ") || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{line.uomCode || "-"}</td>
                        <td className="px-3 py-2.5 text-slate-700">{formatQtyRo(line.qty || 0)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{formatMoneyRo(line.unitPrice || 0, selectedInvoice.currency)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{formatMoneyRo(getUnitPriceWithVat(line), selectedInvoice.currency)}</td>
                        <td className="px-3 py-2.5 text-slate-700">
                          <div>{formatMoneyRo(line.lineVat || 0, selectedInvoice.currency)}</div>
                          <div className="text-xs text-slate-500">{formatQtyRo(line.vatRate || 0)}%</div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{formatMoneyRo(line.lineGross || 0, selectedInvoice.currency)}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              line.matchedProductId
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            }`}
                          >
                            {line.matchedProduct?.name || "Nemapat"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!selectedInvoice.items.length ? (
                      <tr className="border-t border-slate-200">
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                          Factura nu are linii importate.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
