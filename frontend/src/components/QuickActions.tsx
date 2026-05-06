import { ArrowLeftRight, PackageSearch, Plus, Receipt } from "lucide-react"
import { useNavigate } from "react-router-dom"

const actions = [
  {
    label: "Receptie marfa",
    helper: "Adauga rapid un NIR nou",
    icon: Plus,
    path: "/inregistrare-document/nir/new",
    tone: "blue",
  },
  {
    label: "Transfer intre locatii",
    helper: "Muta stoc intre gestiuni",
    icon: ArrowLeftRight,
    path: "/transfer/new",
    tone: "slate",
  },
  {
    label: "Vanzare / Bon",
    helper: "Integrare POS si documente",
    icon: Receipt,
    path: "",
    action: "receipts",
    tone: "amber",
  },
  {
    label: "Cauta produs",
    helper: "Intra direct in nomenclator",
    icon: PackageSearch,
    path: "/nomenclator/produse",
    tone: "slate",
  },
] as const

export default function QuickActions({ onOpenReceipts }: { onOpenReceipts?: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              if ("action" in action && action.action === "receipts") {
                onOpenReceipts?.()
                return
              }
              if (action.path) navigate(action.path)
            }}
            className="rounded-[8px] border border-slate-200 bg-white p-4 text-left shadow-sm shadow-slate-900/[0.03] transition hover:border-[#17324D]"
          >
            <div className="flex items-start justify-between gap-4">
              <span
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-[8px]",
                  action.tone === "blue" && "bg-blue-600 text-white",
                  action.tone === "amber" && "bg-amber-500 text-white",
                  action.tone === "slate" && "bg-slate-900 text-white",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon size={20} />
              </span>

              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                rapid
              </span>
            </div>

            <div className="mt-4">
              <div className="text-base font-semibold text-slate-900">{action.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{action.helper}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
