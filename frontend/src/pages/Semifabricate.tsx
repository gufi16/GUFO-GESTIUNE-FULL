import { ProductsCatalogPage } from "./Produse"

export default function SemifabricatePage() {
  return (
    <ProductsCatalogPage
      title="Semifabricate"
      subtitle="Gestionezi separat preparatele intermediare, cum ar fi sosuri, mixuri sau baze, cu retetare si control operational clar."
      fixedClassValue="SEMIFABRICATE"
      addButtonLabel="Adauga semifabricat"
      searchPlaceholder="Cauta semifabricat dupa nume, cod, categorie sau departament..."
      hideSalePrice
    />
  )
}
