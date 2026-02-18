import { NextRequest } from "next/server"

export function getTenantId(req: NextRequest) {
  const headerTenant = req.headers.get("x-tenant-id")

  // req.nextUrl e sigur în Next.js (are origin/host)
  const queryTenant = req.nextUrl.searchParams.get("tenantId")

  const tenantId = headerTenant || queryTenant
  if (!tenantId) {
    throw new Error("Missing tenantId (header x-tenant-id or ?tenantId=...)")
  }
  return tenantId
}
