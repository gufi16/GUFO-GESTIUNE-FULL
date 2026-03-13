type Props = {
  children: React.ReactNode
}

export default function TableCell({ children }: Props) {

  return (
    <td className="p-3">

      {children}

    </td>
  )
}