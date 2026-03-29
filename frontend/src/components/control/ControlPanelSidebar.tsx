import { NavLink } from "react-router-dom"
import clsx from "clsx"
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

const items = [
  { to: "/control-panel", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/control-panel/clienti", label: "Clienti", icon: Building2 },
  { to: "/control-panel/integrari", label: "Integrari", icon: PlugZap },
  { to: "/control-panel/licente", label: "Licente", icon: ShieldCheck, disabled: true },
  { to: "/control-panel/facturare", label: "Facturare", icon: CreditCard, disabled: true },
  { to: "/control-panel/audit", label: "Audit", icon: Activity, disabled: true },
]

function SidebarContent({
  mobile = false,
  onCloseMobile,
}: {
  mobile?: boolean
  onCloseMobile?: () => void
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-5 py-5">
      {mobile ? (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Meniu control</div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      ) : null}

      <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#17324D] text-base font-bold text-white">
            GC
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-[#17324D]">GUFO Control Panel</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#F39C12]/30 bg-[#FFF1D6] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#B56800]">
                <Sparkles size={11} />
                Owner
              </span>
            </div>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              centru de comanda pentru clienti, licente, integrari, activari POS si billing.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex-1 overflow-y-auto pr-1">
        <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Navigare
          </div>

          <div className="space-y-2">
            {items.map((item) => {
              const Icon = item.icon

              if (item.disabled) {
                return (
                  <div
                    key={item.to}
                    className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-400"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs text-slate-400">in curand</div>
                    </div>
                    <ChevronRight size={16} />
                  </div>
                )
              }

              return (
                <div key={item.to} onClick={onCloseMobile}>
                  <NavLink
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      clsx(
                        "group relative flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition-all duration-200",
                        isActive
                          ? "bg-[#17324D] text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-50 hover:text-[#17324D]"
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={clsx(
                            "flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
                            isActive ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white"
                          )}
                        >
                          <Icon size={18} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{item.label}</div>
                          <div className={clsx("text-xs", isActive ? "text-slate-300" : "text-slate-400")}>
                            {item.label === "Overview" ? "sinteza SaaS" : "gestionare centralizata"}
                          </div>
                        </div>

                        <ChevronRight size={16} className={clsx(isActive ? "text-white/70" : "text-slate-300")} />
                      </>
                    )}
                  </NavLink>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] border border-[#17324D]/10 bg-[#17324D] p-5 text-white shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">workspace</div>
        <div className="mt-3 text-lg font-semibold tracking-tight">GUFO Ecosystem</div>
        <p className="mt-2 text-sm leading-6 text-slate-200">
          un singur punct de control pentru website, Gestiune web si Android POS.
        </p>
      </div>
    </div>
  )
}

export default function ControlPanelSidebar({
  mobileOpen = false,
  onCloseMobile,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}) {
  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px] xl:hidden"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside className="hidden xl:block xl:w-80 xl:shrink-0">
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-80 border-r border-slate-200 bg-white xl:flex">
          <SidebarContent />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[90vw] max-w-[340px] border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 xl:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent mobile onCloseMobile={onCloseMobile} />
      </div>
    </>
  )
}
