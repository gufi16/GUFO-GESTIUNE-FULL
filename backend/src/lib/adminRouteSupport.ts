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

type LicenseLike = LicenseModuleFlags & {
  id: string
  expiresAt: Date
  isSuspended: boolean
  limitLocations: number
  limitTerminals: number
  limitKdsDevices: number
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

type TerminalLike = {
  id: string
  label?: string | null
  deviceType?: TerminalDeviceType | null
  deviceId?: string | null
}

const RESERVED_SUBDOMAINS = new Set(["app", "api", "www", "admin", "cp", "mail", "docs", "support"])

export function isReservedSubdomain(value?: string | null) {
  return RESERVED_SUBDOMAINS.has(normalizeSubdomain(value))
}

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

export function serializePrimaryCompanyContact(company?: CompanyLike | null) {
  if (!company) return null
  return {
    id: company.id,
    name: company.name,
    cui: company.cui,
    email: company.email,
    phone: company.phone,
  }
}

export function serializePrimaryCompanyDetails(company?: CompanyLike | null) {
  if (!company) return null
  return {
    id: company.id,
    name: company.name,
    cui: company.cui,
    email: company.email,
    phone: company.phone,
    regNo: company.regNo,
    address: company.address,
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

export function collectDefinedStrings(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
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

export function buildTenantStatus(license?: { isSuspended: boolean; expiresAt: Date } | null) {
  if (!license) return "inactive"
  if (license.isSuspended) return "suspended"
  return license.expiresAt > new Date() ? "active" : "expired"
}

export function buildLicenseSummary(license?: LicenseLike | null) {
  if (!license) return null
  return {
    id: license.id,
    expiresAt: license.expiresAt,
    isSuspended: license.isSuspended,
    limits: {
      locations: license.limitLocations,
      terminals: license.limitTerminals,
      kdsDevices: license.limitKdsDevices,
    },
    modules: moduleMapFromLicense(license),
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

export async function ensureTenantEfacturaModuleEnabled(tx: any, tenantId: string) {
  const moduleRecord = await tx.appModule.upsert({
    where: { code: "efactura" },
    update: {
      name: "e-Factura",
      description: "Integrare ANAF e-Factura",
      target: "GESTIUNE",
      isActive: true,
    },
    create: {
      code: "efactura",
      name: "e-Factura",
      description: "Integrare ANAF e-Factura",
      target: "GESTIUNE",
      isCore: false,
      isActive: true,
    },
  })

  return tx.tenantModule.upsert({
    where: {
      tenantId_moduleId: {
        tenantId,
        moduleId: moduleRecord.id,
      },
    },
    update: {
      enabled: true,
      source: "client_create",
    },
    create: {
      tenantId,
      moduleId: moduleRecord.id,
      enabled: true,
      source: "client_create",
    },
  })
}

export function normalizeTerminalLabel(value: unknown) {
  return String(value || "").trim()
}

export function inferTerminalDeviceType(terminal: {
  deviceType?: TerminalDeviceType | string | null
  label?: string | null
  deviceId?: string | null
}) {
  const explicit = String(terminal.deviceType || "").trim().toUpperCase()
  if (explicit === "KDS") return TerminalDeviceType.KDS
  if (explicit === "POS") return TerminalDeviceType.POS

  const label = normalizeTerminalLabel(terminal.label).toUpperCase()
  const deviceId = String(terminal.deviceId || "").trim().toUpperCase()
  if (label.includes("KDS") || deviceId.startsWith("KDS-")) {
    return TerminalDeviceType.KDS
  }

  return TerminalDeviceType.POS
}

export function resolveTerminalDisplayLabel(terminal: TerminalLike, labelByTerminalId: Map<string, string>) {
  const currentLabel = normalizeTerminalLabel(terminal.label)
  const genericLabel = currentLabel === "Android POS" || currentLabel === "GuFo POS" || currentLabel === "GuFo KDS"
  const restoredLabel = labelByTerminalId.get(terminal.id) || ""

  return genericLabel && restoredLabel ? restoredLabel : currentLabel
}
