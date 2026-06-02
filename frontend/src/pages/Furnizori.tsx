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

type Supplier = {
  id: string
  name: string
  code?: string | null
  cif?: string | null
  regCom?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
}

function emptyForm() {
  return { id: "", name: "", code: "", cif: "", regCom: "", address: "", city: "", country: "Romania", phone: "", email: "" }
}

export default function FurnizoriPage() {
  const token = getToken() || ""
  const [items, setItems] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<any>(emptyForm())
  const [numbering, setNumbering] = useState<NumberingPayload["previews"] | null>(null)

  useEffect(() => {
    loadSuppliers()
    loadNumbering()
  }, [])

  async function loadNumbering() {
    try {
      const data = await getDocumentNumbering()
      setNumbering(data?.previews || null)
    } catch {
      setNumbering(null)
    }
  }

  async function loadSuppliers(search = "") {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/meta/suppliers${search ? `?q=${encodeURIComponent(search)}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu pot incarca furnizorii.")
      setItems(Array.isArray(data.suppliers) ? data.suppliers : [])
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca furnizorii.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function openNewModal() {
    setForm({ ...emptyForm(), code: getPreviewValue(numbering, "supplier") })
    setModalOpen(true)
  }

  function openEditModal(item: Supplier) {
    setForm({
      id: item.id,
      name: item.name || "",
      code: item.code || "",
      cif: item.cif || "",
      regCom: item.regCom || "",
      address: item.address || "",
      city: item.city || "",
      country: item.country || "Romania",
      phone: item.phone || "",
      email: item.email || "",
    })
    setModalOpen(true)
  }

  async function saveSupplier() {
    if (!token) return setError("Nu exista token de autentificare. Fa login din nou.")
    if (!form.name.trim()) return setError("Completeaza denumirea furnizorului.")

    setSaving(true)
    setError("")
    try {
      const res = await fetch(form.id ? `${API}/api/v1/meta/suppliers/${form.id}` : `${API}/api/v1/meta/suppliers`, {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || null,
          cif: form.cif.trim() || null,
          regCom: form.regCom.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          country: form.country.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Nu am putut salva furnizorul.")
      setModalOpen(false)
      setForm(emptyForm())
      await loadSuppliers(query.trim())
      await loadNumbering()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva furnizorul.")
    } finally {
      setSaving(false)
    }
  }

  async function lookupByCui() {
    if (!token) return setError("Nu exista token de autentificare. Fa login din nou.")
    if (!form.cif.trim()) return setError("Completeaza mai intai CUI-ul furnizorului.")

    setLookupBusy(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/v1/company/cui-lookup?cui=${encodeURIComponent(form.cif)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !data?.company) {
        throw new Error(data?.error || "Nu am putut obtine datele furnizorului dupa CUI.")
      }

      setForm((prev: any) => ({
        ...prev,
        name: data.company.name || prev.name,
        cif: data.company.cui || prev.cif,
        regCom: data.company.regNo || prev.regCom,
        address: data.company.address || prev.address,
        city: data.company.city || prev.city,
        country: data.company.country === "RO" ? "Romania" : (data.company.country || prev.country),
      }))
    } catch (e: any) {
      setError(e?.message || "Nu am putut obtine datele furnizorului dupa CUI.")
    } finally {
      setLookupBusy(false)
    }
  }

  const filtered = useMemo(() => items, [items])
  const stats = useMemo(
    () => ({
      total: items.length,
      cuCif: items.filter((item) => String(item.cif || "").trim()).length,
      cuContact: items.filter((item) => String(item.phone || item.email || "").trim()).length,
    }),
    [items],
  )

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Furnizori"
        subtitle="Gestionezi partenerii de achizitie, datele fiscale si contactele folosite mai departe in receptii, documente si fluxurile comerciale."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Furnizori" value={stats.total} tone="slate" />
        <DocumentMetric title="Cu CIF" value={stats.cuCif} tone="blue" />
        <DocumentMetric title="Cu date contact" value={stats.cuContact} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <DocumentSection
        title="Registru furnizori"
        description="Vezi rapid baza de furnizori si deschizi direct fisa completa pentru actualizare, completare dupa CUI sau corectii comerciale."
        actions={
          <button type="button" onClick={openNewModal} className={documentButtonPrimaryClass}>
            Adauga furnizor
          </button>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[16px] font-semibold text-[#17324D]">Lista furnizori</div>
            <div className="mt-1 text-xs text-slate-500">{filtered.length} rezultate in contextul curent</div>
          </div>

          <div className="flex w-full max-w-xl gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cauta dupa denumire, cod sau CIF..."
              className={documentInputClass}
            />
            <button type="button" onClick={() => loadSuppliers(query.trim())} className={documentButtonSecondaryClass}>
              Cauta
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          {loading ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-7 text-center text-sm text-slate-500">
              Se incarca furnizorii...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-7 text-center text-sm text-slate-500">
              Nu exista furnizori salvati.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openEditModal(item)}
                className="grid w-full grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white md:grid-cols-[minmax(220px,1.4fr)_140px_150px_150px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[#17324D]">{item.name}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{item.address || "fara adresa"}</div>
                </div>
                <div className="text-sm text-slate-700">{item.cif || "-"}</div>
                <div className="text-sm text-slate-700">{item.phone || "-"}</div>
                <div className="text-sm font-medium text-slate-600">{item.code || item.city || "deschide"}</div>
              </button>
            ))
          )}
        </div>
      </DocumentSection>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[18px] font-semibold text-[#17324D]">{form.id ? "Editeaza furnizor" : "Adauga furnizor"}</div>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className={documentButtonSecondaryClass}>
                Inchide
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {[
                ["name", "Denumire furnizor"],
                ["code", "Cod"],
                ["cif", "CIF"],
                ["regCom", "Reg. comertului"],
                ["city", "Oras"],
                ["country", "Tara"],
                ["phone", "Telefon"],
                ["email", "Email"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="mb-1.5 block text-sm font-medium text-[#17324D]">{label}</label>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((prev: any) => ({ ...prev, [key]: e.target.value }))}
                    className={documentInputClass}
                    readOnly={key === "code"}
                    style={key === "code" ? readonlyInputStyle : undefined}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-[#17324D]">Adresa</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm((prev: any) => ({ ...prev, address: e.target.value }))}
                className={documentTextareaClass}
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={lookupByCui} disabled={lookupBusy || saving || !form.cif.trim()} className={documentButtonSecondaryClass}>
                {lookupBusy ? "Caut..." : "Completeaza dupa CUI"}
              </button>
              <button type="button" onClick={() => setModalOpen(false)} className={documentButtonSecondaryClass}>
                Renunta
              </button>
              <button type="button" onClick={saveSupplier} disabled={saving} className={documentButtonPrimaryClass}>
                {saving ? "Se salveaza..." : "Salveaza furnizor"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
