type Suggestion = {
  code: string
  label: string
  confidence: number
  matchedKeywords: string[]
  fiscalRisk: boolean
  fiscalRiskCategory: string | null
}

type Rule = {
  code: string
  label: string
  keywords: string[]
}

type FiscalRiskMeta = {
  fiscalRisk: boolean
  category: string | null
}

const RULES: Rule[] = [
  { code: "22011000", label: "Apa minerala si ape gazoase", keywords: ["apa minerala", "apa plata", "apa carbogazoasa", "apa"] },
  { code: "22021000", label: "Bauturi racoritoare nealcoolice", keywords: ["cola", "coca", "pepsi", "fanta", "sprite", "suc", "ice tea", "energizant", "red bull", "monster", "schweppes", "tonic", "limonada"] },
  { code: "22030010", label: "Bere din malt", keywords: ["bere", "lager", "pils", "ursus", "timi", "ciuc", "heineken"] },
  { code: "22042180", label: "Vin", keywords: ["vin", "merlot", "cabernet", "rose", "sauvignon", "pinot"] },
  { code: "22083030", label: "Whisky", keywords: ["whisky", "whiskey", "jack daniels", "ballantines", "jim beam"] },
  { code: "22085011", label: "Gin", keywords: ["gin", "gordon", "bombay"] },
  { code: "22086011", label: "Vodca", keywords: ["vodka", "vodca", "absolut", "smirnoff"] },
  { code: "22087010", label: "Lichioruri", keywords: ["lichior", "jäger", "jager", "baileys", "aperol"] },
  { code: "19059080", label: "Produse de panificatie / patiserie", keywords: ["paine", "chifla", "croissant", "covrig", "bagheta", "foietaj"] },
  { code: "19023010", label: "Paste alimentare", keywords: ["paste", "spaghete", "penne", "tagliatelle"] },
  { code: "19022030", label: "Pizza si produse similare", keywords: ["pizza", "calzone", "focaccia"] },
  { code: "16023219", label: "Preparate din carne de pasare", keywords: ["snitel pui", "aripioare", "crispy", "pui", "chicken"] },
  { code: "16024919", label: "Preparate din carne de porc", keywords: ["ceafa", "carnat", "porc", "bacon", "sunca"] },
  { code: "16025031", label: "Preparate din carne de bovine", keywords: ["vita", "burger vita", "beef"] },
  { code: "20041099", label: "Cartofi preparati sau conservati", keywords: ["cartofi prajiti", "cartofi wedges", "cartofi"] },
  { code: "21039090", label: "Sosuri si preparate pentru sosuri", keywords: ["ketchup", "maioneza", "mustar", "sos", "bbq", "sweet chili"] },
  { code: "04069086", label: "Branzeturi", keywords: ["cascaval", "mozzarella", "branza", "telemea", "parmezan"] },
  { code: "04031011", label: "Iaurt", keywords: ["iaurt", "yogurt"] },
  { code: "20089967", label: "Masline si alte conserve vegetale", keywords: ["masline", "olive"] },
  { code: "07020000", label: "Rosii proaspete", keywords: ["rosii", "tomate"] },
  { code: "07032000", label: "Usturoi si ceapa", keywords: ["ceapa", "usturoi"] },
  { code: "07096010", label: "Ardei", keywords: ["ardei", "kapia", "gogosar", "chili"] },
  { code: "08081080", label: "Mere", keywords: ["mere", "mar"] },
  { code: "08039010", label: "Banane", keywords: ["banana", "banane"] },
  { code: "09012100", label: "Cafea prajita", keywords: ["cafea", "espresso", "americano", "cappuccino", "latte"] },
  { code: "21012092", label: "Ceai si infuzii", keywords: ["ceai", "tea"] },
  { code: "18069070", label: "Ciocolata si preparate cu cacao", keywords: ["ciocolata", "choco", "cacao"] },
  { code: "17049099", label: "Dulciuri fara cacao", keywords: ["bomboane", "jeleuri", "guma", "drajeuri"] },
  { code: "76129080", label: "Doze si recipiente din aluminiu", keywords: ["doza aluminiu", "doza", "can"] },
  { code: "39233010", label: "Sticle si flacoane din plastic", keywords: ["pet", "sticla plastic", "recipient plastic"] },
  { code: "70109043", label: "Sticle din sticla", keywords: ["sticla", "recipient sticla"] },
]

function normalize(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function getNcChapter(code: string) {
  const digits = String(code || "").replace(/\D/g, "")
  return digits.slice(0, 4)
}

function resolveFiscalRiskMeta(code: string): FiscalRiskMeta {
  const chapter = getNcChapter(code)
  if (!chapter) return { fiscalRisk: false, category: null }

  const chapterNo = Number(chapter)
  if (chapterNo >= 701 && chapterNo <= 714) {
    return { fiscalRisk: true, category: "Legume, plante, radacini si tuberculi alimentari" }
  }
  if (chapterNo >= 801 && chapterNo <= 814) {
    return { fiscalRisk: true, category: "Fructe comestibile" }
  }
  if (chapterNo >= 2201 && chapterNo <= 2208) {
    return { fiscalRisk: true, category: "Bauturi, lichide alcoolice si otet" }
  }
  if (chapter === "2505" || chapter === "2517") {
    return { fiscalRisk: true, category: "Sare, sulf, pamanturi, pietre, ipsos, var si ciment" }
  }
  if (chapterNo >= 6101 && chapterNo <= 6117) {
    return { fiscalRisk: true, category: "Imbracaminte si accesorii tricotate/crosetate" }
  }
  if ((chapterNo >= 6201 && chapterNo <= 6212) || (chapterNo >= 6214 && chapterNo <= 6217)) {
    return { fiscalRisk: true, category: "Imbracaminte si accesorii netricotate" }
  }
  if (chapterNo >= 6401 && chapterNo <= 6405) {
    return { fiscalRisk: true, category: "Incaltaminte" }
  }
  if (chapter === "7213" || chapter === "7214") {
    return { fiscalRisk: true, category: "Fonta, fier si otel" }
  }

  return { fiscalRisk: false, category: null }
}

export function suggestNcCodes(name: string, limit = 5): Suggestion[] {
  const normalized = normalize(name)
  if (!normalized) return []

  const results = RULES.map((rule) => {
    const matchedKeywords = rule.keywords.filter((keyword) => normalized.includes(normalize(keyword)))
    const confidence = matchedKeywords.length / rule.keywords.length
    const fiscalRiskMeta = resolveFiscalRiskMeta(rule.code)
    return {
      code: rule.code,
      label: rule.label,
      confidence,
      matchedKeywords,
      fiscalRisk: fiscalRiskMeta.fiscalRisk,
      fiscalRiskCategory: fiscalRiskMeta.category,
    }
  })
    .filter((item) => item.matchedKeywords.length > 0)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return b.matchedKeywords.join(" ").length - a.matchedKeywords.join(" ").length
    })

  return results.slice(0, limit)
}
