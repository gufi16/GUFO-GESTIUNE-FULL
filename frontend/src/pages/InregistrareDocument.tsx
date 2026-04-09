import { FilePlus2, PackageMinus, PackagePlus, ReceiptText, ScrollText, Tags, TriangleAlert } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"

const cards: Array<{
  title: string
  path: string
  icon: any
  tone: string
  disabled?: boolean
}> = [
  {
    title: "Nota de receptie",
    path: "/inregistrare-document/nir/new",
    icon: ReceiptText,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "Inventar",
    path: "/inregistrare-document/inventar/new",
    icon: PackagePlus,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "Bon de consum",
    path: "/inregistrare-document/bon-consum/new",
    icon: PackageMinus,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    title: "Transfer intre gestiuni",
    path: "/transfer/new",
    icon: FilePlus2,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "Factura",
    path: "/inregistrare-document/factura/new",
    icon: ScrollText,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "PV deteriorare",
    path: "/inregistrare-document/pv-deteriorare/new",
    icon: TriangleAlert,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "PV schimbare pret",
    path: "/inregistrare-document/pv-schimbare-pret/new",
    icon: Tags,
    tone: "bg-slate-100 text-slate-700",
  },
]

export default function InregistrareDocument() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader badge="operatiuni" title="Inregistrare documente" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon
          const disabled = !!card.disabled

          return (
            <button
              key={card.title}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && navigate(card.path)}
              className={[
                "rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition",
                disabled
                  ? "cursor-not-allowed opacity-70"
                  : "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
              ].join(" ")}
            >
              <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                <Icon size={20} />
              </span>

              <div className="text-base font-semibold text-slate-900">{card.title}</div>
              {disabled ? <div className="mt-3 text-xs font-semibold text-slate-400">In curand</div> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}


