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

type CertificateStatus = {
  hasFile: boolean
  filename: string
  uploadedAt: string
  passwordConfigured: boolean
}

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
  const [certBusy, setCertBusy] = useState(false)
  const [certPassword, setCertPassword] = useState("")
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certStatus, setCertStatus] = useState<CertificateStatus>({
    hasFile: false,
    filename: "",
    uploadedAt: "",
    passwordConfigured: false,
  })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [oauthStatus, setOauthStatus] = useState({
    connected: false,
    connectedAt: "",
    expiresAt: "",
    lastError: "",
  })

  useEffect(() => {
    loadSettings()

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

      setCertStatus({
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
        throw new Error(data?.error || "Nu am putut incarca certificatul e-Factura.")
      }

      setCertFile(null)
      setCertPassword("")
      await loadSettings()
      setMessage("Certificatul SPV a fost incarcat pe server.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca certificatul e-Factura.")
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
        throw new Error(data?.error || "Nu am putut sterge certificatul e-Factura.")
      }

      setCertFile(null)
      setCertPassword("")
      await loadSettings()
      setMessage("Certificatul SPV a fost sters de pe server.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut sterge certificatul e-Factura.")
    } finally {
      setCertBusy(false)
    }
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

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Setari e-Factura"
        subtitle="Aici ai tot fluxul intr-un singur loc: activare, certificat SPV pe server, token ANAF si verificarea configurarii firmei."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Flux e-Factura" value={form.efacturaEnabled ? "Activat" : "Oprit"} tone="amber" />
        <DocumentMetric title="Mediu" value={form.efacturaEnvironment === "prod" ? "Productie" : "Test"} tone="blue" />
        <DocumentMetric title="Certificat SPV" value={certStatus.hasFile ? "Incarcat" : "Lipsa"} tone={certStatus.hasFile ? "emerald" : "slate"} />
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

      <DocumentSection title="Rezumat firma emitenta">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Firma: <span className="font-semibold text-slate-900">{form.companyName || "-"}</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            CUI: <span className="font-semibold text-slate-900">{form.companyCui || "-"}</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Emitent: <span className="font-semibold text-slate-900">{[form.companyCity, form.companyCounty].filter(Boolean).join(", ") || "-"}</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Email e-Factura: <span className="font-semibold text-slate-900">{form.contactEmail || "-"}</span>
          </div>
        </div>
      </DocumentSection>

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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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

            <DocumentField label="Serial certificat">
              <input
                value={form.efacturaCertSerial}
                onChange={(e) => updateField("efacturaCertSerial", e.target.value)}
                className={documentInputClass}
                placeholder="Ex: 201104209404..."
              />
            </DocumentField>
          </div>
        )}
      </DocumentSection>

      <DocumentSection
        title="2. Certificat SPV pe server"
        description="Incarci certificatul .p12/.pfx si parola lui. Serverul Gufo le foloseste la sincronizarea SPV si la apelurile ANAF."
        actions={
          <div className="flex gap-2">
            {certStatus.hasFile ? (
              <button type="button" onClick={removeCertificate} className={documentButtonSecondaryClass} disabled={certBusy}>
                {certBusy ? "Se sterge..." : "Sterge certificat"}
              </button>
            ) : null}
            <button type="button" onClick={uploadCertificate} className={documentButtonPrimaryClass} disabled={certBusy || loading}>
              {certBusy ? "Se incarca..." : "Incarca certificat"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              placeholder={certStatus.passwordConfigured ? "Parola este deja salvata pe server" : "Introdu parola certificatului"}
            />
          </DocumentField>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            <div>Status certificat: <span className="font-semibold text-slate-900">{certStatus.hasFile ? "Incarcat" : "Lipsa"}</span></div>
            <div className="mt-2">Fisier: <span className="font-semibold text-slate-900">{certStatus.filename || "-"}</span></div>
            <div className="mt-2">Incarcat la: <span className="font-semibold text-slate-900">{certStatus.uploadedAt ? new Date(certStatus.uploadedAt).toLocaleString("ro-RO") : "-"}</span></div>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection
        title="3. Autorizare ANAF"
        description="Dupa ce certificatul este pregatit pe server, generezi tokenul ANAF pentru firma si verifici conexiunea."
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={testOauthConnection} className={documentButtonSecondaryClass} disabled={testing || loading || !oauthStatus.connected}>
              {testing ? "Testare..." : "Testeaza conexiunea"}
            </button>
            <button type="button" onClick={startOauthConnect} className={documentButtonPrimaryClass} disabled={connecting || loading}>
              {connecting ? "Redirectionare..." : "Genereaza token ANAF"}
            </button>
          </div>
        }
      >
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
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

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Configurare platforma: <span className="font-semibold text-slate-900">{form.efacturaPlatformConfigured ? "Pregatita" : "Lipsa"}</span>
          </div>
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Sursa configurare: <span className="font-semibold text-slate-900">{form.efacturaUsesPlatformConfig ? "Control Panel" : "Configurare locala"}</span>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Ordinea corecta" description="Flux simplu, clar, fara sa te mai plimbi intre pagini.">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            1. Verifici firma, emitentul si serialul certificatului.
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            2. Incarci certificatul .p12/.pfx si parola lui pe server.
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            3. Generezi tokenul ANAF.
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            4. Trimiti, verifici starea si sincronizezi SPV.
          </div>
        </div>
      </DocumentSection>
    </div>
  )
}
