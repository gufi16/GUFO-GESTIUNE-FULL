import PageHeader from "../components/PageHeader"
import PosReceiptsView from "../components/PosReceiptsView"

export default function FinanceReceipts() {
  return (
    <div className="space-y-4">
      <PageHeader badge="financiar" title="Vanzari / Bon" subtitle="Bonuri fiscale emise in Android POS." />
      <PosReceiptsView />
    </div>
  )
}
