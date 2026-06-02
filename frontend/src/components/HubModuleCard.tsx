import type { LucideIcon } from "lucide-react"
import { ArrowRight } from "lucide-react"

type HubModuleCardProps = {
  title: string
  description: string
  icon: LucideIcon
  onClick: () => void
  badge?: string
  iconClassName?: string
  ctaLabel?: string
  className?: string
}

export default function HubModuleCard({
  title,
  description,
  icon: Icon,
  onClick,
  badge = "modul",
  iconClassName = "bg-[#EAF0F6] text-[#17324D]",
  ctaLabel = "Deschide",
  className = "",
}: HubModuleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={`flex h-10 w-10 items-center justify-center rounded-[14px] ${iconClassName}`}>
          <Icon size={18} />
        </span>

        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {badge}
        </span>
      </div>

      <div className="mt-4">
        <div className="text-[16px] font-semibold text-slate-900">{title}</div>
        <div className="mt-1.5 text-sm leading-6 text-slate-500">{description}</div>
      </div>

      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#17324D]">
        {ctaLabel}
        <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
      </div>
    </button>
  )
}
