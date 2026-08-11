import clsx from "clsx"
import { useEffect, useId, useMemo, useState } from "react"

export default function GufoAiAvatar({
  size = 40,
  className,
  thinking = false,
  mode = "active",
}: {
  size?: number
  className?: string
  thinking?: boolean
  mode?: "idle" | "active" | "thinking"
}) {
  const uniqueId = useId().replace(/:/g, "")
  const [hovered, setHovered] = useState(false)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const [idleBeat, setIdleBeat] = useState(0)
  const [idleLookSide, setIdleLookSide] = useState<-1 | 0 | 1>(0)
  const [idleNod, setIdleNod] = useState(false)
  const isThinking = thinking || mode === "thinking"
  const isIdle = mode === "idle" && !isThinking
  const isActive = mode === "active" && !isThinking

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2
      const rawX = (event.clientX - centerX) / centerX
      const rawY = (event.clientY - centerY) / centerY
      const maxOffset = hovered ? 3.4 : 2.2

      setGaze({
        x: Math.max(-maxOffset, Math.min(maxOffset, rawX * maxOffset)),
        y: Math.max(-maxOffset, Math.min(maxOffset, rawY * maxOffset)),
      })
    }

    function handlePointerLeave() {
      setGaze({ x: 0, y: 0 })
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerleave", handlePointerLeave)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerleave", handlePointerLeave)
    }
  }, [hovered])

  useEffect(() => {
    if (!isIdle) {
      setIdleBeat(0)
      setIdleLookSide(0)
      setIdleNod(false)
      return
    }

    const beatTimer = window.setInterval(() => {
      setIdleBeat((value) => (value + 1) % 4)
    }, 2200)

    const lookTimer = window.setInterval(() => {
      const states: Array<-1 | 0 | 1> = [0, -1, 0, 1]
      setIdleLookSide(states[Math.floor(Math.random() * states.length)] ?? 0)
      setIdleNod(Math.random() > 0.55)
      window.setTimeout(() => setIdleNod(false), 900)
    }, 3600)

    return () => {
      window.clearInterval(beatTimer)
      window.clearInterval(lookTimer)
    }
  }, [isIdle])

  const gradients = useMemo(
    () => ({
      metal: `gufoBotMetal-${uniqueId}`,
      dark: `gufoBotDark-${uniqueId}`,
      eye: `gufoBotEye-${uniqueId}`,
      core: `gufoBotCore-${uniqueId}`,
    }),
    [uniqueId]
  )

  const idleGazeX = idleLookSide * 2.8
  const idleGazeY = idleNod ? 1.6 : 0.9
  const finalGaze = isIdle ? { x: idleGazeX, y: idleGazeY } : gaze
  const botScale = isIdle ? 0.88 : hovered ? 1.08 : isThinking ? 1.03 : 1
  const bodyTilt = hovered ? gaze.x * 0.7 : isIdle ? idleLookSide * 1.2 : gaze.x * 0.4
  const headTilt = hovered ? gaze.x * 1.2 : isIdle ? idleLookSide * 2.2 : gaze.x * 0.65
  const idleBodyDrop = isIdle ? 10 + (idleBeat === 1 ? 1 : idleBeat === 3 ? -1 : 0) : 0
  const idleHeadDrop = isIdle ? 10 + (idleNod ? 2 : 0) : 0
  const floatAnimation = isThinking
    ? "gufoBotFloat 1.45s ease-in-out infinite"
    : isIdle
      ? "gufoBotSit 4.2s ease-in-out infinite"
      : "gufoBotIdle 3.2s ease-in-out infinite"

  return (
    <div
      className={clsx("relative inline-flex items-center justify-center overflow-visible select-none", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style>{`
        @keyframes gufoBotIdle {
          0%, 100% { transform: translateY(0px) scale(1); }
          25% { transform: translateY(-1.5px) scale(1.008); }
          50% { transform: translateY(-3px) scale(1.015); }
          75% { transform: translateY(-1px) scale(1.006); }
        }
        @keyframes gufoBotSit {
          0%, 100% { transform: translateY(3px) scale(1); }
          25% { transform: translateY(2px) scale(1.004); }
          50% { transform: translateY(1px) scale(1.008); }
          75% { transform: translateY(2px) scale(1.004); }
        }
        @keyframes gufoBotFloat {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-4px) scale(1.02); }
        }
        @keyframes gufoBotGlow {
          0%, 100% { opacity: .82; filter: drop-shadow(0 0 3px rgba(56,189,248,.55)); }
          50% { opacity: 1; filter: drop-shadow(0 0 10px rgba(56,189,248,.98)); }
        }
        @keyframes gufoBotBlink {
          0%, 44%, 100% { transform: scaleY(1); }
          46%, 48% { transform: scaleY(.14); }
        }
        @keyframes gufoBotThink {
          0%, 100% { transform: translateY(0px) scale(1); opacity: .45; }
          50% { transform: translateY(-2px) scale(1.12); opacity: 1; }
        }
        @keyframes gufoBotPulse {
          0%, 100% { transform: scale(1); opacity: .72; }
          50% { transform: scale(1.12); opacity: 1; }
        }
        @keyframes gufoBotWave {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-4deg); }
          75% { transform: rotate(4deg); }
        }
      `}</style>

      <svg
        viewBox="0 0 120 140"
        className="h-full w-full overflow-visible transition-transform duration-300 ease-out"
        style={{ transform: `scale(${botScale})` }}
      >
        <defs>
          <linearGradient id={gradients.metal} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f7f7fb" />
            <stop offset="38%" stopColor="#cfd5e3" />
            <stop offset="72%" stopColor="#9da9c3" />
            <stop offset="100%" stopColor="#7b879f" />
          </linearGradient>
          <linearGradient id={gradients.dark} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d2434" />
            <stop offset="100%" stopColor="#0f1728" />
          </linearGradient>
          <radialGradient id={gradients.eye} cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#d9f8ff" />
            <stop offset="28%" stopColor="#67e8f9" />
            <stop offset="58%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </radialGradient>
          <radialGradient id={gradients.core} cx="50%" cy="40%" r="68%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="24%" stopColor="#7dd3fc" />
            <stop offset="62%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#0f766e" />
          </radialGradient>
        </defs>

        <ellipse
          cx="60"
          cy={isIdle ? "136" : "131"}
          rx={isIdle ? 25 : hovered ? 34 : 31}
          ry={isIdle ? 4.5 : hovered ? 7.5 : 6.5}
          fill="#38bdf8"
          opacity={isThinking ? "0.24" : hovered ? "0.2" : isIdle ? "0.06" : "0.12"}
        />

        <g opacity={isThinking || hovered ? 1 : isIdle ? 0.48 : 0.72} style={{ animation: hovered ? "gufoBotWave 1.8s ease-in-out infinite" : undefined }}>
          <line x1="27" y1="18" x2="27" y2="4" stroke="#8f99ad" strokeWidth="3" strokeLinecap="round" />
          <line x1="93" y1="18" x2="93" y2="4" stroke="#8f99ad" strokeWidth="3" strokeLinecap="round" />
          <circle
            cx="27"
            cy="3.5"
            r="4"
            fill="#fb7185"
            style={isThinking || hovered ? { animation: "gufoBotThink 1s ease-in-out infinite" } : undefined}
          />
          <circle
            cx="93"
            cy="3.5"
            r="4"
            fill="#fb7185"
            style={isThinking || hovered ? { animation: "gufoBotThink 1s ease-in-out .25s infinite" } : undefined}
          />
        </g>

        <g style={{ transform: `translateY(${isThinking ? -2 : idleBodyDrop}px) rotate(${bodyTilt}deg)`, transformOrigin: "60px 90px", animation: floatAnimation }}>
          <g>
            <ellipse cx="18" cy="43" rx="10" ry="15" fill={`url(#${gradients.metal})`} />
            <ellipse cx="102" cy="43" rx="10" ry="15" fill={`url(#${gradients.metal})`} />
            <ellipse cx="18" cy="43" rx="4.8" ry="8" fill={`url(#${gradients.dark})`} opacity="0.72" />
            <ellipse cx="102" cy="43" rx="4.8" ry="8" fill={`url(#${gradients.dark})`} opacity="0.72" />
          </g>

          <g style={{ transform: `translateY(${idleHeadDrop}px) rotate(${headTilt}deg)`, transformOrigin: "60px 43px" }}>
            <rect x="22" y="16" width="76" height="54" rx="19" fill={`url(#${gradients.metal})`} />
            <rect x="27" y="21" width="66" height="40" rx="14" fill={`url(#${gradients.dark})`} />
            <path d="M41 16h38" stroke="#f8fafc" strokeWidth="2" opacity="0.45" strokeLinecap="round" />

            <g
              style={{
                animation: `gufoBotBlink ${isThinking ? "2.2s" : hovered ? "2.8s" : isIdle ? "6.4s" : "4.2s"} ease-in-out infinite`,
                transformOrigin: "46px 41px",
              }}
            >
              <circle
                cx="46"
                cy="41"
                r="11.5"
                fill={`url(#${gradients.eye})`}
                style={isThinking || hovered || isActive ? { animation: "gufoBotGlow 1.35s ease-in-out infinite" } : isIdle ? { opacity: 0.78 } : undefined}
              />
              <circle cx="46" cy="41" r="6.8" fill="#0f1728" opacity="0.36" />
              <g style={{ transform: `translate(${finalGaze.x}px, ${finalGaze.y}px)`, transition: "transform 280ms ease-out" }}>
                <circle cx="46" cy="41" r="4.1" fill="#020617" />
                <circle cx="43.4" cy="38.2" r="2.2" fill="#ffffff" opacity="0.95" />
              </g>
            </g>

            <g
              style={{
                animation: `gufoBotBlink ${isThinking ? "2.2s" : hovered ? "2.8s" : isIdle ? "6.4s" : "4.2s"} ease-in-out .08s infinite`,
                transformOrigin: "74px 41px",
              }}
            >
              <circle
                cx="74"
                cy="41"
                r="11.5"
                fill={`url(#${gradients.eye})`}
                style={isThinking || hovered || isActive ? { animation: "gufoBotGlow 1.35s ease-in-out .18s infinite" } : isIdle ? { opacity: 0.78 } : undefined}
              />
              <circle cx="74" cy="41" r="6.8" fill="#0f1728" opacity="0.36" />
              <g style={{ transform: `translate(${finalGaze.x}px, ${finalGaze.y}px)`, transition: "transform 280ms ease-out" }}>
                <circle cx="74" cy="41" r="4.1" fill="#020617" />
                <circle cx="71.4" cy="38.2" r="2.2" fill="#ffffff" opacity="0.95" />
              </g>
            </g>
          </g>

          <rect x="35" y={isIdle ? "84" : "74"} width="50" height={isIdle ? "27" : "37"} rx="18" fill={`url(#${gradients.metal})`} />
          <rect x="47" y={isIdle ? "89" : "82"} width="26" height={isIdle ? "14" : "22"} rx="8" fill={`url(#${gradients.dark})`} />
          <rect
            x="53"
            y={isIdle ? "90" : "86"}
            width="14"
            height={isIdle ? "10" : "14"}
            rx="6"
            fill={`url(#${gradients.core})`}
            style={isThinking || hovered ? { animation: "gufoBotGlow 1.15s ease-in-out infinite, gufoBotPulse 1.4s ease-in-out infinite" } : isIdle ? { animation: "gufoBotPulse 3.6s ease-in-out infinite", opacity: 0.58 } : { animation: "gufoBotPulse 2.4s ease-in-out infinite" }}
          />

          <path d={isIdle ? "M41 94c-6 1-9 3-10 7" : "M38 83c-8 2-12 6-15 12"} stroke="#9aa7bf" strokeWidth="5" strokeLinecap="round" />
          <path d={isIdle ? "M79 94c6 1 9 3 10 7" : "M82 83c8 2 12 6 15 12"} stroke="#9aa7bf" strokeWidth="5" strokeLinecap="round" />
          <path d={isIdle ? "M31 101c0 3 1 5 4 7" : "M21 95c-2 7-4 12-3 19"} stroke="#7c879b" strokeWidth="5" strokeLinecap="round" />
          <path d={isIdle ? "M89 101c0 3-1 5-4 7" : "M99 95c2 7 4 12 3 19"} stroke="#7c879b" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx={isIdle ? "34" : "18"} cy={isIdle ? "109" : "118"} rx="8" ry="6" fill={`url(#${gradients.dark})`} />
          <ellipse cx={isIdle ? "86" : "102"} cy={isIdle ? "109" : "118"} rx="8" ry="6" fill={`url(#${gradients.dark})`} />

          <path d={isIdle ? "M52 107c-2 3-2 5-1 8" : "M48 111c-4 6-5 10-4 16"} stroke="#8793ab" strokeWidth="5" strokeLinecap="round" />
          <path d={isIdle ? "M68 107c2 3 2 5 1 8" : "M72 111c4 6 5 10 4 16"} stroke="#8793ab" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx={isIdle ? "52" : "44"} cy={isIdle ? "118" : "129"} rx="10" ry="7" fill={`url(#${gradients.metal})`} />
          <ellipse cx={isIdle ? "68" : "76"} cy={isIdle ? "118" : "129"} rx="10" ry="7" fill={`url(#${gradients.metal})`} />

          {isThinking || hovered ? (
            <g opacity="0.92">
              <circle cx="88" cy="18" r="2.6" fill="#67e8f9" style={{ animation: "gufoBotThink .95s ease-in-out infinite" }} />
              <circle cx="95" cy="13" r="2" fill="#d9f8ff" style={{ animation: "gufoBotThink .95s ease-in-out .18s infinite" }} />
              <circle cx="100" cy="8.5" r="1.55" fill="#ffffff" style={{ animation: "gufoBotThink .95s ease-in-out .36s infinite" }} />
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  )
}
