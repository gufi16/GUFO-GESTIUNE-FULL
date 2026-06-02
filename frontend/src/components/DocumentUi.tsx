import type { CSSProperties, ReactNode } from "react"

export function DocumentSection({
  title,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-4 shadow-sm shadow-slate-900/[0.03] md:px-5">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#17324D]">{title}</h2>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function DocumentField({
  label,
  children,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-[#17324D]">{label}</label>
      {children}
    </div>
  )
}

export function DocumentMetric({
  title,
  value,
  tone = "slate",
}: {
  title: string
  value: ReactNode
  tone?: "slate" | "blue" | "emerald" | "amber"
}) {
  const toneClasses: Record<string, string> = {
    slate: "bg-slate-50 text-[#17324D]",
    blue: "bg-[#EEF4FB] text-[#17324D]",
    emerald: "bg-[#E5F3E8] text-[#215D2A]",
    amber: "bg-[#F6F1E7] text-[#7A5A24]",
  }

  return (
    <div className={`rounded-[18px] border border-slate-200 px-3.5 py-3 ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{title}</div>
      <div className="mt-1 text-[18px] font-semibold text-[#17324D]">{value}</div>
    </div>
  )
}

export function DocumentStatusPill({ status }: { status: string }) {
  const normalized = String(status || "").toUpperCase()
  const className =
    normalized === "POSTED" || normalized === "FINALIZED" || normalized === "ISSUED"
      ? "bg-[#E5F3E8] text-[#215D2A]"
      : normalized === "CANCELLED"
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-700"

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}>
      {status}
    </span>
  )
}

export function InlineNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success"
  children: ReactNode
}) {
  const className =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "success"
        ? "border-[#CFE6D4] bg-[#E5F3E8] text-[#215D2A]"
        : "border-slate-200 bg-slate-50 text-slate-700"

  return <div className={`rounded-[14px] border px-3 py-2 text-sm ${className}`}>{children}</div>
}

export function DocumentPageHeader({
  badge = "Operatiuni",
  title,
  actions,
}: {
  badge?: string
  title: string
  actions?: ReactNode
}) {
  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-[linear-gradient(180deg,#FFFFFF_0%,#F9FBFD_100%)] px-4 py-3.5 shadow-sm shadow-slate-900/[0.03] md:px-5 md:py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm shadow-slate-900/[0.02]">
            {badge}
          </div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[#17324D]">{title}</h1>
        </div>

        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

export function DocumentTabs<T extends string>({
  items,
  activeId,
  onChange,
}: {
  items: Array<{ id: T; title: string }>
  activeId: T
  onChange: (id: T) => void
}) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-2.5 shadow-sm shadow-slate-900/[0.03]">
      <div className="flex flex-nowrap gap-2 overflow-x-auto">
        {items.map((item, index) => {
          const isActive = activeId === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={[
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] border px-3 text-sm font-semibold transition",
                isActive
                  ? "border-[#17324D] bg-[#17324D] text-white shadow-sm shadow-[#17324D]/20"
                  : "border-transparent bg-slate-50 text-[#17324D] hover:border-slate-200 hover:bg-slate-100",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                  isActive ? "bg-white/15 text-white" : "bg-slate-100 text-[#17324D]",
                ].join(" ")}
              >
                {index + 1}
              </span>
              {item.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const documentInputClass =
  "h-10 w-full rounded-[12px] border border-slate-300 bg-white px-3 text-[13px] text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white focus:ring-2 focus:ring-[#DCE7F5]"

export const documentTextareaClass =
  "w-full rounded-[12px] border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white focus:ring-2 focus:ring-[#DCE7F5]"

export const documentButtonPrimaryClass =
  "inline-flex h-10 items-center justify-center rounded-[12px] bg-[#17324D] px-3.5 text-[13px] font-semibold text-white transition hover:bg-[#133B5C] disabled:cursor-not-allowed disabled:opacity-60"

export const documentButtonSecondaryClass =
  "inline-flex h-10 items-center justify-center rounded-[12px] border border-slate-300 bg-slate-50 px-3.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"

export const documentButtonDangerClass =
  "inline-flex h-10 items-center justify-center rounded-[12px] border border-red-200 bg-red-50 px-3.5 text-[13px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"

export const readonlyInputStyle: CSSProperties = {
  backgroundColor: "#f8fafc",
  fontWeight: 600,
}
