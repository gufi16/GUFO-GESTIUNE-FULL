import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentInputClass,
  documentTextareaClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { hasModule } from "../lib/modules"

type CompanyForm = {
  name: string
  cui: string
  regNo: string
  address: string
  city: string
  county: string
  postalCode: string
  country: string
  bank: string
  iban: string
  email: string
  contactEmail: string
  phone: string
  isVatPayer: boolean
  efacturaSellerCity: string
  efacturaSellerCounty: string
  efacturaSellerPostalCode: string
  efacturaSellerCountryCode: string
  efacturaContactEmail: string
  efacturaCertSerial: string
}

type CompanyCertificateState = {
  hasFile: boolean
  filename: string
  uploadedAt: string
  passwordConfigured: boolean
}

const emptyForm: CompanyForm = {
  name: "",
  cui: "",
  regNo: "",
  address: "",
  city: "",
  county: "",
  postalCode: "",
  country: "RO",
  bank: "",
  iban: "",
  email: "",
  contactEmail: "",
  phone: "",
  isVatPayer: true,
  efacturaSellerCity: "",
  efacturaSellerCounty: "",
  efacturaSellerPostalCode: "",
  efacturaSellerCountryCode: "RO",
  efacturaContactEmail: "",
  efacturaCertSerial: "",
}

export default function FirmaPage() {
  const token = getToken() || ""
  const efacturaEnabled = hasModule("efactura")

  const [form, setForm] = useState<CompanyForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [certBusy, setCertBusy] = useState(false)
  const [certPassword, setCertPassword] = useState("")
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certState, setCertState] = useState<CompanyCertificateState>({
    hasFile: false,
    filename: "",
    uploadedAt: "",
    passwordConfigured: false,
  })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadCompany()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCompany() {
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

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setLoading(false)
        return
      }

      if (data?.company) {
        setForm({
          name: data.company.name || "",
          cui: data.company.cui || "",
          regNo: data.company.regNo || "",
          address: data.company.address || "",
          city: data.company.city || data.company.efacturaSellerCity || "",
          county: data.company.county || data.company.efacturaSellerCounty || "",
          postalCode: data.company.postalCode || data.company.efacturaSellerPostalCode || "",
          country: data.company.country || data.company.efacturaSellerCountryCode || "RO",
          bank: data.company.bank || "",
          iban: data.company.iban || "",
          email: data.company.email || "",
          contactEmail: data.company.contactEmail || data.company.efacturaContactEmail || "",
          phone: data.company.phone || "",
          isVatPayer: data.company.isVatPayer ?? true,
          efacturaSellerCity: data.company.efacturaSellerCity || data.company.city || "",
          efacturaSellerCounty: data.company.efacturaSellerCounty || data.company.county || "",
          efacturaSellerPostalCode: data.company.efacturaSellerPostalCode || data.company.postalCode || "",
          efacturaSellerCountryCode: data.company.efacturaSellerCountryCode || data.company.country || "RO",
          efacturaContactEmail: data.company.efacturaContactEmail || data.company.contactEmail || "",
          efacturaCertSerial: data.company.efacturaCertSerial || "",
        })
        setCertState({
          hasFile: Boolean(data.company.efacturaCertHasFile),
          filename: data.company.efacturaCertFilename || "",
          uploadedAt: data.company.efacturaCertUploadedAt || "",
          passwordConfigured: Boolean(data.company.efacturaCertPasswordConfigured),
        })
      } else {
        setForm(emptyForm)
        setCertState({
          hasFile: false,
          filename: "",
          uploadedAt: "",
          passwordConfigured: false,
        })
      }
    } catch {
      setError("Nu pot incarca datele firmei.")
    } finally {
      setLoading(false)
    }
  }

  async function saveCompany() {
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
      const currentCompany = currentData?.company || {}

      const res = await fetch(`${API}/api/v1/company`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...currentCompany,
          ...form,
          ...(certPassword.trim() ? { efacturaCertPassword: certPassword.trim() } : {}),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setSaving(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Eroare la salvarea firmei.")
        setSaving(false)
        return
      }

      setCertPassword("")
      setMessage("Datele firmei au fost salvate.")
    } catch {
      setError("Eroare la salvarea firmei.")
    } finally {
      setSaving(false)
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
        throw new Error(data?.error || "Nu am putut incarca certificatul e-Factura.")
      }

      setCertFile(null)
      setCertPassword("")
      await loadCompany()
      setMessage("Certificatul e-Factura a fost incarcat pe server.")
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
      await loadCompany()
      setMessage("Certificatul e-Factura a fost sters de pe server.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut sterge certificatul e-Factura.")
    } finally {
      setCertBusy(false)
    }
  }

  function updateField<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  async function lookupByCui() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    if (!form.cui.trim()) {
      setError("Completeaza mai intai CUI-ul.")
      return
    }

    setLookupBusy(true)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(form.cui)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.ok || !data?.company) {
        throw new Error(data?.error || "Nu am putut obtine datele firmei dupa CUI.")
      }

      setForm((prev) => ({
        ...prev,
        name: data.company.name || prev.name,
        cui: data.company.cui || prev.cui,
        regNo: data.company.regNo || prev.regNo,
        address: data.company.address || prev.address,
        city: data.company.city || prev.city,
        county: data.company.county || prev.county,
        postalCode: data.company.postalCode || prev.postalCode,
        country: data.company.country || prev.country,
        isVatPayer: data.company.isVatPayer ?? prev.isVatPayer,
        efacturaSellerCity: data.company.city || prev.efacturaSellerCity,
        efacturaSellerCounty: data.company.county || prev.efacturaSellerCounty,
        efacturaSellerPostalCode: data.company.postalCode || prev.efacturaSellerPostalCode,
        efacturaSellerCountryCode: data.company.country || prev.efacturaSellerCountryCode,
      }))
      setMessage("Datele firmei au fost completate automat dupa CUI.")
    } catch (e: any) {
      setError(e?.message || "Nu am putut obtine datele firmei dupa CUI.")
    } finally {
      setLookupBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Firma"
        subtitle={
          efacturaEnabled
            ? "Datele firmei se salveaza o singura data si sunt folosite in documente, PDF si e-Factura."
            : "Datele firmei se salveaza o singura data si sunt folosite in toate documentele si PDF-urile ERP."
        }
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Denumire" value={form.name || "-"} tone="slate" />
        <DocumentMetric title="CUI" value={form.cui || "-"} tone="blue" />
        <DocumentMetric title="TVA" value={form.isVatPayer ? "Platitoare" : "Neplatitoare"} tone="emerald" />
        <DocumentMetric
          title="Certificat SPV"
          value={certState.hasFile ? "Incarcat" : "Lipsa"}
          tone={certState.hasFile ? "emerald" : "amber"}
        />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Date firma"
        description={
          efacturaEnabled
            ? "Aici completezi datele firmei o singura data. Sistemul le foloseste apoi in toate documentele si in e-Factura."
            : "Aici completezi datele firmei o singura data. Sistemul le foloseste apoi in toate documentele si PDF-urile ERP."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={lookupByCui}
              disabled={lookupBusy || loading || !form.cui.trim()}
              className={documentButtonPrimaryClass.replace("bg-[#1D4E89] text-white shadow-[0_16px_30px_rgba(29,78,137,0.18)] hover:bg-[#173E6C]", "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 shadow-none")}
            >
              {lookupBusy ? "Caut..." : "Completeaza dupa CUI"}
            </button>
            <button onClick={saveCompany} disabled={saving || loading} className={documentButtonPrimaryClass}>
              {saving ? "Se salveaza..." : "Salveaza"}
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Se incarca datele firmei...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <DocumentField label="Denumire firma">
                <input value={form.name} onChange={(e) => updateField("name", e.target.value)} className={documentInputClass} placeholder="Ex: GUFO RETAIL SRL" />
              </DocumentField>

              <DocumentField label="CUI">
                <input value={form.cui} onChange={(e) => updateField("cui", e.target.value)} className={documentInputClass} placeholder="Ex: RO12345678" />
              </DocumentField>

              <DocumentField label="Nr. Registru Comert">
                <input value={form.regNo} onChange={(e) => updateField("regNo", e.target.value)} className={documentInputClass} placeholder="Ex: J40/1234/2010" />
              </DocumentField>

              <DocumentField label="Banca">
                <input value={form.bank} onChange={(e) => updateField("bank", e.target.value)} className={documentInputClass} placeholder="Ex: Banca Transilvania" />
              </DocumentField>

              <DocumentField label="IBAN">
                <input value={form.iban} onChange={(e) => updateField("iban", e.target.value)} className={documentInputClass} placeholder="Ex: RO49AAAA1B31007593840000" />
              </DocumentField>

              <DocumentField label="Email">
                <input value={form.email} onChange={(e) => updateField("email", e.target.value)} className={documentInputClass} placeholder="Ex: office@firma.ro" />
              </DocumentField>

              <DocumentField label="Telefon">
                <input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} className={documentInputClass} placeholder="Ex: 0722000000" />
              </DocumentField>

              <DocumentField label="Regim TVA">
                <label className="flex min-h-10 items-center gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">
                  <input type="checkbox" checked={form.isVatPayer} onChange={(e) => updateField("isVatPayer", e.target.checked)} />
                  <span>Firma este platitoare de TVA</span>
                </label>
              </DocumentField>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DocumentField label="Localitate">
                <input value={form.city} onChange={(e) => updateField("city", e.target.value)} className={documentInputClass} placeholder="Ex: Cluj-Napoca" />
              </DocumentField>

              <DocumentField label="Judet">
                <input value={form.county} onChange={(e) => updateField("county", e.target.value)} className={documentInputClass} placeholder="Ex: Cluj" />
              </DocumentField>

              <DocumentField label="Cod postal">
                <input value={form.postalCode} onChange={(e) => updateField("postalCode", e.target.value)} className={documentInputClass} placeholder="Ex: 400000" />
              </DocumentField>

              <DocumentField label="Tara">
                <input value={form.country} onChange={(e) => updateField("country", e.target.value.toUpperCase())} className={documentInputClass} placeholder="RO" />
              </DocumentField>

              <DocumentField label="Email contact">
                <input value={form.contactEmail} onChange={(e) => updateField("contactEmail", e.target.value)} className={documentInputClass} placeholder="Ex: office@firma.ro" />
              </DocumentField>
            </div>

            <div className="mt-4">
              <DocumentField label="Adresa">
                <textarea value={form.address} onChange={(e) => updateField("address", e.target.value)} rows={3} className={documentTextareaClass} placeholder="Ex: Calea Floresti 20" />
              </DocumentField>
            </div>

            {efacturaEnabled ? (
              <div className="mt-4">
                <DocumentSection
                  title="Date emitent e-Factura"
                  description="Aceste campuri sunt folosite direct in XML-ul ANAF. Daca le lasi goale, sistemul foloseste valorile generale ale firmei."
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <DocumentField label="Localitate emitent">
                      <input value={form.efacturaSellerCity} onChange={(e) => updateField("efacturaSellerCity", e.target.value)} className={documentInputClass} placeholder="Ex: Cluj-Napoca" />
                    </DocumentField>
                    <DocumentField label="Judet emitent">
                      <input value={form.efacturaSellerCounty} onChange={(e) => updateField("efacturaSellerCounty", e.target.value)} className={documentInputClass} placeholder="Ex: Cluj" />
                    </DocumentField>
                    <DocumentField label="Cod postal emitent">
                      <input value={form.efacturaSellerPostalCode} onChange={(e) => updateField("efacturaSellerPostalCode", e.target.value)} className={documentInputClass} placeholder="Ex: 400000" />
                    </DocumentField>
                    <DocumentField label="Tara emitent">
                      <input value={form.efacturaSellerCountryCode} onChange={(e) => updateField("efacturaSellerCountryCode", e.target.value.toUpperCase())} className={documentInputClass} placeholder="RO" />
                    </DocumentField>
                    <DocumentField label="Email contact e-Factura">
                      <input value={form.efacturaContactEmail} onChange={(e) => updateField("efacturaContactEmail", e.target.value)} className={documentInputClass} placeholder="Ex: efactura@firma.ro" />
                    </DocumentField>
                    <DocumentField label="Serial certificat">
                      <input value={form.efacturaCertSerial} onChange={(e) => updateField("efacturaCertSerial", e.target.value)} className={documentInputClass} placeholder="Ex: 201104209404..." />
                    </DocumentField>
                  </div>
                </DocumentSection>

                <div className="mt-4">
                  <DocumentSection
                    title="Certificat SPV pe server"
                    description="Varianta A: incarci certificatul .p12/.pfx pe serverul Gufo, iar sincronizarea SPV si apelurile ANAF ruleaza direct din Hetzner."
                    actions={
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={uploadCertificate}
                          disabled={certBusy || loading}
                          className={documentButtonPrimaryClass}
                        >
                          {certBusy ? "Se incarca..." : "Incarca certificat"}
                        </button>
                        {certState.hasFile ? (
                          <button
                            type="button"
                            onClick={removeCertificate}
                            disabled={certBusy || loading}
                            className={documentButtonPrimaryClass.replace("bg-[#1D4E89] text-white shadow-[0_16px_30px_rgba(29,78,137,0.18)] hover:bg-[#173E6C]", "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 shadow-none")}
                          >
                            Sterge certificat
                          </button>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Status</div>
                        <div className="mt-1 font-medium text-slate-900">{certState.hasFile ? "Certificat incarcat" : "Fara certificat pe server"}</div>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Fisier</div>
                        <div className="mt-1 truncate font-medium text-slate-900">{certState.filename || "-"}</div>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Incarcat la</div>
                        <div className="mt-1 font-medium text-slate-900">
                          {certState.uploadedAt ? new Date(certState.uploadedAt).toLocaleString("ro-RO") : "-"}
                        </div>
                      </div>
                    </div>
                  </DocumentSection>
                </div>
              </div>
            ) : null}
          </>
        )}
      </DocumentSection>
    </div>
  )
}
