import { useEffect } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import AppShell from "./components/AppShell"
import RequireAuth from "./components/RequireAuth"
import Login from "./pages/Login"

import Dashboard from "./pages/Dashboard"
import InregistrareDocument from "./pages/InregistrareDocument"
import Gestiune from "./pages/Gestiune"
import Documente from "./pages/Documente"
import Nomenclator from "./pages/Nomenclator"
import Setari from "./pages/Setari"
import Produse from "./pages/Produse"
import Furnizori from "./pages/Furnizori"
import Locatii from "./pages/Locatii"
import Stoc from "./pages/Stoc"
import NirListPage from "./pages/nir-list"
import NirPage from "./pages/nir"
import NirPrintPage from "./pages/nir-print"
import TransferPage from "./pages/transfer"

import UomPage from "./pages/uom"
import DepartamentePage from "./pages/departamente"
import CategoriiPage from "./pages/categorii"
import TvaPage from "./pages/tva"
import FirmaPage from "./pages/firma"

export default function App() {
  useEffect(() => {
    document.title = "GuFo GesTiuNe"
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

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
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/inregistrare-document" element={<InregistrareDocument />} />
        <Route path="/inregistrare-document/nir" element={<NirListPage />} />
        <Route path="/inregistrare-document/nir/new" element={<NirPage />} />
        <Route path="/inregistrare-document/nir/edit" element={<NirPage />} />

        <Route path="/transfer" element={<TransferPage />} />
        <Route path="/transfer/new" element={<TransferPage />} />
        <Route path="/transfer/edit" element={<TransferPage />} />

        <Route path="/gestiune" element={<Gestiune />} />
        <Route path="/gestiune/stoc" element={<Stoc />} />

        <Route path="/documente" element={<Documente />} />

        <Route path="/nomenclator" element={<Nomenclator />} />
        <Route path="/nomenclator/produse" element={<Produse />} />
        <Route path="/nomenclator/furnizori" element={<Furnizori />} />
        <Route path="/nomenclator/locatii" element={<Locatii />} />
        <Route path="/nomenclator/uom" element={<UomPage />} />
        <Route path="/nomenclator/departamente" element={<DepartamentePage />} />
        <Route path="/nomenclator/categorii" element={<CategoriiPage />} />

        <Route path="/setari" element={<Setari />} />
        <Route path="/setari/firma" element={<FirmaPage />} />
        <Route path="/setari/tva" element={<TvaPage />} />

        <Route path="*" element={<div className="p-6">Pagina nu există.</div>} />
      </Route>
    </Routes>
  )
}