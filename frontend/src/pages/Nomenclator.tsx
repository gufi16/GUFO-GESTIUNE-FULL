import { ArrowRight, BookOpen, Boxes, Building2, FolderTree, Package2, Ruler } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"

const items = [
  { name: "Produse", route: "/nomenclator/produse", icon: Package2 },
  { name: "Furnizori", route: "/nomenclator/furnizori", icon: Building2 },
  { name: "Clienti", route: "/nomenclator/clienti", icon: Building2 },
  { name: "Locatii", route: "/nomenclator/locatii", icon: Boxes },
  { name: "Unitati de masura", route: "/nomenclator/uom", icon: Ruler },
  { name: "Departamente", route: "/nomenclator/departamente", icon: BookOpen },
  { name: "Categorii produse", route: "/nomenclator/categorii", icon: FolderTree },
]

export default function Nomenclator() {
  const nav = useNavigate()

  return (
    <div className="space-y-3">
      <PageHeader badge="nomenclator" title="Nomenclatoare" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => nav(item.route)}
              className="group rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#EAF0F6] text-[#17324D]">
                  <Icon size={18} />
                </span>
                <ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#17324D]" />
              </div>

              <div className="mt-3 text-[15px] font-semibold text-slate-900">{item.name}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
