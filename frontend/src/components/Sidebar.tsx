import { NavLink } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  ChevronLeft,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Inbox,
  LayoutDashboard,
  Receipt,
  Settings,
  Store,
  Truck,
  Warehouse,
} from "lucide-react"
import { hasModule } from "../lib/modules"

const APP_VERSION = "V1.1"

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
      { to: "/gestiune/productie", label: "Productie", icon: Receipt, module: "inventory" },
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
    items: [
      { to: "/setari", label: "Setari", icon: Settings, module: "settings" },
      { to: "/setari/marketplace", label: "Marketplace", icon: Store, module: "settings" },
    ],
  },
]

function SidebarLink({ item }: { item: SidebarItem }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-2.5 overflow-hidden rounded-[16px] px-2.5 py-2.5 text-sm font-medium transition-all duration-200",
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

          <span
            className={clsx(
              "h-2 w-2 shrink-0 rounded-full transition-all duration-200",
              isActive ? "bg-[#6EE7D7]" : "bg-slate-200 opacity-0 group-hover:opacity-100"
            )}
          />

          {isActive ? <span className="absolute inset-y-2 left-1 w-1 rounded-full bg-white/80" /> : null}
        </>
      )}
    </NavLink>
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#FFFFFF_0%,#FBFDFF_100%)]">
      <div className="border-b border-slate-200/80 px-4 pb-3 pt-4">
        {mobile ? (
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Meniu ERP</div>
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
              aria-label="Inchide meniul"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : null}

        <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(255,255,255,1)_100%)] p-4 shadow-sm shadow-slate-900/[0.04]">
          <div className="flex flex-col items-center text-center">
            <img
              src="/gufo-logo.png?v=20260417-6"
              alt="Gufo"
              className={clsx(
                "object-contain drop-shadow-[0_8px_16px_rgba(30,157,176,0.14)]",
                mobile ? "h-11 w-11" : "h-12 w-12"
              )}
            />
            <div className="mt-2 text-sm font-semibold tracking-[0.01em] text-[#17324D]">Gufo Backoffice</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {visibleSections.map((section) => (
            <section key={section.title}>
              <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                {section.title}
              </div>

              <div className="space-y-1 rounded-[18px] border border-slate-100 bg-slate-50/65 p-1.5">
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

      <div className="border-t border-slate-200/80 px-4 py-3">
        <div className="flex items-center justify-between rounded-[14px] border border-slate-200 bg-[linear-gradient(180deg,#F8FAFC_0%,#F1F5F9_100%)] px-3 py-2.5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            Versiunea: {APP_VERSION}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Activ</div>
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

      <aside className="hidden xl:block xl:w-64 xl:shrink-0">
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-slate-200/80 bg-white/95 backdrop-blur xl:flex">
          <SidebarContent visibleSections={visibleSections} />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[86vw] max-w-[300px] border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 xl:hidden",
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
