import { FilePlus2, PackageMinus, ReceiptText, ScrollText, Tags, TriangleAlert } from "lucide-react"
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
    title: "Factura",
    path: "/inregistrare-document/factura/new",
    icon: ScrollText,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "Nota de receptie",
    path: "/inregistrare-document/nir/new",
    icon: ReceiptText,
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

      <div className="flex flex-wrap gap-2">
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
                "inline-flex h-10 items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm transition",
                disabled ? "cursor-not-allowed opacity-70" : "hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-[10px] ${card.tone}`}>
                <Icon size={15} />
              </span>
              {card.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}
