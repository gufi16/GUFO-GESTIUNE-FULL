export const SPV_CLASSIC_UNAVAILABLE_MESSAGE =
  "Sincronizarea Facturi primite SPV foloseste fluxul clasic SPVWS2 cu certificat digital calificat si nu este inca implementata separat in Gufo. Tokenul OAuth e-Factura nu este suficient pentru acest ecran."

export function getSpvClassicStatus() {
  return {
    mode: "spvws2",
    implemented: false,
    message: SPV_CLASSIC_UNAVAILABLE_MESSAGE,
  }
}
