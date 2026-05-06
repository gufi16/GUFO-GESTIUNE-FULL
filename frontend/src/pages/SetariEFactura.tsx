import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { hasModule } from "../lib/modules"

type EFacturaForm = {
  companyId: string
  efacturaEnabled: boolean
  efacturaEnvironment: string
  efacturaPlatformConfigured: boolean
  efacturaUsesPlatformConfig: boolean
  companyName: string
  companyCui: string
  companyCity: string
  companyCounty: string
  companyPostalCode: string
  companyCountry: string
  contactEmail: string
  efacturaCertSerial: string
}

type EFacturaDiagnostics = {
  tenantId: string | null
  environment: string
  cif: string | null
  hasAccessToken: boolean
  hasCertificateFile: boolean
  usingClientCertificate: boolean
  certSerialConfigured: string | null
  certSerialNormalized: string | null
  tokenIssuer: string | null
  tokenClientAppId: string | null
  tokenSerial: string | null
  tokenSerialNormalized: string | null
  serialsMatch: boolean
  tokenScopes: string[]
  tokenRoles: string[]
  tokenExp: string | null
}

type EFacturaCertificateState = {
  hasFile: boolean
  filename: string
  uploadedAt: string
  passwordConfigured: boolean
}

type AnafCredentialSummary = {
  id: string
  label: string
  isDefault: boolean
  certSerial: string
  certFilename: string
  certUploadedAt: string | null
  certPasswordConfigured: boolean
  efacturaConnectedAt: string | null
  efacturaAccessTokenExpiresAt: string | null
  efacturaLastError: string
  hasCertificateFile: boolean
  hasCertificatePassword: boolean
  hasEfacturaToken: boolean
  connected: boolean
  hasEtransportToken: boolean
}

type LocalAgentCertificateStatus = {
  configuredSerial: string | null
  detected: boolean
  hasPrivateKey: boolean
  subject: string | null
  issuer: string | null
  thumbprint: string | null
  store: string | null
  notBefore: string | null
  notAfter: string | null
  expiresInDays: number | null
  expired: boolean
  expiringSoon: boolean
  error: string | null
}

type LocalAgentStatus = {
  ok: boolean
  agent: {
    service: string
    bridgeUrl: string
    host: string
    port: number
    erpUrl: string | null
    erpOrigin: string | null
    hasLicenseKey: boolean
  }
  certificate: LocalAgentCertificateStatus
}

type AgentDownloadInfo = {
  available: boolean
  type: "external" | "local" | "missing"
  fileName?: string | null
  updatedAt?: string | null
  size?: number | null
  url?: string | null
  error?: string | null
}

type AgentPairingCodeState = {
  code: string
  expiresAt: string | null
  erpUrl: string
  certSerial: string | null
  companyName: string | null
}

const DEFAULT_LOCAL_AGENT_URL = "http://127.0.0.1:48521"

type ActiveModal = null | "flow" | "agent" | "debug" | "pairing"

const emptyForm: EFacturaForm = {
  companyId: "",
  efacturaEnabled: false,
  efacturaEnvironment: "test",
  efacturaPlatformConfigured: false,
  efacturaUsesPlatformConfig: false,
  companyName: "",
  companyCui: "",
  companyCity: "",
  companyCounty: "",
  companyPostalCode: "",
  companyCountry: "RO",
  contactEmail: "",
  efacturaCertSerial: "",
}

function parseDisplayDate(value: string | null | undefined) {
  const text = String(value || "").trim()
  if (!text) return null
  const serializedMatch = text.match(/^\/Date\((\d+)\)\/$/)
  if (serializedMatch) {
    const timestamp = Number(serializedMatch[1])
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp)
    }
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDisplayDate(value: string | null | undefined) {
  const date = parseDisplayDate(value)
  return date ? date.toLocaleString("ro-RO") : "-"
}

function normalizeAnafMessage(message: string) {
  const text = String(message || "")
  if (text.includes("Platforma nu are configurata")) {
    return "Aplicatia ANAF nu este configurata inca in Control Panel. Completeaza configurarea globala si apoi revino aici."
  }
  if (text.includes("Conecteaza mai intai aplicatia")) {
    return "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul ANAF pentru firma activa."
  }
  if (text.includes("respinsa la nivel TLS")) {
    return text
  }
  if (/handshake failure|sslv3 alert handshake failure|EPROTO|tls/i.test(text)) {
    return "ANAF a respins conexiunea TLS. Verifica endpointul ANAF folosit de backend si reincearca sincronizarea."
  }
  return text
}

function SettingsModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#17324D]">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className={documentButtonSecondaryClass}>
            Inchide
          </button>
        </div>
        <div className="max-h-[calc(90vh-84px)] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function findCredentialById(credentials: AnafCredentialSummary[], credentialId: string | null | undefined) {
  const targetId = String(credentialId || "").trim()
  if (!targetId) return null
  return credentials.find((item) => item.id === targetId) || null
}

function readOauthFeedback() {
  if (typeof window === "undefined") {
    return { oauth: "", message: "" }
  }

  const params = new URLSearchParams(window.location.search)
  return {
    oauth: String(params.get("oauth") || "").trim(),
    message: String(params.get("message") || "").trim(),
  }
}

function clearOauthFeedbackFromUrl() {
  if (typeof window === "undefined") return

  const params = new URLSearchParams(window.location.search)
  if (!params.has("oauth") && !params.has("message")) return

  params.delete("oauth")
  params.delete("message")
  const qs = params.toString()
  const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`
  window.history.replaceState({}, "", nextUrl)
}

export default function SetariEFacturaPage() {
  if (!hasModule("efactura")) {
    return <Navigate to="/setari" replace />
  }

  const token = getToken() || ""
  const [form, setForm] = useState<EFacturaForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
  const [certBusy, setCertBusy] = useState(false)
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [diagnostics, setDiagnostics] = useState<EFacturaDiagnostics | null>(null)
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certPassword, setCertPassword] = useState("")
  const [certState, setCertState] = useState<EFacturaCertificateState>({
    hasFile: false,
    filename: "",
    uploadedAt: "",
    passwordConfigured: false,
  })
  const [oauthStatus, setOauthStatus] = useState({
    connected: false,
    connectedAt: "",
    expiresAt: "",
    lastError: "",
  })
  const [credentials, setCredentials] = useState<AnafCredentialSummary[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState("")
  const [selectedCredentialLabel, setSelectedCredentialLabel] = useState("")
  const [newCredentialLabel, setNewCredentialLabel] = useState("")
  const [localAgentUrl, setLocalAgentUrl] = useState(DEFAULT_LOCAL_AGENT_URL)
  const [localAgentLoading, setLocalAgentLoading] = useState(false)
  const [localAgentError, setLocalAgentError] = useState("")
  const [localAgentStatus, setLocalAgentStatus] = useState<LocalAgentStatus | null>(null)
  const [agentDownloadLoading, setAgentDownloadLoading] = useState(false)
  const [agentDownloadInfo, setAgentDownloadInfo] = useState<AgentDownloadInfo | null>(null)
  const [agentPairingBusy, setAgentPairingBusy] = useState(false)
  const [agentPairing, setAgentPairing] = useState<AgentPairingCodeState | null>(null)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const isDebugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugSpv") === "1"

  useEffect(() => {
    const oauthFeedback = readOauthFeedback()

    if (oauthFeedback.oauth === "success") {
      setMessage("Conectarea ANAF a fost realizata.")
    }
    if (oauthFeedback.oauth === "error") {
      setError(oauthFeedback.message || "Conectarea ANAF nu a putut fi finalizata.")
    }
    if (oauthFeedback.oauth === "denied") {
      setError(oauthFeedback.message || "Autorizarea ANAF a fost anulata sau refuzata.")
    }

    void loadSettings(oauthFeedback)
    void loadLocalAgentStatus()
    void loadAgentDownloadInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const selectedCredential =
      findCredentialById(credentials, selectedCredentialId) ||
      credentials.find((item) => item.isDefault) ||
      credentials[0] ||
      null

    if (!selectedCredential) {
      setSelectedCredentialLabel("")
      return
    }

    if (selectedCredential.id !== selectedCredentialId) {
      setSelectedCredentialId(selectedCredential.id)
    }

    applyCredentialState(selectedCredential, {
      efacturaCertSerial: form.efacturaCertSerial,
      efacturaCertHasFile: certState.hasFile,
      efacturaCertFilename: certState.filename,
      efacturaCertUploadedAt: certState.uploadedAt,
      efacturaCertPasswordConfigured: certState.passwordConfigured,
      efacturaOauthAccessToken: oauthStatus.connected,
      efacturaOauthConnectedAt: oauthStatus.connectedAt,
      efacturaOauthAccessTokenExpiresAt: oauthStatus.expiresAt,
      efacturaOauthLastError: oauthStatus.lastError,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCredentialId, credentials])

  useEffect(() => {
    if (!token || !selectedCredentialId) return
    void loadDiagnostics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCredentialId])

  function applyCredentialState(credential: AnafCredentialSummary | null, company: any) {
    const fallbackSerial = String(company?.efacturaCertSerial || "").trim()
    const fallbackHasFile = Boolean(company?.efacturaCertHasFile)
    const fallbackPassword = Boolean(company?.efacturaCertPasswordConfigured)
    const fallbackHasToken = Boolean(company?.efacturaOauthAccessToken)

    setForm((prev) => ({
      ...prev,
      efacturaCertSerial: credential?.certSerial || fallbackSerial,
    }))

    setSelectedCredentialLabel(credential?.label || "")
    setCertState({
      hasFile: credential ? Boolean(credential.hasCertificateFile) : fallbackHasFile,
      filename: credential?.certFilename || company?.efacturaCertFilename || "",
      uploadedAt: credential?.certUploadedAt || company?.efacturaCertUploadedAt || "",
      passwordConfigured: credential ? Boolean(credential.certPasswordConfigured) : fallbackPassword,
    })

    const connected = credential ? Boolean(credential.hasEfacturaToken) : fallbackHasToken
    const rawLastError = credential
      ? String(credential.efacturaLastError || "")
      : String(company?.efacturaOauthLastError || "")
    const lastError = rawLastError.includes("certificatului SPV") ? "" : rawLastError

    setOauthStatus({
      connected,
      connectedAt: credential?.efacturaConnectedAt || company?.efacturaOauthConnectedAt || "",
      expiresAt: credential?.efacturaAccessTokenExpiresAt || company?.efacturaOauthAccessTokenExpiresAt || "",
      lastError,
    })
  }

  async function loadSettings(oauthFeedback?: { oauth?: string; message?: string }) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    if (!oauthFeedback?.oauth) {
      setError("")
      setMessage("")
    }

    try {
      const res = await fetch(`${API}/api/v1/company`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || "Nu am putut incarca setarile e-Factura.")
      }

      const company = data?.company || {}
      const nextCredentials = Array.isArray(company?.anafCredentials) ? (company.anafCredentials as AnafCredentialSummary[]) : []
      const fallbackCredentialId = String(company?.anafCredentialId || "").trim()
      const preservedCredential =
        findCredentialById(nextCredentials, selectedCredentialId) ||
        findCredentialById(nextCredentials, fallbackCredentialId) ||
        nextCredentials.find((item) => item.isDefault) ||
        nextCredentials[0] ||
        null

      setCredentials(nextCredentials)
      setSelectedCredentialId(preservedCredential?.id || "")
      if (!newCredentialLabel.trim() && company?.name) {
        setNewCredentialLabel(`${company.name} - SPV principal`)
      }

      setForm({
        companyId: data?.company?.id || "",
        efacturaEnabled: data?.company?.efacturaEnabled ?? false,
        efacturaEnvironment: data?.company?.efacturaEnvironment || "test",
        efacturaPlatformConfigured: Boolean(data?.company?.efacturaPlatformConfigured),
        efacturaUsesPlatformConfig: Boolean(data?.company?.efacturaUsesPlatformConfig),
        companyName: data?.company?.name || "",
        companyCui: data?.company?.cui || "",
        companyCity: data?.company?.efacturaSellerCity || data?.company?.city || "",
        companyCounty: data?.company?.efacturaSellerCounty || data?.company?.county || "",
        companyPostalCode: data?.company?.efacturaSellerPostalCode || data?.company?.postalCode || "",
        companyCountry: data?.company?.efacturaSellerCountryCode || data?.company?.country || "RO",
        contactEmail: data?.company?.efacturaContactEmail || data?.company?.contactEmail || "",
        efacturaCertSerial: preservedCredential?.certSerial || data?.company?.efacturaCertSerial || "",
      })
      applyCredentialState(preservedCredential, company)

      if (company?.id) {
        setError((prev) => (prev.includes("Selecteaza mai intai firma activa") ? "" : prev))
      }

      if (oauthFeedback?.oauth) {
        clearOauthFeedbackFromUrl()
      }
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca setarile e-Factura.")
    } finally {
      setLoading(false)
    }
  }

  async function loadLocalAgentStatus(preferredUrl?: string) {
    const agentUrl = String(preferredUrl || localAgentUrl || DEFAULT_LOCAL_AGENT_URL).trim().replace(/\/+$/, "") || DEFAULT_LOCAL_AGENT_URL
    setLocalAgentLoading(true)
    setLocalAgentError("")
    try {
      const res = await fetch(`${agentUrl}/agent/status`, {
        headers: {
          Accept: "application/json",
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut citi starea agentului local Gufo e-Factura.")
      }
      setLocalAgentUrl(agentUrl)
      setLocalAgentStatus(data as LocalAgentStatus)
    } catch (e: any) {
      setLocalAgentStatus(null)
      setLocalAgentError(e?.message || "Nu am putut citi starea agentului local Gufo e-Factura.")
    } finally {
      setLocalAgentLoading(false)
    }
  }

  async function loadAgentDownloadInfo() {
    if (!token) return
    setAgentDownloadLoading(true)
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/agent-download-info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut verifica installerul Gufo e-Factura.")
      }
      setAgentDownloadInfo((data?.agent || null) as AgentDownloadInfo | null)
    } catch (e: any) {
      setAgentDownloadInfo({
        available: false,
        type: "missing",
        error: e?.message || "Nu am putut verifica installerul Gufo e-Factura.",
      })
    } finally {
      setAgentDownloadLoading(false)
    }
  }

  async function downloadAgentInstaller() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/agent-download-link`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Nu am putut descarca installerul Gufo e-Factura.")
      }

      const data = await res.json().catch(() => ({}))
      if (!data?.ok || !data?.url) {
        throw new Error(data?.error || "Nu am putut obtine linkul de descarcare pentru Gufo e-Factura.")
      }

      const downloadUrl = String(data.url)
      const fileName = data?.fileName || agentDownloadInfo?.fileName || "Gufo-eFactura-Setup.exe"
      const link = document.createElement("a")
      link.href = downloadUrl.startsWith("http") ? downloadUrl : `${API}${downloadUrl}`
      link.download = fileName
      link.target = "_blank"
      link.rel = "noopener"
      document.body.appendChild(link)
      link.click()
      link.remove()
      setMessage("Descarcarea installerului Gufo e-Factura a fost pornita.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut descarca installerul Gufo e-Factura.")
    }
  }

  async function generateAgentPairingCode() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setAgentPairingBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/agent-pairing-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.pairing?.code) {
        throw new Error(data?.error || "Nu am putut genera codul de pairing pentru Gufo e-Factura.")
      }
      setAgentPairing(data.pairing as AgentPairingCodeState)
      setMessage("Codul de pairing pentru Gufo e-Factura a fost generat.")
      setActiveModal("pairing")
    } catch (e: any) {
      setError(e?.message || "Nu am putut genera codul de pairing pentru Gufo e-Factura.")
    } finally {
      setAgentPairingBusy(false)
    }
  }

  async function copyPairingCode() {
    if (!agentPairing?.code) return
    try {
      await navigator.clipboard.writeText(agentPairing.code)
      setMessage("Codul de pairing a fost copiat.")
      setError("")
    } catch {
      setError("Nu am putut copia codul de pairing. Copiaza-l manual din fereastra deschisa.")
    }
  }

  async function saveSettings() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const currentRes = await fetch(`${API}/api/v1/company`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const currentData = await currentRes.json().catch(() => ({}))
      if (!currentRes.ok) {
        throw new Error(currentData?.error || "Nu am putut incarca firma pentru salvare.")
      }

      const company = currentData?.company || {}

      const res = await fetch(`${API}/api/v1/company`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.companyName || company.name || "Companie",
          cui: form.companyCui || company.cui || "",
          regNo: company.regNo || "",
          address: company.address || "",
          city: form.companyCity || company.city || "",
          county: form.companyCounty || company.county || "",
          country: form.companyCountry || company.country || "RO",
          postalCode: form.companyPostalCode || company.postalCode || "",
          bank: company.bank || "",
          iban: company.iban || "",
          email: company.email || "",
          contactEmail: form.contactEmail || company.contactEmail || "",
          efacturaSellerCountryCode: form.companyCountry || company.efacturaSellerCountryCode || company.country || "RO",
          efacturaSellerCity: form.companyCity || company.efacturaSellerCity || company.city || "",
          efacturaSellerCounty: form.companyCounty || company.efacturaSellerCounty || company.county || "",
          efacturaSellerPostalCode: form.companyPostalCode || company.efacturaSellerPostalCode || company.postalCode || "",
          efacturaContactEmail: form.contactEmail || company.efacturaContactEmail || company.contactEmail || "",
          phone: company.phone || "",
        isVatPayer: company.isVatPayer ?? true,
        posSyncInterval: company.posSyncInterval ?? 5,
        efacturaEnabled: form.efacturaEnabled,
        efacturaEnvironment: form.efacturaEnvironment,
      }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut salva setarile e-Factura.")
      }

      setMessage("Setarile e-Factura au fost salvate.")
      await loadSettings()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva setarile e-Factura.")
    } finally {
      setSaving(false)
    }
  }

  const currentCredential =
    findCredentialById(credentials, selectedCredentialId) ||
    credentials.find((item) => item.isDefault) ||
    credentials[0] ||
    null

  async function createCredential() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    const label = newCredentialLabel.trim()
    if (!label) {
      setError("Completeaza eticheta credențialei ANAF.")
      return
    }

    setCredentialBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut crea credențiala ANAF.")
      }
      setCredentials(Array.isArray(data?.credentials) ? data.credentials : [])
      setSelectedCredentialId(String(data?.activeCredentialId || data?.credential?.id || ""))
      setMessage("Credențiala ANAF a fost adaugata pentru firma curenta.")
      await loadSettings()
    } catch (e: any) {
      setError(e?.message || "Nu am putut crea credențiala ANAF.")
    } finally {
      setCredentialBusy(false)
    }
  }

  async function saveCredentialDetails() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }
    if (!currentCredential?.id) {
      setError("Alege mai intai o credențiala ANAF.")
      return
    }

    setCredentialBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/credentials/${encodeURIComponent(currentCredential.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: selectedCredentialLabel.trim() || currentCredential.label,
          certSerial: form.efacturaCertSerial.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut salva credențiala ANAF.")
      }
      setCredentials(Array.isArray(data?.credentials) ? data.credentials : [])
      setSelectedCredentialId(String(data?.activeCredentialId || currentCredential.id))
      setMessage("Datele credențialei ANAF au fost salvate.")
      await loadSettings()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva credențiala ANAF.")
    } finally {
      setCredentialBusy(false)
    }
  }

  async function makeCredentialDefault() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }
    if (!currentCredential?.id) {
      setError("Alege mai intai o credențiala ANAF.")
      return
    }

    setCredentialBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/credentials/${encodeURIComponent(currentCredential.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: selectedCredentialLabel.trim() || currentCredential.label,
          certSerial: form.efacturaCertSerial.trim(),
          isDefault: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut seta credențiala implicita.")
      }
      setCredentials(Array.isArray(data?.credentials) ? data.credentials : [])
      setSelectedCredentialId(String(data?.activeCredentialId || currentCredential.id))
      setMessage("Credențiala ANAF a fost setata ca implicita pentru firma curenta.")
      await loadSettings()
    } catch (e: any) {
      setError(e?.message || "Nu am putut seta credențiala implicita.")
    } finally {
      setCredentialBusy(false)
    }
  }

  function updateField<K extends keyof EFacturaForm>(key: K, value: EFacturaForm[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  async function startOauthConnect() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!form.efacturaPlatformConfigured) {
      setError("Aplicatia ANAF nu este configurata inca. Contacteaza suportul pentru activare.")
      return
    }

    setConnecting(true)
    setError("")
    setMessage("")
    try {
      const returnTo = `${window.location.origin}/setari/efactura`
      const search = new URLSearchParams({
        returnTo,
      })
      if (form.companyId) {
        search.set("companyId", form.companyId)
      }
      
      const res = await fetch(`${API}/api/v1/company/efactura/oauth/start?${search.toString()}`, {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.url) {
        throw new Error(normalizeAnafMessage(data?.error || "Nu am putut porni conectarea ANAF."))
      }
      window.location.href = data.url
    } catch (e: any) {
      setError(normalizeAnafMessage(e?.message || "Nu am putut porni conectarea ANAF."))
      setConnecting(false)
    }
  }

  async function testOauthConnection() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setTesting(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/efactura/oauth/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(normalizeAnafMessage(data?.error || "Testul conexiunii ANAF a esuat."))
      }
      setMessage(data?.message || "Conexiunea ANAF a raspuns corect.")
      await loadSettings()
    } catch (e: any) {
      setError(normalizeAnafMessage(e?.message || "Testul conexiunii ANAF a esuat."))
      await loadSettings()
    } finally {
      setTesting(false)
    }
  }

  async function loadDiagnostics() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setLoadingDiagnostics(true)
    setError("")
    try {
      const diagnosticsUrl = `${API}/api/v1/company/efactura/diagnostics`
      const res = await fetch(diagnosticsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca diagnosticul ANAF.")
      }
      setDiagnostics(data?.diagnostics || null)
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca diagnosticul ANAF.")
    } finally {
      setLoadingDiagnostics(false)
    }
  }

  async function uploadCertificate() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }
    if (!certFile) {
      setError("Selecteaza certificatul .p12/.pfx.")
      return
    }
    if (!certPassword.trim()) {
      setError("Completeaza parola certificatului.")
      return
    }

    setCertBusy(true)
    setError("")
    setMessage("")

    try {
      const body = new FormData()
      body.append("certificate", certFile)
      body.append("efacturaCertPassword", certPassword.trim())
      
      if (form.efacturaCertSerial.trim()) {
        body.append("efacturaCertSerial", form.efacturaCertSerial.trim())
      }

      const res = await fetch(`${API}/api/v1/company/efactura/certificate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut incarca certificatul SPV.")
      }

      setCertFile(null)
      setCertPassword("")
      setMessage("Certificatul SPV a fost incarcat pe server.")
      await loadSettings()
      await loadDiagnostics()
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca certificatul SPV.")
    } finally {
      setCertBusy(false)
    }
  }

  async function removeCertificate() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setCertBusy(true)
    setError("")
    setMessage("")

    try {
      const deleteUrl = `${API}/api/v1/company/efactura/certificate`
      const res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Nu am putut sterge certificatul SPV.")
      }

      setCertFile(null)
      setCertPassword("")
      setMessage("Certificatul SPV a fost sters de pe server.")
      await loadSettings()
      await loadDiagnostics()
    } catch (e: any) {
      setError(e?.message || "Nu am putut sterge certificatul SPV.")
    } finally {
      setCertBusy(false)
    }
  }

  const localCertificate = localAgentStatus?.certificate || null
  const localCertificateExpiryText = localCertificate?.notAfter
    ? formatDisplayDate(localCertificate.notAfter)
    : "-"
  const localCertificateWarning =
    localCertificate?.expired
      ? "Certificatul local este expirat."
      : localCertificate?.expiringSoon && typeof localCertificate?.expiresInDays === "number"
        ? `Certificatul local expira in ${localCertificate.expiresInDays} zile.`
        : ""
  const localCertificateStatusText =
    localCertificate?.expired
      ? "Expirat"
      : localCertificate?.expiringSoon && typeof localCertificate?.expiresInDays === "number"
        ? `In ${localCertificate.expiresInDays} zile`
        : localCertificate?.detected
          ? "Valid"
          : "Nedetectat"
  const localAgentConnected = Boolean(localAgentStatus?.ok)
  const localAgentSerialMatches =
    Boolean(localCertificate?.configuredSerial) &&
    Boolean(form.efacturaCertSerial.trim()) &&
    String(localCertificate?.configuredSerial || "").trim().toUpperCase() === form.efacturaCertSerial.trim().toUpperCase()
  const agentInstallerUpdatedAt = agentDownloadInfo?.updatedAt
    ? new Date(agentDownloadInfo.updatedAt).toLocaleString("ro-RO")
    : "-"

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Setari e-Factura"
        subtitle="Pastrezi aici ce conteaza pentru lucru direct din ERP: activare, mediul ANAF si tokenul OAuth ANAF."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Flux e-Factura" value={form.efacturaEnabled ? "Activat" : "Oprit"} tone="amber" />
        <DocumentMetric title="Mediu" value={form.efacturaEnvironment === "prod" ? "Productie" : "Test"} tone="blue" />
        <DocumentMetric title="Token ANAF" value={oauthStatus.connected ? "Activ" : "Neactiv"} tone={oauthStatus.connected ? "emerald" : "slate"} />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {oauthStatus.lastError && !oauthStatus.connected ? <InlineNotice tone="error">{oauthStatus.lastError}</InlineNotice> : null}
      {!form.efacturaPlatformConfigured ? (
        <InlineNotice>
          Aplicatia ANAF se configureaza centralizat in <strong>Control Panel</strong>. Dupa ce este setata acolo, aici ramane doar configurarea firmei si generarea tokenului.
        </InlineNotice>
      ) : null}
      {isDebugMode && localCertificateWarning ? <InlineNotice tone="error">{localCertificateWarning}</InlineNotice> : null}
      {isDebugMode && localAgentConnected && localCertificate?.detected && !localCertificateWarning ? (
        <InlineNotice tone="success">Agentul local este conectat si certificatul este pregatit pentru SPV.</InlineNotice>
      ) : null}

      <DocumentSection
        title="Conectare pe firma curenta"
        description="Tokenul ANAF este folosit separat pe fiecare firma. Cand schimbi firma, generezi sau regenerezi token doar pentru firma activa."
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <div>
              Firma activa: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
            </div>
            <div className="mt-2">
              Profil OAuth: <span className="font-semibold text-slate-900">{`${form.companyName || "Firma"} - SPV principal`}</span>
            </div>
            <div className="mt-2">
              Regula de lucru: <span className="font-semibold text-slate-900">OAuth ANAF in browser, cu semnatura electronica activa pe calculatorul curent</span>
            </div>
            <div className="mt-2">
              Daca folosesti alta semnatura pentru aceeasi firma, apesi din nou <span className="font-semibold text-slate-900">Genereaza token</span> si tokenul firmei se actualizeaza.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Firma activa: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              CUI: <span className="font-semibold text-slate-900">{form.companyCui || "-"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Token ANAF: <span className="font-semibold text-slate-900">{oauthStatus.connected ? "Conectat" : "Neconectat"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Generat la: <span className="font-semibold text-slate-900">{oauthStatus.connectedAt ? new Date(oauthStatus.connectedAt).toLocaleString("ro-RO") : "-"}</span>
            </div>
          </div>
        </div>
      </DocumentSection>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DocumentSection
          title="Flux firma"
          actions={
            <button type="button" onClick={() => setActiveModal("flow")} className={documentButtonPrimaryClass}>
              Configureaza
            </button>
          }
        >
          <div className="space-y-2 text-sm text-slate-600">
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Activ: <span className="font-semibold text-slate-900">{form.efacturaEnabled ? "Da" : "Nu"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Mediu: <span className="font-semibold text-slate-900">{form.efacturaEnvironment === "prod" ? "Productie" : "Test"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Firma: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
            </div>
          </div>
        </DocumentSection>

        <DocumentSection
          title="Conectare ANAF"
          actions={
            <div className="flex gap-2">
              <button type="button" onClick={testOauthConnection} className={documentButtonSecondaryClass} disabled={testing || loading || !oauthStatus.connected}>
                {testing ? "Testare..." : "Testeaza"}
              </button>
              <button type="button" onClick={startOauthConnect} className={documentButtonPrimaryClass} disabled={connecting || loading}>
                {connecting ? "Se deschide..." : "Genereaza token"}
              </button>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-slate-600">
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Status: <span className="font-semibold text-slate-900">{oauthStatus.connected ? "Conectat" : "Neconectat"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Generat la: <span className="font-semibold text-slate-900">{oauthStatus.connectedAt ? new Date(oauthStatus.connectedAt).toLocaleString("ro-RO") : "-"}</span>
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
              Expira: <span className="font-semibold text-slate-900">{oauthStatus.expiresAt ? new Date(oauthStatus.expiresAt).toLocaleString("ro-RO") : "-"}</span>
            </div>
          </div>
        </DocumentSection>

        {isDebugMode ? (
          <DocumentSection
            title="Gufo e-Factura local"
            description="Sectiune tehnica pentru diagnostic si configurare locala."
            actions={
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={downloadAgentInstaller}
                  className={documentButtonSecondaryClass}
                  disabled={!agentDownloadInfo?.available}
                >
                  Descarca agent
                </button>
                <button type="button" onClick={generateAgentPairingCode} className={documentButtonSecondaryClass} disabled={agentPairingBusy}>
                  {agentPairingBusy ? "Generez..." : "Genereaza cod"}
                </button>
                {agentPairing?.code ? (
                  <button type="button" onClick={copyPairingCode} className={documentButtonSecondaryClass}>
                    Copiaza cod
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void loadLocalAgentStatus()}
                  className={documentButtonSecondaryClass}
                  disabled={localAgentLoading}
                >
                  {localAgentLoading ? "Detectare..." : "Actualizeaza"}
                </button>
                <button type="button" onClick={() => setActiveModal("agent")} className={documentButtonPrimaryClass}>
                  Detalii agent
                </button>
              </div>
            }
          >
            <div className="space-y-2 text-sm text-slate-600">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                Agent: <span className="font-semibold text-slate-900">{localAgentConnected ? "Conectat" : "Neconectat"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                Pairing: <span className="font-semibold text-slate-900">{agentPairing?.code ? "Cod generat" : "Genereaza cod"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                Certificat: <span className="font-semibold text-slate-900">{localCertificate?.configuredSerial || "-"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                Expira: <span className="font-semibold text-slate-900">{localCertificateExpiryText}</span>
              </div>
            </div>
            {agentDownloadLoading ? <div className="mt-2 text-xs text-slate-500">Verific installerul Gufo e-Factura...</div> : null}
            {agentDownloadInfo?.available ? (
              <div className="mt-2 text-xs text-slate-500">
                Installer disponibil{agentDownloadInfo?.updatedAt ? `, actualizat la ${agentInstallerUpdatedAt}` : ""}.
              </div>
            ) : agentDownloadInfo?.error ? (
              <div className="mt-2 text-xs text-amber-700">{agentDownloadInfo.error}</div>
            ) : null}
            {agentPairing?.code ? (
              <div className="mt-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <div>
                  Cod pairing pregatit pentru <span className="font-semibold text-slate-900">{agentPairing.companyName || form.companyName || "firma curenta"}</span>.
                </div>
                <div className="mt-1">
                  Expira: <span className="font-semibold text-slate-900">{agentPairing.expiresAt ? new Date(agentPairing.expiresAt).toLocaleString("ro-RO") : "-"}</span>
                </div>
                <div className="mt-1">
                  In agent clientul lipeste codul si verifica serialul certificatului.
                </div>
              </div>
            ) : null}
          </DocumentSection>
        ) : null}
      </div>

      {isDebugMode ? (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setActiveModal("debug")} className={documentButtonSecondaryClass}>
              Detalii tehnice
            </button>
          </div>
          <DocumentSection title="Ordinea corecta" description="Flux simplu, clar, fara pasi tehnici inutili in fata utilizatorului.">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
                1. Verifici firma si mediul ANAF.
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
                2. Generezi tokenul ANAF.
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
                3. Trimiti, verifici starea si sincronizezi SPV direct din web.
              </div>
            </div>
          </DocumentSection>
        </>
      ) : null}

      {activeModal === "flow" ? (
        <SettingsModal title="Configurare flux e-Factura" onClose={() => setActiveModal(null)}>
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Se incarca setarile e-Factura...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <DocumentField label="Activare flux e-Factura">
                  <label className="flex min-h-10 items-center gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">
                    <input type="checkbox" checked={form.efacturaEnabled} onChange={(e) => updateField("efacturaEnabled", e.target.checked)} />
                    <span>Firma foloseste e-Factura</span>
                  </label>
                </DocumentField>

                <DocumentField label="Mediu ANAF">
                  <select value={form.efacturaEnvironment} onChange={(e) => updateField("efacturaEnvironment", e.target.value)} className={documentInputClass}>
                    <option value="test">Test</option>
                    <option value="prod">Productie</option>
                  </select>
                </DocumentField>
              </div>

              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                <div>
                  Firma: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
                </div>
                <div className="mt-1">
                  CUI: <span className="font-semibold text-slate-900">{form.companyCui || "-"}</span>
                </div>
                <div className="mt-1">
                  Emitent: <span className="font-semibold text-slate-900">{[form.companyCity, form.companyCounty].filter(Boolean).join(", ") || "-"}</span>
                </div>
                <div className="mt-1">
                  Conectare SPV: <span className="font-semibold text-slate-900">prin OAuth ANAF, fara agent local in fluxul normal</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setActiveModal(null)} className={documentButtonSecondaryClass}>
                  Anuleaza
                </button>
                <button type="button" onClick={saveSettings} className={documentButtonPrimaryClass} disabled={saving}>
                  {saving ? "Se salveaza..." : "Salveaza"}
                </button>
              </div>
            </div>
          )}
        </SettingsModal>
      ) : null}

      {activeModal === "agent" ? (
        <SettingsModal title="Detalii Gufo e-Factura local" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <DocumentMetric title="ERP in agent" value={localAgentStatus?.agent?.erpUrl || "-"} tone="blue" />
              <DocumentMetric title="Certificat local" value={localCertificate?.configuredSerial || "-"} tone="slate" />
              <DocumentMetric title="Status certificat" value={localCertificateStatusText} tone={localCertificate?.expired ? "amber" : localCertificate?.expiringSoon ? "amber" : localCertificate?.detected ? "emerald" : "slate"} />
            </div>

            {localAgentError ? <InlineNotice tone="error">{localAgentError}</InlineNotice> : null}
            {localCertificate?.error && !localCertificate?.detected ? <InlineNotice tone="error">{localCertificate.error}</InlineNotice> : null}
            {localAgentConnected && localAgentSerialMatches ? <InlineNotice tone="success">Serialul certificatului din agent este aliniat cu serialul salvat in ERP.</InlineNotice> : null}
            {localAgentConnected && localCertificate?.configuredSerial && form.efacturaCertSerial.trim() && !localAgentSerialMatches ? (
              <InlineNotice>Serialul din agentul local este diferit de serialul salvat in ERP. Daca acesta este certificatul bun, copiaza-l si salveaza-l si in setarile firmei.</InlineNotice>
            ) : null}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                URL local: <span className="font-semibold text-slate-900">{localAgentStatus?.agent?.bridgeUrl || localAgentUrl}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Expira la: <span className="font-semibold text-slate-900">{localCertificateExpiryText}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Store certificat: <span className="font-semibold text-slate-900">{localCertificate?.store || "-"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Cheie privata: <span className="font-semibold text-slate-900">{localCertificate?.hasPrivateKey ? "Da" : "Nu"}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <DocumentField label="URL agent local">
                <input
                  value={localAgentUrl}
                  onChange={(e) => setLocalAgentUrl(e.target.value)}
                  className={documentInputClass}
                  placeholder={DEFAULT_LOCAL_AGENT_URL}
                />
              </DocumentField>
              <DocumentField label="Serial detectat din agent">
                <input value={localCertificate?.configuredSerial || ""} readOnly className={documentInputClass} placeholder="Se completeaza dupa detectare" />
              </DocumentField>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => void loadLocalAgentStatus()} className={documentButtonSecondaryClass} disabled={localAgentLoading}>
                {localAgentLoading ? "Detectare..." : "Actualizeaza statusul"}
              </button>
              <button type="button" onClick={() => window.open(localAgentUrl, "_blank", "noopener,noreferrer")} className={documentButtonPrimaryClass}>
                Deschide aplicatia locala
              </button>
            </div>
          </div>
        </SettingsModal>
      ) : null}

      {activeModal === "pairing" && agentPairing?.code ? (
        <SettingsModal title="Cod pairing Gufo e-Factura" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <InlineNotice tone="success">
              Trimite clientului doar acest cod si spune-i sa-l lipeasca in aplicatia Gufo e-Factura.
            </InlineNotice>

            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cod pairing</div>
              <div className="mt-2 break-all rounded-[14px] bg-white px-3 py-3 font-mono text-sm font-semibold text-slate-900">
                {agentPairing.code}
              </div>
              <div className="mt-3 text-sm text-slate-600">
                Valabil pentru <span className="font-semibold text-slate-900">{agentPairing.companyName || form.companyName || "-"}</span>
                {agentPairing.expiresAt ? `, pana la ${new Date(agentPairing.expiresAt).toLocaleString("ro-RO")}` : ""}.
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={copyPairingCode} className={documentButtonSecondaryClass}>
                Copiaza codul
              </button>
              <button type="button" onClick={() => setActiveModal(null)} className={documentButtonPrimaryClass}>
                Gata
              </button>
            </div>
          </div>
        </SettingsModal>
      ) : null}

      {activeModal === "debug" && isDebugMode ? (
          <SettingsModal title="Detalii tehnice e-Factura" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <button type="button" onClick={loadDiagnostics} className={documentButtonSecondaryClass} disabled={loadingDiagnostics || loading}>
                {loadingDiagnostics ? "Diagnoza..." : "Vezi diagnoza"}
              </button>
              <button type="button" onClick={uploadCertificate} className={documentButtonPrimaryClass} disabled={certBusy || loading}>
                {certBusy ? "Se incarca..." : "Incarca certificat"}
              </button>
              {certState.hasFile ? (
                <button type="button" onClick={removeCertificate} className={documentButtonSecondaryClass} disabled={certBusy || loading}>
                  Sterge certificat
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DocumentField label="Serial certificat">
                <input
                  value={form.efacturaCertSerial}
                  onChange={(e) => updateField("efacturaCertSerial", e.target.value)}
                  className={documentInputClass}
                  placeholder="Ex: 201104209404..."
                />
              </DocumentField>
              <DocumentField label="Fisier certificat (.p12 / .pfx)">
                <input
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                  className={documentInputClass}
                />
              </DocumentField>
              <DocumentField label="Parola certificat">
                <input
                  type="password"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                  className={documentInputClass}
                  placeholder={certState.passwordConfigured ? "Parola este deja salvata pe server" : "Introdu parola certificatului"}
                />
              </DocumentField>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Status certificat: <span className="font-semibold text-slate-900">{certState.hasFile ? "Incarcat" : "Lipsa"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Fisier: <span className="font-semibold text-slate-900">{certState.filename || "-"}</span>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Incarcat la: <span className="font-semibold text-slate-900">{certState.uploadedAt ? new Date(certState.uploadedAt).toLocaleString("ro-RO") : "-"}</span>
              </div>
            </div>

            {diagnostics ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Certificat client folosit: <span className="font-semibold text-slate-900">{diagnostics.usingClientCertificate ? "Da" : "Nu"}</span>
                </div>
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Certificat incarcat: <span className="font-semibold text-slate-900">{diagnostics.hasCertificateFile ? "Da" : "Nu"}</span>
                </div>
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Serial in token: <span className="font-semibold text-slate-900">{diagnostics.tokenSerial || "-"}</span>
                </div>
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Serial configurat: <span className="font-semibold text-slate-900">{diagnostics.certSerialConfigured || "-"}</span>
                </div>
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Seriale aliniate: <span className="font-semibold text-slate-900">{diagnostics.serialsMatch ? "Da" : "Nu"}</span>
                </div>
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Roluri token: <span className="font-semibold text-slate-900">{diagnostics.tokenRoles.length ? diagnostics.tokenRoles.join(", ") : "-"}</span>
                </div>
              </div>
            ) : null}
          </div>
        </SettingsModal>
      ) : null}
    </div>
  )
}

