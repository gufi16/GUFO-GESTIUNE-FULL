import { NextRequest } from "next/server"

export function getTenantId(req: NextRequest) {
  const headerTenant = req.headers.get("x-tenant-id")
  const queryTenant = req.nextUrl.searchParams.get("tenantId")
  return (headerTenant || queryTenant || "").trim()
}
