import { Navigate } from "react-router-dom"

export default function RequireControlAuth({
  children,
}: {
  children: React.ReactNode
}) {
  const controlToken = localStorage.getItem("control_token")

  if (controlToken !== "DEV_CONTROL_PANEL_TOKEN") {
    return <Navigate to="/cp/login" replace />
  }

  return <>{children}</>
}