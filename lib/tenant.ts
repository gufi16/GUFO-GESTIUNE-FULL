import { NextRequest } from "next/server"

export function getTenantId(req: NextRequest): string {
  const headerTenant = req.headers.get("x-tenant-id")
  const queryTenant = req.nextUrl.searchParams.get("tenantId")

  const tenantId = (headerTenant || queryTenant || "").trim()

  return tenantId
}
