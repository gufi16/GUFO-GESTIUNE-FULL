import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { controlMe } from "../lib/controlAuth"

export default function RequireControlAuth({
  children,
}: {
  children: React.ReactNode
}) {
  const controlToken = localStorage.getItem("control_token")
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let mounted = true

    async function validate() {
      if (!controlToken) {
        if (mounted) {
          setOk(false)
          setLoading(false)
        }
        return
      }

      try {
        await controlMe()
        if (mounted) setOk(true)
      } catch {
        localStorage.removeItem("control_token")
        if (mounted) setOk(false)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    validate()

    return () => {
      mounted = false
    }
  }, [controlToken])

  if (loading) return <div className="p-6">Se incarca...</div>
  if (!controlToken || !ok) return <Navigate to="/cp/login" replace />

  return <>{children}</>
}
