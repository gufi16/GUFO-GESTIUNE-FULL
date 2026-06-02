import PageHeader from "../components/PageHeader"
import PosReceiptsView from "../components/PosReceiptsView"

export default function FinanceReceipts() {
  return (
    <div className="space-y-4">
      <PageHeader
        badge="financiar"
        title="Vanzari / Bon"
        subtitle="Monitorizezi bonurile emise din Android POS intr-un registru clar, potrivit pentru verificarea rapida a incasarilor, produselor si documentelor fiscale."
      />
      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.03] md:p-5">
        <PosReceiptsView />
      </div>
    </div>
  )
}
