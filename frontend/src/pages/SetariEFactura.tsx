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

const DEFAULT_LOCAL_AGENT_URL = "http://127.0.0.1:48521"

const emptyForm: EFacturaForm = {
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

function normalizeAnafMessage(message: string) {
  const text = String(message || "")
  if (text.includes("Platforma nu are configurata")) {
    return "Aplicatia ANAF nu este configurata inca in Control Panel. Completeaza configurarea globala si apoi revino aici."
  }
  if (text.includes("Conecteaza mai intai aplicatia")) {
    return "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul cu certificatul digital."
  }
  return text
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
  const [localAgentUrl, setLocalAgentUrl] = useState(DEFAULT_LOCAL_AGENT_URL)
  const [localAgentLoading, setLocalAgentLoading] = useState(false)
  const [localAgentError, setLocalAgentError] = useState("")
  const [localAgentStatus, setLocalAgentStatus] = useState<LocalAgentStatus | null>(null)
  const isDebugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugSpv") === "1"

  useEffect(() => {
    loadSettings()
    void loadLocalAgentStatus()

    const params = new URLSearchParams(window.location.search)
    const oauth = params.get("oauth")

    if (oauth === "success") setMessage("Conectarea ANAF a fost realizata.")
    if (oauth === "error") setError("Conectarea ANAF nu a putut fi finalizata.")
    if (oauth === "denied") setError("Autorizarea ANAF a fost anulata sau refuzata.")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSettings() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

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

      setForm({
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
        efacturaCertSerial: data?.company?.efacturaCertSerial || "",
      })
      setCertState({
        hasFile: Boolean(data?.company?.efacturaCertHasFile),
        filename: data?.company?.efacturaCertFilename || "",
        uploadedAt: data?.company?.efacturaCertUploadedAt || "",
        passwordConfigured: Boolean(data?.company?.efacturaCertPasswordConfigured),
      })

      const connected = Boolean(data?.company?.efacturaOauthAccessToken)

      setOauthStatus({
        connected,
        connectedAt: data?.company?.efacturaOauthConnectedAt || "",
        expiresAt: data?.company?.efacturaOauthAccessTokenExpiresAt || "",
        lastError: data?.company?.efacturaOauthLastError || "",
      })

      if (connected) {
        setError("")

        const params = new URLSearchParams(window.location.search)
        const oauth = params.get("oauth")

        if (oauth === "denied" || oauth === "error") {
          params.delete("oauth")
          const qs = params.toString()
          const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`
          window.history.replaceState({}, "", nextUrl)
        }
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
          name: company.name || "Companie",
          cui: company.cui || "",
          regNo: company.regNo || "",
          address: company.address || "",
          city: company.city || "",
          county: company.county || "",
          country: company.country || "RO",
          postalCode: company.postalCode || "",
          bank: company.bank || "",
          iban: company.iban || "",
          email: company.email || "",
          contactEmail: company.contactEmail || "",
          phone: company.phone || "",
          isVatPayer: company.isVatPayer ?? true,
          posSyncInterval: company.posSyncInterval ?? 5,
          efacturaEnabled: form.efacturaEnabled,
          efacturaEnvironment: form.efacturaEnvironment,
          efacturaCertSerial: form.efacturaCertSerial,
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
      setError("Aplicatia ANAF nu este configurata inca la nivel de platforma. Un administrator trebuie sa o seteze in Control Panel.")
      return
    }

    setConnecting(true)
    setError("")
    setMessage("")
    try {
      const returnTo = `${window.location.origin}/setari/efactura`
      const res = await fetch(`${API}/api/v1/company/efactura/oauth/start?returnTo=${encodeURIComponent(returnTo)}`, {
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
          Authorization: `Bearer ${token}`,
        },
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
      const res = await fetch(`${API}/api/v1/company/efactura/diagnostics`, {
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
      const res = await fetch(`${API}/api/v1/company/efactura/certificate`, {
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
    ? new Date(localCertificate.notAfter).toLocaleString("ro-RO")
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

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Setari e-Factura"
        subtitle="Pastrezi aici doar ce conteaza: activare, conectarea ANAF si starea aplicatiei locale Gufo e-Factura."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Flux e-Factura" value={form.efacturaEnabled ? "Activat" : "Oprit"} tone="amber" />
        <DocumentMetric title="Mediu" value={form.efacturaEnvironment === "prod" ? "Productie" : "Test"} tone="blue" />
        <DocumentMetric title="Token ANAF" value={oauthStatus.connected ? "Activ" : "Neactiv"} tone={oauthStatus.connected ? "emerald" : "slate"} />
        <DocumentMetric title="Agent local" value={localAgentConnected ? "Conectat" : "Neconectat"} tone={localAgentConnected ? "emerald" : "slate"} />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {oauthStatus.lastError && !oauthStatus.connected ? <InlineNotice tone="error">{oauthStatus.lastError}</InlineNotice> : null}
      {!form.efacturaPlatformConfigured ? (
        <InlineNotice>
          Aplicatia ANAF se configureaza centralizat in <strong>Control Panel</strong>. Dupa ce este setata acolo, aici ramane doar configurarea firmei si generarea tokenului.
        </InlineNotice>
      ) : null}
      {localCertificateWarning ? <InlineNotice tone="error">{localCertificateWarning}</InlineNotice> : null}
      {localAgentConnected && localCertificate?.detected && !localCertificateWarning ? (
        <InlineNotice tone="success">Agentul local este conectat si certificatul este pregatit pentru SPV.</InlineNotice>
      ) : null}

      <DocumentSection
        title="1. Activare si mediu ANAF"
        description="Pornesti fluxul pentru firma curenta si alegi mediul in care lucrezi."
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={loadSettings} className={documentButtonSecondaryClass} disabled={loading || saving}>
              Reincarca
            </button>
            <button type="button" onClick={saveSettings} className={documentButtonPrimaryClass} disabled={loading || saving}>
              {saving ? "Se salveaza..." : "Salveaza"}
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se incarca setarile e-Factura...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr]">
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

            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 md:col-span-2">
              <div>
                Firma: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
              </div>
              <div className="mt-1">
                CUI: <span className="font-semibold text-slate-900">{form.companyCui || "-"}</span>
              </div>
              <div className="mt-1">
                Emitent: <span className="font-semibold text-slate-900">{[form.companyCity, form.companyCounty].filter(Boolean).join(", ") || "-"}</span>
              </div>
            </div>
          </div>
        )}
      </DocumentSection>

      <DocumentSection
        title="2. Conectare ANAF"
        description="Generezi tokenul ANAF pentru firma si verifici rapid daca legatura este activa."
        actions={
          <div className="flex gap-2">
            {isDebugMode ? (
              <button type="button" onClick={loadDiagnostics} className={documentButtonSecondaryClass} disabled={loadingDiagnostics || loading}>
                {loadingDiagnostics ? "Diagnoza..." : "Vezi diagnoza"}
              </button>
            ) : null}
            <button type="button" onClick={testOauthConnection} className={documentButtonSecondaryClass} disabled={testing || loading || !oauthStatus.connected}>
              {testing ? "Testare..." : "Testeaza conexiunea"}
            </button>
            <button type="button" onClick={startOauthConnect} className={documentButtonPrimaryClass} disabled={connecting || loading}>
              {connecting ? "Redirectionare..." : "Genereaza token ANAF"}
            </button>
          </div>
        }
      >
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Status token: <span className="font-semibold text-slate-900">{oauthStatus.connected ? "Activ" : "Neactiv"}</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Generat la: <span className="font-semibold text-slate-900">{oauthStatus.connectedAt ? new Date(oauthStatus.connectedAt).toLocaleString("ro-RO") : "-"}</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Expira token: <span className="font-semibold text-slate-900">{oauthStatus.expiresAt ? new Date(oauthStatus.expiresAt).toLocaleString("ro-RO") : "-"}</span>
          </div>
        </div>

        {isDebugMode && diagnostics ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
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
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Expira token: <span className="font-semibold text-slate-900">{diagnostics.tokenExp ? new Date(diagnostics.tokenExp).toLocaleString("ro-RO") : "-"}</span>
            </div>
          </div>
        ) : null}
      </DocumentSection>

      <DocumentSection
        title="3. Gufo e-Factura local"
        description="Aici vezi daca aplicatia Windows este conectata si daca certificatul local este pregatit pentru SPV."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadLocalAgentStatus()}
              className={documentButtonSecondaryClass}
              disabled={localAgentLoading}
            >
              {localAgentLoading ? "Detectare..." : "Detecteaza agentul"}
            </button>
            <button
              type="button"
              onClick={() => window.open(localAgentUrl, "_blank", "noopener,noreferrer")}
              className={documentButtonPrimaryClass}
            >
              Deschide aplicatia locala
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <DocumentMetric title="ERP in agent" value={localAgentStatus?.agent?.erpUrl || "-"} tone="blue" />
          <DocumentMetric title="Certificat local" value={localCertificate?.configuredSerial || "-"} tone="slate" />
          <DocumentMetric title="Status certificat" value={localCertificateStatusText} tone={localCertificate?.expired ? "amber" : localCertificate?.expiringSoon ? "amber" : localCertificate?.detected ? "emerald" : "slate"} />
        </div>

        {localAgentError ? <div className="mt-3"><InlineNotice tone="error">{localAgentError}</InlineNotice></div> : null}
        {localCertificate?.error && !localCertificate?.detected ? (
          <div className="mt-3">
            <InlineNotice tone="error">{localCertificate.error}</InlineNotice>
          </div>
        ) : null}
        {localAgentConnected && localAgentSerialMatches ? (
          <div className="mt-3">
            <InlineNotice tone="success">Serialul certificatului din agent este aliniat cu serialul salvat in ERP.</InlineNotice>
          </div>
        ) : null}
        {localAgentConnected && localCertificate?.configuredSerial && form.efacturaCertSerial.trim() && !localAgentSerialMatches ? (
          <div className="mt-3">
            <InlineNotice>
              Serialul din agentul local este diferit de serialul salvat in ERP. Daca acesta este certificatul bun, copiaza-l si salveaza-l si in setarile firmei.
            </InlineNotice>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
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

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <DocumentField label="URL agent local">
            <input
              value={localAgentUrl}
              onChange={(e) => setLocalAgentUrl(e.target.value)}
              className={documentInputClass}
              placeholder={DEFAULT_LOCAL_AGENT_URL}
            />
          </DocumentField>
          <DocumentField label="Serial detectat din agent">
            <input
              value={localCertificate?.configuredSerial || ""}
              readOnly
              className={documentInputClass}
              placeholder="Se completeaza dupa detectare"
            />
          </DocumentField>
        </div>

        <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
          Instalarea clientului trebuie sa ramana simpla: rulezi <strong>Gufo e-Factura</strong>, completezi URL-ul ERP si certificatul local, apoi ERP-ul doar vede starea agentului si a certificatului.
        </div>
      </DocumentSection>

      {isDebugMode ? (
        <>
          <DocumentSection
            title="Debug certificat server"
            description="Sectiune tehnica. O folosesti doar daca vrei certificat client TLS pe server."
            actions={
              <div className="flex gap-2">
                <button type="button" onClick={uploadCertificate} className={documentButtonPrimaryClass} disabled={certBusy || loading}>
                  {certBusy ? "Se incarca..." : "Incarca certificat"}
                </button>
                {certState.hasFile ? (
                  <button type="button" onClick={removeCertificate} className={documentButtonSecondaryClass} disabled={certBusy || loading}>
                    Sterge certificat
                  </button>
                ) : null}
              </div>
            }
          >
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

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
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
          </DocumentSection>

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
    </div>
  )
}
