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

function routeLabel(pathname: string) {
  if (pathname.startsWith("/dashboard")) return "Panou principal"
  if (pathname.startsWith("/nomenclator/produse")) return "Produse"
  if (pathname.startsWith("/nomenclator/locatii")) return "Locatii"
  if (pathname.startsWith("/gestiune/inventare")) return "Inventare"
  if (pathname.startsWith("/inregistrare-document/inventar/new")) return "Inventar nou"
  if (pathname.startsWith("/transfer")) return "Transfer"
  if (pathname.startsWith("/rapoarte")) return "Rapoarte"
  if (pathname.startsWith("/setari/istoric")) return "Istoric actiuni"
  if (pathname.startsWith("/setari/utilizatori")) return "Utilizatori ERP"
  if (pathname.startsWith("/setari")) return "Setari"
  if (pathname.startsWith("/gestiune/productie")) return "Productie"
  if (pathname.startsWith("/documente") || pathname.startsWith("/inregistrare-document")) return "Documente"
  return "ERP"
}

function defaultSuggestions(pathname: string) {
  if (pathname.startsWith("/nomenclator/produse")) {
    return ["Cum adaug un produs?", "Cum completez retetarul?", "De ce nu apare produsul in POS?"]
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
  return ["Cum adaug un produs?", "Cum fac un inventar nou?", "De ce nu vad date in dashboard?"]
}

export default function GufoAiWidget() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions(location.pathname))
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const pageLabel = useMemo(() => routeLabel(location.pathname), [location.pathname])

  useEffect(() => {
    setSuggestions(defaultSuggestions(location.pathname))
  }, [location.pathname])

  useEffect(() => {
    if (!messages.length) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: `Salut! Sunt Gufo AI. Te pot ajuta cu pasii din ERP pentru pagina ${pageLabel}. Spune-mi ce vrei sa faci si iti raspund simplu, in romana.`,
        },
      ])
    }
  }, [messages.length, pageLabel])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open, loading])

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
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-5 right-5 z-50 inline-flex h-16 items-center gap-3 rounded-full border border-[#17324D] bg-[#17324D] px-4 text-white shadow-[0_18px_45px_rgba(23,50,77,0.28)] transition hover:-translate-y-0.5 hover:bg-[#0F2740]"
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12">
          <Bot size={20} />
        </span>
        <span className="pr-1 text-sm font-semibold">Gufo AI</span>
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-50 flex h-[min(78vh,680px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.2)]">
          <div className="border-b border-slate-200 bg-[#17324D] px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                  <Sparkles size={14} />
                  Asistent ERP
                </div>
                <div className="mt-2 text-lg font-semibold">Gufo AI</div>
                <div className="mt-1 text-sm text-slate-200">Pagina curenta: {pageLabel}</div>
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
                  Gufo AI scrie...
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
                placeholder="Scrie ce vrei sa faci in ERP..."
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
