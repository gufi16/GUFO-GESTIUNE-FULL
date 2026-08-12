import { useEffect, useMemo, useRef, useState } from "react"
import { BrainCircuit, Eye, SendHorizonal, ShieldCheck, Sparkles, Wand2, X } from "lucide-react"
import { useLocation } from "react-router-dom"
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const announcedWarningKeyRef = useRef("")
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

  async function submitQuestion(text: string) {
    const question = text.trim()
    if (!question || loading || !config.enabled || !config.conversationalHelp) return

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
      {!hasRoleAccess ? null : (
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
      )}

      {open && hasRoleAccess ? (
        <div
          className="fixed z-50 flex h-[min(78vh,680px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.2)]"
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
                <div className="mt-2 text-sm text-slate-200">{modeDescription(config)}</div>
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
            {hasModuleAccess ? (
            <div className="mb-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Actiuni asistate
              </div>
              <div className="flex flex-wrap gap-2">
                {assistantActions.slice(0, 3).map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => submitQuestion(action.prompt)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#17324D] transition hover:border-[#17324D] hover:bg-blue-100"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
            ) : null}

            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submitQuestion(suggestion)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-[#17324D] hover:bg-slate-100"
                >
                  {suggestion}
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
                    ? "Scrie-mi natural, de exemplu: salut, cum fac un NIR sau de ce nu pot salva..."
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
