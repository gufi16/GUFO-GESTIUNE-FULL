import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
  readonlyInputStyle,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { getDocumentNumbering, getPreviewValue, type NumberingPayload } from "../lib/numbering"
import { hasModule } from "../lib/modules"

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
  isActive?: boolean
}

type CustomerForm = {
  id: string
  name: string
  code: string
  cif: string
  regNo: string
  address: string
  city: string
  county: string
  postalCode: string
  country: string
  phone: string
  email: string
  vatPayer: boolean
  isActive: boolean
}

const emptyForm: CustomerForm = {
  id: "",
  name: "",
  code: "",
  cif: "",
  regNo: "",
  address: "",
  city: "",
  county: "",
  postalCode: "",
  country: "RO",
  phone: "",
  email: "",
  vatPayer: true,
  isActive: true,
}

function isCustomerReadyForEfactura(item: Partial<CustomerForm | Customer>) {
  return Boolean(
    String(item.name || "").trim() &&
      String(item.address || "").trim() &&
      String(item.city || "").trim() &&
      String(item.county || "").trim() &&
      String(item.country || "").trim(),
  )
}

export default function ClientiPage() {
  const token = getToken() || ""
  const efacturaEnabled = hasModule("efactura")
  const [items, setItems] = useState<Customer[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<CustomerForm>(emptyForm)
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)

  useEffect(() => {
    loadCustomers()
    loadNumbering()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadNumbering() {
    try {
      const data = await getDocumentNumbering()
      setNumbering(data?.previews || null)
    } catch {
      setNumbering(null)
    }
  }

  async function loadCustomers() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/customers`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut incarca clientii.")
      setItems(Array.isArray(data.customers) ? data.customers : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca clientii.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function openNewModal() {
    setForm({
      ...emptyForm,
      code: getPreviewValue(numbering, "customer"),
    })
    setModalOpen(true)
  }

  function openEditModal(item: Customer) {
    setForm({
      id: item.id,
      name: item.name || "",
      code: item.code || "",
      cif: item.cif || "",
      regNo: item.regNo || "",
      address: item.address || "",
      city: item.city || "",
      county: item.county || "",
      postalCode: item.postalCode || "",
      country: item.country || "RO",
      phone: item.phone || "",
      email: item.email || "",
      vatPayer: item.vatPayer !== false,
      isActive: item.isActive !== false,
    })
    setModalOpen(true)
  }

  async function saveCustomer() {
    if (!form.name.trim()) {
      setError("Numele clientului este obligatoriu.")
      return
    }

    setSaving(true)
    setError("")
    try {
      const method = form.id ? "PUT" : "POST"
      const url = form.id ? `${API}/api/v1/customers/${form.id}` : `${API}/api/v1/customers`
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...form,
          code: form.id ? form.code.trim() || null : null,
          cif: form.cif.trim() || null,
          regNo: form.regNo.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          county: form.county.trim() || null,
          postalCode: form.postalCode.trim() || null,
          country: form.country.trim().toUpperCase() || "RO",
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut salva clientul.")
      setModalOpen(false)
      setForm(emptyForm)
      await loadCustomers()
      await loadNumbering()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva clientul.")
    } finally {
      setSaving(false)
    }
  }

  async function lookupByCui() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }
    if (!form.cif.trim()) {
      setError("Completeaza mai intai CUI-ul clientului.")
      return
    }

    setLookupBusy(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(form.cif)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.company) {
        throw new Error(data?.error || "Nu am putut obtine datele clientului dupa CUI.")
      }

      setForm((prev) => ({
        ...prev,
        name: data.company.name || prev.name,
        cif: data.company.cui || prev.cif,
        regNo: data.company.regNo || prev.regNo,
        address: data.company.address || prev.address,
        city: data.company.city || prev.city,
        county: data.company.county || prev.county,
        postalCode: data.company.postalCode || prev.postalCode,
        country: data.company.country || prev.country,
        vatPayer: data.company.isVatPayer ?? prev.vatPayer,
      }))
    } catch (e: any) {
      setError(e?.message || "Nu am putut obtine datele clientului dupa CUI.")
    } finally {
      setLookupBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      [item.name, item.code, item.cif, item.phone, item.email, item.city, item.county].filter(Boolean).join(" ").toLowerCase().includes(q),
    )
  }, [items, search])

  const stats = useMemo(
    () => ({
      total: items.length,
      efacturaReady: items.filter((item) => isCustomerReadyForEfactura(item)).length,
      active: items.filter((item) => item.isActive !== false).length,
    }),
    [items],
  )

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Clienti"
        subtitle="Administrezi baza de clienti, datele comerciale si informatiile utile pentru facturare, livrare si e-Factura intr-un registru usor de parcurs."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Clienti" value={stats.total} tone="slate" />
        <DocumentMetric title="Activi" value={stats.active} tone="blue" />
        <DocumentMetric title="Pregatiti e-Factura" value={stats.efacturaReady} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <DocumentSection
        title="Registru clienti"
        description="Cauti rapid dupa nume, CIF, cod, oras sau telefon si deschizi direct fisa clientului pentru editare sau completarea datelor comerciale."
        actions={
          <button type="button" onClick={openNewModal} className={documentButtonPrimaryClass}>
            Adauga client
          </button>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[16px] font-semibold text-[#17324D]">Lista clienti</div>
            <div className="mt-1 text-xs text-slate-500">{filtered.length} rezultate in contextul curent</div>
          </div>

          <div className="flex w-full max-w-xl gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cauta dupa nume, CIF, cod, oras sau telefon..."
              className={documentInputClass}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          {loading ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-7 text-center text-sm text-slate-500">
              Se incarca clientii...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-7 text-center text-sm text-slate-500">
              Nu exista clienti salvati.
            </div>
          ) : (
            filtered.map((item) => {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openEditModal(item)}
                  className="grid w-full grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white md:grid-cols-[minmax(220px,1.4fr)_140px_180px_180px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#17324D]">{item.name}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {[item.address, item.city, item.county].filter(Boolean).join(", ") || "fara adresa"}
                    </div>
                  </div>
                  <div className="text-sm text-slate-700">{item.cif || "-"}</div>
                  <div className="text-sm text-slate-700">{item.code || "-"}</div>
                  <div className="flex items-center justify-between gap-3">
                    {efacturaEnabled ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${isCustomerReadyForEfactura(item) ? "bg-[#E5F3E8] text-[#215D2A]" : "bg-slate-100 text-slate-700"}`}
                      >
                        {isCustomerReadyForEfactura(item) ? "e-Factura ok" : "date incomplete"}
                      </span>
                    ) : null}
                    <span className="text-xs font-medium text-slate-500">{item.phone || "-"}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </DocumentSection>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[18px] font-semibold text-[#17324D]">{form.id ? "Editeaza client" : "Adauga client"}</div>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className={documentButtonSecondaryClass}>
                Inchide
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Nume client</label>
                <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Cod client</label>
                  <input value={form.code} readOnly className={documentInputClass} style={readonlyInputStyle} placeholder="Se propune automat" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">CIF</label>
                <input value={form.cif} onChange={(e) => setForm((prev) => ({ ...prev, cif: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Reg. comertului</label>
                <input value={form.regNo} onChange={(e) => setForm((prev) => ({ ...prev, regNo: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Telefon</label>
                <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Email</label>
                <input value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Localitate</label>
                <input value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Judet</label>
                <input value={form.county} onChange={(e) => setForm((prev) => ({ ...prev, county: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Cod postal</label>
                <input value={form.postalCode} onChange={(e) => setForm((prev) => ({ ...prev, postalCode: e.target.value }))} className={documentInputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Tara</label>
                <input value={form.country} onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value.toUpperCase() }))} className={documentInputClass} />
              </div>
              <div className="xl:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Adresa</label>
                <textarea value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} className={documentTextareaClass} rows={2} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Regim TVA</label>
                <label className="flex min-h-10 items-center gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">
                  <input type="checkbox" checked={form.vatPayer} onChange={(e) => setForm((prev) => ({ ...prev, vatPayer: e.target.checked }))} />
                  <span>Client platitor de TVA</span>
                </label>
              </div>
            </div>

            <div className="mt-5 flex justify-between gap-3">
              {efacturaEnabled ? (
                <div
                      className={`inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-semibold ${isCustomerReadyForEfactura(form) ? "bg-[#E5F3E8] text-[#215D2A]" : "bg-slate-100 text-slate-700"}`}
                >
                  {isCustomerReadyForEfactura(form) ? "Date suficiente pentru pregatire e-Factura" : "Mai lipsesc date utile pentru e-Factura"}
                </div>
              ) : <div />}
              <div className="flex gap-2">
                <button type="button" onClick={lookupByCui} disabled={lookupBusy || saving || !form.cif.trim()} className={documentButtonSecondaryClass}>
                  {lookupBusy ? "Caut..." : "Completeaza dupa CUI"}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} className={documentButtonSecondaryClass}>
                  Renunta
                </button>
                <button type="button" onClick={saveCustomer} disabled={saving} className={documentButtonPrimaryClass}>
                  {saving ? "Se salveaza..." : form.id ? "Salveaza modificarile" : "Salveaza client"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
