import { useEffect, useMemo, useState } from "react"
import { MonitorSmartphone, RefreshCw, ShieldCheck, Store, UserRound } from "lucide-react"
import { useNavigate } from "react-router-dom"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
} from "../components/DocumentUi"
import { api } from "../lib/api"

type TerminalItem = {
  id: string
  label?: string | null
  deviceId: string
  locationId?: string | null
  location?: {
    id: string
    name: string
    code?: string | null
  } | null
}

type UserItem = {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  hasPosPin?: boolean
}

const roleLabels: Record<string, string> = {
  OWNER: "Proprietar",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Ospatar / Casier",
  WAREHOUSE: "Magazioner",
  CHEF: "Bucatar",
  KITCHEN_HELPER: "Ajutor bucatar",
  KITCHEN_OPERATOR: "Operator bucatarie",
}

function isKdsTerminal(item: TerminalItem) {
  const label = String(item.label || "").toUpperCase()
  const deviceId = String(item.deviceId || "").toUpperCase()
  return label.includes("KDS") || deviceId.startsWith("KDS-")
}

export default function SetariKds() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [devices, setDevices] = useState<TerminalItem[]>([])
  const [users, setUsers] = useState<UserItem[]>([])

  async function loadData() {
    setLoading(true)
    setError("")
    setMessage("")

    try {
      const [terminalsRes, usersRes] = await Promise.all([
        api<{ ok: boolean; terminals?: TerminalItem[] }>("/api/v1/meta/terminals"),
        api<{ ok: boolean; items?: UserItem[] }>("/api/v1/users"),
      ])

      const allTerminals = Array.isArray(terminalsRes.terminals) ? terminalsRes.terminals : []
      const kdsDevices = allTerminals.filter(isKdsTerminal)
      const allUsers = Array.isArray(usersRes.items) ? usersRes.items : []

      setDevices(kdsDevices)
      setUsers(allUsers)
      setMessage(kdsDevices.length ? "Device-urile GuFo KDS sunt sincronizate din ERP." : "Nu exista inca device-uri KDS imperecheate.")
    } catch (err: any) {
      setError(err?.message || "Nu am putut incarca setarile KDS.")
      setDevices([])
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const activeDevices = useMemo(() => devices.length, [devices])
  const activeLocations = useMemo(() => new Set(devices.map((item) => item.locationId).filter(Boolean)).size, [devices])
  const kdsOperators = useMemo(
    () =>
      users.filter(
        (item) =>
          item.isActive &&
          Boolean(item.hasPosPin) &&
          ["OWNER", "ADMIN", "MANAGER", "CASHIER", "CHEF", "KITCHEN_HELPER", "KITCHEN_OPERATOR"].includes(item.role)
      ),
    [users]
  )

  return (
    <div className="space-y-3">
      <PageHeader badge="configurare" title="Setari KDS" />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Device-uri KDS" value={activeDevices} tone="emerald" />
        <DocumentMetric title="Locatii active" value={activeLocations} tone="blue" />
        <DocumentMetric title="Operatori cu PIN" value={kdsOperators.length} tone="amber" />
        <DocumentMetric title="Status" value={loading ? "Se incarca" : "Pregatit"} tone="slate" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!error && message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Flux GuFo KDS"
        actions={
          <>
            <button className={documentButtonPrimaryClass} onClick={() => navigate("/setari/utilizatori")}>
              Editeaza utilizatori KDS
            </button>
            <button className={documentButtonSecondaryClass} onClick={loadData} disabled={loading}>
              <RefreshCw size={16} className="mr-2" />
              Reincarca
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-[#17324D]">
              <MonitorSmartphone size={18} />
              <div className="text-sm font-semibold">1. Pair device</div>
            </div>
            <div className="text-sm text-slate-600">
              In aplicatia GuFo KDS intri la <strong>Setari KDS</strong>, completezi URL-ul ERP si cheia de licenta, apoi apesi <strong>Conecteaza KDS</strong>.
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-[#17324D]">
              <UserRound size={18} />
              <div className="text-sm font-semibold">2. Login operator</div>
            </div>
            <div className="text-sm text-slate-600">
              Operatorii intra in KDS cu <strong>numele</strong> din ERP si <strong>PIN-ul POS</strong>. PIN-ul se seteaza din <strong>Utilizatori ERP</strong>.
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-[#17324D]">
              <ShieldCheck size={18} />
              <div className="text-sm font-semibold">3. Finalizare comanda</div>
            </div>
            <div className="text-sm text-slate-600">
              Dupa pairing, device-ul KDS apare aici in ERP si poate fi urmarit separat pe locatie si pe device.
            </div>
          </div>
        </div>
      </DocumentSection>

      <DocumentSection title="Device-uri GuFo KDS salvate">
        {devices.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {devices.map((item) => (
              <div key={item.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[16px] font-semibold text-slate-900">{item.label || "GuFo KDS"}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.deviceId}</div>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    activ
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                  <Store size={16} />
                  <span>{item.location?.name || "Fara locatie"}</span>
                  {item.location?.code ? <span className="text-slate-400">({item.location.code})</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Inca nu exista device-uri KDS imperecheate. Deschide aplicatia GuFo KDS si fa pairing din butonul <strong>Setari KDS</strong>.
          </div>
        )}
      </DocumentSection>

      <DocumentSection
        title="Operatori care pot intra in KDS"
        actions={
          <>
            <button className={documentButtonPrimaryClass} onClick={() => navigate("/setari/utilizatori")}>
              Deschide Utilizatori ERP
            </button>
            <button className={documentButtonSecondaryClass} onClick={() => navigate("/setari/utilizatori")}>
              Adauga utilizator KDS
            </button>
          </>
        }
      >
        {kdsOperators.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">Operator</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">PIN POS</th>
                  <th className="px-3 py-2 text-right">Actiune</th>
                </tr>
              </thead>
              <tbody>
                {kdsOperators.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 font-semibold text-slate-900">{item.name}</td>
                    <td className="px-3 py-3">{roleLabels[item.role] || item.role}</td>
                    <td className="px-3 py-3 text-slate-600">{item.email}</td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                        setat
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button className={documentButtonSecondaryClass} onClick={() => navigate("/setari/utilizatori")}>
                        Editeaza
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Nu exista inca operatori activi cu PIN POS. Mergi in <strong>Utilizatori ERP</strong> si seteaza PIN-ul pentru personalul care va folosi GuFo KDS.
          </div>
        )}
      </DocumentSection>
    </div>
  )
}
