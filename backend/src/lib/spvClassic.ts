export const SPV_CLASSIC_UNAVAILABLE_MESSAGE =
  "Sincronizarea Facturi primite SPV foloseste fluxul clasic SPVWS2 cu certificat digital calificat si nu este inca implementata separat in Gufo. Tokenul OAuth e-Factura nu este suficient pentru acest ecran."

export function getSpvClassicStatus() {
  return {
    mode: "spvws2",
    authType: "qualified_certificate",
    implemented: false,
    endpoints: {
      listMessages: "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje?zile=50",
      download: "https://webserviced.anaf.ro/SPVWS2/rest/descarcare?id=...",
    },
    requirements: [
      "Certificat digital calificat pentru autentificare SPV clasica.",
      "Separare fata de fluxul OAuth e-Factura folosit la tokenul ANAF.",
      "Implementare dedicata pentru lista mesaje si descarcare documente SPVWS2.",
    ],
    message: SPV_CLASSIC_UNAVAILABLE_MESSAGE,
  }
}
