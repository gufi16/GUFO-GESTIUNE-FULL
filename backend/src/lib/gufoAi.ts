type GufoAiGuide = {
  id: string
  title: string
  routePrefixes: string[]
  keywords: string[]
  summary: string
  keyFields?: string[]
  whereTo: string[]
  howTo: string[]
  troubleshooting: string[]
  suggestions: string[]
}

type GufoAiInput = {
  message: string
  currentPath?: string | null
  pageContext?: {
    pageLabel: string
    title?: string
    headings?: string[]
    selectedValues?: string[]
    visibleActions?: string[]
    warnings?: string[]
  }
  history?: Array<{ role: "user" | "assistant"; text: string }>
}

type GufoAiReply = {
  title: string
  answer: string
  suggestions: string[]
}

type ConversationTone = "warm" | "direct" | "supportive"

const FORBIDDEN_KEYWORDS = [
  "control panel",
  "subdomeniu",
  "subdomain",
  "licenta",
  "licente",
  "tenant",
  "saas",
  "clienti saas",
  "admin global",
  "developer",
  "dezvoltator",
]

function normalizeContextList(values?: string[], maxItems = 4) {
  return (values || [])
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function buildPageContextSummary(pageContext?: GufoAiInput["pageContext"]) {
  if (!pageContext) return ""

  const parts: string[] = []
  const title = String(pageContext.title || pageContext.pageLabel || "").trim()
  const headings = normalizeContextList(pageContext.headings)
  const selectedValues = normalizeContextList(pageContext.selectedValues)
  const visibleActions = normalizeContextList(pageContext.visibleActions, 5)
  const warnings = normalizeContextList(pageContext.warnings, 4)

  if (title) parts.push(`Pagina deschisa acum este ${title}.`)
  if (headings.length > 1) parts.push(`In zona asta se vad si sectiunile: ${headings.slice(1).join(", ")}.`)
  if (selectedValues.length) parts.push(`Valorile sau filtrele vizibile acum sunt: ${selectedValues.join(", ")}.`)
  if (visibleActions.length) parts.push(`Actiunile rapide pe care le vad acum sunt: ${visibleActions.join(", ")}.`)
  if (warnings.length) parts.push(`Observatii importante vazute direct in pagina: ${warnings.join(" ")}.`)

  return parts.join("\n")
}

function appendLiveContext(answer: string, pageContext?: GufoAiInput["pageContext"]) {
  const summary = buildPageContextSummary(pageContext)
  if (!summary) return answer
  if (answer.includes("Pagina deschisa acum este")) return answer
  return `${answer}\n\nCe vad acum in ERP:\n${summary}`
}

const GUIDES: GufoAiGuide[] = [
  {
    id: "nir",
    title: "NIR",
    routePrefixes: ["/inregistrare-document/nir", "/inregistrare-document/nir/new", "/inregistrare-document/nir/edit"],
    keywords: ["nir", "receptie", "furnizor", "intrare marfa", "doc no", "curs valutar", "fx", "receptie marfa"],
    summary: "Aici faci nota de intrare receptie pentru marfa sau materii prime intrate de la furnizor.",
    keyFields: ["Locatie", "Furnizor", "Numar document", "Data document", "Moneda", "Curs valutar", "Linii produse"],
    whereTo: [
      "Mergi la Inregistrare document > NIR.",
      "Poti crea un NIR nou sau edita un document existent, daca este in lucru.",
    ],
    howTo: [
      "Selecteaza locatia si furnizorul.",
      "Completeaza numarul documentului, data si moneda.",
      "Adauga produsele pe linii, apoi cantitatea, pretul si TVA-ul.",
      "Salveaza documentul dupa ce verifici totalurile.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica furnizorul, locatia si liniile de produse.",
      "Daca totalurile sunt gresite, verifica pretul, cantitatea, factorul si TVA-ul pe fiecare linie.",
      "Daca lucrezi in alta moneda, verifica si cursul valutar.",
    ],
    suggestions: ["Cum fac un NIR cu mai multe produse?", "Ce completez la curs valutar?", "De ce nu pot salva NIR-ul?"],
  },
  {
    id: "factura",
    title: "Factura",
    routePrefixes: ["/inregistrare-document/factura", "/inregistrare-document/factura/new", "/inregistrare-document/factura/edit"],
    keywords: ["factura", "client", "scadenta", "emit factura", "efactura", "e-factura"],
    summary: "Aici emiti factura pentru client, completezi liniile si, daca este cazul, pregatesti trimiterea e-Factura.",
    keyFields: ["Locatie", "Client", "Numar factura", "Data", "Scadenta", "Moneda", "Linii produse"],
    whereTo: [
      "Mergi la Inregistrare document > Factura.",
      "Alegi clientul, completezi antetul si apoi adaugi liniile de pe factura.",
    ],
    howTo: [
      "Selecteaza locatia si clientul.",
      "Completeaza numarul facturii, data si scadenta.",
      "Adauga produsele sau serviciile pe linii.",
      "Salveaza factura si verifica statusul ei.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica locatia, clientul si liniile facturii.",
      "Daca vrei e-Factura, verifica datele clientului si campurile obligatorii.",
      "Daca totalurile nu ies corect, verifica pretul, cantitatea si TVA-ul.",
    ],
    suggestions: ["Cum emit o factura?", "Ce trebuie completat la client?", "De ce nu merge e-Factura?"],
  },
  {
    id: "bon-consum",
    title: "Bon de consum",
    routePrefixes: ["/inregistrare-document/bon-consum/new"],
    keywords: ["bon consum", "consum", "iesire consum", "consum intern"],
    summary: "Aici creezi bonul de consum pentru produsele iesite din stoc prin consum intern.",
    keyFields: ["Locatie", "Produse", "Cantitate", "Observatii"],
    whereTo: [
      "Mergi la Inregistrare document > Bon de consum.",
      "Alegi locatia si adaugi produsele consumate.",
    ],
    howTo: [
      "Selecteaza locatia.",
      "Cauta produsul si adauga-l in document.",
      "Completeaza cantitatea consumata pentru fiecare produs.",
      "Salveaza bonul dupa ce verifici liniile.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica locatia si daca ai cel putin un produs in document.",
      "Daca stocul pare gresit, reincarca stocul locatiei si verifica produsul ales.",
      "Daca produsul exista deja in document, modifica direct cantitatea lui.",
    ],
    suggestions: ["Cum fac un bon de consum?", "De ce nu pot salva bonul?", "Cum schimb cantitatea unui produs?"],
  },
  {
    id: "inventar-nou",
    title: "Inventar nou",
    routePrefixes: ["/inregistrare-document/inventar/new"],
    keywords: ["inventar nou", "numarare stoc", "cantitate numarata", "diferenta inventar"],
    summary: "Aici creezi un document nou de inventar si compari stocul scriptic cu cantitatea numarata.",
    keyFields: ["Locatie", "Produse", "Cantitate scriptica", "Cantitate numarata", "Diferenta", "Observatii"],
    whereTo: [
      "Mergi la Inregistrare document > Inventar nou.",
      "Alegi locatia si adaugi produsele pe care vrei sa le numeri.",
    ],
    howTo: [
      "Selecteaza locatia.",
      "Cauta si adauga produsele in document.",
      "Completeaza cantitatea numarata pentru fiecare produs.",
      "Salveaza inventarul dupa ce verifici diferentele.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica locatia si liniile din document.",
      "Cantitatea numarata nu poate fi negativa.",
      "Daca produsul este deja in lista, modifica direct valoarea lui din coloana de numarare.",
    ],
    suggestions: ["Cum fac un inventar nou?", "Ce inseamna diferenta la inventar?", "De ce nu pot salva inventarul?"],
  },
  {
    id: "dashboard",
    title: "Panou principal",
    routePrefixes: ["/dashboard"],
    keywords: ["dashboard", "panou", "vanzari", "grafice", "indicatori"],
    summary: "Aici vezi rapid vanzarile, incasarile si indicatorii principali pentru intervalul selectat.",
    whereTo: [
      "Intra in Panou principal din meniul din stanga.",
      "Sus poti filtra dupa perioada, locatie si device, daca exista date pentru ele.",
    ],
    howTo: [
      "Selecteaza perioada din filtrele de sus.",
      "Daca vrei o locatie anume, alege locatia din selector.",
      "Daca vrei un singur POS, alege device-ul din selectorul de device.",
    ],
    troubleshooting: [
      "Daca nu vezi vanzari, verifica intai perioada selectata.",
      "Daca tot nu apar date, verifica locatia sau device-ul ales.",
      "Daca este tot gol, inseamna de obicei ca nu exista vanzari salvate pentru filtrul curent.",
    ],
    suggestions: ["Cum filtrez vanzarile pe locatie?", "De ce nu vad date in dashboard?", "Cum aleg un device?"],
  },
  {
    id: "produse",
    title: "Produse",
    routePrefixes: ["/nomenclator/produse"],
    keywords: ["produs", "produse", "retetar", "pret", "sgr", "categorie"],
    summary: "Aici administrezi produsele, preturile, clasificarea, vizibilitatea in POS si retetarele.",
    whereTo: [
      "Mergi la Nomenclator > Produse.",
      "Din lista poti cauta produsul sau poti apasa pe Adauga produs.",
    ],
    howTo: [
      "Apasa pe Adauga produs.",
      "Completeaza denumirea, clasificarea, unitatea de masura si pretul.",
      "Daca produsul are retetar, salveaza produsul si apoi completeaza retetarul.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica denumirea, UM si TVA-ul, daca firma este platitoare de TVA.",
      "Daca produsul ramane inactiv, completeaza retetarul pentru produs finit sau semifabricat.",
      "Daca nu apare in POS, verifica optiunea Vizibil in POS.",
    ],
    suggestions: ["Cum adaug un produs?", "Cum completez retetarul?", "De ce nu apare produsul in POS?"],
  },
  {
    id: "locatii",
    title: "Locatii",
    routePrefixes: ["/nomenclator/locatii"],
    keywords: ["locatie", "locatii", "magazin", "depozit", "punct de lucru"],
    summary: "Aici salvezi magazinele, depozitele si punctele de lucru folosite in ERP si POS.",
    whereTo: [
      "Mergi la Nomenclator > Locatii.",
      "In partea de sus completezi formularul, iar mai jos vezi lista existenta.",
    ],
    howTo: [
      "Completeaza numele si codul locatiei.",
      "Apasa pe Salveaza locatia.",
      "Dupa salvare, locatia poate fi folosita in documente, stoc si POS.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica numele si codul locatiei.",
      "Daca nu vezi locatia in alte pagini, reincarca pagina dupa salvare.",
    ],
    suggestions: ["Cum adaug o locatie?", "De ce nu pot salva locatia?", "Unde vad locatiile existente?"],
  },
  {
    id: "inventare",
    title: "Inventare",
    routePrefixes: ["/gestiune/inventare", "/inregistrare-document/inventar/new"],
    keywords: ["inventar", "inventare", "numarare", "diferenta stoc"],
    summary: "Aici creezi inventare noi si verifici documentele de inventar deja salvate.",
    whereTo: [
      "Pentru un inventar nou mergi la Inregistrare document > Inventar nou.",
      "Pentru lista documentelor mergi la Gestiune > Inventare.",
    ],
    howTo: [
      "Alege locatia.",
      "Cauta produsele si adauga-le in document.",
      "Completeaza cantitatea numarata si salveaza inventarul.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica daca ai ales o locatie.",
      "Daca documentul are erori, verifica produsele si cantitatile numarate.",
      "Cantitatea numarata nu poate fi negativa.",
    ],
    suggestions: ["Cum fac un inventar nou?", "Unde vad inventarele salvate?", "De ce nu pot salva inventarul?"],
  },
  {
    id: "transfer",
    title: "Transfer",
    routePrefixes: ["/transfer"],
    keywords: ["transfer", "mut stoc", "mutare stoc", "transfer intre locatii"],
    summary: "Aici muti stoc intre doua locatii si salvezi documentul de transfer.",
    whereTo: [
      "Mergi la Transfer din meniul ERP.",
      "Alegi locatia sursa, locatia destinatie si produsele transferate.",
    ],
    howTo: [
      "Selecteaza locatia de plecare.",
      "Selecteaza locatia de sosire.",
      "Adauga produsele si cantitatile, apoi salveaza si posteaza documentul.",
    ],
    troubleshooting: [
      "Locatia sursa si locatia destinatie trebuie sa fie diferite.",
      "Verifica sa ai cel putin un produs in document.",
      "Daca nu poti salva, verifica sesiunea si campurile obligatorii.",
    ],
    suggestions: ["Cum fac un transfer?", "De ce nu pot salva transferul?", "Cum aleg locatia sursa?"],
  },
  {
    id: "documente",
    title: "Documente",
    routePrefixes: ["/documente", "/inregistrare-document", "/inregistrare-document/nir", "/inregistrare-document/factura", "/inregistrare-document/bon-consum"],
    keywords: ["document", "nir", "factura", "bon consum", "proces verbal", "receptie"],
    summary: "Aici lucrezi cu documentele de intrare, consum, facturi si alte documente operationale.",
    whereTo: [
      "Mergi in zona Inregistrare document sau Documente, in functie de ce vrei sa faci.",
      "Din lista poti deschide documentele existente sau poti crea un document nou.",
    ],
    howTo: [
      "Alege tipul de document de care ai nevoie.",
      "Completeaza antetul documentului si apoi liniile.",
      "Salveaza documentul, iar daca este cazul posteaza-l.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica locatia, partenerul si liniile documentului.",
      "Daca lipsesc documente din lista, verifica filtrul de perioada.",
    ],
    suggestions: ["Cum fac un NIR?", "Cum fac un bon de consum?", "Unde vad documentele salvate?"],
  },
  {
    id: "productie",
    title: "Productie",
    routePrefixes: ["/gestiune/productie"],
    keywords: ["productie", "produce", "semifabricat", "produs finit"],
    summary: "Aici generezi documente de productie pentru produsele finite sau semifabricate.",
    whereTo: [
      "Mergi la Gestiune > Productie.",
      "Alege locatia si apoi produsele pe care vrei sa le produci.",
    ],
    howTo: [
      "Selecteaza locatia.",
      "Adauga produsul in productie si cantitatea dorita.",
      "Genereaza documentul de productie.",
    ],
    troubleshooting: [
      "Cantitatea trebuie sa fie mai mare decat 0.",
      "Daca produsul nu poate fi produs corect, verifica retetarul lui.",
    ],
    suggestions: ["Cum fac productie?", "De ce nu pot genera productia?", "Ce produse au nevoie de retetar?"],
  },
  {
    id: "rapoarte",
    title: "Rapoarte",
    routePrefixes: ["/rapoarte"],
    keywords: ["raport", "rapoarte", "profit", "top produse", "marja"],
    summary: "Aici vezi rapoarte despre vanzari, profit, evolutie, produse si locatii.",
    whereTo: [
      "Mergi la Rapoarte din meniul ERP.",
      "Sus poti filtra dupa perioada, locatie si device.",
    ],
    howTo: [
      "Alege perioada pe care vrei sa o analizezi.",
      "Daca vrei detalii pe locatie sau device, selecteaza filtrul potrivit.",
      "Citeste KPI-urile si graficele din sectiunile raportului.",
    ],
    troubleshooting: [
      "Daca raportul este gol, verifica perioada si filtrele.",
      "Daca nu apar vanzari, inseamna ca nu exista date pentru filtrul selectat.",
    ],
    suggestions: ["Cum filtrez raportul pe device?", "De ce raportul este gol?", "Unde vad top produse?"],
  },
  {
    id: "utilizatori",
    title: "Utilizatori ERP",
    routePrefixes: ["/setari/utilizatori"],
    keywords: ["utilizator", "utilizatori", "parola", "rol", "administrator"],
    summary: "Aici administrezi utilizatorii care au acces in ERP.",
    whereTo: [
      "Mergi la Setari > Utilizatori ERP.",
      "Din aceasta pagina poti crea, edita sau dezactiva utilizatori.",
    ],
    howTo: [
      "Apasa pe Adauga utilizator sau editeaza unul existent.",
      "Completeaza numele, emailul, rolul si parola, daca este necesar.",
      "Salveaza utilizatorul.",
    ],
    troubleshooting: [
      "Daca utilizatorul nu se poate autentifica, verifica emailul, parola si rolul.",
      "Daca nu apare in lista, reincarca pagina dupa salvare.",
    ],
    suggestions: ["Cum adaug un utilizator?", "Cum schimb parola unui utilizator?", "Ce roluri exista in ERP?"],
  },
  {
    id: "istoric",
    title: "Istoric actiuni",
    routePrefixes: ["/setari/istoric"],
    keywords: ["istoric", "actiuni", "cine a facut", "audit"],
    summary: "Aici vezi cine a facut modificari in ERP, ce a facut, unde si cand.",
    whereTo: [
      "Mergi la Setari > Istoric actiuni.",
      "Poti cauta dupa nume, actiune sau zona si poti filtra dupa perioada.",
    ],
    howTo: [
      "Scrie in cautare numele utilizatorului sau tipul de actiune.",
      "Selecteaza perioada daca vrei doar un interval.",
      "Lista are scroll si afiseaza doar actiunile din ERP.",
    ],
    troubleshooting: [
      "Daca nu vezi nimic, verifica perioada selectata.",
      "Doar administratorii sau proprietarul pot vedea istoricul.",
    ],
    suggestions: ["Cum caut dupa utilizator?", "De ce nu vad evenimente?", "Cum filtrez pe perioada?"],
  },
  {
    id: "setari",
    title: "Setari",
    routePrefixes: ["/setari"],
    keywords: ["setari", "firma", "tva", "numerotare", "efactura"],
    summary: "Aici gestionezi setarile firmei, numerotarea, e-Factura si utilizatorii ERP.",
    whereTo: [
      "Mergi la Setari din meniul ERP.",
      "Alege apoi sectiunea dorita: Firma, TVA, Numerotare, e-Factura, Utilizatori sau Istoric.",
    ],
    howTo: [
      "Intra in sectiunea potrivita pentru ce vrei sa modifici.",
      "Completeaza campurile si salveaza modificarile.",
    ],
    troubleshooting: [
      "Daca nu poti salva, verifica toate campurile obligatorii din sectiunea curenta.",
      "Unele optiuni sunt vizibile doar daca modulul respectiv este activ.",
    ],
    suggestions: ["Unde schimb datele firmei?", "Unde gasesc numerotarea?", "Unde vad istoricul?"],
  },
]

const EXTRA_GUIDES: GufoAiGuide[] = [
  {
    id: "overview",
    title: "Gufo ERP",
    routePrefixes: ["/"],
    keywords: [
      "gufo",
      "erp",
      "aplicatie",
      "module",
      "ce face",
      "ce stie",
      "cum functioneaza",
      "client",
      "clienti",
    ],
    summary:
      "Gufo ERP acopera operatiunile zilnice din firma: vanzari, documente, stoc, productie, SPV/ANAF, rapoarte, financiar, nomenclator si setari.",
    whereTo: [
      "Dashboard iti arata rapid vanzari, incasari, alerte si indicatori.",
      "Inregistrare documente este zona pentru NIR, factura, bon de consum, inventar nou si procese verbale.",
      "Gestiune strange stocul, productia si inventarele.",
      "SPV si ANAF este zona pentru facturi primite/trimise prin SPV si registrul RO e-Transport.",
      "Rapoarte, Financiar, Nomenclator si Setari acopera analiza, inchiderile POS, partenerii, produsele si configurarea firmei.",
    ],
    howTo: [
      "Spui natural ce vrei sa faci, de exemplu: cum emit o factura, unde vad stocul sau de ce nu merge ANAF.",
      "Daca esti deja pe o pagina, Gufo AI tine cont de pagina curenta.",
      "Pentru probleme, scrie mesajul exact sau pasul unde te-ai blocat si primesti verificari clare.",
    ],
    troubleshooting: [
      "Daca raspunsul nu nimereste modulul, mentioneaza numele paginii sau documentului.",
      "Daca lipsesc date, verifica perioada, locatia, firma activa si drepturile utilizatorului.",
      "Pentru ANAF/SPV, verifica intai tokenul, mediul Productie/Test si firma activa.",
    ],
    suggestions: ["Ce module are aplicatia?", "Cum lucrez cu SPV si ANAF?", "Unde vad stocul si rapoartele?"],
  },
  {
    id: "stoc",
    title: "Stoc",
    routePrefixes: ["/gestiune/stoc"],
    keywords: ["stoc", "cantitate", "sold", "depozit", "gestiune", "valoare stoc", "miscari stoc", "stoc critic"],
    summary: "Aici vezi stocul pe produse si locatii, cantitatile disponibile si zonele unde trebuie verificata marfa.",
    keyFields: ["Locatie", "Produs", "Cod produs", "Cantitate", "Unitate de masura", "Valoare stoc"],
    whereTo: [
      "Mergi la Gestiune > Stoc.",
      "Alege locatia daca vrei sa vezi stocul doar pentru un depozit sau punct de lucru.",
    ],
    howTo: [
      "Filtreaza dupa locatie sau cauta produsul dupa nume/cod.",
      "Verifica randul produsului pentru cantitate si valoare.",
      "Pentru corectii foloseste documentele potrivite: NIR, bon de consum, transfer sau inventar.",
    ],
    troubleshooting: [
      "Daca stocul pare gresit, verifica documentele salvate pentru produs si locatie.",
      "Daca lipseste produsul, verifica daca produsul este activ si daca exista miscari pe locatia aleasa.",
      "Daca vezi zero, verifica daca filtrul de locatie nu ascunde stocul din alta gestiune.",
    ],
    suggestions: ["Unde vad stocul pe locatie?", "De ce produsul are stoc zero?", "Cum corectez stocul?"],
  },
  {
    id: "spv-settings",
    title: "Setari SPV",
    routePrefixes: ["/setari/efactura"],
    keywords: [
      "setari spv",
      "setari e-factura",
      "anaf",
      "spv",
      "token anaf",
      "genereaza token",
      "oauth",
      "certificat",
      "semnatura electronica",
      "mediu productie",
    ],
    summary:
      "Aici configurezi conectarea firmei la ANAF/SPV: mediul de lucru, tokenul OAuth si datele folosite pentru comunicarea cu e-Factura si e-Transport.",
    keyFields: ["Firma activa", "Mediu", "Token ANAF", "Generat la", "Expira la", "Profil OAuth"],
    whereTo: [
      "Mergi la Setari > Setari SPV.",
      "Verifica firma activa in partea de sus inainte sa generezi tokenul.",
    ],
    howTo: [
      "Alege firma pentru care lucrezi.",
      "Verifica mediul ANAF: Productie pentru live sau Test pentru probe.",
      "Apasa Genereaza token si finalizeaza autentificarea ANAF in browser.",
      "Dupa intoarcerea in ERP, verifica statusul Conectat si data expirarii.",
    ],
    troubleshooting: [
      "Daca nu se deschide ANAF, verifica popup-urile/browserul si incearca din nou dupa logout ANAF.",
      "Daca se foloseste certificatul gresit, browserul poate tine minte sesiunea ANAF; inchide sesiunea ANAF sau foloseste profil/browser separat.",
      "Daca e-Transport sau e-Factura nu comunica, verifica tokenul, firma activa si mediul Productie/Test.",
    ],
    suggestions: ["Cum generez token ANAF?", "De ce nu apare autentificarea ANAF?", "Ce verific daca SPV nu comunica?"],
  },
  {
    id: "facturi-spv",
    title: "Facturi SPV",
    routePrefixes: ["/documente/facturi-primite-spv"],
    keywords: [
      "facturi primite spv",
      "facturi trimise spv",
      "facturi spv",
      "facturi din spv",
      "facturile din spv",
      "aduc facturi",
      "descarc facturi",
      "furnizor",
      "client",
      "xml",
      "pdf",
      "raspuns anaf",
      "sincronizare spv",
      "descarcare spv",
    ],
    summary:
      "Aici verifici facturile din SPV: facturile primite de la furnizori si facturile trimise catre clienti prin ANAF, cu XML, PDF si raspunsuri disponibile cand exista in SPV.",
    keyFields: ["Firma activa", "Perioada", "Tip facturi", "Status SPV", "XML", "PDF", "Raspuns ANAF"],
    whereTo: [
      "Mergi la SPV si ANAF > Facturi primite SPV.",
      "Foloseste filtrele de perioada si tip pentru facturi primite sau trimise.",
    ],
    howTo: [
      "Verifica firma activa si tokenul ANAF.",
      "Sincronizeaza mesajele din SPV pentru perioada dorita.",
      "Deschide factura si descarca XML, PDF sau raspunsul ANAF din actiunile disponibile.",
    ],
    troubleshooting: [
      "Daca nu apar facturi, verifica perioada si firma activa.",
      "Daca ANAF refuza accesul, verifica tokenul si certificatul folosit pentru firma respectiva.",
      "Daca lipseste PDF-ul, descarca XML-ul si raspunsul ANAF; PDF-ul exista doar cand este generat/disponibil pentru document.",
    ],
    suggestions: ["Cum aduc facturile primite din SPV?", "Unde vad facturile trimise?", "Cum descarc XML si raspuns ANAF?"],
  },
  {
    id: "etransport",
    title: "RO e-Transport",
    routePrefixes: ["/e-transport"],
    keywords: [
      "e-transport",
      "etransport",
      "transport",
      "uit",
      "vehicul",
      "sofer",
      "trimite anaf",
      "verificare stare",
      "verific stare",
      "xml transport",
      "raspuns transport",
    ],
    summary:
      "Aici pregatesti si urmaresti transporturile raportate la ANAF, inclusiv generarea XML-ului, trimiterea la ANAF, verificarea starii si descarcarea raspunsului.",
    keyFields: ["Tip operatiune", "Partener", "Loc incarcare", "Loc descarcare", "Vehicul", "Produse", "Greutati", "UIT"],
    whereTo: [
      "Mergi la SPV si ANAF > Registru e-Transport.",
      "Deschide un transport existent sau creeaza unul nou.",
    ],
    howTo: [
      "Completeaza datele transportului si produsele.",
      "Apasa Verificare date ca sa vezi campurile lipsa sau gresite.",
      "Dupa validare apasa Trimite ANAF.",
      "Foloseste Verificare stare pentru status si descarca XML/raspuns din butonul de descarcare.",
    ],
    troubleshooting: [
      "Daca verificarea da erori, completeaza campurile cerute: partener, adrese, vehicul, produse si greutati.",
      "Daca trimiterea nu merge, verifica tokenul ANAF in Setari SPV si mediul Productie/Test.",
      "Daca nu ai UIT, ruleaza Verificare stare dupa trimitere.",
    ],
    suggestions: ["Cum trimit e-Transport la ANAF?", "De ce nu primesc UIT?", "Cum descarc XML si raspunsul?"],
  },
  {
    id: "financiar",
    title: "Financiar",
    routePrefixes: ["/financiar/vanzari-bon", "/financiar/inchideri-zilnice"],
    keywords: ["financiar", "vanzari bon", "bonuri", "incasari", "pos", "inchideri zilnice", "z fiscal", "inchidere zi"],
    summary: "Aici urmaresti vanzarile POS, bonurile si inchiderile zilnice generate din activitatea punctelor de lucru.",
    keyFields: ["Perioada", "Locatie", "Device/POS", "Total vanzari", "Metode de plata", "Data inchiderii"],
    whereTo: [
      "Mergi la Financiar > Vanzari / Bon pentru bonurile si vanzarile POS.",
      "Mergi la Financiar > Inchideri zilnice pentru inchiderile pe zile.",
    ],
    howTo: [
      "Alege perioada si locatia.",
      "Verifica vanzarile si metodele de plata.",
      "Pentru inchideri, genereaza sau actualizeaza inchiderea zilnica din vanzarile POS.",
    ],
    troubleshooting: [
      "Daca nu vezi vanzari, verifica perioada, locatia si device-ul.",
      "Daca inchiderea nu se genereaza, verifica daca exista vanzari in ziua respectiva.",
      "Daca totalurile nu corespund, compara vanzarile filtrate cu inchiderea zilnica.",
    ],
    suggestions: ["Unde vad bonurile POS?", "Cum generez inchiderea zilnica?", "De ce nu apar vanzari?"],
  },
  {
    id: "export-contabilitate",
    title: "Export contabilitate",
    routePrefixes: ["/rapoarte/export-contabilitate"],
    keywords: ["export contabilitate", "contabilitate", "contabil", "saga", "csv", "xml", "zip", "export facturi"],
    summary: "Aici pregatesti fisierele de export pentru contabilitate pe perioada selectata.",
    keyFields: ["Perioada", "Tip documente", "Facturi", "NIR", "Vanzari", "Format export"],
    whereTo: [
      "Mergi la Rapoarte > Export contabilitate.",
      "Alege perioada si tipurile de date pe care vrei sa le predai contabilului.",
    ],
    howTo: [
      "Selecteaza perioada de export.",
      "Verifica documentele incluse.",
      "Genereaza fisierul si trimite-l contabilului.",
    ],
    troubleshooting: [
      "Daca exportul este gol, verifica perioada si documentele existente.",
      "Daca lipseste o factura, verifica daca este salvata in ERP si intra in intervalul ales.",
      "Daca fisierul nu se descarca, reincarca pagina si genereaza exportul din nou.",
    ],
    suggestions: ["Cum fac export pentru contabil?", "De ce exportul este gol?", "Ce documente intra in export?"],
  },
  {
    id: "parteneri",
    title: "Clienti si furnizori",
    routePrefixes: ["/nomenclator/clienti", "/nomenclator/furnizori"],
    keywords: ["client", "clienti", "furnizor", "furnizori", "partener", "cui", "cif", "adresa", "anaf date firma"],
    summary: "Aici administrezi partenerii firmei: clienti si furnizori folositi in facturi, NIR si documente.",
    keyFields: ["Denumire", "CUI/CIF", "Adresa", "Judet", "Localitate", "Email", "Telefon"],
    whereTo: [
      "Mergi la Nomenclator > Clienti pentru clienti.",
      "Mergi la Nomenclator > Furnizori pentru furnizori.",
    ],
    howTo: [
      "Apasa adaugare sau editeaza partenerul existent.",
      "Completeaza datele fiscale si de contact.",
      "Salveaza, apoi foloseste partenerul in documente.",
    ],
    troubleshooting: [
      "Daca e-Factura da erori, verifica CUI-ul, adresa, localitatea si judetul clientului.",
      "Daca partenerul nu apare in document, verifica daca a fost salvat si reincarca lista.",
      "Daca ai dubluri, cauta dupa CUI inainte sa creezi unul nou.",
    ],
    suggestions: ["Cum adaug un client?", "Ce date trebuie la furnizor?", "De ce clientul nu apare in factura?"],
  },
  {
    id: "nomenclator",
    title: "Nomenclator",
    routePrefixes: ["/nomenclator", "/nomenclator/uom", "/nomenclator/departamente", "/nomenclator/categorii"],
    keywords: ["nomenclator", "unitate masura", "um", "departament", "categorie", "produse", "locatii"],
    summary:
      "Nomenclatorul tine datele de baza ale firmei: produse, clienti, furnizori, locatii, unitati de masura, departamente si categorii.",
    keyFields: ["Produse", "Clienti", "Furnizori", "Locatii", "UM", "Departamente", "Categorii"],
    whereTo: [
      "Mergi la Nomenclator din sidebar.",
      "Alege subsectiunea potrivita pentru datele pe care vrei sa le modifici.",
    ],
    howTo: [
      "Intra in lista potrivita.",
      "Adauga sau editeaza inregistrarea.",
      "Salveaza, apoi foloseste datele in documente si rapoarte.",
    ],
    troubleshooting: [
      "Daca o valoare nu apare in documente, verifica daca este salvata si activa.",
      "Daca produsul nu apare in POS, verifica setarile produsului.",
      "Daca ai date duplicate, cauta dupa cod/CUI/nume inainte de adaugare.",
    ],
    suggestions: ["Ce este nomenclatorul?", "Unde adaug unitati de masura?", "Unde adaug categorii?"],
  },
  {
    id: "firma-setari",
    title: "Setari firma",
    routePrefixes: ["/setari/firma", "/setari/tva", "/setari/numerotare", "/setari/backup"],
    keywords: ["firma", "date firma", "tva", "platitor tva", "numerotare", "serie factura", "backup", "restaurare"],
    summary: "Aici configurezi datele firmei, TVA-ul, seriile de documente si backup-ul.",
    keyFields: ["Date firma", "CUI", "Adresa", "TVA", "Serii documente", "Backup"],
    whereTo: [
      "Mergi la Setari > Firma pentru datele firmei.",
      "Mergi la Setari > TVA pentru regimul TVA.",
      "Mergi la Setari > Numerotare pentru serii si numere.",
      "Mergi la Setari > Backup pentru export/restaurare date.",
    ],
    howTo: [
      "Intra in sectiunea potrivita.",
      "Completeaza sau modifica datele.",
      "Salveaza si verifica apoi un document nou daca seria sau datele firmei s-au aplicat.",
    ],
    troubleshooting: [
      "Daca datele nu apar pe factura, verifica Setari > Firma si reincarca pagina facturii.",
      "Daca seria nu se aplica, verifica Setari > Numerotare.",
      "Daca TVA-ul este gresit, verifica regimul firmei si TVA-ul produselor.",
    ],
    suggestions: ["Unde schimb datele firmei?", "Unde schimb seria facturii?", "Cum verific setarea de TVA?"],
  },
]

const ALL_GUIDES = [...GUIDES, ...EXTRA_GUIDES]

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function matchesForbiddenTopic(message: string) {
  const normalized = normalize(message)
  return FORBIDDEN_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function tokenize(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function findGuideByPath(currentPath?: string | null) {
  const pathValue = String(currentPath || "").trim()
  if (!pathValue) return null
  return (
    [...ALL_GUIDES]
      .sort((a, b) => {
        const aLen = Math.max(...a.routePrefixes.map((prefix) => prefix.length))
        const bLen = Math.max(...b.routePrefixes.map((prefix) => prefix.length))
        return bLen - aLen
      })
      .find((guide) => guide.routePrefixes.some((prefix) => pathValue.startsWith(prefix))) || null
  )
}

function scoreGuide(message: string, guide: GufoAiGuide, currentPath?: string | null) {
  const normalized = normalize(message)
  const tokens = tokenize(message)
  let score = 0

  for (const keyword of guide.keywords) {
    const normalizedKeyword = normalize(keyword)
    if (normalized.includes(normalizedKeyword)) score += normalizedKeyword.includes(" ") ? 3 : 2
    if (tokens.includes(normalizedKeyword)) score += 1
  }

  if (guide.id === "documente" && /nir|factur|bon consum|proces verbal/.test(normalized)) score += 3
  if (guide.id === "nir" && /furnizor|receptie|curs|moneda|linie|tva/.test(normalized)) score += 4
  if (guide.id === "factura" && /client|scadenta|emit|efactura|linie|tva/.test(normalized)) score += 4
  if (guide.id === "bon-consum" && /consum|cantitate|stoc|iesire/.test(normalized)) score += 4
  if (guide.id === "inventar-nou" && /numarata|scriptic|diferenta|stoc/.test(normalized)) score += 4
  if (guide.id === "rapoarte" && /profit|marja|top produse|evolutie/.test(normalized)) score += 3
  if (guide.id === "dashboard" && /incasari|indicatori|device|locatie/.test(normalized)) score += 3
  if (guide.id === "utilizatori" && /parola|rol|administrator|ospatar|manager/.test(normalized)) score += 3
  if (guide.id === "overview" && /module|aplicatie|gufo|erp|ce stie|ce face|ajuta client/.test(normalized)) score += 5
  if (guide.id === "stoc" && /stoc|cantitate|gestiune|depozit|sold|critic|valoare/.test(normalized)) score += 5
  if (guide.id === "spv-settings" && /token|anaf|spv|oauth|certificat|semnatura|productie|test/.test(normalized)) score += 5
  if (guide.id === "facturi-spv" && /factur.*spv|spv.*factur|furnizor|trimise|primite|xml|pdf|raspuns anaf/.test(normalized)) score += 6
  if (guide.id === "etransport" && /transport|uit|vehicul|sofer|trimite anaf|verificare stare|raspuns/.test(normalized)) score += 5
  if (guide.id === "financiar" && /bon|vanzari|incasari|inchideri|z fiscal|pos/.test(normalized)) score += 4
  if (guide.id === "export-contabilitate" && /export|contabil|saga|csv|zip/.test(normalized)) score += 4
  if (guide.id === "parteneri" && /client|furnizor|partener|cui|cif|adresa/.test(normalized)) score += 4
  if (guide.id === "nomenclator" && /nomenclator|um|unitate|departament|categorie/.test(normalized)) score += 4
  if (guide.id === "firma-setari" && /date firma|tva|numerotare|serie|backup|cui/.test(normalized)) score += 4
  if (currentPath && guide.routePrefixes.some((prefix) => String(currentPath).startsWith(prefix))) score += 2

  return score
}

function findGuideByMessage(message: string, currentPath?: string | null) {
  const ranked = ALL_GUIDES
    .map((guide) => ({ guide, score: scoreGuide(message, guide, currentPath) }))
    .sort((a, b) => b.score - a.score)

  if (!ranked.length || ranked[0].score <= 0) return null
  return ranked[0].guide
}

function detectIntent(message: string) {
  const normalized = normalize(message)
  if (
    ["nu pot", "nu merge", "de ce", "eroare", "problema", "nu vad", "nu apare", "nu se deschide"].some((term) =>
      normalized.includes(term),
    )
  ) {
    return "troubleshooting"
  }
  if (["unde", "de unde", "gasesc", "vad"].some((term) => normalized.includes(term))) {
    return "where"
  }
  if (
    ["cum", "adaug", "cree", "fac", "modific", "salvez", "setez", "trimit", "verific", "sincronizez", "descarc"].some((term) =>
      normalized.includes(term),
    )
  ) {
    return "how"
  }
  return "generic"
}

function isGreeting(message: string) {
  const normalized = normalize(message)
  return [
    "salut",
    "buna",
    "bunaa",
    "hello",
    "hei",
    "hey",
    "ceau",
    "servus",
    "neata",
    "buna ziua",
    "buna seara",
  ].some((term) => normalized === term || normalized.startsWith(`${term} `))
}

function isThanks(message: string) {
  const normalized = normalize(message)
  return ["mersi", "multumesc", "merci", "super mersi", "sarumana"].some(
    (term) => normalized === term || normalized.startsWith(`${term} `),
  )
}

function isFarewell(message: string) {
  const normalized = normalize(message)
  return ["pa", "bye", "la revedere", "o zi buna", "noapte buna"].some(
    (term) => normalized === term || normalized.startsWith(`${term} `),
  )
}

function isHelpPrompt(message: string) {
  const normalized = normalize(message)
  return [
    "ma poti ajuta",
    "ma ajuti",
    "poti sa ma ajuti",
    "am nevoie de ajutor",
    "ce poti sa faci",
    "cu ce ma poti ajuta",
    "vreau ajutor",
    "ce stii",
    "ce stie",
    "ce stii despre aplicatie",
    "ce module are",
    "ce face aplicatia",
    "cum functioneaza aplicatia",
  ].some((term) => normalized.includes(term))
}

function isAppOverviewPrompt(message: string) {
  const normalized = normalize(message)
  return [
    "ce stii despre aplicatie",
    "ce stie gufo",
    "ce module are",
    "ce face aplicatia",
    "ce este gufo",
    "cum functioneaza aplicatia",
    "prezinta aplicatia",
    "explica aplicatia",
  ].some((term) => normalized.includes(term))
}

function isConfused(message: string) {
  const normalized = normalize(message)
  return [
    "nu am inteles",
    "n am inteles",
    "nu inteleg",
    "mai simplu",
    "mai pe scurt",
    "explica mai simplu",
    "cum adica",
  ].some((term) => normalized.includes(term))
}

function isVeryShortAck(message: string) {
  const normalized = normalize(message)
  return ["ok", "bine", "super", "perfect", "gata"].includes(normalized)
}

function buildList(lines: string[]) {
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
}

function buildNaturalList(lines: string[]) {
  if (!lines.length) return ""
  if (lines.length === 1) return lines[0]
  if (lines.length === 2) return `${lines[0]} si ${lines[1]}`
  return `${lines.slice(0, -1).join(", ")} si ${lines[lines.length - 1]}`
}

function buildClosingPrompt(guide?: GufoAiGuide | null, tone: ConversationTone = "warm") {
  const prompts = guide
    ? [
        `Daca vrei, iti spun imediat si pasii exacti pentru ${guide.title.toLowerCase()}.`,
        `Daca vrei, mergem impreuna pas cu pas in ${guide.title.toLowerCase()}.`,
        `Daca te-ai blocat intr-un camp anume din ${guide.title.toLowerCase()}, spune-mi si intram direct acolo.`,
      ]
    : [
        "Daca vrei, imi spui exact unde esti blocat si mergem direct la solutie.",
        "Daca imi spui ce vrei sa faci, iti raspund pe scurt si clar.",
        "Daca vrei, luam exact operatia ta si o desfacem pas cu pas.",
      ]

  if (tone === "direct") return prompts[0]
  if (tone === "supportive") return prompts[1]
  return prompts[2]
}

function buildOverviewReply(currentGuide?: GufoAiGuide | null): GufoAiReply {
  const overview = EXTRA_GUIDES.find((guide) => guide.id === "overview")
  return {
    title: "Gufo ERP",
    answer:
      `Da. Gufo AI stie sa explice aplicatia pe limba clientului, nu doar sa arunce termeni tehnici.\n\n` +
      `Pe scurt, poate ajuta cu Dashboard, Inregistrare documente, Gestiune, Stoc, Productie, SPV si ANAF, Facturi primite/trimise, RO e-Transport, Rapoarte, Export contabilitate, Financiar, Nomenclator si Setari.\n\n` +
      `Clientul poate intreba normal: "cum fac un NIR?", "unde vad facturile din SPV?", "de ce nu primesc UIT?", "cum descarc XML-ul?", "unde schimb seria facturii?" sau "de ce nu vad vanzari?". Eu tin cont si de pagina curenta${currentGuide ? `, iar acum pagina curenta este ${currentGuide.title}` : ""}.`,
    suggestions: overview?.suggestions || ["Ce module are aplicatia?", "Cum lucrez cu SPV si ANAF?", "Unde vad stocul?"],
  }
}

function buildGreetingReply(currentGuide?: GufoAiGuide | null): GufoAiReply {
  return {
    title: "Gufo AI",
    answer: currentGuide
      ? `Salut! Ma bucur sa te ajut.\n\nEsti acum in zona ${currentGuide.title}. Spune-mi ce vrei sa faci, ce nu merge sau ce vrei sa intelegi mai bine, iar eu iti raspund ca intr-o conversatie normala, pas cu pas.\n\n${buildClosingPrompt(currentGuide, "supportive")}`
      : `Salut! Sunt aici sa te ajut cu ERP-ul.\n\nPoti sa ma intrebi natural, de exemplu cum faci un document, de ce nu merge ceva, unde gasesti o setare, cum lucrezi cu SPV/ANAF sau cum rezolvi o problema. Iti raspund simplu si pe scurt, iar daca vrei continuam conversatia pana se clarifica.`,
    suggestions: currentGuide
      ? currentGuide.suggestions
      : ["Ce module are aplicatia?", "Cum fac un NIR?", "Cum lucrez cu SPV si ANAF?"],
  }
}

function buildThanksReply(currentGuide?: GufoAiGuide | null): GufoAiReply {
  return {
    title: "Gufo AI",
    answer: currentGuide
      ? `Cu drag.\n\nDaca mai ai nevoie, raman aici si te ajut in continuare pe zona ${currentGuide.title}.`
      : "Cu drag. Daca mai ai nevoie de ceva in ERP, spune-mi direct si continuam.",
    suggestions: currentGuide
      ? currentGuide.suggestions
      : ["Cum schimb parola unui utilizator?", "Cum filtrez rapoartele pe locatie?", "Cum fac un transfer?"],
  }
}

function buildFarewellReply(): GufoAiReply {
  return {
    title: "Gufo AI",
    answer: "Sigur. Cand mai ai nevoie de ajutor in ERP, scrie-mi direct si continuam de acolo.",
    suggestions: ["Cum adaug un produs?", "Cum fac un inventar nou?", "Unde vad istoricul actiunilor?"],
  }
}

function buildConfusedReply(guide?: GufoAiGuide | null): GufoAiReply {
  return {
    title: guide?.title || "Gufo AI",
    answer: guide
      ? `Hai sa o luam mai simplu pentru ${guide.title}.\n\nPe scurt, ai de facut ${buildNaturalList(guide.howTo.slice(0, 3)).replace(/^./, (char) => char.toLowerCase())}.\n\nDaca vrei, iti explic doar primul pas sau doar campurile importante.`
      : "Hai sa o luam mai simplu.\n\nSpune-mi exact ce vrei sa faci in ERP si iti explic pe scurt, fara termeni tehnici inutili.",
    suggestions: guide
      ? [guide.suggestions[0] || "Arata-mi pasii pe scurt", "Explica-mi doar primul pas", "Ce verific daca nu merge?"]
      : ["Cum adaug un produs?", "Cum fac un NIR?", "Cum schimb parola unui utilizator?"],
  }
}

function buildGuideAnswer(guide: GufoAiGuide, intent: string, currentPath?: string | null) {
  const inCurrentPage =
    currentPath && guide.routePrefixes.some((prefix) => String(currentPath).startsWith(prefix))

  const intro = inCurrentPage
    ? `Esti deja in zona ${guide.title}.`
    : `Pentru ce intrebi tu, te ajuta zona ${guide.title}.`

  const fields = guide.keyFields?.length ? `Uita-te in special la:\n${buildList(guide.keyFields)}\n\n` : ""

  if (intent === "where") {
    return `${intro}\n\n${guide.summary}\n\nGasesti asta aici:\n${buildList(guide.whereTo)}\n\n${buildClosingPrompt(
      guide,
      "direct",
    )}`
  }

  if (intent === "troubleshooting") {
    return `${intro}\n\nCel mai des blocajele din ${guide.title} vin din cateva lucruri clare.\n\n${fields}Verifica pe rand:\n${buildList(
      guide.troubleshooting,
    )}\n\nDaca imi spui exact ce mesaj vezi sau la ce pas te opresti, restrang imediat cauza.`
  }

  if (intent === "how") {
    return `${intro}\n\n${guide.summary}\n\n${fields}Pasii sunt:\n${buildList(
      guide.howTo,
    )}\n\n${buildClosingPrompt(guide, "supportive")}`
  }

  return `${intro}\n\n${guide.summary}\n\n${fields}Ca sa te orientezi repede:\n1. Unde intri:\n${buildList(
    guide.whereTo,
  )}\n\n2. Ce faci acolo:\n${buildList(guide.howTo)}\n\n3. Daca ceva nu merge:\n${buildList(
    guide.troubleshooting.slice(0, 2),
  )}\n\nSpune-mi ce vrei sa rezolvi exact si mergem mai adanc doar pe bucata ta.`
}

function getLastUserQuestion(history?: Array<{ role: "user" | "assistant"; text: string }>) {
  if (!Array.isArray(history)) return ""
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item?.role === "user" && String(item.text || "").trim()) return String(item.text).trim()
  }
  return ""
}

function getRecentUserQuestions(history?: Array<{ role: "user" | "assistant"; text: string }>, limit = 3) {
  if (!Array.isArray(history)) return []
  const questions: string[] = []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item?.role === "user" && String(item.text || "").trim()) {
      questions.push(String(item.text).trim())
      if (questions.length >= limit) break
    }
  }
  return questions
}

function shouldBorrowConversationContext(message: string) {
  const normalized = normalize(message)
  if (!normalized) return false
  if (shouldReusePreviousQuestion(message)) return true

  const contextualStarts = [
    "si ",
    "dar ",
    "bun ",
    "atunci ",
    "daca ",
    "iar daca ",
    "iar ",
    "acolo ",
    "aici ",
  ]

  const contextualTerms = [
    "ce completez",
    "ce pun",
    "cum continui",
    "ce fac dupa",
    "dupa aia",
    "dupa aceea",
    "la final",
    "in cazul asta",
    "in cazul meu",
  ]

  return (
    contextualStarts.some((term) => normalized.startsWith(term)) ||
    contextualTerms.some((term) => normalized.includes(term))
  )
}

function mergeConversationContext(
  rawMessage: string,
  history?: Array<{ role: "user" | "assistant"; text: string }>,
) {
  const recentQuestions = getRecentUserQuestions(history)
  const previousQuestion = recentQuestions[0] || ""

  if (!previousQuestion) return rawMessage
  if (!shouldBorrowConversationContext(rawMessage)) return rawMessage

  const normalizedRaw = normalize(rawMessage)
  const normalizedPrevious = normalize(previousQuestion)
  if (normalizedPrevious.includes(normalizedRaw)) return previousQuestion

  const secondPrevious = recentQuestions[1]
  const chain = [secondPrevious, previousQuestion, rawMessage].filter(Boolean).join(". ")
  return chain
}

function shouldReusePreviousQuestion(message: string) {
  const normalized = normalize(message)
  return (
    normalized.split(/\s+/).length <= 4 ||
    [
      "si aici",
      "si la asta",
      "aici",
      "acolo",
      "de ce",
      "cum exact",
      "detaliaza",
      "mai clar",
      "si cum fac",
      "bun si aici",
    ].includes(normalized)
  )
}

export function generateGufoAiReply(input: GufoAiInput): GufoAiReply {
  const rawMessage = String(input.message || "").trim()
  const currentPath = String(input.currentPath || "").trim()
  const pathGuide = findGuideByPath(currentPath)

  if (!rawMessage) {
    return {
      title: "Gufo AI",
      answer: appendLiveContext(
        pathGuide
        ? `Salut! Sunt Gufo AI.\n\nTe pot ajuta cu tot ce tine de ERP, iar acum esti in zona ${pathGuide.title}. Poti sa ma intrebi natural: ce vrei sa faci, ce nu merge, unde gasesti ceva sau ce trebuie verificat.`
        : "Salut! Sunt Gufo AI. Spune-mi ce vrei sa faci in ERP, unde te-ai blocat sau ce vrei sa intelegi mai bine, iar eu iti raspund pas cu pas.",
        input.pageContext
      ),
      suggestions: pathGuide
        ? pathGuide.suggestions
        : ["Ce module are aplicatia?", "Cum lucrez cu SPV si ANAF?", "Cum fac un NIR?"],
    }
  }

  const message = mergeConversationContext(rawMessage, input.history)

  if (matchesForbiddenTopic(message)) {
    return {
      title: "Gufo AI",
      answer:
        "Pot ajuta doar cu folosirea ERP-ului. Pentru aceasta solicitare este nevoie de administrare interna si nu este disponibila din ERP.",
      suggestions: ["Cum adaug un produs?", "Unde vad istoricul actiunilor?", "Cum fac un transfer?"],
    }
  }

  if (isGreeting(rawMessage)) return buildGreetingReply(pathGuide)
  if (isThanks(rawMessage)) return buildThanksReply(pathGuide)
  if (isFarewell(rawMessage)) return buildFarewellReply()
  if (isAppOverviewPrompt(rawMessage)) return buildOverviewReply(pathGuide)
  if (isHelpPrompt(rawMessage)) {
    return {
      title: "Gufo AI",
      answer: appendLiveContext(
        pathGuide
        ? `Da, sigur.\n\nPot sa te ajut pe pagina ${pathGuide.title} sau cu orice alta functie din ERP: Dashboard, documente, stoc, productie, SPV/ANAF, e-Transport, facturi primite/trimise, rapoarte, export contabilitate, financiar, nomenclator si setari.\n\nSpune-mi direct ce vrei sa faci sau unde te-ai blocat.`
        : "Da, sigur.\n\nPot sa te ajut cu Dashboard, documente, stoc, productie, SPV/ANAF, e-Transport, facturi primite/trimise, rapoarte, export contabilitate, financiar, nomenclator si setari. Spune-mi direct ce vrei sa faci sau unde te-ai blocat.",
        input.pageContext
      ),
      suggestions: pathGuide
        ? pathGuide.suggestions
        : ["Cum fac un NIR?", "Cum aduc facturile din SPV?", "Cum trimit e-Transport la ANAF?"],
    }
  }

  const guide = findGuideByMessage(message, currentPath)
  if (isConfused(rawMessage)) return buildConfusedReply(guide)
  if (isVeryShortAck(rawMessage) && guide) {
    return {
      title: guide.title,
      answer: `Perfect. Daca vrei, continuam pe ${guide.title}.\n\nPot sa-ti spun mai departe fie pasii exacti, fie ce verifici daca nu merge, fie unde gasesti functia in ERP.`,
      suggestions: guide.suggestions,
    }
  }

  const intent = detectIntent(message)

  if (guide) {
    return {
      title: guide.title,
      answer: appendLiveContext(buildGuideAnswer(guide, intent, currentPath), input.pageContext),
      suggestions: guide.suggestions,
    }
  }

  if (pathGuide && intent !== "generic") {
    return {
      title: pathGuide.title,
      answer: appendLiveContext(buildGuideAnswer(pathGuide, intent, currentPath), input.pageContext),
      suggestions: pathGuide.suggestions,
    }
  }

  if (pathGuide && rawMessage.split(/\s+/).length <= 3) {
    return {
      title: pathGuide.title,
      answer: appendLiveContext(
        `Esti in zona ${pathGuide.title}.\n\nSpune-mi direct ce vrei sa faci aici si iti raspund ca intr-o conversatie normala, nu doar cu descrierea paginii. De exemplu poti sa-mi spui ce vrei sa creezi, ce nu merge sau ce camp nu intelegi.`,
        input.pageContext
      ),
      suggestions: pathGuide.suggestions,
    }
  }

  return {
    title: "Gufo AI",
    answer: appendLiveContext(
      `Nu sunt sigur inca ce operatie vrei sa faci.\n\nSpune-mi mai direct, de exemplu:\n1. ce document sau modul folosesti\n2. ce vrei sa obtii\n3. unde te blochezi\n\nExemple bune: "cum fac un NIR cu 3 produse", "cum aduc facturile din SPV", "cum trimit e-Transport la ANAF", "de ce nu vad vanzari pe locatie", "unde schimb seria facturii".${pathGuide ? `\n\nDaca intrebi despre pagina curenta, esti acum in zona ${pathGuide.title}.` : ""}`,
      input.pageContext
    ),
    suggestions: [
      "Cum fac un NIR?",
      "Cum aduc facturile din SPV?",
      "Cum trimit e-Transport la ANAF?",
    ],
  }
}
