type PageHeaderProps = {
  title: string
  subtitle?: string
  badge?: string
}

export default function PageHeader({ title, subtitle, badge }: PageHeaderProps) {
  return (
    <div className="w-full rounded-[18px] border border-slate-200/90 bg-[linear-gradient(180deg,#FFFFFF_0%,#F9FBFD_100%)] px-4 py-3.5 shadow-sm shadow-slate-900/[0.03] md:px-5 md:py-4">
      {badge ? (
        <div className="mb-2 inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm shadow-slate-900/[0.02]">
          {badge}
        </div>
      ) : null}

      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#17324D] md:text-[28px]">{title}</h1>
      {subtitle ? (
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
      ) : null}
    </div>
  )
}
