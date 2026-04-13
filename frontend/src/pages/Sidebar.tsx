import { useMemo, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Factory,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Receipt,
  Settings,
  Sparkles,
  Warehouse,
  ArrowLeftRight,
  BarChart3,
  FileSpreadsheet,
  ScrollText,
} from "lucide-react"
import clsx from "clsx"

type SidebarItem = {
  to?: string
  label: string
  icon: any
  disabled?: boolean
  badge?: string
}

type SidebarSection = {
  title: string
  items: SidebarItem[]
  collapsible?: boolean
  icon?: any
}

const sections: SidebarSection[] = [
  {
    title: "General",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Operațiuni",
    collapsible: true,
    icon: FilePlus2,
    items: [
      { to: "/inregistrare-document", label: "Înregistrare documente", icon: FilePlus2 },
      { label: "Factură", icon: ScrollText, disabled: true, badge: "în curând" },
      { to: "/inregistrare-document/nir/new", label: "Notă de recepție", icon: Receipt },
      { to: "/gestiune/inventare", label: "Inventar", icon: ClipboardList },
    ],
  },
  {
    title: "Gestiune",
    collapsible: true,
    icon: Warehouse,
    items: [
      { to: "/gestiune/stoc", label: "Stoc", icon: Warehouse },
      { to: "/transfer", label: "Transfer între gestiuni", icon: ArrowLeftRight },
      { to: "/gestiune/productie", label: "Producție", icon: Factory },
      { to: "/documente", label: "Documente", icon: FileText },
      { to: "/rapoarte", label: "Rapoarte", icon: BarChart3 },
      { to: "/rapoarte/export-contabilitate", label: "Export contabilitate", icon: FileSpreadsheet },
    ],
  },
  {
    title: "Nomenclator",
    items: [{ to: "/nomenclator", label: "Nomenclator", icon: BookOpen }],
  },
  {
    title: "Configurare",
    items: [{ to: "/setari", label: "Setări", icon: Settings }],
  },
]

function SidebarLink({ item, nested = false }: { item: SidebarItem; nested?: boolean }) {
  const Icon = item.icon

  if (item.disabled || !item.to) {
    return (
      <div
        className={clsx(
          "group relative flex items-center gap-3 overflow-hidden border border-dashed border-slate-200 bg-slate-50/90 px-3 py-3 text-sm font-medium text-slate-400",
          nested ? "rounded-xl" : "rounded-2xl"
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
          <Icon size={18} />
        </span>

        <span className="flex-1 truncate">{item.label}</span>

        {item.badge ? (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {item.badge}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-3 overflow-hidden px-3 py-3 text-sm font-medium transition-all duration-200",
          nested ? "rounded-xl" : "rounded-2xl",
          isActive
            ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.16)]"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
              isActive ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white"
            )}
          >
            <Icon size={18} />
          </span>

          <span className="flex-1 truncate">{item.label}</span>

          <ChevronRight
            size={16}
            className={clsx(
              "transition-all duration-200",
              isActive
                ? "translate-x-0 text-white/80"
                : "translate-x-1 opacity-0 text-slate-400 group-hover:translate-x-0 group-hover:opacity-100"
            )}
          />

          {isActive ? <span className="absolute inset-y-2 left-1 w-1 rounded-full bg-white/80" /> : null}
        </>
      )}
    </NavLink>
  )
}

function SidebarAccordion({ title, icon: Icon, items }: { title: string; icon: any; items: SidebarItem[] }) {
  const location = useLocation()
  const hasActiveChild = useMemo(
    () => items.some((item) => item.to && location.pathname.startsWith(item.to)),
    [items, location.pathname]
  )
  const [open, setOpen] = useState(hasActiveChild)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-left text-sm font-medium transition-all duration-200",
          hasActiveChild
            ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.16)]"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )}
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
            hasActiveChild ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white"
          )}
        >
          <Icon size={18} />
        </span>

        <span className="flex-1 truncate">{title}</span>

        <span
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
            hasActiveChild ? "bg-white/10 text-white/80" : "bg-white text-slate-400"
          )}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        {hasActiveChild ? <span className="absolute inset-y-2 left-1 w-1 rounded-full bg-white/80" /> : null}
      </button>

      <div
        className={clsx(
          "grid overflow-hidden transition-all duration-300",
          open ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-70"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-4 space-y-2 border-l border-slate-200 pl-3 pt-1">
            {items.map((item) => (
              <SidebarLink key={`${title}-${item.label}`} item={item} nested />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="hidden xl:block xl:w-72 xl:shrink-0">
      <div className="fixed left-0 top-0 z-40 hidden h-screen w-72 border-r border-slate-200/80 bg-white/95 backdrop-blur xl:flex">
        <div className="flex h-full w-full flex-col overflow-hidden">
          <div className="border-b border-slate-200/80 px-5 pb-4 pt-5">
            <div className="rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white shadow-sm">
                  GF
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold tracking-tight text-slate-900">
                    GuFo GesTiuNe
                  </div>

                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    gestiune modernă pentru retail, horeca și depozit
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                      <Sparkles size={12} />
                      UI nou
                    </span>

                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      GUFO ERP
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-4 py-5">
            <div className="space-y-6">
              {sections.map((section) => (
                <div key={section.title}>
                  <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {section.title}
                  </div>

                  {section.collapsible && section.icon ? (
                    <SidebarAccordion title={section.title} icon={section.icon} items={section.items} />
                  ) : (
                    <div className="space-y-1.5">
                      {section.items.map((item) => (
                        <SidebarLink key={`${section.title}-${item.label}`} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </nav>

          <div className="border-t border-slate-200/80 p-4">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold text-white">
                  DT
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="truncate">Tenant activ</span>
                  </div>
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
