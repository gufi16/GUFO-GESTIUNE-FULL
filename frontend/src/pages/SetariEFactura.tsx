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
}

const emptyForm: EFacturaForm = {
  efacturaEnabled: false,
  efacturaEnvironment: "test",
  efacturaPlatformConfigured: false,
  efacturaUsesPlatformConfig: false,
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
          bank: company.bank || "",
          iban: company.iban || "",
          email: company.email || "",
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

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Setari e-Factura"
        subtitle="Aici activezi modulul si generezi tokenul ANAF pentru firma care este inregistrata in SPV si transmite e-Factura cu certificatul digital."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Flux e-Factura" value={form.efacturaEnabled ? "Activat" : "Oprit"} tone="amber" />
        <DocumentMetric title="Mediu" value={form.efacturaEnvironment === "prod" ? "Productie" : "Test"} tone="blue" />
        <DocumentMetric title="Token ANAF" value={oauthStatus.connected ? "Activ" : "Neactiv"} tone="emerald" />
        <DocumentMetric title="Conectare ANAF" value={oauthStatus.connected ? "Autorizata" : "Neconectata"} tone="slate" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {oauthStatus.lastError ? <InlineNotice tone="error">{oauthStatus.lastError}</InlineNotice> : null}
      <InlineNotice>
        Datele firmei emitente se completeaza in pagina <strong>Firma</strong>. Aici ramai doar cu activarea si autorizarea ANAF pentru firma din SPV.
      </InlineNotice>
      {!form.efacturaPlatformConfigured ? (
        <InlineNotice>
          Aplicatia ANAF se configureaza centralizat in <strong>Control Panel</strong>. Dupa ce este setata acolo, aici ramane doar generarea tokenului pentru firma din SPV.
        </InlineNotice>
      ) : null}

      <DocumentSection
        title="Modul e-Factura"
        description="Activezi functia pentru firma curenta si alegi mediul de lucru folosit la conectarea cu ANAF."
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
        )}
      </DocumentSection>

      <DocumentSection
        title="Autorizare ANAF"
        description="Firma se autentifica in SPV cu certificatul digital si autorizeaza aplicatia pentru transmiterea facturilor."
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

      <DocumentSection title="Cum functioneaza" description="Fluxul pentru client trebuie sa fie simplu si usor de urmarit.">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            1. Completezi datele emitentului in pagina Firma.
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            2. Generezi tokenul ANAF cu semnatura electronica a firmei.
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            3. Din factura trimiti, verifici starea si descarci recipisa.
          </div>
        </div>
      </DocumentSection>
    </div>
  )
}
