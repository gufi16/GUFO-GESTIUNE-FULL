import { NavLink } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  ChevronLeft,
  Circle,
  Factory,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Inbox,
  LayoutDashboard,
  Receipt,
  Settings,
  Truck,
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
      { to: "/gestiune/stoc", label: "Stoc", icon: Warehouse, module: "inventory" },
      { to: "/gestiune/gestiuni", label: "Gestiuni", icon: Building2, module: "inventory" },
      { to: "/gestiune/productie", label: "Productie", icon: Factory, module: "inventory" },
      { to: "/documente", label: "Documente", icon: FileText, module: "documents" },
    ],
  },
  {
    title: "SPV si ANAF",
    items: [
      { to: "/documente/facturi-primite-spv", label: "Facturi primite SPV", icon: Inbox, module: "documents" },
      { to: "/e-transport", label: "Registru e-Transport", icon: Truck, module: "documents" },
    ],
  },
  {
    title: "Rapoarte",
    items: [
      { to: "/rapoarte", label: "Rapoarte", icon: BarChart3, module: "reports" },
      { to: "/rapoarte/export-contabilitate", label: "Export contabilitate", icon: FileSpreadsheet, module: "reports" },
    ],
  },
  {
    title: "Financiar",
    items: [
      { to: "/financiar/vanzari-bon", label: "Vanzari / Bon", icon: Receipt },
      { to: "/financiar/inchideri-zilnice", label: "Inchideri zilnice", icon: CalendarCheck },
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
          "group relative flex min-h-[42px] items-center gap-2.5 overflow-hidden rounded-[8px] px-2.5 py-2 text-sm font-medium transition",
          isActive
            ? "border border-[#17324D] bg-[#17324D] text-white shadow-sm shadow-[#17324D]/20"
            : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-[#17324D]"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition",
              isActive ? "bg-white/12 text-white" : "bg-slate-100 text-[#6C7A89] group-hover:bg-white group-hover:text-[#244A7C]"
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

function BrandBlock({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]",
        mobile ? "p-3" : "p-3.5"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#EEF4FB]">
          <img
            src="/gufo-logo.png?v=20260417-6"
            alt="Gufo"
            className={clsx(
              "shrink-0 object-contain drop-shadow-[0_8px_16px_rgba(30,157,176,0.14)]",
              mobile ? "h-8 w-8" : "h-9 w-9"
            )}
          />
        </div>
        <div className="min-w-0">
          <span
            className={clsx(
              "block font-black leading-none tracking-[-0.04em] text-[#17324D]",
              mobile ? "text-[1.65rem]" : "text-[1.85rem]"
            )}
          >
            Gufo
          </span>
          <div className="mt-1 truncate text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            ERP operational
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarContent({
  visibleSections,
  onNavigate,
  mobile = false,
  onCloseMobile,
}: {
  visibleSections: SidebarSection[]
  onNavigate?: () => void
  mobile?: boolean
  onCloseMobile?: () => void
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className="border-b border-slate-200 px-3 pb-3 pt-3">
        {mobile ? (
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-500"
              aria-label="Inchide meniul"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : null}

        <BrandBlock mobile={mobile} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-4">
          {visibleSections.map((section) => (
            <section key={section.title}>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {section.title}
                </div>
                <div className="text-[10px] font-semibold text-slate-300">{section.items.length}</div>
              </div>

              <div className="space-y-1">
                {section.items.map((item) => (
                  <div key={`${section.title}-${item.label}`} onClick={onNavigate}>
                    <SidebarLink item={item} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200 px-3 py-3">
        <div className="rounded-[8px] border border-emerald-100 bg-emerald-50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
            <Circle size={8} fill="currentColor" />
            Sistem activ
          </div>
          <div className="mt-1 text-[11px] leading-4 text-emerald-700">
            Datele se actualizeaza automat in zonele live.
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Sidebar({
  mobileOpen = false,
  onCloseMobile,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}) {
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.module || hasModule(item.module)),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px] xl:hidden"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside className="hidden xl:block xl:w-[268px] xl:shrink-0">
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-[268px] border-r border-slate-200 bg-white xl:flex">
          <SidebarContent visibleSections={visibleSections} />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[86vw] max-w-[310px] border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 xl:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent
          visibleSections={visibleSections}
          mobile
          onCloseMobile={onCloseMobile}
          onNavigate={onCloseMobile}
        />
      </div>
    </>
  )
}
