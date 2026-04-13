import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { getToken } from "../lib/api"
import { me, selectCompany } from "../lib/auth"

type CompanyChoice = {
  id: string
  name: string
  code?: string | null
  cui?: string | null
  isDefault?: boolean
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken()
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(false)
  const [, setModuleStamp] = useState("")
  const [companyChoices, setCompanyChoices] = useState<CompanyChoice[]>([])
  const [choosingCompany, setChoosingCompany] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const loadProfile = async () => {
      if (!token) {
        if (mounted) {
          setOk(false)
          setLoading(false)
        }
        return
      }
      try {
        const profile = await me()
        const modules = Array.isArray((profile as any)?.modules) ? (profile as any).modules : []
        const companies = Array.isArray((profile as any)?.companies) ? (profile as any).companies : []
        const activeCompanyId = typeof (profile as any)?.active_company_id === "string" ? String((profile as any).active_company_id) : ""
        const requiresCompanySelection = Boolean((profile as any)?.requires_company_selection)

        localStorage.setItem("modules", JSON.stringify(modules))
        if (mounted) {
          setModuleStamp(modules.join("|"))
          setCompanyChoices(requiresCompanySelection && !activeCompanyId ? companies : [])
        }
        if (mounted) setOk(true)
      } catch {
        if (mounted) setOk(false)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadProfile()

    const onFocus = () => {
      loadProfile()
    }

    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      mounted = false
    }
  }, [token])

  async function handleSelectCompany(companyId: string) {
    try {
      setChoosingCompany(true)
      setCompanyError(null)
      await selectCompany(companyId)
      const profile = await me()
      const modules = Array.isArray((profile as any)?.modules) ? (profile as any).modules : []
      localStorage.setItem("modules", JSON.stringify(modules))
      setModuleStamp(modules.join("|"))
      setCompanyChoices([])
      setOk(true)
    } catch (error: any) {
      setCompanyError(error?.message || "Nu am putut selecta firma.")
    } finally {
      setChoosingCompany(false)
    }
  }

  if (loading) return <div className="p-6">Se incarca...</div>
  if (!token || !ok) return <Navigate to="/login" replace />

  return (
    <>
      {children}

      {companyChoices.length ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alege firma</div>
            <h2 className="mt-2 text-2xl font-semibold text-[#17324D]">Pe ce firma vrei sa lucrezi?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Ai acces la mai multe firme in acelasi ERP. Alege firma activa, iar apoi poti incepe lucrul.
            </p>

            <div className="mt-6 grid gap-3">
              {companyChoices.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => handleSelectCompany(company.id)}
                  disabled={choosingCompany}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-[#17324D] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div>
                    <div className="text-base font-semibold text-[#17324D]">{company.name}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {[company.code, company.cui].filter(Boolean).join(" • ") || "Firma activa ERP"}
                    </div>
                  </div>
                  {company.isDefault ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      Implicita
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {companyError ? <div className="mt-4 text-sm text-rose-600">{companyError}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
