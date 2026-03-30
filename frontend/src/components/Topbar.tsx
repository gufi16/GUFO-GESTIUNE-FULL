import { Bell, LogOut, MapPin, Menu, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { API_BASE as API, authHeaders } from "../lib/api"
import { logout } from "../lib/auth"
import { getActiveLocationId, setActiveLocationId, subscribeToActiveLocation } from "../lib/location"

export default function Topbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const navigate = useNavigate()
  const [locations, setLocations] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [locationId, setLocationIdState] = useState(getActiveLocationId())

  useEffect(() => {
    let cancelled = false

    async function loadLocations() {
      try {
        const res = await fetch(`${API}/api/v1/meta/locations`, {
          headers: authHeaders(),
        })
        const data = await res.json().catch(() => ({}))
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
      } catch {
        if (!cancelled) {
          setLocations([])
        }
      }
    }

    loadLocations()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setLocationIdState(nextLocationId)
    })
  }, [])

  const selectedLocationLabel = useMemo(() => {
    const selected = locations.find((item) => item.id === locationId)
    if (!selected) return "Toate locatiile"
    return selected.code ? `${selected.name} (${selected.code})` : selected.name
  }, [locationId, locations])

  function handleLocationChange(nextLocationId: string) {
    setLocationIdState(nextLocationId)
    setActiveLocationId(nextLocationId)
  }

  function handleLogout() {
    logout()
    navigate("/login")
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="px-3 py-2.5 md:px-3.5 md:py-2 xl:px-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-[#17324D] xl:hidden"
          >
            <Menu size={18} />
          </button>

          <div className="hidden min-w-0 flex-1 md:block">
            <div className="relative w-full max-w-xl">
              <input
                placeholder="Cauta produse, documente, furnizori sau locatii..."
                className="h-9 w-full rounded-[12px] border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white focus:ring-2 focus:ring-[#DCE7F5]"
              />
            </div>
          </div>

          <div className="min-w-0 flex-1 md:hidden">
            <div className="truncate text-sm font-semibold text-[#17324D]">Gufo ERP</div>
            <div className="truncate text-[11px] text-slate-500">{selectedLocationLabel}</div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 md:hidden"
            aria-label="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>

        <div className="mt-2 md:hidden">
          <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
              <MapPin size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                Locatie activa
              </div>
              <select
                value={locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="h-8 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                title={selectedLocationLabel}
              >
                <option value="">Toate locatiile</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code ? `${location.name} (${location.code})` : location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-2 hidden items-center gap-3 md:flex">
          <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#EEF4FB] text-[#244A7C]">
              <MapPin size={16} />
            </div>
            <div className="min-w-[190px]">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6C7A89]">
                Locatie activa
              </div>
              <select
                value={locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="h-7 w-full rounded-[8px] border border-slate-200 bg-white px-2 text-sm text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white"
                title={selectedLocationLabel}
              >
                <option value="">Toate locatiile</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code ? `${location.name} (${location.code})` : location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-[#6C7A89] shadow-sm transition hover:text-[#17324D]"
          >
            <Bell size={18} />
          </button>

          <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#17324D] text-white">
              <Sparkles size={18} />
            </div>
            <div className="text-sm">
              <div className="font-semibold text-[#17324D]">Cont activ</div>
              <div className="text-xs text-slate-500">ERP</div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-9 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            <LogOut size={16} className="mr-2" />
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
