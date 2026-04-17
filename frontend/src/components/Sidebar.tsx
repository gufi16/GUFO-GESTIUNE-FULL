import { NavLink } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Building2,
  ChevronLeft,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Settings,
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
      { to: "/rapoarte/export-contabilitate", label: "Export contabilitate", icon: FileSpreadsheet, module: "reports" },
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

function BrandBlock({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[24px] border border-[#dbe8ea] bg-[linear-gradient(145deg,#ffffff_0%,#f5fbfb_55%,#eef7f8_100%)] shadow-[0_14px_36px_rgba(23,50,77,0.06)]",
        mobile ? "p-3" : "p-4"
      )}
    >
      <div className="flex flex-col items-center justify-center text-center">
        <div className={clsx("flex items-center justify-center", mobile ? "-space-x-1" : "-space-x-1.5")}>
          <img
            src="/gufo-logo.png?v=20260417-6"
            alt="Gufo"
            className={clsx(
              "shrink-0 object-contain drop-shadow-[0_8px_16px_rgba(30,157,176,0.14)]",
              mobile ? "h-12 w-12" : "h-14 w-14"
            )}
          />
          <span
            className={clsx(
              "font-black tracking-[-0.05em] text-[#17324D]",
              mobile ? "text-[2rem]" : "text-[2.25rem]"
            )}
          >
            ufo
          </span>
        </div>
        <div
          className={clsx(
            "mt-3 max-w-[220px] font-medium leading-5 text-slate-500",
            mobile ? "text-[11px]" : "text-xs"
          )}
        >
          A system behind every sound decision
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
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b border-slate-200/80 px-4 pb-3 pt-4">
        {mobile ? (
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : null}

        <BrandBlock mobile={mobile} />
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
