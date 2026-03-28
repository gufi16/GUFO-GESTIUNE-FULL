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
    <section className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-900/[0.03]">
      <div className="mb-2 flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#17324D]">{title}</h2>
        </div>
        {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
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
    <div className={`rounded-[14px] border border-slate-200 px-2.5 py-2 ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{title}</div>
      <div className="mt-0.5 text-[17px] font-semibold text-[#17324D]">{value}</div>
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

export const documentInputClass =
  "h-10 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-[13px] text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white focus:ring-2 focus:ring-[#DCE7F5]"

export const documentTextareaClass =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-[#17324D] outline-none transition focus:border-[#244A7C] focus:bg-white focus:ring-2 focus:ring-[#DCE7F5]"

export const documentButtonPrimaryClass =
  "inline-flex h-10 items-center justify-center rounded-[10px] bg-[#17324D] px-3.5 text-[13px] font-semibold text-white transition hover:bg-[#133B5C] disabled:cursor-not-allowed disabled:opacity-60"

export const documentButtonSecondaryClass =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-slate-300 bg-slate-50 px-3.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"

export const documentButtonDangerClass =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-red-200 bg-red-50 px-3.5 text-[13px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"

export const readonlyInputStyle: CSSProperties = {
  backgroundColor: "#f8fafc",
  fontWeight: 600,
}
