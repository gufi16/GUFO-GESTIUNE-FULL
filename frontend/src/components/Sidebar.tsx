import { NavLink } from "react-router-dom"
import {
  BookOpen,
  ChevronRight,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Package2,
  Receipt,
  Settings,
  Warehouse,
} from "lucide-react"
import clsx from "clsx"

const sections = [
  {
    title: "General",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Operațiuni",
    items: [
      { to: "/inregistrare-document", label: "Înregistrare document", icon: FilePlus2, accent: true },
      { to: "/inregistrare-document/nir", label: "Recepție NIR", icon: Receipt, accent: true },
    ],
  },
  {
    title: "Gestiune",
    items: [
      { to: "/gestiune", label: "Gestiune", icon: Warehouse },
      { to: "/documente", label: "Documente", icon: FileText },
    ],
  },
  {
    title: "Nomenclator",
    items: [
      { to: "/nomenclator", label: "Nomenclator", icon: BookOpen },
      { to: "/nomenclator/produse", label: "Produse", icon: Package2 },
    ],
  },
  {
    title: "Configurare",
    items: [{ to: "/setari", label: "Setări", icon: Settings }],
  },
]

export default function Sidebar() {
  return (
    <aside className="hidden h-screen w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white xl:flex">
      <div className="border-b border-slate-200/80 px-5 pb-5 pt-6">
        <div className="rounded-3xl border border-slate-200/80 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-sm">
              GF
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-slate-900">
                GuFo GesTiuNe
              </div>
              <div className="mt-1 text-xs text-slate-500">
                gestiune modernă pentru retail, horeca și depozit
              </div>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5">
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                {section.title}
              </div>

              <div className="space-y-1.5">
                {section.items.map((item) => {
                  const Icon = item.icon

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        clsx(
                          "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-all duration-200",
                          isActive
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                          item.accent && "border border-slate-200/70 bg-slate-50"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={clsx(
                              "flex h-10 w-10 items-center justify-center rounded-xl transition",
                              isActive
                                ? "bg-white/10 text-white"
                                : item.accent
                                  ? "bg-blue-50 text-blue-600"
                                  : "bg-slate-100 text-slate-500"
                            )}
                          >
                            <Icon size={18} />
                          </span>

                          <span className="flex-1">{item.label}</span>

                          <ChevronRight
                            size={16}
                            className={clsx(
                              "transition-all duration-200",
                              isActive
                                ? "translate-x-0 text-white/80"
                                : "translate-x-0 opacity-0 text-slate-400 group-hover:opacity-100"
                            )}
                          />
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="p-4">
        <div className="rounded-3xl border border-slate-200/80 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold text-white">
              DT
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Demo tenant</div>
              <div className="text-xs text-slate-500">demo-tenant • demo-location</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
