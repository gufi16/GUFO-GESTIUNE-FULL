import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonDangerClass,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"

const FISCAL_CODES = ["", "A", "B", "C", "D", "E", "F", "G"]

type Vat = {
  id: string
  name: string
  rate: number
  fiscalCode: string | null
  isActive: boolean
}

type DraftState = Record<
  string,
  {
    rate: string
    fiscalCode: string
  }
>

function normalizeFiscalCode(value: string) {
  const code = value.trim().toUpperCase()
  return FISCAL_CODES.includes(code) ? code : ""
}

export default function TvaPage() {
  const token = getToken() || ""

  const [list, setList] = useState<Vat[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rate, setRate] = useState("")
  const [fiscalCode, setFiscalCode] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [drafts, setDrafts] = useState<DraftState>({})
  const [savingRowId, setSavingRowId] = useState("")

  useEffect(() => {
    load()
  }, [])

  const sortedList = useMemo(() => [...list].sort((a, b) => a.rate - b.rate), [list])

  const metrics = useMemo(() => {
    const active = sortedList.filter((item) => item.isActive).length
    const mapped = sortedList.filter((item) => item.fiscalCode).length
    const maxRate = sortedList.length ? `${Math.max(...sortedList.map((item) => item.rate))}%` : "-"
    return { total: sortedList.length, active, mapped, maxRate }
  }, [sortedList])

  async function load() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/vat`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setLoading(false)
        return
      }

      const items = Array.isArray(data.items) ? data.items : Array.isArray(data.vat) ? data.vat : []
      setList(items)
      setDrafts(
        Object.fromEntries(
          items.map((item: Vat) => [
            item.id,
            {
              rate: String(item.rate),
              fiscalCode: item.fiscalCode || ""
            }
          ])
        )
      )
    } catch {
      setError("Nu pot incarca cotele TVA.")
      setList([])
      setDrafts({})
    } finally {
      setLoading(false)
    }
  }

  async function addVat() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    const numericRate = Number(rate)
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      setError("Introdu o cota TVA valida.")
      return
    }

    const normalizedFiscalCode = normalizeFiscalCode(fiscalCode)
    if (fiscalCode && !normalizedFiscalCode) {
      setError("Selecteaza un cod fiscal valid A-G sau lasa campul gol.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/meta/vat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rate: numericRate,
          fiscalCode: normalizedFiscalCode || null
        })
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setSaving(false)
        return
      }

      if (!data.ok) {
        setError(data.error || "Nu am putut salva cota TVA.")
        setSaving(false)
        return
      }

      setRate("")
      setFiscalCode("")
      setMessage("Cota TVA a fost salvata.")
      await load()
    } catch {
      setError("Nu am putut salva cota TVA.")
    } finally {
      setSaving(false)
    }
  }

  function updateDraft(id: string, field: "rate" | "fiscalCode", value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        rate: field === "rate" ? value : prev[id]?.rate || "",
        fiscalCode: field === "fiscalCode" ? value : prev[id]?.fiscalCode || ""
      }
    }))
  }

  async function saveVat(item: Vat) {
    const draft = drafts[item.id]
    if (!draft) return

    const numericRate = Number(draft.rate)
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      setError("Introdu o cota TVA valida.")
      return
    }

    const normalizedFiscalCode = normalizeFiscalCode(draft.fiscalCode)
    if (draft.fiscalCode && !normalizedFiscalCode) {
      setError("Selecteaza un cod fiscal valid A-G sau lasa campul gol.")
      return
    }

    try {
      setSavingRowId(item.id)
      setError("")
      setMessage("")

      const res = await fetch(`${API}/api/v1/meta/vat/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rate: numericRate,
          fiscalCode: normalizedFiscalCode || null,
          isActive: item.isActive
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        setError(data.error || "Nu am putut actualiza cota TVA.")
        return
      }

      setMessage(`Cota TVA ${numericRate}% a fost actualizata.`)
      await load()
    } catch {
      setError("Nu am putut actualiza cota TVA.")
    } finally {
      setSavingRowId("")
    }
  }

  async function toggleVat(item: Vat) {
    const draft = drafts[item.id]
    const numericRate = Number(draft?.rate || item.rate)
    const normalizedFiscalCode = normalizeFiscalCode(draft?.fiscalCode || item.fiscalCode || "")

    try {
      setError("")
      setMessage("")

      const res = await fetch(`${API}/api/v1/meta/vat/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rate: numericRate,
          fiscalCode: normalizedFiscalCode || null,
          isActive: !item.isActive
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        setError(data.error || "Nu am putut actualiza cota TVA.")
        return
      }

      setMessage(item.isActive ? "Cota TVA a fost dezactivata." : "Cota TVA a fost activata.")
      await load()
    } catch {
      setError("Nu am putut actualiza cota TVA.")
    }
  }

  async function deleteVat(id: string) {
    const ok = window.confirm("Stergi aceasta cota TVA?")
    if (!ok) return

    try {
      setError("")
      setMessage("")

      const res = await fetch(`${API}/api/v1/meta/vat/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        setError(data.error || "Nu am putut sterge cota TVA.")
        return
      }

      setMessage("Cota TVA a fost stearsa.")
      await load()
    } catch {
      setError("Nu am putut sterge cota TVA.")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Cote TVA"
        subtitle="Configurezi rapid procentele de TVA si maparea fiscala folosita la emiterea bonului pe casa de marcat."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DocumentMetric title="Total cote" value={metrics.total} tone="blue" />
        <DocumentMetric title="Cote active" value={metrics.active} tone="emerald" />
        <DocumentMetric title="Mapari fiscale" value={metrics.mapped} tone="amber" />
        <DocumentMetric title="Cota maxima" value={metrics.maxRate} />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="info">{message}</InlineNotice> : null}

      <DocumentSection
        title="Adauga cota TVA"
        description="Pastrezi nomenclatorul simplu: procentul TVA, codul fiscal optional si activarea ulterioara."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[180px_220px_1fr]">
          <DocumentField label="Cota TVA (%)">
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Ex: 21"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              className={documentInputClass}
            />
          </DocumentField>

          <DocumentField label="Cod fiscal">
            <select value={fiscalCode} onChange={(event) => setFiscalCode(event.target.value)} className={documentInputClass}>
              <option value="">Neasignat</option>
              {FISCAL_CODES.filter(Boolean).map((code) => (
                <option key={code} value={code}>
                  Cota {code}
                </option>
              ))}
            </select>
          </DocumentField>

          <div className="flex items-end">
            <button onClick={addVat} disabled={saving} className={documentButtonPrimaryClass}>
              {saving ? "Se salveaza..." : "Adauga cota TVA"}
            </button>
          </div>
        </div>

        <InlineNotice tone="info">
          Exemplu: TVA 21% poate fi mapat la cota fiscala <strong>A</strong>. In produse ramai cu procentul TVA, iar la Android POS se
          transmite si litera fiscala pentru FiscalNet.
        </InlineNotice>
      </DocumentSection>

      <DocumentSection
        title="Lista cote TVA"
        description="Editezi rapid procentul, codul fiscal si starea fiecarei cote fara sa iesi din tabel."
      >
        {loading ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
            Se incarca cotele TVA...
          </div>
        ) : sortedList.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
            Nu exista cote TVA definite.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[26px] border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Cota TVA</th>
                    <th className="px-4 py-3">Denumire</th>
                    <th className="px-4 py-3">Cota fiscala</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actiuni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedList.map((item) => {
                    const draft = drafts[item.id] || { rate: String(item.rate), fiscalCode: item.fiscalCode || "" }

                    return (
                      <tr key={item.id} className="align-top transition hover:bg-slate-50/70">
                        <td className="px-4 py-4">
                          <div className="flex max-w-[140px] items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={draft.rate}
                              onChange={(event) => updateDraft(item.id, "rate", event.target.value)}
                              className={documentInputClass}
                            />
                            <span className="text-slate-500">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-700">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">Utilizata in produse, facturi si bonuri fiscale.</div>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={draft.fiscalCode}
                            onChange={(event) => updateDraft(item.id, "fiscalCode", event.target.value)}
                            className={documentInputClass}
                          >
                            <option value="">Neasignat</option>
                            {FISCAL_CODES.filter(Boolean).map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              item.isActive ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {item.isActive ? "Activ" : "Inactiv"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() => saveVat(item)}
                              disabled={savingRowId === item.id}
                              className={documentButtonPrimaryClass}
                            >
                              {savingRowId === item.id ? "Se salveaza..." : "Salveaza"}
                            </button>
                            <button onClick={() => toggleVat(item)} className={documentButtonSecondaryClass}>
                              {item.isActive ? "Dezactiveaza" : "Activeaza"}
                            </button>
                            <button onClick={() => deleteVat(item.id)} className={documentButtonDangerClass}>
                              Sterge
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DocumentSection>
    </div>
  )
}
