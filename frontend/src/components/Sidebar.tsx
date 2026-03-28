import { NavLink } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Building2,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Settings,
  Sparkles,
  Warehouse,
} from "lucide-react"
import { hasModule } from "../lib/modules"

type SidebarItem = {
  to: string
  label: string
  icon: any
  module?: string
}

type SidebarSection = {
  title: string
  items: SidebarItem[]
}

const sections: SidebarSection[] = [
  {
    title: "General",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" }],
  },
  {
    title: "Operatiuni",
    items: [{ to: "/inregistrare-document", label: "Inregistrare documente", icon: FilePlus2, module: "documents" }],
  },
  {
    title: "Gestiune",
    items: [
      { to: "/gestiune", label: "Gestiune", icon: Warehouse, module: "inventory" },
      { to: "/documente", label: "Documente", icon: FileText, module: "documents" },
      { to: "/rapoarte", label: "Rapoarte", icon: BarChart3, module: "reports" },
    ],
  },
  {
    title: "Nomenclator",
    items: [
      { to: "/nomenclator", label: "Nomenclator", icon: BookOpen, module: "nomenclature" },
      { to: "/nomenclator/clienti", label: "Clienti", icon: Building2, module: "nomenclature" },
    ],
  },
  {
    title: "Configurare",
    items: [{ to: "/setari", label: "Setari", icon: Settings, module: "settings" }],
  },
]

function SidebarLink({ item }: { item: SidebarItem }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-2.5 overflow-hidden rounded-[18px] px-2.5 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[#17324D] text-white shadow-[0_10px_30px_rgba(23,50,77,0.18)]"
            : "text-slate-600 hover:bg-slate-100 hover:text-[#17324D]"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
              isActive ? "bg-white/10 text-white" : "bg-slate-100 text-[#6C7A89] group-hover:bg-white group-hover:text-[#244A7C]"
            )}
          >
            <Icon size={18} />
          </span>

          <span className="flex-1 truncate">{item.label}</span>

          {isActive ? <span className="absolute inset-y-2 left-1 w-1 rounded-full bg-white/80" /> : null}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.module || hasModule(item.module)),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <aside className="hidden xl:block xl:w-64 xl:shrink-0">
      <div className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-slate-200/80 bg-white/95 backdrop-blur xl:flex">
        <div className="flex h-full w-full flex-col overflow-hidden">
          <div className="border-b border-slate-200/80 px-4 pb-3 pt-4">
            <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/[0.03]">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-[#17324D] text-sm font-bold text-white shadow-sm">
                  GF
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold tracking-tight text-[#17324D]">GuFo Gestiune</div>
                  <div className="mt-1 text-xs leading-4.5 text-slate-500">
                    gestiune moderna pentru retail, horeca si depozit
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      <Sparkles size={12} />
                      UI nou
                    </span>
                    <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      GUFO ERP
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-5">
              {visibleSections.map((section) => (
                <section key={section.title}>
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {section.title}
                  </div>

                  <div className="space-y-1.5">
                    {section.items.map((item) => (
                      <SidebarLink key={`${section.title}-${item.label}`} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200/80 px-4 py-3">
            <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-[#17324D] text-sm font-bold text-white">
                  DT
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[#17324D]">Tenant activ</div>
                  <div className="mt-1 truncate text-xs text-slate-500">cont conectat</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
