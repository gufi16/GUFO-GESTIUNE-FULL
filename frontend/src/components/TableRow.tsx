type Props = {
  children: React.ReactNode
}

export default function TableRow({ children }: Props) {

  return (
    <tr className="border-t border-slate-200 hover:bg-slate-50 transition">

      {children}

    </tr>
  )
}