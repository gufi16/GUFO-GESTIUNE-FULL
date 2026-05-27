import { ProductsCatalogPage } from "./Produse"

export default function MateriiPrimePage() {
  return (
    <ProductsCatalogPage
      title="Materii prime"
      subtitle="Organizezi separat materiile prime folosite in productie, retetare si consum intern."
      fixedClassValue="MATERIE_PRIMA"
      addButtonLabel="Adauga materie prima"
      searchPlaceholder="Cauta materie prima dupa nume, cod, categorie sau departament..."
      hideSalePrice
    />
  )
}
