import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"
import { useNavigate } from "react-router-dom"
import { Archive, Bot, Building2, FileDigit, History, Percent, ReceiptText, RefreshCcw, Settings2, Store, Users, Warehouse } from "lucide-react"
import {
  DocumentMetric,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
} from "../components/DocumentUi"
import { API_BASE as API, getToken } from "../lib/api"
import { hasModule } from "../lib/modules"
import HubModuleCard from "../components/HubModuleCard"

const items = [
  {
    name: "Firma",
    desc: "Date companie, identificare fiscala si informatii de baza.",
    route: "/setari/firma",
    icon: Building2,
  },
  {
    name: "Cote TVA",
    desc: "Gestionare cote TVA si valori utilizate in documente.",
    route: "/setari/tva",
    icon: Percent,
  },
  {
    name: "Serii si numerotare",
    desc: "Setezi seria facturii, numarul de start si codurile automate pentru documente, clienti si furnizori.",
    route: "/setari/numerotare",
    icon: FileDigit,
  },
  {
    name: "Setari SPV",
    desc: "Configurezi firma, mediul de lucru si tokenul ANAF pentru SPV.",
    route: "/setari/efactura",
    icon: ReceiptText,
  },
  {
    name: "Configurare gestiune",
    desc: "Setezi regulile de lucru, filtrele si etichetele folosite pentru gestiune in ERP.",
    route: "/setari/gestiune",
    icon: Warehouse,
  },
  {
    name: "Marketplace",
    desc: "Conectezi Glovo, Wolt si Bolt Food, mapezi produsele si urmaresti comenzile intrate din platforme.",
    route: "/setari/marketplace",
    icon: Store,
  },
  {
    name: "Gufo AI",
    desc: "Configurezi drepturile, modul de lucru si comportamentul asistentului inteligent din ERP.",
    route: "/setari/gufo-ai",
    icon: Bot,
  },
  {
    name: "Gestiuni",
    desc: "Administrezi efectiv gestiunile pe fiecare locatie: adaugare, editare, default si status.",
    route: "/gestiune/gestiuni",
    icon: Building2,
  },
  {
    name: "Utilizatori ERP",
    desc: "Administrezi echipa, rolurile si PIN-ul de acces folosit mai departe in POS si KDS.",
    route: "/setari/utilizatori",
    icon: Users,
  },
  {
    name: "Backup client",
    desc: "Creezi si descarci snapshot-uri complete pentru clientul curent.",
    route: "/setari/backup",
    icon: Archive,
  },
  {
    name: "Istoric actiuni",
    desc: "Vezi cine a facut modificari in ERP, cand si pe ce entitate.",
    route: "/setari/istoric",
    icon: History,
  },
]

const allowedIntervals = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]

export default function Setari() {
  const nav = useNavigate()
  const token = getToken() || ""
  const availableItems = items.filter((item) => item.route !== "/setari/efactura" || hasModule("efactura"))

  const [posSyncInterval, setPosSyncInterval] = useState<number>(5)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadPosSyncConfig()
  }, [])

  async function loadPosSyncConfig() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoadingConfig(false)
      return
    }

    setLoadingConfig(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/pos-sync-config`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut incarca setarea de sync POS.")
        return
      }

      setPosSyncInterval(Number(data.posSyncInterval || 5))
    } catch {
      setError("Nu am putut incarca setarea de sync POS.")
    } finally {
      setLoadingConfig(false)
    }
  }

  async function savePosSyncConfig() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setSavingConfig(true)
    setError("")
    setMessage("")

    try {
      const res = await fetch(`${API}/api/v1/company/pos-sync-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          posSyncInterval,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.ok) {
        setError(data.error || "Nu am putut salva setarea de sync POS.")
        return
      }

      setMessage(`Intervalul de sync POS a fost salvat: ${data.posSyncInterval} minute.`)
    } catch {
      setError("Nu am putut salva setarea de sync POS.")
    } finally {
      setSavingConfig(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="configurare"
        title="Setari"
        subtitle="Controlezi configurarea companiei, utilizatorii, numerotarea si integrarile dintr-un singur modul administrativ, cu trasee mai clare pentru echipa."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <DocumentMetric title="Module setari" value={availableItems.length} tone="slate" />
        <DocumentMetric title="Autosync POS" value={`${posSyncInterval} min`} tone="blue" />
        <DocumentMetric title="Status configurare" value={loadingConfig ? "Se incarca" : "Activ"} tone="emerald" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {availableItems.map((item) => {
          return (
            <HubModuleCard
              key={item.name}
              onClick={() => nav(item.route)}
              title={item.name}
              description={item.desc}
              icon={item.icon}
              iconClassName="bg-blue-50 text-blue-700"
            />
          )
        })}

        <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[16px] font-semibold text-slate-900">Sync POS</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">Configurezi cat de des sincronizeaza ERP-ul cu Android POS si revii rapid la setarea activa.</div>
            </div>

            <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-slate-900 text-white">
              <Settings2 size={20} />
            </span>
          </div>

          <div className="mt-6">
            <label className="mb-2 block text-sm font-medium text-slate-700">Interval autosync POS</label>

            <select
              value={posSyncInterval}
              onChange={(e) => setPosSyncInterval(Number(e.target.value))}
              className={documentInputClass}
              disabled={loadingConfig || savingConfig}
            >
              {allowedIntervals.map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "minut" : "minute"}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 flex gap-3">
            <button className={documentButtonPrimaryClass} onClick={savePosSyncConfig} disabled={loadingConfig || savingConfig}>
              {savingConfig ? "Se salveaza..." : "Salveaza"}
            </button>

            <button className={documentButtonSecondaryClass} onClick={loadPosSyncConfig} disabled={loadingConfig || savingConfig}>
              <RefreshCcw size={16} className="mr-2" />
              Reincarca
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
