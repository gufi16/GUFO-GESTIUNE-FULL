import { BookOpen, Boxes, Building2, FolderTree, Package2, Ruler, UtensilsCrossed } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import HubModuleCard from "../components/HubModuleCard"

const items = [
  { name: "Produse", route: "/nomenclator/produse", icon: Package2, description: "Intri direct in catalogul comercial complet pentru administrare, cautare rapida si reguli operationale." },
  { name: "Materii prime", route: "/nomenclator/materii-prime", icon: Boxes, description: "Revizuiesti materiile prime folosite in productie, consum intern si retetare, separate clar de restul catalogului." },
  { name: "Semifabricate", route: "/nomenclator/semifabricate", icon: BookOpen, description: "Gestionezi preparatele intermediare care intra mai departe in productie, retete si fluxurile zilnice." },
  { name: "Meniuri", route: "/nomenclator/meniuri", icon: UtensilsCrossed, description: "Configurezi meniurile vandabile, publicarea lor si legatura cu produsele finite deja definite in ERP." },
  { name: "Furnizori", route: "/nomenclator/furnizori", icon: Building2, description: "Deschizi registrul partenerilor de achizitie si completezi rapid datele fiscale, comerciale si de contact." },
  { name: "Clienti", route: "/nomenclator/clienti", icon: Building2, description: "Administrezi baza de clienti, datele de facturare si informatiile utile pentru livrare si fluxurile comerciale." },
  { name: "Locatii", route: "/nomenclator/locatii", icon: Boxes, description: "Vezi locatiile companiei, adresele operationale si contextul folosit mai departe in documente si transport." },
  { name: "Unitati de masura", route: "/nomenclator/uom", icon: Ruler, description: "Pastrezi nomenclatorul de unitati coerent pentru produse, achizitii, documente si e-Factura." },
  { name: "Departamente", route: "/nomenclator/departamente", icon: BookOpen, description: "Organizezi structura comerciala folosita ulterior in categorii, produse si fluxurile din POS." },
  { name: "Categorii produse", route: "/nomenclator/categorii", icon: FolderTree, description: "Controlezi gruparea produselor pe categorii, imagini si vizibilitate in interfetele comerciale." },
]

export default function Nomenclator() {
  const nav = useNavigate()

  return (
    <div className="space-y-3">
      <PageHeader
        badge="nomenclator"
        title="Nomenclatoare"
        subtitle="Administrezi produsele, materiile prime, partenerii si clasificarea comerciala dintr-un singur modul, cu acces rapid la toate registrele de baza."
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
