import { ProductsCatalogPage } from "./Produse"

export default function MateriiPrimePage() {
  return (
    <ProductsCatalogPage
      title="Materii prime"
      subtitle="Controlezi materiile prime folosite in productie, retetare si consum intern, separate clar de marfa si produse finite."
      fixedClassValue="MATERIE_PRIMA"
      addButtonLabel="Adauga materie prima"
      searchPlaceholder="Cauta materie prima dupa nume, cod, categorie sau departament..."
      hideSalePrice
    />
  )
}
