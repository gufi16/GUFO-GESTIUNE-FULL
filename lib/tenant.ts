
import { NextRequest } from "next/server"

export function getTenantId(req: NextRequest) {
  const headerTenant = req.headers.get("x-tenant-id")
  const url = new URL(req.url)
  const queryTenant = url.searchParams.get("tenantId")
  const tenantId = headerTenant || queryTenant
  if (!tenantId) {
    throw new Error("Missing tenantId (header x-tenant-id or ?tenantId=...)")
  }
  return tenantId
}
