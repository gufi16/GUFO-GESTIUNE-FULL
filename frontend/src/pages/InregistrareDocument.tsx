import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"

const docs = [
  {
    name: "Recepție (NIR)",
    desc: "Intrări marfă pe depozit/locație",
    path: "/inregistrare-document/nir"
  },
  {
    name: "Transfer",
    desc: "Notă de transfer între gestiuni",
    path: "/transfer"
  },
  {
    name: "Inventar",
    desc: "Ajustări pe bază de inventariere",
    path: "/inventar"
  },
  {
    name: "Cheltuială",
    desc: "Înregistrare cheltuieli/bonuri",
    path: "/cheltuiala"
  }
]

export default function InregistrareDocument() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Înregistrare document"
        subtitle="Creează documente operaționale (recepții, transferuri, inventare, cheltuieli)."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {docs.map((d) => (
          <button
            key={d.name}
            className="card p-5 text-left hover:shadow-md transition"
            type="button"
            onClick={() => navigate(d.path)}
          >
            <div className="text-sm font-semibold">{d.name}</div>
            <div className="text-xs text-neutral-500 mt-2">{d.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}