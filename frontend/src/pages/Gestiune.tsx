import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"

const items = [
  { name: "Stoc", desc: "Stoc global și pe locații", route: "/gestiune/stoc" },
  { name: "Transferuri", desc: "Note de transfer între locații", route: "/transfer" },
  { name: "Inventare", desc: "Liste și diferențe", route: "" },
  { name: "Alerte stoc", desc: "Produse sub pragul minim", route: "" }
]

export default function Gestiune() {
  const nav = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestiune"
        subtitle="Stocuri, mișcări, transferuri și inventare."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((i) => (
          <div key={i.name} className="card p-5">
            <div className="text-sm font-semibold">{i.name}</div>
            <div className="text-xs text-neutral-500 mt-2">{i.desc}</div>
            <div className="mt-4">
              <button
                className="px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm"
                type="button"
                onClick={() => {
                  if (i.route) nav(i.route)
                  else alert("Modul în lucru 🙂")
                }}
              >
                Deschide
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}