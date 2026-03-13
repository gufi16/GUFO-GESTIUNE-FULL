import { ArrowLeftRight, PackageSearch, Plus, Receipt } from "lucide-react"
import { useNavigate } from "react-router-dom"

const actions = [
  {
    label: "Recepție marfă",
    helper: "Adaugă rapid un NIR nou",
    icon: Plus,
    path: "/inregistrare-document/nir/new",
    tone: "blue",
  },
  {
    label: "Transfer între locații",
    helper: "Mută stoc între gestiuni",
    icon: ArrowLeftRight,
    path: "/transfer/new",
    tone: "slate",
  },
  {
    label: "Vânzare / Bon",
    helper: "Integrare POS și documente",
    icon: Receipt,
    path: "",
    tone: "amber",
  },
  {
    label: "Caută produs",
    helper: "Intră direct în nomenclator",
    icon: PackageSearch,
    path: "/nomenclator/produse",
    tone: "slate",
  },
] as const

export default function QuickActions() {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              if (action.path) navigate(action.path)
            }}
            className="rounded-[26px] border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <span
                className={[
                  "flex h-12 w-12 items-center justify-center rounded-2xl",
                  action.tone === "blue" && "bg-blue-600 text-white",
                  action.tone === "amber" && "bg-amber-500 text-white",
                  action.tone === "slate" && "bg-slate-900 text-white",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon size={20} />
              </span>

              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                rapid
              </span>
            </div>

            <div className="mt-5">
              <div className="text-base font-semibold text-slate-900">{action.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{action.helper}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
