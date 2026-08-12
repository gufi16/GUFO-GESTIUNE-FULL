import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, BrainCircuit, Eye, MousePointer2, SendHorizonal, ShieldCheck, Sparkles, Wand2, X } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { api } from "../lib/api"
import { me } from "../lib/auth"
import GufoAiAvatar from "./GufoAiAvatar"
import { readGufoAiConfig, subscribeGufoAiConfig, type GufoAiConfig } from "../lib/gufoAiConfig"

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  text: string
}

type GufoAiResponse = {
  ok: boolean
  item?: {
    title: string
    answer: string
    suggestions: string[]
  }
}

type GufoAiPageContext = {
  pageLabel: string
  title?: string
  headings: string[]
  selectedValues: string[]
  visibleActions: string[]
  warnings: string[]
}

type WidgetPosition = {
  x: number
  y: number
}

type AssistantAction = {
  label: string
  prompt: string
}

type GufoAiModuleScope = "nomenclature" | "inventory" | "financial" | "settings" | "generic"

type LocalGuideTarget = {
  title: string
  hint: string
  anchors: string[]
  tabs?: string[]
  route?: string
}

type RobotBubble = {
  title: string
  text: string
}

type GuideMarker = {
  title: string
  left: number
  top: number
}

const POSITION_STORAGE_KEY = "gufo-ai-widget-position"
const FAB_WIDTH = 92
const FAB_HEIGHT = 92
const FAB_MARGIN = 20
const CHAT_GAP = 20
const CHAT_WIDTH = 420
const CHAT_HEIGHT = 680

function routeLabel(pathname: string) {
  if (pathname.startsWith("/dashboard")) return "Panou principal"
  if (pathname.startsWith("/nomenclator/produse")) return "Produse"
  if (pathname.startsWith("/nomenclator/clienti")) return "Clienti"
  if (pathname.startsWith("/nomenclator/furnizori")) return "Furnizori"
  if (pathname.startsWith("/nomenclator/locatii")) return "Locatii"
  if (pathname.startsWith("/nomenclator/uom")) return "Unitati de masura"
  if (pathname.startsWith("/nomenclator/departamente")) return "Departamente"
  if (pathname.startsWith("/nomenclator/categorii")) return "Categorii"
  if (pathname.startsWith("/nomenclator")) return "Nomenclator"
  if (pathname.startsWith("/gestiune/stoc")) return "Stoc"
  if (pathname.startsWith("/gestiune/inventare")) return "Inventare"
  if (pathname.startsWith("/gestiune/productie")) return "Productie"
  if (pathname.startsWith("/inregistrare-document/inventar/new")) return "Inventar nou"
  if (pathname.startsWith("/transfer")) return "Transfer"
  if (pathname.startsWith("/e-transport")) return "RO e-Transport"
  if (pathname.startsWith("/documente/facturi-primite-spv")) return "Facturi SPV"
  if (pathname.startsWith("/rapoarte/export-contabilitate")) return "Export contabilitate"
  if (pathname.startsWith("/rapoarte")) return "Rapoarte"
  if (pathname.startsWith("/financiar/vanzari-bon")) return "Vanzari / Bon"
  if (pathname.startsWith("/financiar/inchideri-zilnice")) return "Inchideri zilnice"
  if (pathname.startsWith("/setari/efactura")) return "Setari SPV"
  if (pathname.startsWith("/setari/gufo-ai")) return "Setari Gufo AI"
  if (pathname.startsWith("/setari/firma")) return "Setari firma"
  if (pathname.startsWith("/setari/tva")) return "Setari TVA"
  if (pathname.startsWith("/setari/numerotare")) return "Numerotare"
  if (pathname.startsWith("/setari/backup")) return "Backup"
  if (pathname.startsWith("/setari/istoric")) return "Istoric actiuni"
  if (pathname.startsWith("/setari/utilizatori")) return "Utilizatori ERP"
  if (pathname.startsWith("/setari")) return "Setari"
  if (pathname.startsWith("/documente") || pathname.startsWith("/inregistrare-document")) return "Documente"
  return "ERP"
}

function defaultSuggestions(pathname: string) {
  if (pathname.startsWith("/nomenclator/produse")) {
    return ["Cum adaug un produs?", "Cum completez retetarul?", "De ce nu apare produsul in POS?"]
  }
  if (pathname.startsWith("/nomenclator/clienti") || pathname.startsWith("/nomenclator/furnizori")) {
    return ["Cum adaug un partener?", "Ce date trebuie pentru e-Factura?", "De ce nu apare in document?"]
  }
  if (pathname.startsWith("/gestiune/stoc")) {
    return ["Unde vad stocul pe locatie?", "De ce produsul are stoc zero?", "Cum corectez stocul?"]
  }
  if (pathname.startsWith("/documente/facturi-primite-spv")) {
    return ["Cum aduc facturile din SPV?", "Unde vad facturile trimise?", "Cum descarc XML si raspuns ANAF?"]
  }
  if (pathname.startsWith("/e-transport")) {
    return ["Cum trimit e-Transport la ANAF?", "De ce nu primesc UIT?", "Cum descarc XML si raspunsul?"]
  }
  if (pathname.startsWith("/setari/efactura")) {
    return ["Cum generez token ANAF?", "De ce nu apare autentificarea ANAF?", "Ce verific daca SPV nu comunica?"]
  }
  if (pathname.startsWith("/financiar/vanzari-bon") || pathname.startsWith("/financiar/inchideri-zilnice")) {
    return ["Unde vad bonurile POS?", "Cum generez inchiderea zilnica?", "De ce nu apar vanzari?"]
  }
  if (pathname.startsWith("/rapoarte/export-contabilitate")) {
    return ["Cum fac export pentru contabil?", "De ce exportul este gol?", "Ce documente intra in export?"]
  }
  if (pathname.startsWith("/rapoarte")) {
    return ["Cum filtrez pe locatie?", "Cum aleg un device?", "De ce raportul este gol?"]
  }
  if (pathname.startsWith("/transfer")) {
    return ["Cum fac un transfer?", "De ce nu pot salva transferul?", "Cum aleg locatia sursa?"]
  }
  if (pathname.startsWith("/setari/istoric")) {
    return ["Cum caut dupa utilizator?", "Cum filtrez pe perioada?", "De ce nu vad evenimente?"]
  }
  if (pathname.startsWith("/setari/gufo-ai")) {
    return ["Cum setez modul observer?", "Ce roluri au acces la AI?", "Ce las blocat pentru siguranta?"]
  }
  if (pathname.startsWith("/setari")) {
    return ["Unde schimb datele firmei?", "Unde schimb seria facturii?", "Cum verific setarea de TVA?"]
  }
  return ["Ce module are aplicatia?", "Cum lucrez cu SPV si ANAF?", "Cum fac un NIR?"]
}

function modeLabel(mode: GufoAiConfig["mode"]) {
  if (mode === "observer") return "Observer"
  if (mode === "action") return "Action"
  return "Copilot"
}

function modeDescription(config: GufoAiConfig) {
  if (config.mode === "observer") {
    return "Vede pagina curenta si te avertizeaza cand ceva nu pare in regula."
  }
  if (config.mode === "action") {
    return config.requireConfirmation
      ? "Pregateste actiuni ghidate, dar asteapta confirmarea ta."
      : "Poate merge mai departe cu asistenta activa in zonele permise."
  }
  return "Explica, sugereaza si pregateste pasi urmatori ca un coleg virtual."
}

function modeIcon(mode: GufoAiConfig["mode"]) {
  if (mode === "observer") return Eye
  if (mode === "action") return Wand2
  return BrainCircuit
}

function resolveModuleScope(pathname: string): GufoAiModuleScope {
  if (pathname.startsWith("/nomenclator")) return "nomenclature"
  if (
    pathname.startsWith("/gestiune") ||
    pathname.startsWith("/transfer") ||
    pathname.startsWith("/inregistrare-document") ||
    pathname.startsWith("/documente")
  ) {
    return "inventory"
  }
  if (pathname.startsWith("/financiar")) return "financial"
  if (pathname.startsWith("/setari")) return "settings"
  return "generic"
}

function moduleLabel(scope: GufoAiModuleScope) {
  if (scope === "nomenclature") return "Nomenclator"
  if (scope === "inventory") return "Stoc si operatiuni"
  if (scope === "financial") return "Financiar"
  if (scope === "settings") return "Setari"
  return "ERP"
}

function hasModuleDraftAccess(config: GufoAiConfig, scope: GufoAiModuleScope) {
  if (scope === "nomenclature") return config.allowNomenclatureDrafts
  if (scope === "inventory") return config.allowInventoryDrafts
  if (scope === "financial") return config.allowFinancialDrafts
  if (scope === "settings") return config.allowSettingsGuidance
  return true
}

function resolveAiRoleKey(role: string | null | undefined): keyof GufoAiConfig["roleAccess"] {
  const value = String(role || "").trim().toUpperCase()
  if (value === "OWNER") return "owner"
  if (value === "ADMIN") return "admin"
  if (value === "MANAGER") return "manager"
  if (value === "CASHIER") return "cashier"
  return "operator"
}

function buildAssistantActions(pathname: string): AssistantAction[] {
  if (pathname.startsWith("/nomenclator/produse")) {
    return [
      { label: "Verifica produs", prompt: "Verifica ce campuri lipsesc la produsul pe care il editez acum." },
      { label: "Explica retetar", prompt: "Explica-mi exact cand trebuie retetar si ce verific daca nu pot salva produsul." },
      { label: "Verifica POS", prompt: "Spune-mi ce verific ca produsul sa apara corect in POS." },
    ]
  }
  if (pathname.startsWith("/nomenclator/categorii") || pathname.startsWith("/nomenclator/subcategorii")) {
    return [
      { label: "Verifica structura", prompt: "Verifica structura actuala de categorie sau subcategorie si spune-mi daca lipseste ceva important." },
      { label: "Ordine POS", prompt: "Spune-mi ce verific pentru ordinea in POS la categorii si subcategorii." },
      { label: "Poze catalog", prompt: "Spune-mi ce verific daca pozele de categorie sau subcategorie nu apar in POS." },
    ]
  }
  if (pathname.startsWith("/dashboard")) {
    return [
      { label: "Verifica filtre", prompt: "Verifica filtrele vizibile din dashboard si spune-mi daca ceva pare gresit." },
      { label: "Explica cifrele", prompt: "Explica-mi pe scurt ce inseamna cardurile principale din dashboardul curent." },
      { label: "De ce lipsesc vanzari", prompt: "Spune-mi ce verific daca in dashboard nu apar vanzari sau indicatorii sunt goi." },
    ]
  }
  if (pathname.startsWith("/financiar/vanzari-bon")) {
    return [
      { label: "Verifica bonuri", prompt: "Verifica pagina curenta si spune-mi ce filtre sau selectie pot afecta lista de bonuri." },
      { label: "Explica totaluri", prompt: "Explica-mi totalurile din pagina de vanzari bon dupa contextul curent." },
      { label: "Lipsesc bonuri", prompt: "Ce verific daca nu apar bonurile emise de Android POS in aceasta pagina?" },
    ]
  }
  if (pathname.startsWith("/financiar/inchideri-zilnice")) {
    return [
      { label: "Verifica inchideri", prompt: "Verifica pagina si spune-mi ce trebuie verificat daca inchiderile zilnice lipsesc." },
      { label: "Explica Z", prompt: "Explica-mi simplu diferenta dintre vanzari, bonuri si inchideri zilnice." },
      { label: "Filtre financiar", prompt: "Spune-mi exact ce filtre conteaza pe pagina asta." },
    ]
  }
  if (pathname.startsWith("/setari")) {
    return [
      { label: "Verifica setarea", prompt: "Verifica contextul curent si spune-mi ce setari importante vezi pe pagina aceasta." },
      { label: "Ce risc exista", prompt: "Spune-mi daca exista ceva sensibil in pagina curenta care merita confirmare inainte de schimbare." },
      { label: "Ghideaza-ma", prompt: "Ghideaza-ma pas cu pas pe pagina curenta, ca pentru un client nou." },
    ]
  }

  return [
    { label: "Analizeaza pagina", prompt: "Analizeaza pagina curenta si spune-mi ce este important aici." },
    { label: "Ce verific", prompt: "Spune-mi ce merita verificat acum in pagina curenta." },
    { label: "Ghid rapid", prompt: "Da-mi un ghid rapid pentru pagina curenta." },
  ]
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueCompactTexts(values: Array<string | null | undefined>, maxItems: number, maxLength = 80) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const rawValue of values) {
    const value = normalizeText(rawValue)
    if (!value) continue
    if (value.length < 2 || value.length > maxLength) continue
    const lower = value.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    items.push(value)
    if (items.length >= maxItems) break
  }

  return items
}

function normalizedIncludes(value: string, keywords: readonly string[]) {
  const normalized = normalizeText(value).toLowerCase()
  return keywords.some((keyword) => normalized.includes(keyword))
}

function buildRouteTarget(title: string, hint: string, route: string, anchors: string[] = []) {
  return {
    title,
    hint,
    route,
    anchors: anchors.length ? anchors : [title],
  } satisfies LocalGuideTarget
}

function buildSearchRoute(pathname: string, query: string, extraParams?: Record<string, string>) {
  const params = new URLSearchParams()
  if (query.trim()) params.set("q", query.trim())
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  const search = params.toString()
  return search ? `${pathname}?${search}` : pathname
}

function resolveLocalGuide(pathname: string, rawQuestion: string): LocalGuideTarget | null {
  const question = normalizeText(rawQuestion).toLowerCase()
  const searchCommandPatterns = [
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+produs(?:ul)?\s+(.+)/i,
      title: "Produse",
      hint: "Te duc direct in Produse si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/nomenclator/produse", value, { open: /deschide/i.test(question) ? "1" : "" }),
      anchors: ["Produse", "Cauta rapid dupa produs"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+client(?:ul)?\s+(.+)/i,
      title: "Clienti",
      hint: "Te duc direct in Clienti si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/nomenclator/clienti", value, { open: /deschide/i.test(question) ? "1" : "" }),
      anchors: ["Clienti", "Lista clienti"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+furnizor(?:ul)?\s+(.+)/i,
      title: "Furnizori",
      hint: "Te duc direct in Furnizori si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/nomenclator/furnizori", value, { open: /deschide/i.test(question) ? "1" : "" }),
      anchors: ["Furnizori", "Lista furnizori"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+(?:receptia|nir(?:ul)?|nota de receptie)\s+(.+)/i,
      title: "Receptii NIR",
      hint: "Te duc direct in lista NIR si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/inregistrare-document/nir", value, { open: /deschide/i.test(question) ? "1" : "" }),
      anchors: ["Receptii NIR", "Cauta dupa numar, furnizor sau locatie"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+factur(?:a|i?le?)\s+(.+)/i,
      title: "Facturi",
      hint: "Te duc direct in Documente > Facturi si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/documente", value, { tab: "invoice", open: /deschide/i.test(question) ? "1" : "" }),
      anchors: ["Facturi", "Documente"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+transfer(?:ul)?\s+(.+)/i,
      title: "Transferuri",
      hint: "Te duc direct in Documente > Transferuri si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/documente", value, { tab: "transfer" }),
      anchors: ["Transferuri", "Documente"],
    },
    {
      regex: /(?:deschide|cauta|cauta-mi|gaseste|arata-mi)\s+inventar(?:ul)?\s+(.+)/i,
      title: "Inventare",
      hint: "Te duc direct in Documente > Inventare si aplic cautarea ceruta.",
      route: (value: string) => buildSearchRoute("/documente", value, { tab: "inventory" }),
      anchors: ["Inventare", "Documente"],
    },
  ] as const
  const routeIntentMatchers = [
    { keywords: ["unde este operatiuni", "unde sunt operatiunile", "du-ma la operatiuni", "mergi la operatiuni", "deschide operatiuni"], target: buildRouteTarget("Operatiuni", "Te duc direct in Operatiuni > Inregistrare documente.", "/inregistrare-document", ["Inregistrare documente", "Documente"]) },
    { keywords: ["unde este stoc si productie", "unde sunt stoc si productie", "du-ma la stoc si productie", "mergi la stoc si productie", "deschide stoc si productie"], target: buildRouteTarget("Stoc si productie", "Te duc direct in Stoc si productie > Stoc.", "/gestiune/stoc", ["Stoc", "Gestiuni", "Productie"]) },
    { keywords: ["unde este anaf si spv", "unde sunt anaf si spv", "du-ma la anaf si spv", "mergi la anaf si spv", "deschide anaf si spv", "unde este spv", "du-ma la spv", "mergi la spv", "deschide spv", "unde este anaf", "du-ma la anaf", "mergi la anaf", "deschide anaf"], target: buildRouteTarget("ANAF si SPV", "Te duc direct in ANAF si SPV > Facturi primite SPV.", "/documente/facturi-primite-spv", ["Facturi primite SPV", "Registru e-Transport"]) },
    { keywords: ["unde este financiar", "unde sunt financiar", "du-ma la financiar", "mergi la financiar", "deschide financiar"], target: buildRouteTarget("Financiar", "Te duc direct in Financiar > Vanzari / Bon.", "/financiar/vanzari-bon", ["Vanzari / Bon", "Inchideri zilnice"]) },
    { keywords: ["unde este nomenclator", "unde sunt nomenclator", "du-ma la nomenclator", "mergi la nomenclator", "deschide nomenclator"], target: buildRouteTarget("Nomenclator", "Te duc direct in Nomenclator > Produse.", "/nomenclator/produse", ["Produse", "Categorii", "Subcategorii"]) },
    { keywords: ["unde este rapoarte", "du-ma la rapoarte", "mergi la rapoarte", "deschide rapoarte"], target: buildRouteTarget("Rapoarte", "Te duc direct in Rapoarte.", "/rapoarte", ["Rapoarte", "Export contabilitate"]) },
    { keywords: ["unde sunt produsele", "unde gasesc produsele", "du-ma la produse", "mergi la produse", "deschide produse"], target: buildRouteTarget("Produse", "Te duc direct in Nomenclator > Produse.", "/nomenclator/produse", ["Produse", "Adauga produs", "Cauta rapid dupa produs"]) },
    { keywords: ["unde sunt clientii", "unde gasesc clientii", "du-ma la clienti", "mergi la clienti", "deschide clienti"], target: buildRouteTarget("Clienti", "Te duc direct in Nomenclator > Clienti.", "/nomenclator/clienti", ["Clienti", "Lista clienti"]) },
    { keywords: ["unde sunt furnizorii", "unde gasesc furnizorii", "du-ma la furnizori", "mergi la furnizori", "deschide furnizori"], target: buildRouteTarget("Furnizori", "Te duc direct in Nomenclator > Furnizori.", "/nomenclator/furnizori", ["Furnizori", "Lista furnizori"]) },
    { keywords: ["unde este inregistrare documente", "unde sunt inregistrare documente", "du-ma la inregistrare documente", "mergi la inregistrare documente", "deschide inregistrare documente"], target: buildRouteTarget("Inregistrare documente", "Te duc direct in Operatiuni > Inregistrare documente.", "/inregistrare-document", ["Inregistrare documente"]) },
    { keywords: ["unde este documente", "unde sunt documentele", "du-ma la documente", "mergi la documente", "deschide documente"], target: buildRouteTarget("Documente", "Te duc direct in Operatiuni > Documente.", "/documente", ["Documente"]) },
    { keywords: ["unde este stoc", "unde gasesc stocul", "du-ma la stoc", "mergi la stoc", "deschide stoc"], target: buildRouteTarget("Stoc", "Te duc direct in Stoc si productie > Stoc.", "/gestiune/stoc", ["Stoc"]) },
    { keywords: ["unde sunt gestiunile", "unde gasesc gestiunile", "du-ma la gestiuni", "mergi la gestiuni", "deschide gestiuni"], target: buildRouteTarget("Gestiuni", "Te duc direct in Stoc si productie > Gestiuni.", "/gestiune/gestiuni", ["Gestiuni"]) },
    { keywords: ["unde este productia", "unde gasesc productia", "du-ma la productie", "mergi la productie", "deschide productie"], target: buildRouteTarget("Productie", "Te duc direct in Stoc si productie > Productie.", "/gestiune/productie", ["Productie"]) },
    { keywords: ["unde sunt facturile primite spv", "unde gasesc facturile primite spv", "du-ma la facturi primite spv", "mergi la facturi primite spv", "deschide facturi primite spv"], target: buildRouteTarget("Facturi primite SPV", "Te duc direct in ANAF si SPV > Facturi primite SPV.", "/documente/facturi-primite-spv", ["Facturi primite SPV"]) },
    { keywords: ["unde este e-transport", "unde este etransport", "unde gasesc e-transport", "du-ma la e-transport", "mergi la e-transport", "deschide e-transport", "deschide etransport"], target: buildRouteTarget("Registru e-Transport", "Te duc direct in ANAF si SPV > Registru e-Transport.", "/e-transport", ["Registru e-Transport"]) },
    { keywords: ["unde sunt locatiile", "unde gasesc locatiile", "du-ma la locatii", "mergi la locatii", "deschide locatii"], target: buildRouteTarget("Locatii", "Te duc direct in Nomenclator > Locatii.", "/nomenclator/locatii", ["Locatii"]) },
    { keywords: ["unde sunt unitatile de masura", "unde gasesc unitatile de masura", "du-ma la unitati de masura", "mergi la unitati de masura", "deschide unitati de masura"], target: buildRouteTarget("Unitati de masura", "Te duc direct in Nomenclator > Unitati de masura.", "/nomenclator/uom", ["Unitati de masura"]) },
    { keywords: ["unde sunt departamentele", "unde gasesc departamentele", "du-ma la departamente", "mergi la departamente", "deschide departamente"], target: buildRouteTarget("Departamente", "Te duc direct in Nomenclator > Departamente.", "/nomenclator/departamente", ["Departamente"]) },
    { keywords: ["unde sunt categoriile", "unde gasesc categoriile", "du-ma la categorii", "mergi la categorii", "deschide categorii"], target: buildRouteTarget("Categorii", "Te duc direct in Nomenclator > Categorii.", "/nomenclator/categorii", ["Categorii produse", "Adauga categorie"]) },
    { keywords: ["unde sunt subcategoriile", "unde gasesc subcategoriile", "du-ma la subcategorii", "mergi la subcategorii", "deschide subcategorii"], target: buildRouteTarget("Subcategorii", "Te duc direct in Nomenclator > Subcategorii.", "/nomenclator/subcategorii", ["Subcategorii produse", "Adauga subcategorie"]) },
    { keywords: ["unde sunt materiile prime", "unde gasesc materiile prime", "du-ma la materii prime", "mergi la materii prime", "deschide materii prime"], target: buildRouteTarget("Materii prime", "Te duc direct in Nomenclator > Materii prime.", "/nomenclator/materii-prime", ["Materii prime"]) },
    { keywords: ["unde sunt semifabricatele", "unde gasesc semifabricatele", "du-ma la semifabricate", "mergi la semifabricate", "deschide semifabricate"], target: buildRouteTarget("Semifabricate", "Te duc direct in Nomenclator > Semifabricate.", "/nomenclator/semifabricate", ["Semifabricate"]) },
    { keywords: ["unde sunt meniurile", "unde gasesc meniurile", "du-ma la meniuri", "mergi la meniuri", "deschide meniuri"], target: buildRouteTarget("Meniuri", "Te duc direct in Nomenclator > Meniuri.", "/nomenclator/meniuri", ["Meniuri"]) },
    { keywords: ["unde sunt facturile", "unde gasesc facturile", "du-ma la facturi", "mergi la facturi", "deschide facturi"], target: buildRouteTarget("Facturi", "Te duc direct in Documente > Facturi.", buildSearchRoute("/documente", "", { tab: "invoice" }), ["Facturi", "Documente"]) },
    { keywords: ["unde sunt receptiile", "unde gasesc receptiile", "unde este nir", "du-ma la nir", "mergi la nir", "deschide nir"], target: buildRouteTarget("Receptii NIR", "Te duc direct in Operatiuni > Receptii NIR.", "/inregistrare-document/nir", ["Receptii NIR", "Cauta dupa numar, furnizor sau locatie"]) },
    { keywords: ["unde sunt transferurile", "unde gasesc transferurile", "du-ma la transferuri", "mergi la transferuri", "deschide transferuri"], target: buildRouteTarget("Transferuri", "Te duc direct in Documente > Transferuri.", buildSearchRoute("/documente", "", { tab: "transfer" }), ["Transferuri", "Documente"]) },
    { keywords: ["unde sunt inventarele", "unde gasesc inventarele", "du-ma la inventare", "mergi la inventare", "deschide inventare"], target: buildRouteTarget("Inventare", "Te duc direct in Documente > Inventare.", buildSearchRoute("/documente", "", { tab: "inventory" }), ["Inventare", "Documente"]) },
    { keywords: ["unde este export contabilitate", "unde gasesc export contabilitate", "du-ma la export contabilitate", "mergi la export contabilitate", "deschide export contabilitate"], target: buildRouteTarget("Export contabilitate", "Te duc direct in Rapoarte > Export contabilitate.", "/rapoarte/export-contabilitate", ["Export contabilitate"]) },
    { keywords: ["unde sunt bonurile", "unde gasesc bonurile", "du-ma la vanzari bon", "mergi la vanzari bon", "deschide vanzari bon"], target: buildRouteTarget("Vanzari / Bon", "Te duc direct in Financiar > Vanzari / Bon.", "/financiar/vanzari-bon", ["Vanzari / Bon"]) },
    { keywords: ["unde sunt inchiderile zilnice", "unde gasesc inchiderile zilnice", "du-ma la inchideri zilnice", "mergi la inchideri zilnice", "deschide inchideri zilnice"], target: buildRouteTarget("Inchideri zilnice", "Te duc direct in Financiar > Inchideri zilnice.", "/financiar/inchideri-zilnice", ["Inchideri zilnice"]) },
    { keywords: ["unde sunt setarile", "unde gasesc setarile", "du-ma la setari", "mergi la setari", "deschide setari"], target: buildRouteTarget("Setari", "Te duc direct in Setari.", "/setari", ["Setari"]) },
    { keywords: ["unde este gufo ai", "unde gasesc gufo ai", "du-ma la gufo ai", "mergi la gufo ai", "deschide gufo ai"], target: buildRouteTarget("Gufo AI", "Te duc direct in Setari > Gufo AI.", "/setari/gufo-ai", ["Gufo AI"]) },
    { keywords: ["unde este marketplace", "unde gasesc marketplace", "du-ma la marketplace", "mergi la marketplace", "deschide marketplace"], target: buildRouteTarget("Marketplace", "Te duc direct in Setari > Marketplace.", "/setari/marketplace", ["Marketplace"]) },
    { keywords: ["unde este setarea tva", "unde sunt setarile tva", "du-ma la tva", "mergi la tva", "deschide tva"], target: buildRouteTarget("Setari TVA", "Te duc direct in Setari > TVA.", "/setari/tva", ["Setari TVA"]) },
    { keywords: ["unde sunt utilizatorii", "unde gasesc utilizatorii", "du-ma la utilizatori", "mergi la utilizatori", "deschide utilizatori"], target: buildRouteTarget("Utilizatori ERP", "Te duc direct in Setari > Utilizatori.", "/setari/utilizatori", ["Utilizatori ERP"]) },
    { keywords: ["unde este backup", "unde sunt backupurile", "du-ma la backup", "mergi la backup", "deschide backup"], target: buildRouteTarget("Backup", "Te duc direct in Setari > Backup.", "/setari/backup", ["Backup"]) },
    { keywords: ["unde este istoricul", "unde gasesc istoricul", "du-ma la istoric", "mergi la istoric", "deschide istoric"], target: buildRouteTarget("Istoric actiuni", "Te duc direct in Setari > Istoric.", "/setari/istoric", ["Istoric actiuni"]) },
    { keywords: ["unde este dashboard", "du-ma la dashboard", "mergi la dashboard", "deschide dashboard"], target: buildRouteTarget("Dashboard", "Te duc direct in dashboard.", "/dashboard", ["Dashboard operational"]) },
  ] as const
  const openProductMatch = question.match(/deschide produsul\s+(.+)/i)

  const searchCommandMatch = searchCommandPatterns.find((item) => item.regex.test(rawQuestion))
  if (searchCommandMatch) {
    const result = rawQuestion.match(searchCommandMatch.regex)
    const value = normalizeText(result?.[1])
    if (value) {
      return {
        title: searchCommandMatch.title,
        hint: searchCommandMatch.hint,
        anchors: [...searchCommandMatch.anchors, value],
        route: searchCommandMatch.route(value),
      }
    }
  }

  const routeIntent = routeIntentMatchers.find((item) => normalizedIncludes(question, item.keywords))
  if (routeIntent) {
    return routeIntent.target
  }

  if (openProductMatch?.[1]) {
    const productName = normalizeText(openProductMatch[1])
    return {
      title: `Produs: ${productName}`,
      hint: `Te duc direct in Produse si caut ${productName}.`,
      anchors: [productName, "Cauta rapid dupa produs", "Produse"],
      route: `/nomenclator/produse?q=${encodeURIComponent(productName)}`,
    }
  }

  if (pathname.startsWith("/nomenclator/produse")) {
    if (normalizedIncludes(question, ["unitate de masura", "unitatea de masura", "um", "masura"])) {
      return {
        title: "Unitate de masura",
        hint: "Aici alegi UM-ul produsului din zona Unitati si achizitie.",
        anchors: ["UM vanzare", "UM", "Unitati si achizitie"],
        tabs: ["Unitati si achizitie"],
      }
    }
    if (normalizedIncludes(question, ["cod de bare", "barcode"])) {
      return {
        title: "Cod de bare",
        hint: "Aici completezi sau generezi codul de bare pentru produs.",
        anchors: ["Cod de bare", "Genereaza cod"],
        tabs: ["Date generale"],
      }
    }
    if (normalizedIncludes(question, ["retetar"])) {
      return {
        title: "Retetar",
        hint: "Aici verifici modul de retetar si daca produsul cere retetar obligatoriu.",
        anchors: ["Mod retetar", "Retetar obligatoriu"],
        tabs: ["Date generale", "Control si loturi"],
      }
    }
    if (normalizedIncludes(question, ["categorie", "subcategorie"])) {
      return {
        title: "Categorie produs",
        hint: "Aici alegi categoria principala si, daca este cazul, subcategoria produsului.",
        anchors: ["Categorie principala", "Subcategorie", "Incadrare produs"],
        tabs: ["Date generale"],
      }
    }
    if (normalizedIncludes(question, ["pret", "pret vanzare", "cost"])) {
      return {
        title: "Pret si cost",
        hint: "Aici verifici pretul de vanzare, costul si unitatile de achizitie.",
        anchors: ["Pret vanzare", "Cost achizitie / UM", "Unitati si achizitie"],
        tabs: ["Unitati si achizitie"],
      }
    }
  }

  if (pathname.startsWith("/nomenclator/categorii")) {
    if (normalizedIncludes(question, ["pozitie", "ordine", "pos"])) {
      return {
        title: "Pozitie Gufo POS",
        hint: "Aici setezi ordinea in care categoria apare in Gufo POS.",
        anchors: ["Pozitie Gufo POS", "Categorie", "Categorie parinte"],
        tabs: ["Categorii produse"],
      }
    }
  }

  if (pathname.startsWith("/setari/gufo-ai")) {
    if (normalizedIncludes(question, ["rol", "acces"])) {
      return {
        title: "Acces pe rol",
        hint: "Aici alegi ce roluri pot vedea si folosi Gufo AI.",
        anchors: ["Acces pe rol", "Proprietar", "Administrator", "Operator", "Casier"],
        tabs: ["Setari Gufo AI"],
      }
    }
  }

  return null
}

function extractFieldLabel(element: Element) {
  const parent = element.parentElement
  const previous = element.previousElementSibling
  const fromPrevious = normalizeText(previous?.textContent)
  if (fromPrevious && fromPrevious.length <= 40) return fromPrevious

  const label = parent?.querySelector("label")
  const fromLabel = normalizeText(label?.textContent)
  if (fromLabel && fromLabel.length <= 40) return fromLabel

  return ""
}

function locateGuideElement(anchors: string[]) {
  if (typeof document === "undefined") return null
  const candidates = Array.from(document.querySelectorAll("label, button, h1, h2, h3, h4, span, div, p"))
  for (const anchor of anchors) {
    const normalizedAnchor = normalizeText(anchor).toLowerCase()
    const exact = candidates.find((element) => normalizeText(element.textContent).toLowerCase() === normalizedAnchor)
    if (exact) return exact
    const partial = candidates.find((element) => normalizeText(element.textContent).toLowerCase().includes(normalizedAnchor))
    if (partial) return partial
  }
  return null
}

function openGuideTabs(tabTitles?: string[]) {
  if (typeof document === "undefined" || !tabTitles?.length) return
  const buttons = Array.from(document.querySelectorAll("button"))
  for (const tabTitle of tabTitles) {
    const normalizedTab = normalizeText(tabTitle).toLowerCase()
    const tabButton = buttons.find((button) => normalizeText(button.textContent).toLowerCase() === normalizedTab)
    if (tabButton) {
      ;(tabButton as HTMLButtonElement).click()
    }
  }
}

function extractPageContext(pageLabel: string): GufoAiPageContext | undefined {
  if (typeof document === "undefined") return undefined

  const title = normalizeText(document.querySelector("h1")?.textContent) || pageLabel
  const bodyText = normalizeText(document.body?.innerText)

  const headings = uniqueCompactTexts(
    Array.from(document.querySelectorAll("h1, h2, h3")).map((node) => node.textContent),
    6,
    90
  )

  const selectedValues = uniqueCompactTexts(
    Array.from(document.querySelectorAll("select, input[type='text'], input[type='date'], input[type='search']"))
      .map((element) => {
        const input = element as HTMLInputElement | HTMLSelectElement
        const rawValue =
          input instanceof HTMLSelectElement
            ? input.selectedOptions?.[0]?.textContent || input.value
            : input.value || input.placeholder
        const label = extractFieldLabel(element)
        return label ? `${label}: ${normalizeText(rawValue)}` : normalizeText(rawValue)
      }),
    6,
    120
  )

  const visibleActions = uniqueCompactTexts(
    Array.from(document.querySelectorAll("button, a[role='button']"))
      .map((element) => normalizeText(element.textContent))
      .filter((value) => value && value.length <= 40),
    8,
    40
  )

  const warnings = uniqueCompactTexts(
    [
      bodyText.includes("nu pot incarca") ? "Vad un mesaj de eroare de incarcare in pagina." : "",
      bodyText.includes("eroare") ? "Exista un mesaj de eroare vizibil in pagina." : "",
      bodyText.includes("offline") ? "Aplicatia sau modulul curent pare sa fie offline." : "",
      bodyText.includes("invalid") ? "Exista un mesaj de validare sau credențiale invalide in pagina." : "",
      selectedValues.some((value) => value.toLowerCase().includes("selecteaza categoria principala"))
        ? "Categoria principala nu este selectata in formularul curent."
        : "",
      selectedValues.some((value) => value.toLowerCase().includes("nu exista subcategorii"))
        ? "Categoria aleasa nu are inca subcategorii disponibile."
        : "",
      pageLabel === "Panou principal" && !selectedValues.length
        ? "Nu vad filtre clare selectate; daca lipsesc date, merita verificata perioada sau locatia."
        : "",
      (pageLabel === "Rapoarte" || pageLabel === "Vanzari / Bon" || pageLabel === "Inchideri zilnice") &&
      !selectedValues.length
        ? "Pe rapoarte si financiar merita verificate perioada, locatia si device-ul daca rezultatele par goale."
        : "",
    ],
    4,
    140
  )

  if (!title && !headings.length && !selectedValues.length && !visibleActions.length && !warnings.length) return undefined

  return {
    pageLabel,
    title,
    headings,
    selectedValues,
    visibleActions,
    warnings,
  }
}

export default function GufoAiWidget() {
  const location = useLocation()
  const navigate = useNavigate()
  const [config, setConfig] = useState<GufoAiConfig>(() => readGufoAiConfig())
  const [userRole, setUserRole] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return window.localStorage.getItem("role") || ""
  })
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions(location.pathname))
  const [robotBubble, setRobotBubble] = useState<RobotBubble | null>(null)
  const [guideMarker, setGuideMarker] = useState<GuideMarker | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const announcedWarningKeyRef = useRef("")
  const guideTimerRef = useRef<number | null>(null)
  const [position, setPosition] = useState<WidgetPosition>(() => {
    if (typeof window === "undefined") {
      return { x: 0, y: 0 }
    }

    const saved = window.localStorage.getItem(POSITION_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WidgetPosition
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          return parsed
        }
      } catch {
        // ignore invalid stored position
      }
    }

    return {
      x: window.innerWidth - FAB_WIDTH - FAB_MARGIN,
      y: window.innerHeight - FAB_HEIGHT - FAB_MARGIN,
    }
  })

  const pageLabel = useMemo(() => routeLabel(location.pathname), [location.pathname])
  const moduleScope = useMemo(() => resolveModuleScope(location.pathname), [location.pathname])
  const pageContext = useMemo(
    () => (config.watchCurrentPage ? extractPageContext(pageLabel) : undefined),
    [config.watchCurrentPage, pageLabel, location.pathname]
  )
  const assistantActions = useMemo(() => buildAssistantActions(location.pathname), [location.pathname])
  const hasRoleAccess = config.roleAccess[resolveAiRoleKey(userRole)]
  const hasModuleAccess = hasModuleDraftAccess(config, moduleScope)
  const ModeIcon = modeIcon(config.mode)
  const chatPosition = useMemo(() => {
    if (typeof window === "undefined") {
      return { left: FAB_MARGIN, top: FAB_MARGIN }
    }

    const desiredLeft = position.x + FAB_WIDTH - CHAT_WIDTH
    const maxLeft = Math.max(FAB_MARGIN, window.innerWidth - CHAT_WIDTH - FAB_MARGIN)
    const left = Math.max(FAB_MARGIN, Math.min(desiredLeft, maxLeft))

    const preferredTop = position.y - CHAT_HEIGHT - CHAT_GAP
    const maxTop = Math.max(FAB_MARGIN, window.innerHeight - CHAT_HEIGHT - FAB_MARGIN)
    const top =
      preferredTop >= FAB_MARGIN
        ? Math.min(preferredTop, maxTop)
        : Math.max(FAB_MARGIN, Math.min(position.y + FAB_HEIGHT + CHAT_GAP, maxTop))

    return { left, top }
  }, [position])

  useEffect(() => {
    setSuggestions(defaultSuggestions(location.pathname))
  }, [location.pathname])

  useEffect(() => {
    return () => {
      if (guideTimerRef.current) {
        window.clearTimeout(guideTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (open) {
      setRobotBubble(null)
      setGuideMarker(null)
      return
    }
    if (!config.enabled || !hasRoleAccess) return

    if (pageContext?.warnings?.length) {
      setRobotBubble({
        title: "Am observat ceva",
        text: pageContext.warnings[0] || "Merita verificata pagina curenta.",
      })
      return
    }

    setRobotBubble({
      title: pageLabel,
      text: hasModuleAccess
        ? "Te pot ghida direct in campurile din pagina asta."
        : "Aici iti explic si iti arat unde trebuie sa verifici.",
    })
  }, [config.enabled, hasModuleAccess, hasRoleAccess, open, pageContext, pageLabel])

  useEffect(() => {
    if (!config.enabled || !config.proactiveWarnings || !config.watchCurrentPage) return
    if (!pageContext?.warnings?.length) return

    const warningKey = `${location.pathname}::${pageContext.warnings.join("|")}`
    if (announcedWarningKeyRef.current === warningKey) return
    announcedWarningKeyRef.current = warningKey

    setMessages((prev) => {
      const alreadyExists = prev.some(
        (item) =>
          item.role === "assistant" &&
          item.text.includes("Am observat ceva") &&
          pageContext.warnings.every((warning) => item.text.includes(warning))
      )
      if (alreadyExists) return prev

      return [
        ...prev,
        {
          id: `${Date.now()}-observer`,
          role: "assistant",
          text: `Am observat ceva in pagina curenta:\n- ${pageContext.warnings.join("\n- ")}\n\nDaca vrei, iti spun imediat si ce merita verificat sau cum rezolvi.`,
        },
      ]
    })
  }, [
    config.enabled,
    config.proactiveWarnings,
    config.watchCurrentPage,
    location.pathname,
    pageContext,
  ])

  useEffect(() => subscribeGufoAiConfig(setConfig), [])

  useEffect(() => {
    let cancelled = false

    void me()
      .then((profile) => {
        if (cancelled) return
        const role = String(profile?.role || "").trim()
        if (!role) return
        setUserRole(role)
        if (typeof window !== "undefined") {
          window.localStorage.setItem("role", role)
        }
      })
      .catch(() => null)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasRoleAccess && open) {
      setOpen(false)
    }
  }, [hasRoleAccess, open])

  useEffect(() => {
    if (!config.enabled || !hasRoleAccess) return
    if (hasModuleAccess) return

    const infoKey = `module-lock::${location.pathname}::${moduleScope}`
    if (announcedWarningKeyRef.current === infoKey) return
    announcedWarningKeyRef.current = infoKey

    setMessages((prev) => {
      const text = `Pe modulul ${moduleLabel(moduleScope)}, Gufo AI este acum in mod sigur: pot explica si ghida, dar drafturile sau asistenta activa sunt oprite din Setari Gufo AI.`
      const alreadyExists = prev.some((item) => item.role === "assistant" && item.text === text)
      if (alreadyExists) return prev
      return [
        ...prev,
        {
          id: `${Date.now()}-module-lock`,
          role: "assistant",
          text,
        },
      ]
    })
  }, [config.enabled, hasRoleAccess, hasModuleAccess, location.pathname, moduleScope])

  useEffect(() => {
    if (!messages.length) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: `Salut! Sunt Gufo AI.\n\nAcum rulez in modul ${modeLabel(config.mode)}. ${modeDescription(config)}\n\nStiu zonele importante din aplicatie: documente, stoc, productie, SPV/ANAF, e-Transport, rapoarte, financiar, nomenclator si setari. Acum esti in zona ${pageLabel}. Vorbeste cu mine natural, exact cum ai vorbi cu un coleg: spune-mi ce vrei sa faci, unde te-ai blocat sau ce nu intelegi.`,
        },
      ])
    }
  }, [config.mode, messages.length, pageLabel])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open, loading])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
  }, [position])

  useEffect(() => {
    if (typeof window === "undefined") return

    function clampPosition(next: WidgetPosition) {
      const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_WIDTH - FAB_MARGIN)
      const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_HEIGHT - FAB_MARGIN)
      return {
        x: Math.max(FAB_MARGIN, Math.min(next.x, maxX)),
        y: Math.max(FAB_MARGIN, Math.min(next.y, maxY)),
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragOffsetRef.current) return
      draggedRef.current = true
      setPosition(
        clampPosition({
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        })
      )
    }

    function handlePointerUp() {
      dragOffsetRef.current = null
      window.setTimeout(() => {
        draggedRef.current = false
      }, 0)
    }

    function handleResize() {
      setPosition((prev) => clampPosition(prev))
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    draggedRef.current = false
  }

  function activateGuide(target: LocalGuideTarget) {
    if (typeof window === "undefined") return false

    if (target.route && location.pathname !== target.route) {
      setRobotBubble({
        title: target.title,
        text: target.hint,
      })
      setGuideMarker(null)
      setOpen(false)
      setInput("")
      navigate(target.route)
      window.setTimeout(() => {
        activateGuide({
          ...target,
          route: undefined,
        })
      }, 450)
      return true
    }

    openGuideTabs(target.tabs)

    const locateTarget = () => locateGuideElement(target.anchors)
    let element = locateTarget()
    if (!element) {
      window.setTimeout(() => {
        activateGuide({
          ...target,
          tabs: [],
        })
      }, 220)
      return true
    }

    const guideElement = (element.parentElement || element) as HTMLElement
    guideElement.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
    guideElement.classList.add("gufo-ai-guide-target")

    const rect = guideElement.getBoundingClientRect()
    const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_WIDTH - FAB_MARGIN)
    const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_HEIGHT - FAB_MARGIN)
    setPosition({
      x: Math.max(FAB_MARGIN, Math.min(rect.right + 18, maxX)),
      y: Math.max(FAB_MARGIN, Math.min(rect.top - 8, maxY)),
    })
    setGuideMarker({
      title: target.title,
      left: Math.max(FAB_MARGIN, Math.min(rect.right - 16, window.innerWidth - 180)),
      top: Math.max(FAB_MARGIN, rect.top - 54),
    })

    setRobotBubble({
      title: target.title,
      text: target.hint,
    })
    setOpen(false)
    setInput("")
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-guide`,
        role: "assistant",
        text: `${target.title}: ${target.hint}`,
      },
    ])

    if (guideTimerRef.current) {
      window.clearTimeout(guideTimerRef.current)
    }
    guideTimerRef.current = window.setTimeout(() => {
      guideElement.classList.remove("gufo-ai-guide-target")
      setGuideMarker(null)
    }, 5000)

    return true
  }

  async function submitQuestion(text: string) {
    const question = text.trim()
    if (!question || loading || !config.enabled || !config.conversationalHelp) return

    const localGuide = resolveLocalGuide(location.pathname, question)
    if (localGuide && activateGuide(localGuide)) {
      return
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text: question,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setLoading(true)

    try {
      const response = await api<GufoAiResponse>("/api/v1/gufo-ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: question,
          currentPath: location.pathname,
          pageContext,
          history: messages.slice(-8).map((item) => ({
            role: item.role,
            text: item.text,
          })),
        }),
      })

      const answer = response?.item?.answer || "Nu am reusit sa formulez un raspuns util."
      const nextSuggestions = Array.isArray(response?.item?.suggestions) ? response.item!.suggestions : []

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          text: answer,
        },
      ])

      if (nextSuggestions.length) setSuggestions(nextSuggestions)
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant-error`,
          role: "assistant",
          text:
            error?.message ||
            "Gufo AI nu este disponibil momentan. Incearca din nou peste cateva momente.",
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        .gufo-ai-guide-target {
          position: relative;
          outline: 3px solid rgba(34, 211, 238, 0.92);
          box-shadow: 0 0 0 8px rgba(34, 211, 238, 0.16);
          border-radius: 18px;
          animation: gufoAiGuidePulse 1.1s ease-in-out infinite;
          transition: box-shadow .2s ease, outline-color .2s ease;
        }
        @keyframes gufoAiGuidePulse {
          0%, 100% { box-shadow: 0 0 0 8px rgba(34, 211, 238, 0.16); }
          50% { box-shadow: 0 0 0 14px rgba(34, 211, 238, 0.22); }
        }
        .gufo-ai-cloud {
          position: relative;
          border-radius: 32px;
          background: rgba(255,255,255,0.97);
        }
        .gufo-ai-cloud::before,
        .gufo-ai-cloud::after {
          content: "";
          position: absolute;
          border-radius: 999px;
          background: rgba(255,255,255,0.95);
          border: 1px solid rgba(226,232,240,0.92);
          z-index: -1;
        }
        .gufo-ai-cloud::before {
          width: 86px;
          height: 86px;
          left: 10px;
          top: -30px;
        }
        .gufo-ai-cloud::after {
          width: 104px;
          height: 104px;
          right: 18px;
          top: -38px;
        }
        .gufo-ai-cloud-tail {
          position: absolute;
          right: 28px;
          bottom: -16px;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: rgba(255,255,255,0.95);
          border: 1px solid rgba(226,232,240,0.92);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        }
        .gufo-ai-cloud-tail::after {
          content: "";
          position: absolute;
          right: -12px;
          bottom: -10px;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: rgba(255,255,255,0.95);
          border: 1px solid rgba(226,232,240,0.92);
        }
        @keyframes gufoAiPointerBounce {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-7px); }
        }
      `}</style>
      {!hasRoleAccess ? null : (
        <>
          {!open && guideMarker ? (
            <div
              className="fixed z-[60] flex items-center gap-2 rounded-full bg-[#17324D] px-3 py-2 text-xs font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.26)]"
              style={{
                left: `${guideMarker.left}px`,
                top: `${guideMarker.top}px`,
                animation: "gufoAiPointerBounce 1.05s ease-in-out infinite",
              }}
            >
              <MousePointer2 size={14} />
              Aici: {guideMarker.title}
            </div>
          ) : null}
          {!open && robotBubble ? (
            <div
              className="gufo-ai-cloud fixed z-50 max-w-[300px] border border-slate-200 bg-white/95 px-4 py-3 text-left shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur"
              style={{
                left: `${Math.max(FAB_MARGIN, position.x - 190)}px`,
                top: `${Math.max(FAB_MARGIN, position.y - 110)}px`,
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {robotBubble.title}
              </div>
              <div className="mt-1 text-sm leading-5 text-slate-700">{robotBubble.text}</div>
              <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#17324D]">
                <ArrowRight size={12} />
                Apasa robotul pentru chat
              </div>
              <div className="gufo-ai-cloud-tail" />
            </div>
          ) : null}

          <button
            type="button"
            onPointerDown={startDrag}
            onClick={() => {
              if (draggedRef.current) return
              setOpen((prev) => !prev)
            }}
            className="fixed z-50 inline-flex items-center justify-center border-0 bg-transparent p-0 shadow-none transition hover:-translate-y-0.5"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: `${FAB_WIDTH}px`,
              height: `${FAB_HEIGHT}px`,
              touchAction: "none",
              cursor: "grab",
              opacity: config.enabled ? 1 : 0.78,
            }}
          >
            <GufoAiAvatar size={84} thinking={loading} mode={loading ? "thinking" : open ? "active" : "idle"} className="shrink-0" />
          </button>
        </>
      )}

      {open && hasRoleAccess ? (
        <div
          className="fixed z-50 flex h-[min(66vh,520px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.2)]"
          style={{
            left: `${chatPosition.left}px`,
            top: `${chatPosition.top}px`,
          }}
        >
          <div className="border-b border-slate-200 bg-[#17324D] px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                  <Sparkles size={14} />
                  Asistent ERP live
                </div>
                <div className="mt-2 flex items-center gap-3 text-lg font-semibold">
                  <GufoAiAvatar size={56} thinking={loading} mode={loading ? "thinking" : "active"} className="shrink-0" />
                  <span>Gufo AI</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                    <ModeIcon size={12} />
                    {modeLabel(config.mode)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                    {moduleLabel(moduleScope)}
                  </span>
                  {config.watchCurrentPage ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                      <Eye size={12} />
                      Context live
                    </span>
                  ) : null}
                  {config.requireConfirmation ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                      <ShieldCheck size={12} />
                      Confirmare
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-300">Pagina curenta: {pageLabel}</div>
                {!hasModuleAccess ? (
                  <div className="mt-2 rounded-2xl border border-amber-200/40 bg-amber-100/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    Pe acest modul pot doar sa explic si sa ghidez. Asistenta activa este oprita din Setari Gufo AI.
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white transition hover:bg-white/15"
                aria-label="Inchide chatul"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {!config.enabled ? (
              <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Gufo AI este momentan pus pe pauza din Setari AI. Il poti reactiva din <strong>Setari &gt; Gufo AI</strong>.
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[86%] rounded-[22px] rounded-br-md bg-[#17324D] px-4 py-3 text-sm leading-6 text-white"
                      : "max-w-[92%] rounded-[22px] rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700"
                  }
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {message.text}
                </div>
              </div>
            ))}

            {loading ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-3 rounded-[22px] rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  <GufoAiAvatar size={42} thinking mode="thinking" className="shrink-0" />
                  <div>
                    <div className="font-medium text-slate-700">Gufo AI gandeste...</div>
                    <div className="text-xs text-slate-500">Analizez pagina, contextul si intrebarea ta.</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {(hasModuleAccess ? assistantActions.map((action) => action.prompt) : suggestions).slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submitQuestion(suggestion)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-[#17324D] hover:bg-slate-100"
                >
                  {hasModuleAccess
                    ? assistantActions.find((action) => action.prompt === suggestion)?.label || suggestion
                    : suggestion}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submitQuestion(input)
                  }
                }}
                rows={2}
                placeholder={
                  config.enabled && config.conversationalHelp
                    ? "Intreaba scurt, de exemplu: unde gasesc UM?"
                    : "Conversatia este pusa pe pauza din Setari AI."
                }
                className="min-h-[52px] flex-1 resize-none rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#17324D] focus:bg-white focus:ring-4 focus:ring-blue-100"
                disabled={!config.enabled || !config.conversationalHelp}
              />

              <button
                type="button"
                onClick={() => submitQuestion(input)}
                disabled={loading || !input.trim() || !config.enabled || !config.conversationalHelp}
                className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-[18px] bg-[#17324D] text-white transition hover:bg-[#0F2740] disabled:cursor-not-allowed disabled:bg-slate-300"
                aria-label="Trimite mesajul"
              >
                <SendHorizonal size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
