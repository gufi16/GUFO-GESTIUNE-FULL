type PageHeaderProps = {
  title: string
  subtitle?: string
  badge?: string
}

export default function PageHeader({ title, subtitle, badge }: PageHeaderProps) {
  return (
    <div className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-900/[0.03] md:px-4 md:py-3">
      {badge ? (
        <div className="mb-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {badge}
        </div>
      ) : null}

      <h1 className="text-[20px] font-semibold tracking-tight text-[#17324D] md:text-[22px]">{title}</h1>
      {subtitle ? (
        <p className="mt-1 hidden max-w-3xl text-sm leading-6 text-slate-500 md:block">{subtitle}</p>
      ) : null}
    </div>
  )
}
