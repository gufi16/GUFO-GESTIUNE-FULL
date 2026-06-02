import { FilePlus2, PackageMinus, PackagePlus, ReceiptText, ScrollText, Tags, TriangleAlert } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import HubModuleCard from "../components/HubModuleCard"

const cards: Array<{
  title: string
  path: string
  icon: any
  tone: string
  description: string
  disabled?: boolean
}> = [
  {
    title: "Factura",
    path: "/inregistrare-document/factura/new",
    icon: ScrollText,
    tone: "bg-slate-100 text-slate-700",
    description: "Emitere factura client.",
  },
  {
    title: "Nota de receptie",
    path: "/inregistrare-document/nir/new",
    icon: ReceiptText,
    tone: "bg-slate-100 text-slate-700",
    description: "Intrare marfa in gestiune.",
  },
  {
    title: "Bon de consum",
    path: "/inregistrare-document/bon-consum/new",
    icon: PackageMinus,
    tone: "bg-amber-50 text-amber-700",
    description: "Consum intern de stoc.",
  },
  {
    title: "Transfer intre gestiuni",
    path: "/transfer/new",
    icon: FilePlus2,
    tone: "bg-slate-100 text-slate-700",
    description: "Mutare stoc intre gestiuni.",
  },
  {
    title: "PV deteriorare",
    path: "/inregistrare-document/pv-deteriorare/new",
    icon: TriangleAlert,
    tone: "bg-slate-100 text-slate-700",
    description: "Pierderi si deteriorari.",
  },
  {
    title: "PV schimbare pret",
    path: "/inregistrare-document/pv-schimbare-pret/new",
    icon: Tags,
    tone: "bg-slate-100 text-slate-700",
    description: "Actualizare preturi.",
  },
  {
    title: "Inventar",
    path: "/inregistrare-document/inventar/new",
    icon: PackagePlus,
    tone: "bg-slate-100 text-slate-700",
    description: "Numarare si diferente stoc.",
  },
]

export default function InregistrareDocument() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        badge="operatiuni"
        title="Inregistrare documente"
        subtitle="Alegi documentul si continui."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <HubModuleCard
            key={card.title}
            onClick={() => !card.disabled && navigate(card.path)}
            title={card.title}
            description={card.description}
            icon={card.icon}
            iconClassName={card.tone}
            badge="document"
            disabled={Boolean(card.disabled)}
          />
        ))}
      </div>
    </div>
  )
}
