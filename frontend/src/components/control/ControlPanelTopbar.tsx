import { Bell, LogOut, Menu, Search, ShieldCheck, Sparkles } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { controlLogout } from "../../lib/controlAuth"

export default function ControlPanelTopbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const navigate = useNavigate()

  function handleLogout() {
    controlLogout()
    navigate("/cp/login")
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="px-3 py-3 md:px-6 md:py-4 xl:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-[#17324D] xl:hidden"
          >
            <Menu size={18} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="relative w-full max-w-2xl">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Cauta client, licenta, CUI, email sau terminal POS..."
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-[#17324D] focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 md:hidden"
          >
            <LogOut size={16} className="mr-2" />
            Logout
          </button>
        </div>

        <div className="mt-3 hidden items-center gap-3 md:flex">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-800"
          >
            <Bell size={18} />
          </button>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#17324D] text-white">
              <ShieldCheck size={18} />
            </div>
            <div className="text-sm">
              <div className="font-semibold text-[#17324D]">Control Panel</div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Sparkles size={12} className="text-[#F39C12]" />
                control total pe clienti si module
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            <LogOut size={16} className="mr-2" />
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
