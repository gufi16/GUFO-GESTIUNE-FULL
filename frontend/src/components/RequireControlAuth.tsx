import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { clearControlToken, hasControlSession } from "../lib/api"
import { controlMe } from "../lib/controlAuth"

export default function RequireControlAuth({
  children,
}: {
  children: React.ReactNode
}) {
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let mounted = true

    async function validate() {
      try {
        await controlMe()
        if (mounted) setOk(true)
      } catch {
        clearControlToken()
        if (mounted) setOk(false)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    validate()

    return () => {
      mounted = false
    }
  }, [])

  if (loading) return <div className="p-6">Se incarca...</div>
  if (!hasControlSession() && !ok) return <Navigate to="/cp/login" replace />
  if (!ok) return <Navigate to="/cp/login" replace />

  return <>{children}</>
}
