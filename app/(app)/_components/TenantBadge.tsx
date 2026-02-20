"use client"

import { useSearchParams } from "next/navigation"

export default function TenantBadge() {
  const sp = useSearchParams()
  const tenantId = (sp.get("tenantId") || "").trim()

  return (
    <div style={{ fontSize: 12, opacity: 0.85 }}>
      Tenant: <b>{tenantId || "(nesetat)"}</b>
    </div>
  )
}
