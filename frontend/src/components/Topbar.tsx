import { Bell, Search, Sparkles } from "lucide-react"

export default function Topbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-4 px-4 md:px-6 xl:px-8">
        <div className="flex-1">
          <div className="relative max-w-2xl">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Caută produse, documente, furnizori sau locații..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-800"
          >
            <Bell size={18} />
          </button>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white">
              <Sparkles size={18} />
            </div>
            <div className="text-sm">
              <div className="font-semibold text-slate-900">Admin</div>
              <div className="text-xs text-slate-500">demo@gufo.ro</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
