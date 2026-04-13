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
    [...GUIDES]
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
  if (currentPath && guide.routePrefixes.some((prefix) => String(currentPath).startsWith(prefix))) score += 2

  return score
}

function findGuideByMessage(message: string, currentPath?: string | null) {
  const ranked = GUIDES
    .map((guide) => ({ guide, score: scoreGuide(message, guide, currentPath) }))
    .sort((a, b) => b.score - a.score)

  if (!ranked.length || ranked[0].score <= 0) return null
  return ranked[0].guide
}

function detectIntent(message: string) {
  const normalized = normalize(message)
  if (
    ["nu pot", "nu merge", "de ce", "eroare", "problema", "nu vad"].some((term) =>
      normalized.includes(term),
    )
  ) {
    return "troubleshooting"
  }
  if (["unde", "de unde", "gasesc", "vad"].some((term) => normalized.includes(term))) {
    return "where"
  }
  if (
    ["cum", "adaug", "cree", "fac", "modific", "salvez", "setez"].some((term) =>
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

function buildGreetingReply(currentGuide?: GufoAiGuide | null): GufoAiReply {
  return {
    title: "Gufo AI",
    answer: currentGuide
      ? `Salut! Ma bucur sa te ajut.\n\nEsti acum in zona ${currentGuide.title}. Spune-mi ce vrei sa faci, ce nu merge sau ce vrei sa intelegi mai bine, iar eu iti raspund ca intr-o conversatie normala, pas cu pas.\n\n${buildClosingPrompt(currentGuide, "supportive")}`
      : `Salut! Sunt aici sa te ajut cu ERP-ul.\n\nPoti sa ma intrebi natural, de exemplu cum faci un document, de ce nu merge ceva, unde gasesti o setare sau cum rezolvi o problema. Iti raspund simplu si pe scurt, iar daca vrei continuam conversatia pana se clarifica.`,
    suggestions: currentGuide
      ? currentGuide.suggestions
      : ["Cum adaug un produs?", "Cum fac un NIR?", "De ce nu vad date in dashboard?"],
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
      answer: pathGuide
        ? `Salut! Sunt Gufo AI.\n\nTe pot ajuta cu tot ce tine de ERP, iar acum esti in zona ${pathGuide.title}. Poti sa ma intrebi natural, de exemplu ce vrei sa faci, ce nu merge sau ce vrei sa intelegi mai bine.`
        : "Salut! Sunt Gufo AI. Spune-mi ce vrei sa faci in ERP, unde te-ai blocat sau ce vrei sa intelegi mai bine, iar eu iti raspund pas cu pas.",
      suggestions: pathGuide
        ? pathGuide.suggestions
        : ["Cum adaug un produs?", "Cum fac un inventar nou?", "De ce nu vad vanzari in dashboard?"],
    }
  }

  const previousUserQuestion = getLastUserQuestion(input.history)
  const message =
    shouldReusePreviousQuestion(rawMessage) && previousUserQuestion
      ? `${previousUserQuestion}. ${rawMessage}`
      : rawMessage

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
  if (isHelpPrompt(rawMessage)) {
    return {
      title: "Gufo AI",
      answer: pathGuide
        ? `Da, sigur.\n\nPot sa te ajut pe pagina ${pathGuide.title} sau cu orice alta functie din ERP: produse, documente, stoc, inventare, rapoarte, utilizatori si setari.\n\nSpune-mi direct ce vrei sa faci sau unde te-ai blocat.`
        : "Da, sigur.\n\nPot sa te ajut cu produse, documente, stoc, inventare, rapoarte, utilizatori si setari din ERP. Spune-mi direct ce vrei sa faci sau unde te-ai blocat.",
      suggestions: pathGuide
        ? pathGuide.suggestions
        : ["Cum fac un NIR?", "Cum schimb parola unui utilizator?", "De ce raportul este gol?"],
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
      answer: buildGuideAnswer(guide, intent, currentPath),
      suggestions: guide.suggestions,
    }
  }

  if (pathGuide && intent !== "generic") {
    return {
      title: pathGuide.title,
      answer: buildGuideAnswer(pathGuide, intent, currentPath),
      suggestions: pathGuide.suggestions,
    }
  }

  if (pathGuide && rawMessage.split(/\s+/).length <= 3) {
    return {
      title: pathGuide.title,
      answer: `Esti in zona ${pathGuide.title}.\n\nSpune-mi direct ce vrei sa faci aici si iti raspund ca intr-o conversatie normala, nu doar cu descrierea paginii. De exemplu poti sa-mi spui ce vrei sa creezi, ce nu merge sau ce camp nu intelegi.`,
      suggestions: pathGuide.suggestions,
    }
  }

  return {
    title: "Gufo AI",
    answer:
      `Nu sunt sigur inca ce operatie vrei sa faci.\n\nSpune-mi mai direct, de exemplu:\n1. ce document sau modul folosesti\n2. ce vrei sa obtii\n3. unde te blochezi\n\nExemple bune: "cum fac un NIR cu 3 produse", "de ce nu vad vanzari pe locatie", "cum schimb parola unui utilizator".${pathGuide ? `\n\nDaca intrebi despre pagina curenta, esti acum in zona ${pathGuide.title}.` : ""}`,
    suggestions: [
      "Cum fac un NIR?",
      "Cum filtrez rapoartele pe locatie?",
      "Cum schimb parola unui utilizator?",
    ],
  }
}
