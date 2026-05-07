import { useEffect, useMemo, useState } from "react"
import { ArrowUpToLine, Building2, ChevronDown, FileOutput, Plus, ReceiptText, RefreshCw, Send, UserRound, X } from "lucide-react"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  DocumentStatusPill,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
  readonlyInputStyle,
} from "../components/DocumentUi"
import { API_BASE, getToken } from "../lib/api"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { downloadPdfFile, openPdfInNewTab } from "../lib/pdf"
import { getDocumentNumbering, getPreviewValue, type NumberingPayload } from "../lib/numbering"
import { hasModule } from "../lib/modules"
import { formatMoneyRo, formatNumberRo, parseLocaleNumber } from "../lib/format"

type Customer = {
  id: string
  name: string
  code?: string | null
  cif?: string | null
  regNo?: string | null
  address?: string | null
  city?: string | null
  county?: string | null
  postalCode?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  vatPayer?: boolean | null
}

type InvoiceLine = {
  id: string
  productId: string
  search: string
  qty: string
  unitPriceFc: string
  vatRateValue: string
  discountPercent: string
}

function rawToken() {
  return getToken() || localStorage.getItem("token") || localStorage.getItem("access_token") || ""
}

function toNumber(value: any) {
  return parseLocaleNumber(value)
}

function formatNumber(value: any, digits = 2) {
  return formatNumberRo(value, digits)
}

function formatUomOption(uom?: { code?: string | null; standardCode?: string | null; name?: string | null } | null) {
  const shortCode = String(uom?.code || "").trim().toUpperCase()
  const standardCode = String(uom?.standardCode || "").trim().toUpperCase()
  const fallbackName = String(uom?.name || "").trim()
  if (shortCode && standardCode) return `${shortCode}-${standardCode}`
  if (shortCode) return shortCode
  if (standardCode) return standardCode
  return fallbackName || ""
}

function getInvoiceIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("id") || ""
}

function makeLine(): InvoiceLine {
  return { id: crypto.randomUUID(), productId: "", search: "", qty: "1", unitPriceFc: "0", vatRateValue: "19", discountPercent: "0" }
}

function emptyQuickCustomer(name = "") {
  return { name, code: "", cif: "", regNo: "", address: "", city: "", county: "", postalCode: "", country: "RO", phone: "", email: "", vatPayer: true }
}

function isCustomerReadyForEfactura(customer: {
  name?: string
  address?: string
  city?: string
  county?: string
  country?: string
}) {
  return Boolean(
    String(customer.name || "").trim() &&
      String(customer.address || "").trim() &&
      String(customer.city || "").trim() &&
      String(customer.county || "").trim() &&
      String(customer.country || "").trim(),
  )
}

function shortEfacturaMessage(status: string) {
  if (status === "ACCEPTED") return "OK"
  if (status === "REJECTED") return "NOK"
  if (status === "SENT") return "Trimis"
  if (status === "PREPARED" || status === "READY_TO_SEND") return "Pregatit"
  return ""
}

const invoiceLineInputClass =
  "h-10 w-full rounded-[12px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#17324D] focus:ring-2 focus:ring-[#17324D]/10"

export default function FacturaPage() {
  const efacturaEnabled = hasModule("efactura")
  const token = rawToken()
  const invoiceId = getInvoiceIdFromUrl()

  const [products, setProducts] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingInvoice, setLoadingInvoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState("DRAFT")
  const [efacturaStatus, setEfacturaStatus] = useState("NOT_READY")
  const [efacturaInfo, setEfacturaInfo] = useState("")
  const [efacturaBusy, setEfacturaBusy] = useState(false)
  const [efacturaIssues, setEfacturaIssues] = useState<Array<{ severity: string; message: string }>>([])
  const [efacturaUploadIndex, setEfacturaUploadIndex] = useState("")
  const [efacturaSentAt, setEfacturaSentAt] = useState("")
  const [efacturaDownloadedAt, setEfacturaDownloadedAt] = useState("")
  const [customerSearch, setCustomerSearch] = useState("")
  const [customerChosen, setCustomerChosen] = useState(false)
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false)
  const [quickCustomerSaving, setQuickCustomerSaving] = useState(false)
  const [quickCustomerError, setQuickCustomerError] = useState("")
  const [quickCustomerForm, setQuickCustomerForm] = useState(emptyQuickCustomer())
  const [activePanel, setActivePanel] = useState<"header" | "lines" | "summary">("header")

  const [header, setHeader] = useState({
    locationId: getActiveLocationId(),
    customerId: "",
    customerName: "",
    customerCode: "",
    customerCif: "",
    customerRegNo: "",
    customerAddress: "",
    customerEmail: "",
    customerPhone: "",
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    currency: "RON",
    fxRate: "1",
    note: "",
  })

  const [lines, setLines] = useState<InvoiceLine[]>([makeLine()])

  useEffect(() => {
    loadMeta()
    const unsubscribe = subscribeToActiveLocation((locationId) => {
      if (invoiceId) return
      setHeader((prev) => {
        if (!locationId || prev.locationId === locationId) return prev
        return { ...prev, locationId }
      })
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (invoiceId) loadInvoice(invoiceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  async function loadMeta() {
    setLoadingMeta(true)
    setError("")
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const [productsRes, locationsRes, customersRes, numberingData] = await Promise.all([
        fetch(`${API_BASE}/api/v1/products`, { headers }),
        fetch(`${API_BASE}/api/v1/meta/locations`, { headers }),
        fetch(`${API_BASE}/api/v1/customers`, { headers }),
        getDocumentNumbering().catch(() => null),
      ])

      const productsData = await productsRes.json().catch(() => ({}))
      const locationsData = await locationsRes.json().catch(() => ({}))
      const customersData = await customersRes.json().catch(() => ({}))

      const nextProducts = Array.isArray(productsData?.items) ? productsData.items : []
      const nextLocations = Array.isArray(locationsData?.locations) ? locationsData.locations : []
      setProducts(nextProducts)
      setLocations(nextLocations)
      setCustomers(Array.isArray(customersData?.customers) ? customersData.customers : [])
      setNumbering(numberingData?.previews || null)

      if (!invoiceId && nextLocations.length) {
        const preferredLocationId =
          nextLocations.find((location: any) => location.id === getActiveLocationId())?.id || nextLocations[0]?.id || ""
        setHeader((prev) => ({
          ...prev,
          locationId: prev.locationId || preferredLocationId,
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, "invoice"),
        }))
      } else if (!invoiceId) {
        setHeader((prev) => ({
          ...prev,
          docNo: prev.docNo || getPreviewValue(numberingData?.previews, "invoice"),
        }))
      }
    } catch {
      setError("Nu am putut incarca datele necesare pentru factura.")
    } finally {
      setLoadingMeta(false)
    }
  }

  async function loadInvoice(id: string) {
    if (!token) return
    setLoadingInvoice(true)
    setError("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.invoice) throw new Error(data?.error || "Nu am putut incarca factura.")
      const invoice = data.invoice
      setStatus(invoice.status || "DRAFT")
      setEfacturaStatus(invoice.efacturaStatus || "NOT_READY")
      setEfacturaInfo(invoice.efacturaErrorText || "")
      setEfacturaIssues([])
      setEfacturaUploadIndex(invoice.efacturaUploadIndex || "")
      setEfacturaSentAt(invoice.efacturaSentAt || "")
      setEfacturaDownloadedAt(invoice.efacturaDownloadedAt || "")
      setHeader({
        locationId: invoice.locationId || "",
        customerId: invoice.customerId || "",
        customerName: invoice.customerName || "",
        customerCode: invoice.customerCode || "",
        customerCif: invoice.customerCif || "",
        customerRegNo: invoice.customerRegNo || "",
        customerAddress: invoice.customerAddress || "",
        customerEmail: invoice.customerEmail || "",
        customerPhone: invoice.customerPhone || "",
        docNo: invoice.docNo || "",
        docDate: invoice.docDate ? String(invoice.docDate).slice(0, 10) : "",
        dueDate: invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : "",
        currency: invoice.currency || "RON",
        fxRate: String(invoice.fxRate || 1),
        note: invoice.note || "",
      })
      setCustomerSearch(invoice.customerName || "")
      setCustomerChosen(Boolean(invoice.customerId || invoice.customerName))
      const nextLines = Array.isArray(invoice.items)
        ? invoice.items.map((item: any) => ({
            id: item.id || crypto.randomUUID(),
            productId: item.productId || "",
            search: item.productName || item.product?.name || "",
            qty: String(item.qty ?? 1),
            unitPriceFc: String(item.unitPriceFc ?? 0),
            vatRateValue: String(item.vatRateValue ?? item.product?.vatRate?.rate ?? 19),
            discountPercent: String(item.discountPercent ?? 0),
          }))
        : []
      setLines(nextLines.length ? nextLines : [makeLine()])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca factura.")
    } finally {
      setLoadingInvoice(false)
    }
  }

  function setLineValue(id: string, patch: Partial<InvoiceLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()])
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const next = prev.filter((line) => line.id !== id)
      return next.length ? next : [makeLine()]
    })
  }

  function customerMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []
    return customers.filter((customer) => [customer.name, customer.code, customer.cif, customer.phone, customer.email].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0, 8)
  }

  function productMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []
    return products.filter((product) => [product?.name, product?.sku].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0, 8)
  }

  function chooseCustomer(customer: Customer) {
    setHeader((prev) => ({
      ...prev,
      customerId: customer.id,
      customerName: customer.name || "",
      customerCode: customer.code || "",
      customerCif: customer.cif || "",
      customerRegNo: customer.regNo || "",
      customerAddress: customer.address || "",
      customerEmail: customer.email || "",
      customerPhone: customer.phone || "",
    }))
    setCustomerSearch(customer.name || "")
    setCustomerChosen(true)
  }

  function clearCustomer() {
    setHeader((prev) => ({
      ...prev,
      customerId: "",
      customerName: "",
      customerCode: "",
      customerCif: "",
      customerRegNo: "",
      customerAddress: "",
      customerEmail: "",
      customerPhone: "",
    }))
    setCustomerSearch("")
    setCustomerChosen(false)
  }

  function chooseProduct(lineId: string, product: any) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? { ...line, productId: product.id, search: product.name || "", unitPriceFc: String(product.price ?? 0), vatRateValue: String(product.vatRate?.rate ?? 19) }
          : line
      )
    )
  }

  async function printInvoicePdf() {
    if (!invoiceId || !token) return
    const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      setError("Nu am putut genera PDF-ul facturii.")
      return
    }

    await downloadPdfFile(res, `Factura-${header.docNo || "draft"}.pdf`)
  }

  async function prepareEfactura() {
    if (!invoiceId || !token) return
    setEfacturaBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/efactura/prepare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEfacturaStatus(data?.invoice?.efacturaStatus || "NOT_READY")
        setEfacturaInfo(data?.invoice?.efacturaErrorText || data?.error || "Factura nu a trecut validarea locala.")
        setEfacturaIssues(Array.isArray(data?.validation?.issues) ? data.validation.issues : [])
        throw new Error(data?.error || "Factura nu a trecut validarea locala.")
      }

      setEfacturaStatus(data?.invoice?.efacturaStatus || "PREPARED")
      setEfacturaInfo(data?.invoice?.efacturaErrorText || shortEfacturaMessage(data?.invoice?.efacturaStatus || "PREPARED"))
      setEfacturaIssues(Array.isArray(data?.validation?.issues) ? data.validation.issues : [])
      setMessage("XML pregatit.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut pregati e-Factura.")
    } finally {
      setEfacturaBusy(false)
    }
  }

  async function downloadEfacturaXml() {
    if (!invoiceId || !token) return
    const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/efactura/xml`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      setError("Nu am putut descarca XML-ul e-Factura.")
      return
    }

    await downloadPdfFile(res, `eFactura-${header.docNo || "draft"}.xml`)
  }

  async function sendEfacturaToAnaf() {
    if (!invoiceId || !token) return
    setEfacturaBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/efactura/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Nu am putut trimite factura la ANAF.")
      }

      setEfacturaStatus(data?.invoice?.efacturaStatus || "SENT")
      setEfacturaInfo(data?.invoice?.efacturaErrorText || shortEfacturaMessage(data?.invoice?.efacturaStatus || "SENT"))
      setEfacturaUploadIndex(data?.invoice?.efacturaUploadIndex || data?.uploadIndex || "")
      setEfacturaSentAt(data?.invoice?.efacturaSentAt || new Date().toISOString())
      setMessage(shortEfacturaMessage(data?.invoice?.efacturaStatus || "SENT") || "Trimis")
    } catch (e: any) {
      setError(e?.message || "Nu am putut trimite factura la ANAF.")
      throw e
    } finally {
      setEfacturaBusy(false)
    }
  }

  async function sendToSpv() {
    if (!invoiceId || !token) return
    if (status !== "ISSUED") {
      setError("Emite factura inainte sa o trimiti in SPV.")
      return
    }

    try {
      if (!["PREPARED", "READY_TO_SEND", "SENT", "ACCEPTED"].includes(efacturaStatus)) {
        await prepareEfactura()
      }
      if (!["SENT", "ACCEPTED"].includes(efacturaStatus)) {
        await sendEfacturaToAnaf()
      }
      if (!["ACCEPTED", "REJECTED"].includes(efacturaStatus)) {
        await checkEfacturaStatus()
      }
    } catch {
      // Errors are already surfaced by the called steps.
    }
  }

  async function checkEfacturaStatus() {
    if (!invoiceId || !token) return
    setEfacturaBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/efactura/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Nu am putut verifica starea la ANAF.")
      }

      setEfacturaStatus(data?.invoice?.efacturaStatus || data?.status || "SENT")
      const nextStatus = data?.invoice?.efacturaStatus || data?.status || "SENT"
      setEfacturaInfo(data?.invoice?.efacturaErrorText || shortEfacturaMessage(nextStatus))
      setEfacturaUploadIndex(data?.invoice?.efacturaUploadIndex || efacturaUploadIndex)
      setEfacturaSentAt(data?.invoice?.efacturaSentAt || efacturaSentAt)
      setEfacturaDownloadedAt(data?.invoice?.efacturaDownloadedAt || efacturaDownloadedAt)
      setMessage(shortEfacturaMessage(nextStatus) || "Status actualizat")
    } catch (e: any) {
      setError(e?.message || "Nu am putut verifica starea la ANAF.")
    } finally {
      setEfacturaBusy(false)
    }
  }

  async function downloadEfacturaReceipt() {
    if (!invoiceId || !token) return
    setEfacturaBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/${invoiceId}/efactura/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Nu am putut descarca recipisa ANAF.")
      }

      const contentType = res.headers.get("content-type") || ""
      if (contentType.includes("pdf") || contentType.includes("xml") || contentType.startsWith("text/")) {
        await openPdfInNewTab(res)
      } else {
        await downloadPdfFile(res, `Recipisa-${header.docNo || "efactura"}`)
      }
      setEfacturaDownloadedAt(new Date().toISOString())
      setMessage("Recipisa descarcata.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut descarca recipisa.")
    } finally {
      setEfacturaBusy(false)
    }
  }

  function openQuickCustomer() {
    setQuickCustomerOpen(true)
    setQuickCustomerError("")
    setQuickCustomerForm({
      ...emptyQuickCustomer(customerSearch.trim()),
      code: getPreviewValue(numbering, "customer"),
    })
  }

  function closeQuickCustomer() {
    setQuickCustomerOpen(false)
    setQuickCustomerSaving(false)
    setQuickCustomerError("")
  }

  async function saveQuickCustomer() {
    if (!token) return setQuickCustomerError("Lipseste sesiunea de autentificare.")
    if (!quickCustomerForm.name.trim()) return setQuickCustomerError("Completeaza numele clientului.")

    setQuickCustomerSaving(true)
    setQuickCustomerError("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: quickCustomerForm.name.trim(),
          code: null,
          cif: quickCustomerForm.cif.trim() || null,
          regNo: quickCustomerForm.regNo.trim() || null,
          address: quickCustomerForm.address.trim() || null,
          city: quickCustomerForm.city.trim() || null,
          county: quickCustomerForm.county.trim() || null,
          postalCode: quickCustomerForm.postalCode.trim() || null,
          country: quickCustomerForm.country.trim().toUpperCase() || "RO",
          phone: quickCustomerForm.phone.trim() || null,
          email: quickCustomerForm.email.trim() || null,
          vatPayer: quickCustomerForm.vatPayer,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.customer) throw new Error(data?.error || "Nu am putut salva clientul.")
      const created = data.customer as Customer
      setCustomers((prev) => [created, ...prev])
      chooseCustomer(created)
      closeQuickCustomer()
    } catch (e: any) {
      setQuickCustomerError(e?.message || "Nu am putut salva clientul.")
    } finally {
      setQuickCustomerSaving(false)
    }
  }

  const computedLines = useMemo(() => {
    const fxRate = header.currency === "RON" ? 1 : Math.max(0.000001, toNumber(header.fxRate))
    return lines.map((line) => {
      const product = products.find((item) => item.id === line.productId)
      const qty = Math.max(0, toNumber(line.qty))
      const unitPriceFc = Math.max(0, toNumber(line.unitPriceFc))
      const vatRateValue = Math.max(0, toNumber(line.vatRateValue))
      const discountPercent = Math.min(100, Math.max(0, toNumber(line.discountPercent)))
      const lineBaseFc = qty * unitPriceFc
      const discountAmountFc = (lineBaseFc * discountPercent) / 100
      const lineNetFc = lineBaseFc - discountAmountFc
      const lineVatFc = (lineNetFc * vatRateValue) / 100
      const lineGrossFc = lineNetFc + lineVatFc
      const sgrUnitFc = product?.isSgr ? toNumber(product?.sgrValue) : 0
      const sgrTotalFc = qty * sgrUnitFc
      return {
        ...line,
        qty,
        unitPriceFc,
        vatRateValue,
        discountPercent,
        lineBaseFc,
        discountAmountFc,
        lineNetFc,
        lineVatFc,
        lineGrossFc,
        sgrUnitFc,
        sgrTotalFc,
        discountAmountRon: discountAmountFc * fxRate,
        lineNetRon: lineNetFc * fxRate,
        lineVatRon: lineVatFc * fxRate,
        lineGrossRon: lineGrossFc * fxRate,
        sgrTotalRon: sgrTotalFc * fxRate,
      }
    })
  }, [header.currency, header.fxRate, lines, products])

  const totals = useMemo(
    () =>
      computedLines.reduce(
        (acc, line) => {
          acc.discountFc += line.discountAmountFc
          acc.netFc += line.lineNetFc
          acc.vatFc += line.lineVatFc
          acc.grossFc += line.lineGrossFc
          acc.sgrFc += line.sgrTotalFc
          acc.discountRon += line.discountAmountRon
          acc.netRon += line.lineNetRon
          acc.vatRon += line.lineVatRon
          acc.grossRon += line.lineGrossRon
          acc.sgrRon += line.sgrTotalRon
          return acc
        },
        { discountFc: 0, netFc: 0, vatFc: 0, grossFc: 0, sgrFc: 0, discountRon: 0, netRon: 0, vatRon: 0, grossRon: 0, sgrRon: 0 }
      ),
    [computedLines]
  )

  async function saveInvoice(issueNow = false) {
    if (!token) return setError("Lipseste sesiunea de autentificare.")
    if (!header.locationId) return setError("Selecteaza locatia pentru factura.")
    const customerName = header.customerName.trim() || customerSearch.trim()
    if (!customerName) return setError("Selecteaza sau completeaza clientul.")

    const payloadLines = computedLines
      .filter((line) => line.productId && line.qty > 0)
      .map((line) => ({
        productId: line.productId,
        qty: line.qty,
        unitPriceFc: line.unitPriceFc,
        vatRateValue: line.vatRateValue,
        discountPercent: line.discountPercent,
      }))

    if (!payloadLines.length) return setError("Factura trebuie sa aiba cel putin o pozitie.")

    setSaving(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/api/v1/sales-invoices/full`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: invoiceId || undefined,
          issueNow,
          header: { ...header, customerName, fxRate: header.currency === "RON" ? 1 : Math.max(0.000001, toNumber(header.fxRate)) },
          items: payloadLines,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.invoice) throw new Error(data?.error || "Nu am putut salva factura.")
      const savedId = data.invoice.id
      setStatus(data.invoice.status || (issueNow ? "ISSUED" : "DRAFT"))
      setMessage(issueNow ? "Factura finalizata si salvata in documente." : "Factura finalizata si salvata in documente.")
      if (!invoiceId) {
        window.location.href = `/inregistrare-document/factura/edit?id=${savedId}`
        return
      }
      await loadInvoice(savedId)
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva factura.")
    } finally {
      setSaving(false)
    }
  }

  const selectedCustomerInfo = header.customerName
    ? [header.customerCif ? `CIF ${header.customerCif}` : "", header.customerPhone || "", header.customerEmail || ""].filter(Boolean).join(" • ")
    : ""
  const selectedCustomer = customers.find((item) => item.id === header.customerId)
  const customerReadyForEfactura = isCustomerReadyForEfactura({
    name: header.customerName,
    address: header.customerAddress,
    city: selectedCustomer?.city || "",
    county: selectedCustomer?.county || "",
    country: selectedCustomer?.country || "RO",
  })
  const efacturaPrepared = ["PREPARED", "READY_TO_SEND", "SENT", "ACCEPTED"].includes(efacturaStatus)
  const efacturaCanSend = status === "ISSUED" && customerReadyForEfactura
  const hasSgr = totals.sgrFc > 0 || computedLines.some((line) => line.sgrTotalFc > 0)
  const invoicePanels = [
    {
      id: "header" as const,
      title: "Date factura",
    },
    {
      id: "lines" as const,
      title: "Produse",
    },
    {
      id: "summary" as const,
      title: "Verificare",
    },
  ]

  return (
    <div className="space-y-3">
      <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-900/[0.03]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Operatiuni
            </div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-[#17324D]">
              {invoiceId ? "Editare factura" : "Factura noua"}
            </h1>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {invoiceId ? (
              <button type="button" onClick={printInvoicePdf} className={documentButtonSecondaryClass}>
                <FileOutput size={16} className="mr-2" />
                PDF
              </button>
            ) : null}
            <button type="button" onClick={() => saveInvoice(true)} className={documentButtonPrimaryClass} disabled={saving || loadingMeta || loadingInvoice}>
              {saving ? "Se salveaza..." : "Finalizeaza"}
            </button>
            {invoiceId && efacturaEnabled ? (
              <button
                type="button"
                onClick={sendToSpv}
                className={documentButtonPrimaryClass}
                disabled={efacturaBusy || saving || loadingMeta || loadingInvoice || !efacturaCanSend}
              >
                <Send size={16} className="mr-2" />
                {efacturaBusy ? "Se trimite..." : "Trimite ANAF"}
              </button>
            ) : null}
          </div>
        </div>

        {invoiceId && efacturaEnabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={checkEfacturaStatus} className={documentButtonSecondaryClass} disabled={efacturaBusy || !efacturaUploadIndex}>
              <RefreshCw size={16} className="mr-2" />
              Verifica stare
            </button>
            <details className="relative">
              <summary className={`${documentButtonSecondaryClass} cursor-pointer list-none`}>
                <ArrowUpToLine size={16} className="mr-2" />
                Descarca
                <ChevronDown size={15} className="ml-1" />
              </summary>
              <div className="absolute right-0 z-30 mt-2 min-w-[190px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
                <button
                  type="button"
                  onClick={downloadEfacturaXml}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!efacturaPrepared}
                >
                  <FileOutput size={16} />
                  XML
                </button>
                <button
                  type="button"
                  onClick={downloadEfacturaReceipt}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={efacturaBusy || !efacturaUploadIndex}
                >
                  <ReceiptText size={16} />
                  Recipisa ANAF
                </button>
              </div>
            </details>
            {!customerReadyForEfactura ? (
              <span className="text-xs font-medium text-amber-700">Completeaza adresa, orasul, judetul si tara clientului inainte de trimiterea SPV.</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {loadingMeta ? <InlineNotice>Se incarca nomenclatoarele pentru factura.</InlineNotice> : null}
      {loadingInvoice ? <InlineNotice>Se incarca factura selectata.</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {efacturaEnabled && efacturaInfo && efacturaStatus === "REJECTED" ? <InlineNotice>{efacturaInfo}</InlineNotice> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 rounded-[8px] border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/[0.03]">
            {invoicePanels.map((panel, index) => {
              const isActive = activePanel === panel.id
              return (
                <button
                  key={panel.id}
                  type="button"
                  onClick={() => setActivePanel(panel.id)}
                  className={[
                    "inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-sm font-extrabold transition",
                    isActive
                      ? "border-[#17324D] bg-[#17324D] text-white shadow-sm shadow-[#17324D]/20"
                      : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-xs font-extrabold",
                    isActive ? "bg-white/15 text-white" : "bg-slate-100 text-[#17324D]",
                  ].join(" ")}>
                    {index + 1}
                  </span>
                  {panel.title}
                </button>
              )
            })}
        </div>

        <div className="min-w-0">
      {activePanel === "summary" && invoiceId && efacturaEnabled ? (
        <DocumentSection title="Detalii SPV">
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Trimis in SPV: <span className="font-semibold text-slate-900">{efacturaSentAt ? new Date(efacturaSentAt).toLocaleString("ro-RO") : "-"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Recipisa descarcata: <span className="font-semibold text-slate-900">{efacturaDownloadedAt ? new Date(efacturaDownloadedAt).toLocaleString("ro-RO") : "-"}</span>
            </div>
          </div>

          {efacturaIssues.length ? (
            <div className="mt-3 space-y-2">
              {efacturaIssues.map((issue, index) => (
                <InlineNotice key={`${issue.severity}-${index}`} tone={issue.severity === "error" ? "error" : "info"}>
                  {issue.message}
                </InlineNotice>
              ))}
            </div>
          ) : null}
        </DocumentSection>
      ) : null}

      {activePanel === "header" ? (
      <>
      <DocumentSection title="Antet factura">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DocumentField label="Locatie">
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={header.locationId}
                onChange={(e) => {
                  const nextLocationId = e.target.value
                  setHeader((prev) => ({ ...prev, locationId: nextLocationId }))
                  setActiveLocationId(nextLocationId)
                }}
                className={`${documentInputClass} pl-11`}
              >
                <option value="">Selecteaza locatie</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          </DocumentField>

          <DocumentField label="Numar factura">
            <input value={header.docNo} readOnly className={documentInputClass} style={readonlyInputStyle} />
          </DocumentField>

          <DocumentField label="Data">
            <input type="date" value={header.docDate} onChange={(e) => setHeader((prev) => ({ ...prev, docDate: e.target.value }))} className={documentInputClass} />
          </DocumentField>

          <DocumentField label="Scadenta">
            <input type="date" value={header.dueDate} onChange={(e) => setHeader((prev) => ({ ...prev, dueDate: e.target.value }))} className={documentInputClass} />
          </DocumentField>

          <DocumentField label="Moneda">
            <select value={header.currency} onChange={(e) => setHeader((prev) => ({ ...prev, currency: e.target.value }))} className={documentInputClass}>
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="HUF">HUF</option>
            </select>
          </DocumentField>

          <DocumentField label="Curs">
            <input value={header.fxRate} onChange={(e) => setHeader((prev) => ({ ...prev, fxRate: e.target.value }))} className={documentInputClass} disabled={header.currency === "RON"} />
          </DocumentField>
        </div>

        <div className="mt-3 rounded-[8px] border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-slate-900">Client</div>
            <button type="button" onClick={openQuickCustomer} className={documentButtonSecondaryClass}>
              <Plus size={16} className="mr-2" />
              Adauga client
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_0.8fr]">
            <div>
              <DocumentField label="Client">
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    value={customerSearch}
                    onChange={(e) => {
                      const value = e.target.value
                      setCustomerSearch(value)
                      setCustomerChosen(false)
                      setHeader((prev) => ({
                        ...prev,
                        customerId: "",
                        customerName: value,
                        customerCode: "",
                        customerCif: "",
                        customerRegNo: "",
                        customerAddress: "",
                        customerEmail: "",
                        customerPhone: "",
                      }))
                    }}
                    placeholder="Scrie numele clientului sau cateva litere..."
                    className={`${documentInputClass} pl-9`}
                  />
                </div>
              </DocumentField>

            {!customerChosen && customerMatches(customerSearch).length ? (
              <div className="mt-2 space-y-1.5 rounded-[8px] border border-slate-200 bg-white p-2.5">
                {customerMatches(customerSearch).map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => chooseCustomer(customer)}
                    className="w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="font-semibold text-slate-900">{customer.name}</div>
                    <div className="mt-0.5 text-[12px] text-slate-500">{[customer.code, customer.cif, customer.phone].filter(Boolean).join(" • ")}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-[8px] border border-slate-200 bg-white p-3">
            {header.customerName ? (
              <div className="space-y-2">
                <div className="text-[15px] font-semibold text-slate-900">{header.customerName}</div>
                <div className="text-[13px] text-slate-600">{selectedCustomerInfo || "-"}</div>
                {header.customerAddress ? <div className="text-[13px] text-slate-500">{header.customerAddress}</div> : null}
                {efacturaEnabled ? (
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${customerReadyForEfactura ? "bg-[#E5F3E8] text-[#215D2A]" : "bg-slate-100 text-slate-700"}`}>
                    {customerReadyForEfactura ? "e-Factura ok" : "date incomplete"}
                  </div>
                ) : null}
                <button type="button" onClick={clearCustomer} className="mt-2 inline-flex items-center rounded-[8px] border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">
                  Schimba clientul
                </button>
              </div>
            ) : (
              <div className="text-[13px] text-slate-500">-</div>
            )}
          </div>
        </div>
        </div>

        <div className="mt-3">
          <DocumentField label="Observatii">
            <textarea value={header.note} onChange={(e) => setHeader((prev) => ({ ...prev, note: e.target.value }))} rows={3} className={documentTextareaClass} placeholder="Poti nota aici detalii comerciale sau observatii pentru livrare." />
          </DocumentField>
        </div>
      </DocumentSection>
      </>
      ) : null}

      {activePanel === "lines" ? (
      <DocumentSection
        title="Linii factura"
        description="Pastrez acelasi flux simplu: cauti produsul, alegi rapid si completezi cantitatea, pretul, discountul si TVA-ul."
        actions={
          <button type="button" onClick={addLine} className={documentButtonPrimaryClass}>
            <Plus size={16} className="mr-2" />
            Linie
          </button>
        }
      >
        <div className="mb-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-5">
          <DocumentMetric title="Linii" value={computedLines.length} tone="blue" />
          <DocumentMetric title={`Net ${header.currency}`} value={formatMoneyRo(totals.netFc, header.currency)} tone="slate" />
          <DocumentMetric title={`TVA ${header.currency}`} value={formatMoneyRo(totals.vatFc, header.currency)} tone="blue" />
          {hasSgr ? <DocumentMetric title={`SGR ${header.currency}`} value={formatMoneyRo(totals.sgrFc, header.currency)} tone="slate" /> : null}
          <DocumentMetric title={`Total ${header.currency}`} value={formatMoneyRo(totals.grossFc + totals.sgrFc, header.currency)} tone="emerald" />
        </div>

        <div className="space-y-2">
          <div className="hidden xl:grid xl:grid-cols-[minmax(260px,2.2fr)_100px_130px_110px_90px_150px_140px_96px] xl:gap-2 xl:px-1">
            {["Produs", "Cant.", `Pret ${header.currency}`, "Disc. %", "TVA %", "Total", "Net", "Actiuni"].map((label) => (
              <div key={label} className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {label}
              </div>
            ))}
          </div>

          {computedLines.map((line, index) => {
            const product = products.find((item) => item.id === line.productId)
            const lineLabel = String(line.search || product?.name || "").trim()
            const suggestions = !line.productId ? productMatches(line.search) : []

            return (
              <div key={line.id} className="rounded-[14px] border border-slate-200 bg-white p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2 xl:hidden">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-600">Pozitia {index + 1}</div>
                  <button type="button" onClick={() => removeLine(line.id)} className={documentButtonDangerClass}>
                    <X size={15} className="mr-1" />
                    Sterge
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,2.2fr)_100px_130px_110px_90px_150px_140px_96px] xl:items-start">
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">Produs</div>
                    <input value={line.search} onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "" })} placeholder="Scrie produsul sau SKU..." className={invoiceLineInputClass} />
                    {lineLabel ? <div className="pt-1 text-[11px] font-semibold text-teal-700">{product?.sku && lineLabel === product.name ? `${lineLabel} (${product.sku})` : lineLabel}</div> : null}
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">Cantitate</div>
                    <input value={line.qty} onChange={(e) => setLineValue(line.id, { qty: e.target.value })} className={invoiceLineInputClass} />
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">{`Pret ${header.currency}`}</div>
                    <input value={line.unitPriceFc} onChange={(e) => setLineValue(line.id, { unitPriceFc: e.target.value })} className={invoiceLineInputClass} />
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">Discount %</div>
                    <input value={String(line.discountPercent)} onChange={(e) => setLineValue(line.id, { discountPercent: e.target.value })} className={invoiceLineInputClass} />
                    <div className="pt-1 text-[11px] text-slate-500">
                      {line.discountAmountFc > 0 ? `-${formatMoneyRo(line.discountAmountFc, header.currency)}` : "Fara discount"}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">TVA %</div>
                    <input value={line.vatRateValue} onChange={(e) => setLineValue(line.id, { vatRateValue: e.target.value })} className={invoiceLineInputClass} />
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">Total linie</div>
                    <input value={formatMoneyRo(line.lineGrossFc + line.sgrTotalFc, header.currency)} readOnly className={invoiceLineInputClass} style={readonlyInputStyle} />
                    <div className="pt-1 text-[11px] text-slate-500">
                      {[line.discountAmountFc > 0 ? `Discount ${formatMoneyRo(line.discountAmountFc, header.currency)}` : "", line.sgrTotalFc > 0 ? `Include SGR ${formatMoneyRo(line.sgrTotalFc, header.currency)}` : formatUomOption(product?.uom)].filter(Boolean).join(" - ")}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:hidden">Net</div>
                    <input value={formatMoneyRo(line.lineNetFc, header.currency)} readOnly className={invoiceLineInputClass} style={readonlyInputStyle} />
                  </div>

                  <div className="flex items-start justify-end xl:pt-0.5">
                    <button type="button" onClick={() => removeLine(line.id)} className="hidden xl:inline-flex items-center justify-center rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {!line.productId && suggestions.length ? (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => chooseProduct(line.id, item)}
                        className="rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <div className="mt-0.5 text-[12px] text-slate-500">{[item.sku, formatUomOption(item.uom), `${formatNumber(item.price || 0)} RON`].filter(Boolean).join(" - ")}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className="flex justify-center border-t border-dashed border-slate-200 pt-3">
            <button type="button" onClick={addLine} className={documentButtonPrimaryClass}>
              <Plus size={16} className="mr-2" />
              Adauga linie
            </button>
          </div>
        </div>
      </DocumentSection>
      ) : null}

      {activePanel === "summary" ? (
      <DocumentSection title="Totaluri" description="Vezi imediat discountul, netul, TVA-ul, SGR-ul si totalul final al documentului.">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-6">
          <DocumentMetric title={`Discount ${header.currency}`} value={formatMoneyRo(totals.discountFc, header.currency)} tone="amber" />
          <DocumentMetric title={`Net ${header.currency}`} value={formatMoneyRo(totals.netFc, header.currency)} tone="slate" />
          <DocumentMetric title={`TVA ${header.currency}`} value={formatMoneyRo(totals.vatFc, header.currency)} tone="blue" />
          {hasSgr ? <DocumentMetric title={`SGR ${header.currency}`} value={formatMoneyRo(totals.sgrFc, header.currency)} tone="slate" /> : null}
          <DocumentMetric title={`Total ${header.currency}`} value={formatMoneyRo(totals.grossFc + totals.sgrFc, header.currency)} tone="emerald" />
          {header.currency !== "RON" ? <DocumentMetric title="Total RON" value={formatMoneyRo(totals.grossRon + totals.sgrRon, "RON")} tone="blue" /> : null}
        </div>
      </DocumentSection>
      ) : null}
        </div>
      </div>

      {quickCustomerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[18px] font-semibold text-slate-900">Adauga client nou</div>
              </div>
              <button type="button" onClick={closeQuickCustomer} className={documentButtonSecondaryClass}>
                Inchide
              </button>
            </div>

            {quickCustomerError ? <InlineNotice tone="error">{quickCustomerError}</InlineNotice> : null}

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DocumentField label="Nume client">
                <input value={quickCustomerForm.name} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, name: e.target.value }))} className={documentInputClass} />
              </DocumentField>
                  <DocumentField label="Cod client">
                    <input value={quickCustomerForm.code} readOnly className={documentInputClass} style={readonlyInputStyle} placeholder="Se propune automat" />
                  </DocumentField>
              <DocumentField label="CIF">
                <input value={quickCustomerForm.cif} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, cif: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Reg. comertului">
                <input value={quickCustomerForm.regNo} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, regNo: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Telefon">
                <input value={quickCustomerForm.phone} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, phone: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Email">
                <input value={quickCustomerForm.email} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, email: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Localitate">
                <input value={quickCustomerForm.city} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, city: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Judet">
                <input value={quickCustomerForm.county} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, county: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Cod postal">
                <input value={quickCustomerForm.postalCode} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, postalCode: e.target.value }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Tara">
                <input value={quickCustomerForm.country} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, country: e.target.value.toUpperCase() }))} className={documentInputClass} />
              </DocumentField>
              <DocumentField label="Regim TVA">
                <label className="flex min-h-10 items-center gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">
                  <input type="checkbox" checked={quickCustomerForm.vatPayer} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, vatPayer: e.target.checked }))} />
                  <span>Client platitor de TVA</span>
                </label>
              </DocumentField>
            </div>

            <div className="mt-3">
              <DocumentField label="Adresa">
                <textarea value={quickCustomerForm.address} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, address: e.target.value }))} rows={2} className={documentTextareaClass} />
              </DocumentField>
            </div>

            {efacturaEnabled ? (
              <div className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-[12px] font-semibold ${isCustomerReadyForEfactura(quickCustomerForm) ? "bg-[#E5F3E8] text-[#215D2A]" : "bg-slate-100 text-slate-700"}`}>
                {isCustomerReadyForEfactura(quickCustomerForm) ? "e-Factura ok" : "date incomplete"}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeQuickCustomer} className={documentButtonSecondaryClass}>
                Renunta
              </button>
              <button type="button" onClick={saveQuickCustomer} className={documentButtonPrimaryClass} disabled={quickCustomerSaving}>
                {quickCustomerSaving ? "Se salveaza..." : "Salveaza client"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
