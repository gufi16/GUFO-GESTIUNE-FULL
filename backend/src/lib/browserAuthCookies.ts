import type { CookieOptions, Request, Response } from "express"
import { getOriginHostname, getRequestHostname } from "./tenantRequest"

export const ERP_AUTH_COOKIE = "gufo_erp_session"
export const CONTROL_AUTH_COOKIE = "gufo_control_session"
export const ERP_CSRF_COOKIE = "gufo_erp_csrf"
export const CONTROL_CSRF_COOKIE = "gufo_control_csrf"
export const WEB_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function isSecureCookieRequest(req: Request) {
  const originHost = getOriginHostname(req)
  const requestHost = getRequestHostname(req)
  const host = originHost || requestHost
  return !/^(localhost|127\.0\.0\.1)$/i.test(host)
}

function buildAuthCookieOptions(req: Request): CookieOptions {
  const secure = isSecureCookieRequest(req)
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  }
}

function buildCsrfCookieOptions(req: Request): CookieOptions {
  const secure = isSecureCookieRequest(req)
  return {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: WEB_SESSION_TTL_MS,
  }
}

export function setErpAuthCookie(req: Request, res: Response, token: string) {
  res.cookie(ERP_AUTH_COOKIE, token, buildAuthCookieOptions(req))
}

export function clearErpAuthCookie(req: Request, res: Response) {
  res.clearCookie(ERP_AUTH_COOKIE, {
    ...buildAuthCookieOptions(req),
    maxAge: undefined,
  })
}

export function setErpCsrfCookie(req: Request, res: Response, token: string) {
  res.cookie(ERP_CSRF_COOKIE, token, buildCsrfCookieOptions(req))
}

export function clearErpCsrfCookie(req: Request, res: Response) {
  res.clearCookie(ERP_CSRF_COOKIE, {
    ...buildCsrfCookieOptions(req),
    maxAge: undefined,
  })
}

export function setErpTenantCookie(req: Request, res: Response, subdomain: string) {
  res.cookie("gufo_erp_tenant", subdomain, buildCsrfCookieOptions(req))
}

export function clearErpTenantCookie(req: Request, res: Response) {
  res.clearCookie("gufo_erp_tenant", {
    ...buildCsrfCookieOptions(req),
    maxAge: undefined,
  })
}

export function setControlAuthCookie(req: Request, res: Response, token: string) {
  res.cookie(CONTROL_AUTH_COOKIE, token, buildAuthCookieOptions(req))
}

export function clearControlAuthCookie(req: Request, res: Response) {
  res.clearCookie(CONTROL_AUTH_COOKIE, {
    ...buildAuthCookieOptions(req),
    maxAge: undefined,
  })
}

export function setControlCsrfCookie(req: Request, res: Response, token: string) {
  res.cookie(CONTROL_CSRF_COOKIE, token, buildCsrfCookieOptions(req))
}

export function clearControlCsrfCookie(req: Request, res: Response) {
  res.clearCookie(CONTROL_CSRF_COOKIE, {
    ...buildCsrfCookieOptions(req),
    maxAge: undefined,
  })
}
