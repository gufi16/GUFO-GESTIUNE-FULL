import PageHeader from "../components/PageHeader"
import PosClosuresView from "../components/PosClosuresView"

export default function FinanceClosures() {
  return (
    <div className="space-y-4">
      <PageHeader
        badge="financiar"
        title="Inchideri zilnice"
        subtitle="Vezi rapoartele Z si inchiderile salvate din Android POS intr-un ecran mai disciplinat si mai usor de citit pentru verificarea zilnica."
      />
      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.03] md:p-5">
        <PosClosuresView />
      </div>
    </div>
  )
}
