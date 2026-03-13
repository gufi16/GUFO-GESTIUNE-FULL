import { ArrowRight, BookOpen, Boxes, Building2, FolderTree, Package2, Ruler } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"

const items = [
  {
    name: "Produse",
    desc: "Produsele comercializate, rețetare, vizibilitate POS și clasificări.",
    route: "/nomenclator/produse",
    icon: Package2,
  },
  {
    name: "Furnizori",
    desc: "Lista furnizori și datele lor de identificare.",
    route: "/nomenclator/furnizori",
    icon: Building2,
  },
  {
    name: "Locații",
    desc: "Depozite, magazine și puncte de lucru.",
    route: "/nomenclator/locatii",
    icon: Boxes,
  },
  {
    name: "Unități de măsură",
    desc: "UM utilizate în produse, documente și recepții.",
    route: "/nomenclator/uom",
    icon: Ruler,
  },
  {
    name: "Departamente",
    desc: "Organizarea produselor pe departamente.",
    route: "/nomenclator/departamente",
    icon: BookOpen,
  },
  {
    name: "Categorii produse",
    desc: "Categorii pentru structurarea și filtrarea produselor.",
    route: "/nomenclator/categorii",
    icon: FolderTree,
  },
]

export default function Nomenclator() {
  const nav = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        badge="nomenclator"
        title="Nomenclatoare"
        subtitle="Datele de bază utilizate în sistem. Accesează rapid modulele esențiale pentru produse, furnizori, locații și clasificări."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => {
          const Icon = i.icon
          return (
            <button
              key={i.name}
              type="button"
              onClick={() => nav(i.route)}
              className="group rounded-[28px] border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon size={20} />
                </span>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  modul
                </span>
              </div>

              <div className="mt-5">
                <div className="text-lg font-semibold text-slate-900">{i.name}</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">{i.desc}</div>
              </div>

              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                Deschide
                <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
