import type { Request } from "express"
import { prisma } from "./prisma"

export const ERP_TENANT_COOKIE = "gufo_erp_tenant"

type TenantSubdomainRequestOptions = {
  includeCookieFallback?: boolean
}

export function getHostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ""
  }
}

export function normalizeSubdomain(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

export function getRequestHostname(req: Request) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
  return forwardedHost.replace(/:\d+$/, "")
}

export function getOriginHostname(req: Request) {
  const origin = String(req.headers.origin || "").trim()
  if (origin) return getHostnameFromUrl(origin)

  const referer = String(req.headers.referer || "").trim()
  if (referer) return getHostnameFromUrl(referer)

  return ""
}

export function isHostedGufoBrowserRequest(req: Request) {
  const hostnames = [getRequestHostname(req), getOriginHostname(req)].filter(Boolean)
  return hostnames.some((hostname) => hostname.endsWith(".gufo.ink"))
}

export function getTenantSubdomainFromHostname(hostname: string) {
  if (!hostname) return null
  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return null
  if (hostname === "gufo.ink" || hostname === "app.gufo.ink" || hostname === "api.gufo.ink") return null
  if (!hostname.endsWith(".gufo.ink")) return null

  const parts = hostname.split(".")
  if (parts.length < 3) return null

  const subdomain = parts[0]
  if (!subdomain || ["app", "api", "www", "admin", "cp"].includes(subdomain)) return null
  return subdomain
}

export function getTenantSubdomainFromRequest(req: Request, options: TenantSubdomainRequestOptions = {}) {
  const { includeCookieFallback = true } = options
  const explicitHeader = String(req.headers["x-tenant-subdomain"] || "").trim().toLowerCase()
  const validExplicitHeader = explicitHeader && /^[a-z0-9-]+$/.test(explicitHeader) ? explicitHeader : ""

  const hostnames = [getRequestHostname(req), getOriginHostname(req)]
  let hostDerivedSubdomain: string | null = null

  for (const hostname of hostnames) {
    const subdomain = getTenantSubdomainFromHostname(hostname)
    if (subdomain) {
      hostDerivedSubdomain = subdomain
      break
    }
  }

  if (validExplicitHeader && hostDerivedSubdomain && validExplicitHeader !== hostDerivedSubdomain) {
    return null
  }

  if (validExplicitHeader) return validExplicitHeader
  if (hostDerivedSubdomain) return hostDerivedSubdomain

  if (!includeCookieFallback) {
    return null
  }

  const cookieSubdomain = String(req.cookies?.[ERP_TENANT_COOKIE] || "").trim().toLowerCase()
  if (cookieSubdomain && /^[a-z0-9-]+$/.test(cookieSubdomain)) {
    return cookieSubdomain
  }

  return null
}

export async function resolveTenantIdFromRequestHost(req: Request, options: TenantSubdomainRequestOptions = {}) {
  const subdomain = getTenantSubdomainFromRequest(req, options)
  if (!subdomain) return null

  const tenant = await prisma.tenant.findFirst({
    where: { subdomain },
    select: { id: true },
  })

  return tenant?.id || null
}

export async function resolveRequestedTenantId(
  req: Request,
  tenantId?: string | null,
  tenantSubdomain?: string | null,
  options: TenantSubdomainRequestOptions = {}
) {
  const hostTenantId = await resolveTenantIdFromRequestHost(req, options)
  let requestedTenantId = String(tenantId || "").trim() || undefined

  if (!requestedTenantId && tenantSubdomain) {
    const tenant = await prisma.tenant.findFirst({
      where: { subdomain: normalizeSubdomain(tenantSubdomain) },
      select: { id: true },
    })
    requestedTenantId = tenant?.id || undefined
  }

  if (requestedTenantId && hostTenantId && requestedTenantId !== hostTenantId) {
    throw new Error("Tenantul nu corespunde subdomeniului.")
  }

  return requestedTenantId || hostTenantId || undefined
}
