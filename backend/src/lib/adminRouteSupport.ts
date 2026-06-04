import { TerminalDeviceType } from "@prisma/client"
import { prisma } from "./prisma"

type CompanyLike = {
  id: string
  name: string
  code?: string | null
  cui?: string | null
  regNo?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  isDefault?: boolean | null
  createdAt?: Date | null
}

type LicenseModuleFlags = {
  modDashboard: boolean
  modDocuments: boolean
  modInventory: boolean
  modNomenclature: boolean
  modSettings: boolean
  modPos: boolean
  modKds: boolean
  modReports: boolean
}

type StructuredLocationAddressInput = {
  street?: string | null
  streetNo?: string | null
  building?: string | null
  staircase?: string | null
  floor?: string | null
  apartment?: string | null
  details?: string | null
}

const RESERVED_SUBDOMAINS = new Set(["app", "api", "www", "admin", "cp", "mail", "docs", "support"])

export function slugify(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "client"
  )
}

export function normalizeSubdomain(value?: string | null) {
  const normalized = slugify(String(value || ""))
  return normalized || "client"
}

export function buildTenantPortalUrl(subdomain?: string | null) {
  if (!subdomain) return null
  return `https://${subdomain}.gufo.ink`
}

export function pickPrimaryCompany<T extends { isDefault?: boolean | null }>(companies?: Array<T> | null) {
  if (!Array.isArray(companies) || !companies.length) return null
  return companies.find((company) => company?.isDefault) || companies[0] || null
}

export function serializeCompanySummary(company?: CompanyLike | null) {
  if (!company) return null
  return {
    id: company.id,
    name: company.name,
    code: company.code,
    cui: company.cui,
    regNo: company.regNo,
    address: company.address,
    email: company.email,
    phone: company.phone,
    isDefault: company.isDefault,
    createdAt: company.createdAt,
  }
}

export function toNullableText(value: unknown) {
  const text = String(value ?? "").trim()
  return text || null
}

export function buildStructuredLocationAddress(data: StructuredLocationAddressInput) {
  const streetLine = [data.street, data.streetNo ? `Nr. ${data.streetNo}` : null].filter(Boolean).join(" ").trim()
  const secondaryLine = [
    data.building ? `Bl. ${data.building}` : null,
    data.staircase ? `Sc. ${data.staircase}` : null,
    data.floor ? `Et. ${data.floor}` : null,
    data.apartment ? `Ap. ${data.apartment}` : null,
  ]
    .filter(Boolean)
    .join(", ")
    .trim()
  return [streetLine, secondaryLine, data.details].filter(Boolean).join(", ").trim() || null
}

export function resolveOwnedCompany<T extends { id: string; isDefault?: boolean | null }>(
  companies: Array<T>,
  requestedCompanyId?: string | null
) {
  if (!Array.isArray(companies) || !companies.length) return null
  if (requestedCompanyId) {
    return companies.find((company) => company.id === requestedCompanyId) || null
  }
  return pickPrimaryCompany(companies)
}

export async function generateUniqueTenantSubdomain(value: string) {
  const base = normalizeSubdomain(value)
  let candidate = RESERVED_SUBDOMAINS.has(base) ? `${base}-client` : base
  let index = 1

  while (await prisma.tenant.findFirst({ where: { subdomain: candidate } })) {
    candidate = `${base}-${index}`.slice(0, 50)
    index += 1
  }

  if (RESERVED_SUBDOMAINS.has(candidate)) {
    candidate = `${candidate}-1`.slice(0, 50)
  }

  return candidate
}

export function addDays(base: Date, days: number) {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

export function parseOptionalDate(value?: string | null) {
  if (!value || !value.trim()) return undefined

  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value
  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return undefined
  }

  return date
}

export function moduleMapFromLicense(license: LicenseModuleFlags) {
  return {
    dashboard: Boolean(license.modDashboard),
    documents: Boolean(license.modDocuments),
    inventory: Boolean(license.modInventory),
    nomenclature: Boolean(license.modNomenclature),
    settings: Boolean(license.modSettings),
    pos: Boolean(license.modPos),
    kds: Boolean(license.modKds),
    reports: Boolean(license.modReports),
  }
}

export function randomChunk(length = 4) {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length)
}

export function generateTemporaryPassword(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let value = ""
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return value
}

export async function generateUniqueLocationCode(tenantId: string, companyId: string | null | undefined, name: string) {
  const base = slugify(name).replace(/-/g, "").toUpperCase().slice(0, 6) || "LOC"
  let code = base
  let index = 1

  while (await prisma.location.findFirst({ where: { tenantId, companyId: companyId ?? null, code } })) {
    code = `${base}${index}`.slice(0, 10)
    index += 1
  }

  return code
}

export async function generateUniqueDeviceId(
  tenantId: string,
  companyId: string | null | undefined,
  deviceType: TerminalDeviceType = TerminalDeviceType.POS
) {
  const prefix = deviceType === TerminalDeviceType.KDS ? "KDS" : "POS"
  let deviceId = `${prefix}-${randomChunk(4)}-${randomChunk(4)}`

  while (await prisma.terminal.findFirst({ where: { tenantId, companyId: companyId ?? null, deviceId } })) {
    deviceId = `${prefix}-${randomChunk(4)}-${randomChunk(4)}`
  }

  return deviceId
}
