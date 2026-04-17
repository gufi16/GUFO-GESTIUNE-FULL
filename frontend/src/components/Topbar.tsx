import { Bell, Building2, LogOut, MapPin, Menu } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { API_BASE as API, authHeaders } from "../lib/api"
import { logout, me, selectCompany } from "../lib/auth"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { getActiveTerminalId, setActiveTerminalId, subscribeToActiveTerminal } from "../lib/terminal"

function toInputDate(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

export default function Topbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [locations, setLocations] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [terminals, setTerminals] = useState<
    Array<{ id: string; label: string; deviceId: string; locationId?: string; locationName?: string; locationCode?: string }>
  >([])
  const [locationId, setLocationIdState] = useState(getActiveLocationId())
  const [terminalId, setTerminalIdState] = useState(getActiveTerminalId())
  const [userLabel, setUserLabel] = useState("Utilizator")
  const [userMeta, setUserMeta] = useState("ERP")
  const [companyLabel, setCompanyLabel] = useState("Firma activa")
  const [companyChoices, setCompanyChoices] = useState<Array<{ id: string; name: string; code?: string; cui?: string; isDefault?: boolean }>>([])
  const [activeCompanyId, setActiveCompanyId] = useState("")
  const [switchingCompany, setSwitchingCompany] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const isDashboard = location.pathname === "/dashboard"
  const isReports = location.pathname === "/rapoarte"
  const showSalesFilters = isDashboard || isReports
  const today = new Date()
  const defaultDateTo = toInputDate(today)
  const defaultDateFrom = toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))
  const dashboardDateFrom = searchParams.get("dateFrom") || defaultDateFrom
  const dashboardDateTo = searchParams.get("dateTo") || defaultDateTo

  const notifications = [
    {
      id: "release",
      title: "Actualizare ERP",
      description: "Sunt disponibile modificari noi in platforma.",
    },
    {
      id: "sync",
      title: "Sincronizare finalizata",
      description: "Datele au fost actualizate.",
    },
    {
      id: "support",
      title: "Notificare interna",
      description: "Verifica ultimele alerte operationale.",
    },
  ]

  useEffect(() => {
    let cancelled = false

    async function loadTopbarData() {
      try {
        const [locationsRes, profile] = await Promise.all([
          fetch(`${API}/api/v1/meta/locations`, {
            headers: authHeaders(),
          }),
          me().catch(() => null),
        ])
        const data = await locationsRes.json().catch(() => ({}))
        const items = Array.isArray(data?.locations) ? data.locations : []

        if (cancelled) return

        const normalized = items.map((item: any) => ({
          id: String(item.id || ""),
          name: String(item.name || "Locatie"),
          code: item.code ? String(item.code) : undefined,
        }))

        setLocations(normalized)

        if (!locationId && normalized.length === 1) {
          setLocationIdState(normalized[0].id)
          setActiveLocationId(normalized[0].id)
        }

        const profileName =
          typeof (profile as any)?.name === "string" && (profile as any).name.trim()
            ? String((profile as any).name).trim()
            : typeof (profile as any)?.email === "string" && (profile as any).email.trim()
              ? String((profile as any).email).trim()
              : "Utilizator"

        const profileRole =
          typeof (profile as any)?.role === "string" && (profile as any).role.trim()
            ? String((profile as any).role).trim()
            : "ERP"
        const activeCompanyId =
          typeof (profile as any)?.active_company_id === "string" ? String((profile as any).active_company_id) : ""
        const companies = Array.isArray((profile as any)?.companies) ? (profile as any).companies : []
        const activeCompany =
          companies.find((item: any) => String(item?.id || "") === activeCompanyId) ||
          companies.find((item: any) => item?.isDefault) ||
          companies[0] ||
          null

        setUserLabel(profileName)
        setUserMeta(profileRole)
        setCompanyChoices(companies)
        setActiveCompanyId(activeCompany?.id || "")
        setCompanyLabel(activeCompany?.name || "Firma activa")
      } catch {
        if (!cancelled) {
          setLocations([])
        }
      }
    }

    loadTopbarData()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setLocationIdState(nextLocationId)
    })
  }, [])

  useEffect(() => {
    return subscribeToActiveTerminal((nextTerminalId) => {
      setTerminalIdState(nextTerminalId)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadTerminals() {
      try {
        const params = new URLSearchParams()
        if (locationId) params.set("locationId", locationId)

        const res = await fetch(`${API}/api/v1/meta/terminals${params.toString() ? `?${params.toString()}` : ""}`, {
          headers: authHeaders(),
        })
        const data = await res.json().catch(() => ({}))
        const items = Array.isArray(data?.terminals) ? data.terminals : []

        if (cancelled) return

        const normalized = items.map((item: any) => ({
          id: String(item.id || ""),
          label: String(item.label || item.deviceId || "POS"),
          deviceId: String(item.deviceId || ""),
          locationId: item.locationId ? String(item.locationId) : undefined,
          locationName: item.location?.name ? String(item.location.name) : undefined,
          locationCode: item.location?.code ? String(item.location.code) : undefined,
        }))

        setTerminals(normalized)

        if (terminalId && !normalized.some((item: { id: string }) => item.id === terminalId)) {
          setTerminalIdState("")
          setActiveTerminalId("")
        }
      } catch {
        if (!cancelled) {
          setTerminals([])
        }
      }
    }

    void loadTerminals()

    return () => {
      cancelled = true
    }
  }, [locationId, terminalId])

  useEffect(() => {
    setNotificationsOpen(false)
  }, [location.pathname])

  const selectedLocationLabel = useMemo(() => {
    const selected = locations.find((item) => item.id === locationId)
    if (!selected) return "Toate locatiile"
    return selected.code ? `${selected.name} (${selected.code})` : selected.name
  }, [locationId, locations])

  const selectedTerminalLabel = useMemo(() => {
    const selected = terminals.find((item) => item.id === terminalId)
    if (!selected) return "Toate device-urile"
    return selected.deviceId ? `${selected.label} (${selected.deviceId})` : selected.label
  }, [terminalId, terminals])

  function handleLocationChange(nextLocationId: string) {
    setLocationIdState(nextLocationId)
    setActiveLocationId(nextLocationId)
    setTerminalIdState("")
    setActiveTerminalId("")
  }

  function handleTerminalChange(nextTerminalId: string) {
    const normalized = String(nextTerminalId || "")
    setTerminalIdState(normalized)
    setActiveTerminalId(normalized)

    if (!normalized) return

    const selectedTerminal = terminals.find((item) => item.id === normalized)
    if (!selectedTerminal?.locationId || selectedTerminal.locationId === locationId) return

    setLocationIdState(selectedTerminal.locationId)
    setActiveLocationId(selectedTerminal.locationId)
  }

  function handleIesire() {
    logout()
    navigate("/login")
  }

  async function handleCompanyChange(nextCompanyId: string) {
    if (!nextCompanyId || nextCompanyId === activeCompanyId) return

    try {
      setSwitchingCompany(true)
      await selectCompany(nextCompanyId)
      const profile = await me()
      const companies = Array.isArray((profile as any)?.companies) ? (profile as any).companies : []
      const nextActiveCompany =
        companies.find((item: any) => String(item?.id || "") === nextCompanyId) ||
        companies.find((item: any) => item?.isDefault) ||
        companies[0] ||
        null

      setCompanyChoices(companies)
      setActiveCompanyId(nextActiveCompany?.id || "")
      setCompanyLabel(nextActiveCompany?.name || "Firma activa")
      window.location.reload()
    } finally {
      setSwitchingCompany(false)
    }
  }

  function updateDashboardRange(next: { dateFrom?: string; dateTo?: string; reset?: boolean }) {
    const nextParams = new URLSearchParams(searchParams)
    if (next.reset) {
      nextParams.set("dateFrom", defaultDateFrom)
      nextParams.set("dateTo", defaultDateTo)
    } else {
      if (typeof next.dateFrom === "string") nextParams.set("dateFrom", next.dateFrom)
      if (typeof next.dateTo === "string") nextParams.set("dateTo", next.dateTo)
    }
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="px-3 py-2.5 md:px-3.5 md:py-2 xl:px-3.5">
        <div className="flex items-center gap-2.5 md:hidden">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-[#17324D] xl:hidden"
          >
            <Menu size={18} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[#17324D]">{userLabel}</div>
            <div className="truncate text-[11px] text-slate-500">{companyLabel}</div>
          </div>

          <button
            type="button"
            onClick={handleIesire}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
            aria-label="Iesire"
          >
            <LogOut size={16} />
          </button>
        </div>

        <div className="mt-2 md:hidden">
          {companyChoices.length > 1 ? (
            <div className="mb-2 flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
              <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
                <Building2 size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                  Firma
                </div>
                <select
                  value={activeCompanyId}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  disabled={switchingCompany}
                  className="h-8 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                  title={companyLabel}
                >
                  {companyChoices.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.code ? `${company.name} (${company.code})` : company.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
              <MapPin size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                Locatie
              </div>
              <select
                value={locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="h-8 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                title={selectedLocationLabel}
              >
                <option value="">Toate locatiile</option>
                {locations.map((locationItem) => (
                  <option key={locationItem.id} value={locationItem.id}>
                    {locationItem.code ? `${locationItem.name} (${locationItem.code})` : locationItem.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showSalesFilters ? (
            <div className="mt-2 flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                  Device
                </div>
                <select
                  value={terminalId}
                  onChange={(e) => handleTerminalChange(e.target.value)}
                  className="h-8 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                  title={selectedTerminalLabel}
                >
                  <option value="">Toate device-urile</option>
                  {terminals.map((terminalItem) => (
                    <option key={terminalItem.id} value={terminalItem.id}>
                      {terminalItem.deviceId ? `${terminalItem.label} (${terminalItem.deviceId})` : terminalItem.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-2 hidden items-center justify-between gap-3 md:flex">
          <div className="flex items-center gap-3">
            {companyChoices.length > 1 ? (
              <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
                <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
                  <Building2 size={16} />
                </div>
                <div className="min-w-[220px]">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                    Firma
                  </div>
                  <select
                    value={activeCompanyId}
                    onChange={(e) => handleCompanyChange(e.target.value)}
                    disabled={switchingCompany}
                    className="h-7 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                    title={companyLabel}
                  >
                    {companyChoices.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.code ? `${company.name} (${company.code})` : company.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
              <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
                <MapPin size={16} />
              </div>
              <div className="min-w-[190px]">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                  Locatie
                </div>
                <select
                  value={locationId}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  className="h-7 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                  title={selectedLocationLabel}
                >
                  <option value="">Toate locatiile</option>
                  {locations.map((locationItem) => (
                    <option key={locationItem.id} value={locationItem.id}>
                      {locationItem.code ? `${locationItem.name} (${locationItem.code})` : locationItem.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {showSalesFilters ? (
              <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
                <div className="min-w-[230px]">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                    Device
                  </div>
                  <select
                    value={terminalId}
                    onChange={(e) => handleTerminalChange(e.target.value)}
                    className="h-7 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                    title={selectedTerminalLabel}
                  >
                    <option value="">Toate device-urile</option>
                    {terminals.map((terminalItem) => (
                      <option key={terminalItem.id} value={terminalItem.id}>
                        {terminalItem.deviceId ? `${terminalItem.label} (${terminalItem.deviceId})` : terminalItem.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {isDashboard ? (
              <div className="flex items-end gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
                <div>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                    De la
                  </div>
                  <input
                    type="date"
                    value={dashboardDateFrom}
                    onChange={(e) => updateDashboardRange({ dateFrom: e.target.value })}
                    className="h-7 rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                  />
                </div>
                <div>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                    Pana la
                  </div>
                  <input
                    type="date"
                    value={dashboardDateTo}
                    onChange={(e) => updateDashboardRange({ dateTo: e.target.value })}
                    className="h-7 rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => updateDashboardRange({ reset: true })}
                  className="inline-flex h-7 items-center justify-center rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                >
                  Reset
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-[#6C7A89] shadow-sm transition hover:text-[#17324D]"
              >
                <Bell size={18} />
              </button>

              {notificationsOpen ? (
                <div className="absolute right-0 top-12 z-40 w-[320px] rounded-[16px] border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="mb-2 text-sm font-semibold text-[#17324D]">Notificari</div>
                  <div className="space-y-2">
                    {notifications.map((item) => (
                      <div key={item.id} className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">{item.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex min-w-[190px] items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
              <img src="/gufo-mark.svg?v=20260417-3" alt="Gufo" className="h-10 w-10 object-contain" />
              <div className="min-w-0 text-sm">
                <div className="truncate font-semibold text-[#17324D]">{userLabel}</div>
                <div className="truncate text-xs uppercase text-slate-500">{companyLabel} • {userMeta}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleIesire}
              className="inline-flex h-9 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              <LogOut size={16} className="mr-2" />
              Iesire
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}



