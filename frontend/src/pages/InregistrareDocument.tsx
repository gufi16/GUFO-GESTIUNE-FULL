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
    description: "Intri direct in fluxul comercial complet pentru client, linii de factura, totaluri si pregatirea pentru e-Factura.",
  },
  {
    title: "Nota de receptie",
    path: "/inregistrare-document/nir/new",
    icon: ReceiptText,
    tone: "bg-slate-100 text-slate-700",
    description: "Pornesti receptia de marfa cu furnizor, produse, costuri si documentul pregatit pentru validare sau export PDF.",
  },
  {
    title: "Bon de consum",
    path: "/inregistrare-document/bon-consum/new",
    icon: PackageMinus,
    tone: "bg-amber-50 text-amber-700",
    description: "Documentezi consumul operational pe locatie si gestiune, cu selectie rapida pentru produsele si materiile prime folosite.",
  },
  {
    title: "Transfer intre gestiuni",
    path: "/transfer/new",
    icon: FilePlus2,
    tone: "bg-slate-100 text-slate-700",
    description: "Muti stocul intre gestiuni cu context logistic clar si verificari pregatite pentru fluxurile unde apare si e-Transport.",
  },
  {
    title: "PV deteriorare",
    path: "/inregistrare-document/pv-deteriorare/new",
    icon: TriangleAlert,
    tone: "bg-slate-100 text-slate-700",
    description: "Inregistrezi pierderile sau deteriorarile cu justificare clara, pozitii afectate si trasabilitate in registrul operational.",
  },
  {
    title: "PV schimbare pret",
    path: "/inregistrare-document/pv-schimbare-pret/new",
    icon: Tags,
    tone: "bg-slate-100 text-slate-700",
    description: "Actualizezi preturile prin document dedicat, astfel incat schimbarile comerciale sa ramana usor de urmarit in istoric.",
  },
  {
    title: "Inventar",
    path: "/inregistrare-document/inventar/new",
    icon: PackagePlus,
    tone: "bg-slate-100 text-slate-700",
    description: "Pornesti inventarul pe locatia activa si compari rapid scripticul cu cantitatile constatate pentru fiecare articol.",
  },
]

export default function InregistrareDocument() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        badge="operatiuni"
        title="Inregistrare documente"
        subtitle="Alegi rapid documentul pe care vrei sa il creezi si intri direct in fluxul operational potrivit pentru receptii, transferuri, consum, inventar sau documente comerciale."
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
