type Props = {
  columns: string[]
  children: React.ReactNode
}

export default function Table({ columns, children }: Props) {

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">

      <table className="w-full text-sm">

        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className="p-3 text-left font-medium"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="bg-white">

          {children}

        </tbody>

      </table>

    </div>
  )
}