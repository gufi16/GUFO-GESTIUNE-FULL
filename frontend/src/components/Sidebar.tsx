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
          "group relative flex min-h-[36px] items-center gap-2 overflow-hidden rounded-[12px] px-2.5 py-2 text-[13px] font-medium transition-all duration-150",
          isActive
            ? "bg-[#17324D] text-white shadow-[0_14px_28px_rgba(23,50,77,0.18)]"
            : "text-slate-600 hover:bg-white hover:text-[#17324D] hover:shadow-sm"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] transition",
              isActive ? "bg-white/12 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-[#EEF4FB] group-hover:text-[#17324D]"
            )}
          >
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {isActive ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#47C2B1]" /> : null}
        </>
      )}
    </NavLink>
  )
}

function BrandBlock({ mobile = false, totalItems }: { mobile?: boolean; totalItems: number }) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[20px] border border-[#D7E4F0] bg-[radial-gradient(circle_at_top_left,_rgba(71,194,177,0.18),_transparent_42%),linear-gradient(180deg,#F9FBFD_0%,#F2F7FB_100%)] shadow-[0_18px_40px_rgba(15,23,42,0.06)]",
        mobile ? "p-3.5" : "p-4"
      )}
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]">
          <img
            src="/gufo-logo.png?v=20260417-6"
            alt="Gufo"
            className={clsx(
              "shrink-0 object-contain drop-shadow-[0_10px_18px_rgba(30,157,176,0.18)]",
              mobile ? "h-9 w-9" : "h-10 w-10"
            )}
          />
        </div>
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          Gufo Backoffice
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-[12px] border border-white/70 bg-white/80 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Module</div>
          <div className="mt-1 text-sm font-semibold text-[#17324D]">{totalItems}</div>
        </div>
        <div className="rounded-[12px] border border-white/70 bg-white/80 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Status</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <Circle size={7} fill="currentColor" />
            Live
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
  const totalItems = visibleSections.reduce((acc, section) => acc + section.items.length, 0)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F4F7FB]">
      <div className="px-3 pb-3 pt-3">
        {mobile ? (
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-500 shadow-sm"
              aria-label="Inchide meniul"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : null}

        <BrandBlock mobile={mobile} totalItems={totalItems} />
      </div>

      <div className="min-h-0 flex-1 px-3 pb-2">
        <div className="h-full overflow-y-auto rounded-[20px] border border-slate-200/80 bg-white px-3 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="space-y-3">
            {visibleSections.map((section) => (
              <section key={section.title} className="rounded-[16px] border border-slate-100 bg-slate-50/70 px-2.5 py-2.5">
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {section.title}
                  </div>
                  <div className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400 shadow-sm">
                    {section.items.length}
                  </div>
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
      </div>

      <div className="px-3 pb-3 pt-1">
        <div className="flex items-center justify-between rounded-[16px] border border-emerald-100 bg-[linear-gradient(180deg,#F1FBF8_0%,#E8F8F3_100%)] px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-800">
            Versiunea: {APP_VERSION}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-700">
            <Circle size={8} fill="currentColor" />
            Activ
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

      <aside className="hidden xl:block xl:w-[252px] xl:shrink-0">
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-[252px] border-r border-slate-200 bg-[#F4F7FB] xl:flex">
          <SidebarContent visibleSections={visibleSections} />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[86vw] max-w-[312px] bg-[#F4F7FB] shadow-2xl transition-transform duration-200 xl:hidden",
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
