import { ProductsCatalogPage } from "./Produse"

export default function MateriiPrimePage() {
  return (
    <ProductsCatalogPage
      title="Materii prime"
      subtitle="Controlezi registrul materiilor prime folosite in productie, retetare si consum intern, separat clar de marfa si produsele finite."
      fixedClassValue="MATERIE_PRIMA"
      addButtonLabel="Adauga materie prima"
      searchPlaceholder="Cauta materie prima dupa nume, cod, categorie sau departament..."
      hideSalePrice
    />
  )
}
