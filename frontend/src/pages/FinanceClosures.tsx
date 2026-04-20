import PageHeader from "../components/PageHeader"
import PosClosuresView from "../components/PosClosuresView"

export default function FinanceClosures() {
  return (
    <div className="space-y-4">
      <PageHeader badge="financiar" title="Inchideri zilnice" subtitle="Rapoarte Z salvate din Android POS." />
      <PosClosuresView />
    </div>
  )
}
