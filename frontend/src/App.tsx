import { useEffect } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import AppShell from "./components/AppShell"
import RequireAuth from "./components/RequireAuth"
import RequireControlAuth from "./components/RequireControlAuth"
import ControlPanelLayout from "./components/control/ControlPanelLayout"
import ForgotPassword from "./pages/ForgotPassword"
import Login from "./pages/login"
import ResetPassword from "./pages/ResetPassword"
import ControlPanelLogin from "./pages/control/ControlPanelLogin"
import Dashboard from "./pages/Dashboard"
import InregistrareDocument from "./pages/InregistrareDocument"
import Documente from "./pages/Documente"
import Nomenclator from "./pages/Nomenclator"
import Setari from "./pages/Setari"
import Produse from "./pages/Produse"
import Furnizori from "./pages/Furnizori"
import Clienti from "./pages/Clienti"
import Locatii from "./pages/Locatii"
import Stoc from "./pages/stoc"
import Inventare from "./pages/Inventare"
import InventarNou from "./pages/InventarNou"
import BonConsumNou from "./pages/BonConsumNou"
import NirListPage from "./pages/nir-list"
import NirPage from "./pages/nir"
import NirPrintPage from "./pages/nir-print"
import TransferPage from "./pages/transfer"
import FacturaPage from "./pages/factura"
import ProcesVerbalPage from "./pages/proces-verbal"
import FacturiPrimiteSPVPage from "./pages/FacturiPrimiteSPV"
import ETransportPage from "./pages/ETransport"
import UomPage from "./pages/uom"
import DepartamentePage from "./pages/departamente"
import CategoriiPage from "./pages/categorii"
import TvaPage from "./pages/tva"
import FirmaPage from "./pages/Firma"
import SetariNumerotarePage from "./pages/SetariNumerotare"
import SetariEFacturaPage from "./pages/SetariEFactura"
import SetariBackupPage from "./pages/SetariBackup"
import UtilizatoriPage from "./pages/Utilizatori"
import IstoricActiuniPage from "./pages/IstoricActiuni"
import Productie from "./pages/Productie"
import Rapoarte from "./pages/Rapoarte"
import ExportContabilitatePage from "./pages/ExportContabilitate"
import FinanceReceipts from "./pages/FinanceReceipts"
import FinanceClosures from "./pages/FinanceClosures"
import ControlPanelDashboard from "./pages/control/ControlPanelDashboard"
import ControlPanelClients from "./pages/control/ControlPanelClients"
import ControlPanelClientDetails from "./pages/control/ControlPanelClientDetails"
import ControlPanelIntegrations from "./pages/control/ControlPanelIntegrations"
import { firstAllowedRoute, hasModule } from "./lib/modules"

function RequireModule({
  code,
  children,
}: {
  code: string
  children: React.ReactNode
}) {
  if (!hasModule(code)) {
    return <Navigate to={firstAllowedRoute()} replace />
  }

  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    document.title = "GuFo GesTiuNe"
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/cp/login" element={<ControlPanelLogin />} />

      <Route
        path="/inregistrare-document/nir/print"
        element={
          <RequireAuth>
            <NirPrintPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireControlAuth>
            <ControlPanelLayout />
          </RequireControlAuth>
        }
      >
        <Route path="/control-panel" element={<ControlPanelDashboard />} />
        <Route path="/control-panel/clienti" element={<ControlPanelClients />} />
        <Route path="/control-panel/clienti/:id" element={<ControlPanelClientDetails />} />
        <Route path="/control-panel/integrari" element={<ControlPanelIntegrations />} />
        <Route path="/control-panel/licente" element={<ControlPanelDashboard />} />
        <Route path="/control-panel/facturare" element={<ControlPanelDashboard />} />
        <Route path="/control-panel/audit" element={<ControlPanelDashboard />} />
      </Route>

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to={firstAllowedRoute()} replace />} />
        <Route path="/dashboard" element={<RequireModule code="dashboard"><Dashboard /></RequireModule>} />

        <Route path="/inregistrare-document" element={<RequireModule code="documents"><InregistrareDocument /></RequireModule>} />
        <Route path="/inregistrare-document/nir" element={<RequireModule code="documents"><NirListPage /></RequireModule>} />
        <Route path="/inregistrare-document/nir/new" element={<RequireModule code="documents"><NirPage /></RequireModule>} />
        <Route path="/inregistrare-document/nir/edit" element={<RequireModule code="documents"><NirPage /></RequireModule>} />
        <Route path="/inregistrare-document/factura/new" element={<RequireModule code="documents"><FacturaPage /></RequireModule>} />
        <Route path="/inregistrare-document/factura/edit" element={<RequireModule code="documents"><FacturaPage /></RequireModule>} />
        <Route path="/inregistrare-document/proces-verbal/deteriorare/new" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/proces-verbal/deteriorare/edit" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/proces-verbal/pret/new" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/proces-verbal/pret/edit" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/pv-deteriorare/new" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/pv-deteriorare/edit" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/pv-schimbare-pret/new" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />
        <Route path="/inregistrare-document/pv-schimbare-pret/edit" element={<RequireModule code="documents"><ProcesVerbalPage /></RequireModule>} />

        <Route path="/transfer" element={<RequireModule code="documents"><TransferPage /></RequireModule>} />
        <Route path="/transfer/new" element={<RequireModule code="documents"><TransferPage /></RequireModule>} />
        <Route path="/transfer/edit" element={<RequireModule code="documents"><TransferPage /></RequireModule>} />
        <Route path="/e-transport" element={<RequireModule code="documents"><ETransportPage /></RequireModule>} />
        <Route path="/e-transport/new" element={<RequireModule code="documents"><ETransportPage /></RequireModule>} />
        <Route path="/e-transport/edit" element={<RequireModule code="documents"><ETransportPage /></RequireModule>} />

        <Route path="/gestiune" element={<RequireModule code="inventory"><Navigate to="/gestiune/stoc" replace /></RequireModule>} />
        <Route path="/gestiune/stoc" element={<RequireModule code="inventory"><Stoc /></RequireModule>} />
        <Route path="/gestiune/productie" element={<RequireModule code="inventory"><Productie /></RequireModule>} />
        <Route path="/gestiune/inventare" element={<RequireModule code="inventory"><Inventare /></RequireModule>} />
        <Route path="/inregistrare-document/inventar/new" element={<RequireModule code="inventory"><InventarNou /></RequireModule>} />
        <Route path="/inregistrare-document/bon-consum/new" element={<RequireModule code="documents"><BonConsumNou /></RequireModule>} />

        <Route path="/documente" element={<RequireModule code="documents"><Documente /></RequireModule>} />
        <Route path="/documente/facturi-primite-spv" element={<RequireModule code="documents"><FacturiPrimiteSPVPage /></RequireModule>} />
        <Route path="/rapoarte" element={<RequireModule code="reports"><Rapoarte /></RequireModule>} />
        <Route path="/rapoarte/export-contabilitate" element={<RequireModule code="reports"><ExportContabilitatePage /></RequireModule>} />
        <Route path="/financiar/vanzari-bon" element={<FinanceReceipts />} />
        <Route path="/financiar/inchideri-zilnice" element={<FinanceClosures />} />

        <Route path="/nomenclator" element={<RequireModule code="nomenclature"><Nomenclator /></RequireModule>} />
        <Route path="/nomenclator/produse" element={<RequireModule code="nomenclature"><Produse /></RequireModule>} />
        <Route path="/nomenclator/furnizori" element={<RequireModule code="nomenclature"><Furnizori /></RequireModule>} />
        <Route path="/nomenclator/clienti" element={<RequireModule code="nomenclature"><Clienti /></RequireModule>} />
        <Route path="/nomenclator/locatii" element={<RequireModule code="nomenclature"><Locatii /></RequireModule>} />
        <Route path="/nomenclator/uom" element={<RequireModule code="nomenclature"><UomPage /></RequireModule>} />
        <Route path="/nomenclator/departamente" element={<RequireModule code="nomenclature"><DepartamentePage /></RequireModule>} />
        <Route path="/nomenclator/categorii" element={<RequireModule code="nomenclature"><CategoriiPage /></RequireModule>} />

        <Route path="/setari" element={<RequireModule code="settings"><Setari /></RequireModule>} />
        <Route path="/setari/firma" element={<RequireModule code="settings"><FirmaPage /></RequireModule>} />
        <Route path="/setari/tva" element={<RequireModule code="settings"><TvaPage /></RequireModule>} />
        <Route path="/setari/numerotare" element={<RequireModule code="settings"><SetariNumerotarePage /></RequireModule>} />
        <Route path="/setari/efactura" element={<RequireModule code="settings"><SetariEFacturaPage /></RequireModule>} />
        <Route path="/setari/utilizatori" element={<RequireModule code="settings"><UtilizatoriPage /></RequireModule>} />
        <Route path="/setari/backup" element={<RequireModule code="settings"><SetariBackupPage /></RequireModule>} />
        <Route path="/setari/kds" element={<Navigate to="/setari/utilizatori" replace />} />
        <Route path="/setari/istoric" element={<RequireModule code="settings"><IstoricActiuniPage /></RequireModule>} />

        <Route path="*" element={<div className="p-6">Pagina nu exista.</div>} />
      </Route>
    </Routes>
  )
}


