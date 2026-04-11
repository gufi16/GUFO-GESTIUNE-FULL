import { useEffect, useMemo, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import clsx from "clsx"
import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Factory,
  FileBarChart2,
  FileInput,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderCog,
  LayoutDashboard,
  Package2,
  PackageSearch,
  ReceiptText,
  Ruler,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Store,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
  Warehouse,
} from "lucide-react"
import { hasModule } from "../lib/modules"

type SidebarItem = {
  to: string
  label: string
  icon?: any
  module?: string
}

type SidebarSection = {
  id: string
  title: string
  icon: any
  module?: string
  items: SidebarItem[]
}

const sections: SidebarSection[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    module: "dashboard",
    items: [
      { to: "/dashboard", label: "Dashboard live", icon: LayoutDashboard, module: "dashboard" },
    ],
  },
  {
    id: "administrare",
    title: "Administrare",
    icon: Building2,
    items: [
      { to: "/setari", label: "Panou setari", icon: Settings, module: "settings" },
      { to: "/setari/firma", label: "Date firma", icon: Building2, module: "settings" },
      { to: "/nomenclator/locatii", label: "Loca?ii", icon: Store, module: "nomenclature" },
      { to: "/setari/utilizatori", label: "Utilizatori", icon: Users, module: "settings" },
      { to: "/setari/numerotare", label: "Serii documente", icon: FileText, module: "settings" },
      { to: "/setari/efactura", label: "e-Factura", icon: FileSpreadsheet, module: "settings" },
    ],
  },
  {
    id: "nomenclatoare",
    title: "Nomenclatoare",
    icon: BookOpen,
    items: [
      { to: "/nomenclator", label: "Panou nomenclatoare", icon: BookOpen, module: "nomenclature" },
      { to: "/nomenclator/produse", label: "Produse", icon: Package2, module: "nomenclature" },
      { to: "/nomenclator/categorii", label: "Categorii produse", icon: FolderCog, module: "nomenclature" },
      { to: "/nomenclator/uom", label: "Unita?i de masura", icon: Ruler, module: "nomenclature" },
      { to: "/setari/tva", label: "Cote TVA", icon: ReceiptText, module: "settings" },
      { to: "/nomenclator/departamente", label: "Departamente", icon: Boxes, module: "nomenclature" },
    ],
  },
  {
    id: "parteneri",
    title: "Parteneri",
    icon: Users,
    items: [
      { to: "/nomenclator/clienti", label: "Clien?i", icon: Users, module: "nomenclature" },
      { to: "/nomenclator/furnizori", label: "Furnizori", icon: Building2, module: "nomenclature" },
      { to: "/nomenclator/locatii", label: "Loca?ii", icon: Store, module: "nomenclature" },
    ],
  },
  {
    id: "operatiuni",
    title: "Opera?iuni",
    icon: FilePlus2,
    items: [
      { to: "/inregistrare-document", label: "Înregistrare documente", icon: FilePlus2, module: "documents" },
      { to: "/documente", label: "Documente salvate", icon: FileText, module: "documents" },
      { to: "/inregistrare-document/nir", label: "Note de recep?ie", icon: ReceiptText, module: "documents" },
      { to: "/transfer", label: "Transfer între gestiuni", icon: Truck, module: "documents" },
      { to: "/inregistrare-document/bon-consum/new", label: "Bon de consum", icon: FileInput, module: "documents" },
      { to: "/inregistrare-document/factura/new", label: "Factura de ie?ire", icon: FileSpreadsheet, module: "documents" },
      { to: "/inregistrare-document/proces-verbal/deteriorare/new", label: "Proces verbal deteriorare", icon: ClipboardList, module: "documents" },
      { to: "/inregistrare-document/proces-verbal/pret/new", label: "Proces verbal schimbare pre?", icon: SlidersHorizontal, module: "documents" },
    ],
  },
  {
    id: "stocuri",
    title: "Stocuri",
    icon: Warehouse,
    items: [
      { to: "/gestiune", label: "Panou gestiune", icon: Warehouse, module: "inventory" },
      { to: "/gestiune/stoc", label: "Stoc curent", icon: PackageSearch, module: "inventory" },
      { to: "/gestiune/productie", label: "Note de produc?ie", icon: Factory, module: "inventory" },
      { to: "/gestiune/inventare", label: "Inventare", icon: ClipboardList, module: "inventory" },
      { to: "/inregistrare-document/inventar/new", label: "Inventar nou", icon: ClipboardList, module: "inventory" },
    ],
  },
  {
    id: "financiar",
    title: "Financiar",
    icon: Wallet,
    items: [
      { to: "/inregistrare-document/factura/new", label: "Facturi ie?ire", icon: FileSpreadsheet, module: "documents" },
      { to: "/documente/facturi-primite-spv", label: "Facturi primite SPV", icon: FileBarChart2, module: "documents" },
      { to: "/setari/efactura", label: "Setari e-Factura", icon: FileText, module: "settings" },
      { to: "/setari/numerotare", label: "Numerotare documente", icon: FileText, module: "settings" },
    ],
  },
  {
    id: "rapoarte",
    title: "Rapoarte",
    icon: BarChart3,
    items: [
      { to: "/rapoarte", label: "Rapoarte ERP", icon: BarChart3, module: "reports" },
      { to: "/dashboard", label: "Analiza live", icon: LayoutDashboard, module: "dashboard" },
      { to: "/documente", label: "Istoric documente", icon: FileText, module: "documents" },
    ],
  },
  {
    id: "pos-kitchen",
    title: "POS / Kitchen",
    icon: UtensilsCrossed,
    items: [
      { to: "/setari/firma", label: "Companie ?i terminale", icon: UtensilsCrossed, module: "settings" },
      { to: "/setari/utilizatori", label: "Acces operatori", icon: Users, module: "settings" },
      { to: "/dashboard", label: "Monitorizare live", icon: LayoutDashboard, module: "dashboard" },
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
          "group relative flex items-center gap-2.5 overflow-hidden rounded-[16px] px-3 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[#17324D] text-white shadow-[0_10px_30px_rgba(23,50,77,0.18)]"
            : "text-slate-600 hover:bg-slate-100 hover:text-[#17324D]"
        )
      }
    >
      {({ isActive }) => (
        <>
          {Icon ? (
            <span
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                isActive ? "bg-white/10 text-white" : "bg-slate-100 text-[#6C7A89] group-hover:bg-white group-hover:text-[#244A7C]"
              )}
            >
              <Icon size={16} />
            </span>
          ) : null}

          <span className="flex-1 truncate">{item.label}</span>

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
  const location = useLocation()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev }
      for (const section of visibleSections) {
        if (prev[section.id] !== undefined) continue
        next[section.id] = section.items.some((item) => location.pathname.startsWith(item.to))
      }
      return next
    })
  }, [visibleSections, location.pathname])

  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev }
      for (const section of visibleSections) {
        if (section.items.some((item) => location.pathname.startsWith(item.to))) {
          next[section.id] = true
        }
      }
      return next
    })
  }, [visibleSections, location.pathname])

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }))
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b border-slate-200/80 px-4 pb-3 pt-4">
        {mobile ? (
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Meniu ERP</div>
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : null}

        {!mobile ? (
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
        ) : (
          <div className="mt-2 text-sm font-semibold text-[#17324D]">Gufo ERP</div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {visibleSections.map((section) => {
            const SectionIcon = section.icon
            const isOpen = openSections[section.id] ?? false

            return (
              <section key={section.id} className="rounded-[18px] border border-slate-200/80 bg-white/80 shadow-sm shadow-slate-900/[0.02]">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50/80"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#244A7C]">
                    <SectionIcon size={18} />
                  </span>
                  <span className="flex-1 text-sm font-semibold text-[#17324D]">{section.title}</span>
                  <ChevronDown
                    size={16}
                    className={clsx("text-slate-400 transition-transform", isOpen && "rotate-180")}
                  />
                </button>

                {isOpen ? (
                  <div className="space-y-1 px-3 pb-3">
                    {section.items.map((item) => (
                      <div key={`${section.id}-${item.to}`} onClick={onNavigate}>
                        <SidebarLink item={item} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>

      <div className="border-t border-slate-200/80 px-4 py-3">
        <div className={clsx("rounded-[14px] border border-slate-200 bg-white px-3 py-3 shadow-sm", mobile && "hidden")}>
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
  )
}

export default function Sidebar({
  mobileOpen = false,
  onCloseMobile,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}) {
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.module || hasModule(item.module)),
        }))
        .filter((section) => section.items.length > 0),
    []
  )

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px] xl:hidden"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside className="hidden xl:block xl:w-72 xl:shrink-0">
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-72 border-r border-slate-200/80 bg-white/95 backdrop-blur xl:flex">
          <SidebarContent visibleSections={visibleSections} />
        </div>
      </aside>

      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-[60] w-[88vw] max-w-[320px] border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 xl:hidden",
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
