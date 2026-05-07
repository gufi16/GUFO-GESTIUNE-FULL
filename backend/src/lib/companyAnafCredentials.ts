// @ts-nocheck
import type { PrismaClient } from "@prisma/client"
import { resolveTenantCompany, resolveTenantCompanyForAuth, type CompanyAuthContext } from "./companyResolver"

export const COMPANY_ANAF_LEGACY_FIELDS = {
  id: true,
  tenantId: true,
  name: true,
  efacturaCertSerial: true,
  efacturaCertPasswordEnc: true,
  efacturaCertFilename: true,
  efacturaCertUploadedAt: true,
  efacturaOauthAccessToken: true,
  efacturaOauthRefreshToken: true,
  efacturaOauthAccessTokenExpiresAt: true,
  efacturaOauthRefreshTokenExpiresAt: true,
  efacturaOauthConnectedAt: true,
  efacturaOauthLastError: true,
}

export const ANAF_CREDENTIAL_SELECT = {
  id: true,
  tenantId: true,
  companyId: true,
  label: true,
  isDefault: true,
  certSerial: true,
  certPasswordEnc: true,
  certFilename: true,
  certUploadedAt: true,
  efacturaOauthAccessToken: true,
  efacturaOauthRefreshToken: true,
  efacturaOauthAccessTokenExpiresAt: true,
  efacturaOauthRefreshTokenExpiresAt: true,
  efacturaOauthConnectedAt: true,
  efacturaOauthLastError: true,
  createdAt: true,
  updatedAt: true,
}

function hasMeaningfulValue(value: unknown) {
  if (value instanceof Date) return true
  return String(value || "").trim().length > 0
}

function companyHasLegacyAnafData(company: any) {
  return [
    company?.efacturaCertSerial,
    company?.efacturaCertPasswordEnc,
    company?.efacturaCertFilename,
    company?.efacturaOauthAccessToken,
    company?.efacturaOauthRefreshToken,
    company?.efacturaOauthLastError,
    company?.etrtransportOauthAccessToken,
    company?.etrtransportOauthRefreshToken,
    company?.etrtransportOauthLastError,
  ].some(hasMeaningfulValue)
}

function buildCredentialLabel(company: any) {
  const companyName = String(company?.name || "Firma").trim() || "Firma"
  return `${companyName} - SPV principal`
}

function buildCredentialPayloadFromCompany(company: any) {
  return {
    label: buildCredentialLabel(company),
    isDefault: true,
    certSerial: company?.efacturaCertSerial || null,
    certPasswordEnc: company?.efacturaCertPasswordEnc || null,
    certFilename: company?.efacturaCertFilename || null,
    certUploadedAt: company?.efacturaCertUploadedAt || null,
    efacturaOauthAccessToken: company?.efacturaOauthAccessToken || null,
    efacturaOauthRefreshToken: company?.efacturaOauthRefreshToken || null,
    efacturaOauthAccessTokenExpiresAt: company?.efacturaOauthAccessTokenExpiresAt || null,
    efacturaOauthRefreshTokenExpiresAt: company?.efacturaOauthRefreshTokenExpiresAt || null,
    efacturaOauthConnectedAt: company?.efacturaOauthConnectedAt || null,
    efacturaOauthLastError: company?.efacturaOauthLastError || null,
  }
}

function overlayCredentialOnCompany(company: any, credential: any) {
  if (!company || !credential) {
    return company
  }

  return {
    ...company,
    anafCredentialId: credential.id,
    anafCredentialLabel: credential.label,
    efacturaCertSerial: credential.certSerial,
    efacturaCertPasswordEnc: credential.certPasswordEnc,
    efacturaCertFilename: credential.certFilename,
    efacturaCertUploadedAt: credential.certUploadedAt,
    efacturaOauthAccessToken: credential.efacturaOauthAccessToken,
    efacturaOauthRefreshToken: credential.efacturaOauthRefreshToken,
    efacturaOauthAccessTokenExpiresAt: credential.efacturaOauthAccessTokenExpiresAt,
    efacturaOauthRefreshTokenExpiresAt: credential.efacturaOauthRefreshTokenExpiresAt,
    efacturaOauthConnectedAt: credential.efacturaOauthConnectedAt,
    efacturaOauthLastError: credential.efacturaOauthLastError,
  }
}

export function mapAnafCredentialSummary(credential: any) {
  const hasCertificateFile = Boolean(credential.certFilename)
  const hasCertificatePassword = Boolean(credential.certPasswordEnc)
  const hasEfacturaToken = Boolean(credential.efacturaOauthAccessToken)
  return {
    id: credential.id,
    label: credential.label,
    isDefault: Boolean(credential.isDefault),
    certSerial: credential.certSerial || "",
    certFilename: credential.certFilename || "",
    certUploadedAt: credential.certUploadedAt || null,
    certPasswordConfigured: hasCertificatePassword,
    efacturaConnectedAt: credential.efacturaOauthConnectedAt || null,
    efacturaAccessTokenExpiresAt: credential.efacturaOauthAccessTokenExpiresAt || null,
    efacturaLastError: credential.efacturaOauthLastError || "",
    hasCertificateFile,
    hasCertificatePassword,
    hasEfacturaToken,
    connected: hasEfacturaToken,
  }
}

export async function listCompanyAnafCredentials(prismaClient: PrismaClient, tenantId: string, companyId: string) {
  return prismaClient.companyAnafCredential.findMany({
    where: { tenantId, companyId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { createdAt: "asc" }],
    select: ANAF_CREDENTIAL_SELECT,
  })
}

export async function getCompanyAnafCredentialById(
  prismaClient: PrismaClient,
  tenantId: string,
  companyId: string,
  credentialId: string,
) {
  return prismaClient.companyAnafCredential.findFirst({
    where: {
      id: credentialId,
      tenantId,
      companyId,
    },
    select: ANAF_CREDENTIAL_SELECT,
  })
}

export async function ensureLegacyCompanyCredential(
  prismaClient: PrismaClient,
  company: any,
) {
  if (!company?.id || !company?.tenantId) {
    return null
  }

  const existing = await prismaClient.companyAnafCredential.findFirst({
    where: {
      tenantId: company.tenantId,
      companyId: company.id,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { createdAt: "asc" }],
    select: ANAF_CREDENTIAL_SELECT,
  })

  if (existing) {
    return existing
  }

  return prismaClient.companyAnafCredential.create({
    data: {
      tenantId: company.tenantId,
      companyId: company.id,
      ...(companyHasLegacyAnafData(company)
        ? buildCredentialPayloadFromCompany(company)
        : {
            label: buildCredentialLabel(company),
            isDefault: true,
          }),
    },
    select: ANAF_CREDENTIAL_SELECT,
  })
}

export async function getDefaultCompanyAnafCredential(
  prismaClient: PrismaClient,
  tenantId: string,
  companyId: string,
  legacyCompany?: any,
) {
  const existing = await prismaClient.companyAnafCredential.findFirst({
    where: {
      tenantId,
      companyId,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { createdAt: "asc" }],
    select: ANAF_CREDENTIAL_SELECT,
  })

  if (existing) {
    return existing
  }

  if (!legacyCompany) {
    const company = await prismaClient.company.findFirst({
      where: { id: companyId, tenantId },
      select: COMPANY_ANAF_LEGACY_FIELDS,
    })
    return ensureLegacyCompanyCredential(prismaClient, company)
  }

  return ensureLegacyCompanyCredential(prismaClient, legacyCompany)
}

export async function resolveCompanyWithAnafCredential(
  prismaClient: PrismaClient,
  tenantId: string,
  activeCompanyId: string | null | undefined,
  options: {
    select?: Record<string, boolean>
    includeCredentialList?: boolean
    auth?: CompanyAuthContext | null
  } = {},
) {
  const hasExplicitSelect = Boolean(options.select && Object.keys(options.select).length)
  const companyQuery = hasExplicitSelect
    ? {
        select: {
          ...COMPANY_ANAF_LEGACY_FIELDS,
          ...(options.select || {}),
        },
      }
    : {}

  const company = options.auth?.userId
    ? await resolveTenantCompanyForAuth(
        prismaClient as any,
        {
          ...options.auth,
          tenantId,
          activeCompanyId: activeCompanyId ?? options.auth?.activeCompanyId ?? null,
        },
        companyQuery,
      )
    : await resolveTenantCompany(
        prismaClient as any,
        tenantId,
        activeCompanyId,
        companyQuery,
      )

  if (!company) {
    return null
  }

  const defaultCredential = await getDefaultCompanyAnafCredential(prismaClient, tenantId, company.id, company)
  const hydrated = overlayCredentialOnCompany(company, defaultCredential)

  if (!options.includeCredentialList) {
    return hydrated
  }

  const credentials = await listCompanyAnafCredentials(prismaClient, tenantId, company.id)
  return {
    ...hydrated,
    anafCredentials: credentials.map(mapAnafCredentialSummary),
    anafCredentialsCount: credentials.length,
  }
}

export async function syncCompanyToDefaultAnafCredential(
  prismaClient: PrismaClient,
  tenantId: string,
  companyId: string,
) {
  const company = await prismaClient.company.findFirst({
    where: { id: companyId, tenantId },
    select: COMPANY_ANAF_LEGACY_FIELDS,
  })

  if (!company || !companyHasLegacyAnafData(company)) {
    return null
  }

  const existing = await getDefaultCompanyAnafCredential(prismaClient, tenantId, companyId, company)
  if (!existing) {
    return null
  }

  return prismaClient.companyAnafCredential.update({
    where: { id: existing.id },
    data: buildCredentialPayloadFromCompany(company),
    select: ANAF_CREDENTIAL_SELECT,
  })
}

export async function syncDefaultAnafCredentialToCompany(
  prismaClient: PrismaClient,
  companyId: string,
  credential: any,
) {
  if (!companyId || !credential) {
    return null
  }

  return prismaClient.company.update({
    where: { id: companyId },
    data: {
      efacturaCertSerial: credential.certSerial || null,
      efacturaCertPasswordEnc: credential.certPasswordEnc || null,
      efacturaCertFilename: credential.certFilename || null,
      efacturaCertUploadedAt: credential.certUploadedAt || null,
      efacturaOauthAccessToken: credential.efacturaOauthAccessToken || null,
      efacturaOauthRefreshToken: credential.efacturaOauthRefreshToken || null,
      efacturaOauthAccessTokenExpiresAt: credential.efacturaOauthAccessTokenExpiresAt || null,
      efacturaOauthRefreshTokenExpiresAt: credential.efacturaOauthRefreshTokenExpiresAt || null,
      efacturaOauthConnectedAt: credential.efacturaOauthConnectedAt || null,
      efacturaOauthLastError: credential.efacturaOauthLastError || null,
    },
  })
}

export async function setDefaultCompanyAnafCredential(
  prismaClient: PrismaClient,
  tenantId: string,
  companyId: string,
  credentialId: string,
) {
  await prismaClient.companyAnafCredential.updateMany({
    where: {
      tenantId,
      companyId,
    },
    data: {
      isDefault: false,
    },
  })

  const credential = await prismaClient.companyAnafCredential.update({
    where: { id: credentialId },
    data: { isDefault: true },
    select: ANAF_CREDENTIAL_SELECT,
  })

  await syncDefaultAnafCredentialToCompany(prismaClient, companyId, credential)
  return credential
}

