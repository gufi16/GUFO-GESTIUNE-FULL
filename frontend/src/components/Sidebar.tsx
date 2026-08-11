import { useEffect, useMemo, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Inbox,
  LayoutDashboard,
  Package2,
  Receipt,
  Ruler,
  Settings,
  Store,
  Truck,
  UtensilsCrossed,
  Warehouse,
} from "lucide-react"
import { hasModule } from "../lib/modules"

const APP_VERSION = "V1.1"

type SidebarItem = {
  to?: string
  label: string
  icon: any
  module?: string
}

type SidebarSection = {
  title: string
  icon?: any
  collapsible?: boolean
  items: SidebarItem[]
}

const sections: SidebarSection[] = [
  {
    title: "Dashboard",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" }],
  },
  {
    title: "Operatiuni",
    icon: FilePlus2,
    collapsible: true,
    items: [
      { to: "/inregistrare-document", label: "Inregistrare documente", icon: FilePlus2, module: "documents" },
      { to: "/documente", label: "Documente", icon: FileText, module: "documents" },
    ],
  },
  {
    title: "Stoc si productie",
    icon: Warehouse,
    collapsible: true,
    items: [
      { to: "/gestiune/stoc", label: "Stoc", icon: Warehouse, module: "inventory" },
      { to: "/gestiune/gestiuni", label: "Gestiuni", icon: Building2, module: "inventory" },
      { to: "/gestiune/productie", label: "Productie", icon: Receipt, module: "inventory" },
    ],
  },
  {
    title: "ANAF si SPV",
    icon: Truck,
    collapsible: true,
    items: [
      { to: "/documente/facturi-primite-spv", label: "Facturi primite SPV", icon: Inbox, module: "documents" },
      { to: "/e-transport", label: "Registru e-Transport", icon: Truck, module: "documents" },
    ],
  },
  {
    title: "Rapoarte",
    icon: BarChart3,
    collapsible: true,
    items: [
      { to: "/rapoarte", label: "Rapoarte", icon: BarChart3, module: "reports" },
      { to: "/rapoarte/export-contabilitate", label: "Export contabilitate", icon: FileSpreadsheet, module: "reports" },
    ],
  },
  {
    title: "Financiar",
    icon: CalendarCheck,
    collapsible: true,
    items: [
      { to: "/financiar/vanzari-bon", label: "Vanzari / Bon", icon: Receipt },
      { to: "/financiar/inchideri-zilnice", label: "Inchideri zilnice", icon: CalendarCheck },
    ],
  },
  {
    title: "Nomenclator",
    icon: BookOpen,
    collapsible: true,
    items: [
      { to: "/nomenclator/produse", label: "Produse", icon: Package2, module: "nomenclature" },
      { to: "/nomenclator/categorii", label: "Categorii", icon: FolderTree, module: "nomenclature" },
      { to: "/nomenclator/subcategorii", label: "Subcategorii", icon: FolderTree, module: "nomenclature" },
      { to: "/nomenclator/departamente", label: "Departamente", icon: BookOpen, module: "nomenclature" },
      { to: "/nomenclator/uom", label: "Unitati masura", icon: Ruler, module: "nomenclature" },
      { to: "/nomenclator/materii-prime", label: "Materii prime", icon: Boxes, module: "nomenclature" },
      { to: "/nomenclator/semifabricate", label: "Semifabricate", icon: Boxes, module: "nomenclature" },
      { to: "/nomenclator/meniuri", label: "Meniuri", icon: UtensilsCrossed, module: "nomenclature" },
      { to: "/nomenclator/furnizori", label: "Furnizori", icon: Building2, module: "nomenclature" },
      { to: "/nomenclator/clienti", label: "Clienti", icon: Building2, module: "nomenclature" },
    ],
  },
  {
    title: "Setari",
    icon: Settings,
    collapsible: true,
    items: [
      { to: "/setari", label: "Setari", icon: Settings, module: "settings" },
      { to: "/setari/gufo-ai", label: "Gufo AI", icon: Store, module: "settings" },
      { to: "/setari/marketplace", label: "Marketplace", icon: Store, module: "settings" },
    ],
  },
]

function SidebarLink({ item, nested = false, onNavigate }: { item: SidebarItem; nested?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon

  if (!item.to) return null

  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-200",
          nested ? "rounded-lg" : "rounded-xl",
          isActive
            ? "bg-[#EEF4FB] font-semibold text-[#17324D]"
            : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
              isActive ? "bg-white text-[#17324D]" : "bg-slate-100 text-slate-500 group-hover:bg-white"
            )}
          >
            <Icon size={16} />
          </span>

          <span className="flex-1 truncate">{item.label}</span>

          <ChevronRight
            size={14}
            className={clsx(
              "transition-all duration-200",
              isActive ? "translate-x-0 text-[#17324D]/70" : "translate-x-1 opacity-0 text-slate-400 group-hover:translate-x-0 group-hover:opacity-100"
            )}
          />

          {isActive ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#17324D]" /> : null}
        </>
      )}
    </NavLink>
  )
}

function SidebarAccordion({
  title,
  icon: Icon,
  items,
  flyout = false,
  forceOpen,
  onToggle,
  onNavigate,
}: {
  title: string
  icon: any
  items: SidebarItem[]
  flyout?: boolean
  forceOpen?: boolean
  onToggle?: () => void
  onNavigate?: () => void
}) {
  const location = useLocation()
  const hasActiveChild = useMemo(
    () => items.some((item) => item.to && location.pathname.startsWith(item.to)),
    [items, location.pathname]
  )
  const [open, setOpen] = useState(hasActiveChild)

  useEffect(() => {
    if (hasActiveChild) setOpen(true)
  }, [hasActiveChild])

  const isOpen = flyout ? !!forceOpen : open

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (flyout) {
            onToggle?.()
            return
          }
          setOpen((value) => !value)
        }}
        className={clsx(
          "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200",
          hasActiveChild
            ? "bg-[#EEF4FB] font-semibold text-[#17324D]"
            : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )}
      >
        <span
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
            hasActiveChild ? "bg-white text-[#17324D]" : "bg-slate-100 text-slate-500 group-hover:bg-white"
          )}
        >
          <Icon size={16} />
        </span>

        <span className="flex-1 truncate">{title}</span>

        <span
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200",
            hasActiveChild ? "bg-white text-[#17324D]/75" : "text-slate-400"
          )}
        >
          {flyout ? <ChevronRight size={15} className={clsx(isOpen ? "text-[#17324D]" : "")} /> : isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>

        {hasActiveChild ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#17324D]" /> : null}
      </button>

      {flyout ? (
        null
      ) : (
        <div
          className={clsx(
            "grid overflow-hidden transition-all duration-300",
            isOpen ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-80"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
              {items.map((item) => (
                <SidebarLink key={`${title}-${item.label}`} item={item} nested onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarContent({
  visibleSections,
  activeDesktopSection,
  onActiveDesktopSectionChange,
  mobile = false,
  onCloseMobile,
}: {
  visibleSections: SidebarSection[]
  activeDesktopSection?: string | null
  onActiveDesktopSectionChange?: (section: string | null) => void
  mobile?: boolean
  onCloseMobile?: () => void
}) {
  const activeDesktopItems =
    !mobile && activeDesktopSection
      ? visibleSections.find((section) => section.title === activeDesktopSection)?.items || []
      : []

  return (
    <div className={clsx("flex h-full w-full bg-white", mobile ? "overflow-hidden" : "overflow-visible")}>
      <div className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white">
        <div className="border-b border-slate-200/80 px-5 pb-5 pt-5">
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

          <div className="flex flex-col items-center text-center">
            <img
              src="/gufo-logo.png?v=20260417-6"
              alt="Gufo"
              className={clsx("object-contain", mobile ? "h-10 w-10" : "h-11 w-11")}
            />
            <div className="mt-2 text-sm font-semibold tracking-[0.01em] text-[#17324D]">Gufo Backoffice</div>
          </div>
        </div>

        <div className={clsx("min-h-0 flex-1 px-3 py-4", mobile ? "overflow-y-auto" : "overflow-y-auto")}>
          <div className="space-y-4">
            {visibleSections.map((section) =>
              section.collapsible && section.icon ? (
                <div key={section.title}>
                  <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {section.title}
                  </div>
                  <SidebarAccordion
                    title={section.title}
                    icon={section.icon}
                    items={section.items}
                    flyout={!mobile}
                    forceOpen={!mobile && activeDesktopSection === section.title}
                    onToggle={
                      mobile
                        ? undefined
                        : () =>
                            onActiveDesktopSectionChange?.(
                              activeDesktopSection === section.title ? null : section.title
                            )
                    }
                    onNavigate={mobile ? onCloseMobile : undefined}
                  />
                </div>
              ) : (
                <div key={section.title}>
                  <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {section.title}
                  </div>
                  {section.items.map((item) => (
                    <SidebarLink
                      key={`${section.title}-${item.label}`}
                      item={item}
                      onNavigate={mobile ? onCloseMobile : undefined}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        <div className="border-t border-slate-200/80 px-5 py-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <div>Versiunea: {APP_VERSION}</div>
            <div className="text-emerald-700">Activ</div>
          </div>
        </div>
      </div>

      {!mobile && activeDesktopSection ? (
        <div className="hidden h-full w-72 shrink-0 border-r border-slate-200/80 bg-[#F8FAFC] xl:flex xl:flex-col">
          <div className="border-b border-slate-200/80 px-5 pb-4 pt-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Submeniu</div>
            <div className="mt-2 text-lg font-semibold text-[#17324D]">{activeDesktopSection}</div>
            <div className="mt-1 text-sm text-slate-500">Acces rapid la modulele din aceasta sectiune.</div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <div className="space-y-1">
              {activeDesktopItems.map((item) => (
                <SidebarLink
                  key={`${activeDesktopSection}-${item.label}`}
                  item={item}
                  nested
                  onNavigate={() => onActiveDesktopSectionChange?.(null)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
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
  const location = useLocation()
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.module || hasModule(item.module)),
    }))
    .filter((section) => section.items.length > 0)
  const [activeDesktopSection, setActiveDesktopSection] = useState<string | null>(null)

  useEffect(() => {
    setActiveDesktopSection(null)
  }, [location.pathname])

  useEffect(() => {
    if (!activeDesktopSection) return

    const activeSection = visibleSections.find((section) => section.title === activeDesktopSection)
    const stillInsideActiveSection = !!activeSection?.items.some(
      (item) => item.to && location.pathname.startsWith(item.to)
    )

    if (!stillInsideActiveSection) {
      setActiveDesktopSection(null)
    }
  }, [activeDesktopSection, location.pathname, visibleSections])

  const hasDesktopSecondary = !!activeDesktopSection

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px] xl:hidden" onClick={onCloseMobile} />
      ) : null}

      <aside className={clsx("hidden xl:block xl:shrink-0", hasDesktopSecondary ? "xl:w-[544px]" : "xl:w-64")}>
        <div
          className={clsx(
            "fixed left-0 top-0 z-40 hidden h-screen overflow-hidden border-r border-slate-200/80 bg-white/95 backdrop-blur xl:flex",
            hasDesktopSecondary ? "w-[544px]" : "w-64"
          )}
        >
          <SidebarContent
            visibleSections={visibleSections}
            activeDesktopSection={activeDesktopSection}
            onActiveDesktopSectionChange={setActiveDesktopSection}
          />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[86vw] max-w-[300px] border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 xl:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent visibleSections={visibleSections} mobile onCloseMobile={onCloseMobile} />
      </div>
    </>
  )
}
