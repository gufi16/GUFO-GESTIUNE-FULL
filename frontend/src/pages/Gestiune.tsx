import { ArrowLeftRight, Factory, Warehouse } from "lucide-react"
import PageHeader from "../components/PageHeader"
import HubModuleCard from "../components/HubModuleCard"
import { useNavigate } from "react-router-dom"

const items = [
  {
    name: "Stoc",
    desc: "Verifici rapid stocul curent, loturile, expirarile si miscarile pe contextul activ din companie.",
    route: "/gestiune/stoc",
    icon: Warehouse,
  },
  {
    name: "Transfer intre gestiuni",
    desc: "Muti marfa intre gestiuni cu traseu clar pentru cantitati, validare si documentele care insotesc miscarea.",
    route: "/transfer",
    icon: ArrowLeftRight,
  },
  {
    name: "Productie",
    desc: "Coordonezi transformarea materiilor prime in produse finite sau semifabricate, cu control clar pe pozitii si cantitati.",
    route: "/gestiune/productie",
    icon: Factory,
  },
]

export default function Gestiune() {
  const nav = useNavigate()

  return (
    <div className="space-y-3">
      <PageHeader
        badge="gestiune"
        title="Gestiune"
        subtitle="Controlezi stocul, transferurile, inventarele si productia dintr-un singur modul operational, cu intrare rapida in actiunile care misca marfa."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          return (
            <HubModuleCard
              key={item.name}
              onClick={() => nav(item.route)}
              title={item.name}
              description={item.desc}
              icon={item.icon}
            />
          )
        })}
      </div>
    </div>
  )
}
