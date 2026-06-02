import { ArrowRight, ArrowLeftRight, Factory, Warehouse } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"

const items = [
  {
    name: "Stoc",
    desc: "Vezi stocul global si pe locatii.",
    route: "/gestiune/stoc",
    icon: Warehouse,
  },
  {
    name: "Transfer intre gestiuni",
    desc: "Muti marfa intre locatii.",
    route: "/transfer",
    icon: ArrowLeftRight,
  },
  {
    name: "Productie",
    desc: "Controlezi transformarea materiilor prime.",
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
          const Icon = item.icon
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => nav(item.route)}
              className="group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#EAF0F6] text-[#17324D]">
                  <Icon size={18} />
                </span>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  modul
                </span>
              </div>

              <div className="mt-4">
                <div className="text-[17px] font-semibold text-slate-900">{item.name}</div>
                <div className="mt-1.5 text-sm leading-6 text-slate-500">{item.desc}</div>
              </div>

              <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#17324D]">
                Deschide
                <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
