import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, SendHorizonal, Sparkles, X } from "lucide-react"
import { useLocation } from "react-router-dom"
import { api } from "../lib/api"

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

type WidgetPosition = {
  x: number
  y: number
}

const POSITION_STORAGE_KEY = "gufo-ai-widget-position"
const FAB_WIDTH = 176
const FAB_HEIGHT = 64
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
  if (pathname.startsWith("/setari")) {
    return ["Unde schimb datele firmei?", "Unde schimb seria facturii?", "Cum verific setarea de TVA?"]
  }
  return ["Ce module are aplicatia?", "Cum lucrez cu SPV si ANAF?", "Cum fac un NIR?"]
}

export default function GufoAiWidget() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions(location.pathname))
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
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
    if (!messages.length) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: `Salut! Sunt Gufo AI.\n\nStiu zonele importante din aplicatie: documente, stoc, productie, SPV/ANAF, e-Transport, rapoarte, financiar, nomenclator si setari. Acum esti in zona ${pageLabel}. Vorbeste cu mine natural, exact cum ai vorbi cu un coleg: spune-mi ce vrei sa faci, unde te-ai blocat sau ce nu intelegi.`,
        },
      ])
    }
  }, [messages.length, pageLabel])

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
    if (!question || loading) return

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
      <button
        type="button"
        onPointerDown={startDrag}
        onClick={() => {
          if (draggedRef.current) return
          setOpen((prev) => !prev)
        }}
        className="fixed z-50 inline-flex h-16 items-center gap-3 rounded-full border border-[#17324D] bg-[#17324D] px-4 text-white shadow-[0_18px_45px_rgba(23,50,77,0.28)] transition hover:-translate-y-0.5 hover:bg-[#0F2740]"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12">
          <Bot size={20} />
        </span>
        <span className="pr-1 text-sm font-semibold">Gufo AI</span>
      </button>

      {open ? (
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
                  Asistent ERP
                </div>
                <div className="mt-2 text-lg font-semibold">Gufo AI</div>
                <div className="mt-1 text-sm text-slate-200">Asistent ERP conversational</div>
                <div className="mt-1 text-xs text-slate-300">Pagina curenta: {pageLabel}</div>
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
                <div className="rounded-[22px] rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  Gufo AI iti raspunde...
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-4">
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
                placeholder="Scrie-mi natural, de exemplu: salut, cum fac un NIR sau de ce nu pot salva..."
                className="min-h-[52px] flex-1 resize-none rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#17324D] focus:bg-white focus:ring-4 focus:ring-blue-100"
              />

              <button
                type="button"
                onClick={() => submitQuestion(input)}
                disabled={loading || !input.trim()}
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
