import { BookOpen, Boxes, Building2, FolderTree, Package2, Ruler, UtensilsCrossed } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import HubModuleCard from "../components/HubModuleCard"

const items = [
  { name: "Produse", route: "/nomenclator/produse", icon: Package2, description: "Catalog produse." },
  { name: "Materii prime", route: "/nomenclator/materii-prime", icon: Boxes, description: "Stoc productie." },
  { name: "Semifabricate", route: "/nomenclator/semifabricate", icon: BookOpen, description: "Preparare interna." },
  { name: "Meniuri", route: "/nomenclator/meniuri", icon: UtensilsCrossed, description: "Produse vandabile." },
  { name: "Furnizori", route: "/nomenclator/furnizori", icon: Building2, description: "Parteneri achizitie." },
  { name: "Clienti", route: "/nomenclator/clienti", icon: Building2, description: "Parteneri vanzare." },
  { name: "Locatii", route: "/nomenclator/locatii", icon: Boxes, description: "Puncte de lucru." },
  { name: "Unitati de masura", route: "/nomenclator/uom", icon: Ruler, description: "U.M. standard." },
  { name: "Departamente", route: "/nomenclator/departamente", icon: BookOpen, description: "Structura comerciala." },
  { name: "Categorii produse", route: "/nomenclator/categorii", icon: FolderTree, description: "Grupare produse." },
  { name: "Subcategorii produse", route: "/nomenclator/subcategorii", icon: FolderTree, description: "Variante in interiorul categoriilor." },
]

export default function Nomenclator() {
  const nav = useNavigate()

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Nomenclatoare"
        subtitle="Registrele de baza."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <HubModuleCard
            key={item.name}
            onClick={() => nav(item.route)}
            title={item.name}
            description={item.description}
            icon={item.icon}
          />
        ))}
      </div>
    </div>
  )
}
