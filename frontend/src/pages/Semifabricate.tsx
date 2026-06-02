import { ProductsCatalogPage } from "./Produse"

export default function SemifabricatePage() {
  return (
    <ProductsCatalogPage
      title="Semifabricate"
      subtitle="Gestionezi registrul de semifabricate, cu preparatele intermediare folosite mai departe in productie, retete si control operational."
      fixedClassValue="SEMIFABRICATE"
      addButtonLabel="Adauga semifabricat"
      searchPlaceholder="Cauta semifabricat dupa nume, cod, categorie sau departament..."
      hideSalePrice
    />
  )
}
