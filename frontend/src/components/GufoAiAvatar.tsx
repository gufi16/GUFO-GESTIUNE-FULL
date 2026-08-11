import clsx from "clsx"

export default function GufoAiAvatar({
  size = 40,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <div
      className={clsx(
        "relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_30%,#5EEAD4_0%,#0F766E_45%,#17324D_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-[82%] w-[82%]">
        <circle cx="32" cy="23" r="10.5" fill="#F8FAFC" opacity="0.96" />
        <path
          d="M15 53c2.8-9.6 9.6-14.8 17-14.8S46.2 43.4 49 53"
          fill="none"
          stroke="#F8FAFC"
          strokeWidth="6.5"
          strokeLinecap="round"
          opacity="0.96"
        />
        <circle cx="45.5" cy="15.5" r="6.5" fill="#FDE68A" opacity="0.98" />
        <circle cx="52.5" cy="11.2" r="3.2" fill="#FFFFFF" opacity="0.88" />
        <circle cx="56.8" cy="7.5" r="2.1" fill="#FFFFFF" opacity="0.72" />
      </svg>
    </div>
  )
}
