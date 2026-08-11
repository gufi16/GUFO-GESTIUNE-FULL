import clsx from "clsx"

export default function GufoAiAvatar({
  size = 40,
  className,
  thinking = false,
}: {
  size?: number
  className?: string
  thinking?: boolean
}) {
  return (
    <div
      className={clsx(
        "relative inline-flex items-center justify-center overflow-visible",
        thinking ? "animate-[gufoBotFloat_2.2s_ease-in-out_infinite]" : "",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes gufoBotFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-2px); }
        }
        @keyframes gufoBotGlow {
          0%, 100% { opacity: .82; filter: drop-shadow(0 0 3px rgba(56,189,248,.55)); }
          50% { opacity: 1; filter: drop-shadow(0 0 8px rgba(56,189,248,.95)); }
        }
        @keyframes gufoBotBlink {
          0%, 44%, 100% { transform: scaleY(1); }
          46%, 48% { transform: scaleY(.18); }
        }
        @keyframes gufoBotThink {
          0%, 100% { transform: translateY(0px) scale(1); opacity: .45; }
          50% { transform: translateY(-1px) scale(1.07); opacity: 1; }
        }
      `}</style>

      <svg viewBox="0 0 120 140" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="gufoBotMetal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f7f7fb" />
            <stop offset="38%" stopColor="#cfd5e3" />
            <stop offset="72%" stopColor="#9da9c3" />
            <stop offset="100%" stopColor="#7b879f" />
          </linearGradient>
          <linearGradient id="gufoBotDark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d2434" />
            <stop offset="100%" stopColor="#0f1728" />
          </linearGradient>
          <radialGradient id="gufoBotEye" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#d9f8ff" />
            <stop offset="28%" stopColor="#67e8f9" />
            <stop offset="58%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </radialGradient>
          <radialGradient id="gufoBotCore" cx="50%" cy="40%" r="68%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="24%" stopColor="#7dd3fc" />
            <stop offset="62%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#0f766e" />
          </radialGradient>
        </defs>

        <ellipse cx="60" cy="131" rx="31" ry="6.5" fill="#38bdf8" opacity={thinking ? "0.24" : "0.12"} />

        <g opacity={thinking ? 1 : 0.72}>
          <line x1="27" y1="18" x2="27" y2="4" stroke="#8f99ad" strokeWidth="3" strokeLinecap="round" />
          <line x1="93" y1="18" x2="93" y2="4" stroke="#8f99ad" strokeWidth="3" strokeLinecap="round" />
          <circle
            cx="27"
            cy="3.5"
            r="4"
            fill="#fb7185"
            style={thinking ? { animation: "gufoBotThink 1s ease-in-out infinite" } : undefined}
          />
          <circle
            cx="93"
            cy="3.5"
            r="4"
            fill="#fb7185"
            style={thinking ? { animation: "gufoBotThink 1s ease-in-out .25s infinite" } : undefined}
          />
        </g>

        <g>
          <ellipse cx="18" cy="43" rx="10" ry="15" fill="url(#gufoBotMetal)" />
          <ellipse cx="102" cy="43" rx="10" ry="15" fill="url(#gufoBotMetal)" />
          <ellipse cx="18" cy="43" rx="4.8" ry="8" fill="url(#gufoBotDark)" opacity="0.72" />
          <ellipse cx="102" cy="43" rx="4.8" ry="8" fill="url(#gufoBotDark)" opacity="0.72" />
        </g>

        <rect x="22" y="16" width="76" height="54" rx="19" fill="url(#gufoBotMetal)" />
        <rect x="27" y="21" width="66" height="40" rx="14" fill="url(#gufoBotDark)" />
        <path d="M41 16h38" stroke="#f8fafc" strokeWidth="2" opacity="0.45" strokeLinecap="round" />

        <g style={{ animation: thinking ? "gufoBotBlink 3.8s ease-in-out infinite" : undefined, transformOrigin: "48px 41px" }}>
          <circle cx="46" cy="41" r="11.5" fill="url(#gufoBotEye)" style={thinking ? { animation: "gufoBotGlow 1.35s ease-in-out infinite" } : undefined} />
          <circle cx="46" cy="41" r="6.5" fill="#0f1728" opacity="0.28" />
          <circle cx="43" cy="38" r="2.6" fill="#ffffff" opacity="0.95" />
        </g>
        <g style={{ animation: thinking ? "gufoBotBlink 3.8s ease-in-out .08s infinite" : undefined, transformOrigin: "74px 41px" }}>
          <circle cx="74" cy="41" r="11.5" fill="url(#gufoBotEye)" style={thinking ? { animation: "gufoBotGlow 1.35s ease-in-out .18s infinite" } : undefined} />
          <circle cx="74" cy="41" r="6.5" fill="#0f1728" opacity="0.28" />
          <circle cx="71" cy="38" r="2.6" fill="#ffffff" opacity="0.95" />
        </g>

        <rect x="35" y="74" width="50" height="37" rx="18" fill="url(#gufoBotMetal)" />
        <rect x="47" y="82" width="26" height="22" rx="8" fill="url(#gufoBotDark)" />
        <rect x="53" y="86" width="14" height="14" rx="6" fill="url(#gufoBotCore)" style={thinking ? { animation: "gufoBotGlow 1.5s ease-in-out infinite" } : undefined} />

        <path d="M38 83c-8 2-12 6-15 12" stroke="#9aa7bf" strokeWidth="5" strokeLinecap="round" />
        <path d="M82 83c8 2 12 6 15 12" stroke="#9aa7bf" strokeWidth="5" strokeLinecap="round" />
        <path d="M21 95c-2 7-4 12-3 19" stroke="#7c879b" strokeWidth="5" strokeLinecap="round" />
        <path d="M99 95c2 7 4 12 3 19" stroke="#7c879b" strokeWidth="5" strokeLinecap="round" />
        <ellipse cx="18" cy="118" rx="8" ry="6" fill="url(#gufoBotDark)" />
        <ellipse cx="102" cy="118" rx="8" ry="6" fill="url(#gufoBotDark)" />

        <path d="M48 111c-4 6-5 10-4 16" stroke="#8793ab" strokeWidth="5" strokeLinecap="round" />
        <path d="M72 111c4 6 5 10 4 16" stroke="#8793ab" strokeWidth="5" strokeLinecap="round" />
        <ellipse cx="44" cy="129" rx="10" ry="7" fill="url(#gufoBotMetal)" />
        <ellipse cx="76" cy="129" rx="10" ry="7" fill="url(#gufoBotMetal)" />

        {thinking ? (
          <g opacity="0.92">
            <circle cx="88" cy="18" r="2.6" fill="#67e8f9" style={{ animation: "gufoBotThink .95s ease-in-out infinite" }} />
            <circle cx="95" cy="13" r="2" fill="#d9f8ff" style={{ animation: "gufoBotThink .95s ease-in-out .18s infinite" }} />
            <circle cx="100" cy="8.5" r="1.55" fill="#ffffff" style={{ animation: "gufoBotThink .95s ease-in-out .36s infinite" }} />
          </g>
        ) : null}
      </svg>
    </div>
  )
}
