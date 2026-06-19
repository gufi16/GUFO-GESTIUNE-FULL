import { TerminalDeviceType, WarehouseType, type PrismaClient, type Prisma } from "@prisma/client"

const WAREHOUSE_TYPES = ["GENERAL", "RAW_MATERIALS", "FINISHED_GOODS", "BAR", "KITCHEN", "PACKAGING"] as const

const DEFAULT_UOMS = [
  { code: "buc", name: "Bucata", standardCode: "C62" },
  { code: "set", name: "Set", standardCode: "SET" },
  { code: "portie", name: "Portie", standardCode: "C62" },
  { code: "kg", name: "Kilogram", standardCode: "KGM" },
  { code: "g", name: "Gram", standardCode: "GRM" },
  { code: "l", name: "Litru", standardCode: "LTR" },
  { code: "ml", name: "Mililitru", standardCode: "MLT" },
  { code: "bax", name: "Bax", standardCode: "XBX" },
  { code: "cutie", name: "Cutie", standardCode: "BX" },
  { code: "sac", name: "Sac", standardCode: "BG" },
  { code: "lada", name: "Lada", standardCode: "CS" },
  { code: "pachet", name: "Pachet", standardCode: "PK" },
  { code: "bidon", name: "Bidon", standardCode: "BO" },
  { code: "sticla", name: "Sticla", standardCode: "BO" },
  { code: "doza", name: "Doza", standardCode: "BX" },
] as const

type UomClient = PrismaClient | Prisma.TransactionClient

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

export function buildCompanyScope(companyId: string) {
  return [{ companyId }, { companyId: null }]
}

export function normalizeStandardUomCode(value: unknown) {
  const text = String(value || "").trim().toUpperCase()
  return text || null
}

export function normalizeWarehouseType(value: unknown): WarehouseType {
  const text = String(value || "").trim().toUpperCase()
  return WAREHOUSE_TYPES.includes(text as (typeof WAREHOUSE_TYPES)[number])
    ? (text as WarehouseType)
    : WarehouseType.GENERAL
}

export function normalizeImageUrl(value: unknown, normalizeStoredUploadUrl: (value: unknown) => string | null) {
  return normalizeStoredUploadUrl(value)
}

export function mergeImageUrl(
  requestedImageUrl: string | null,
  currentImageUrl: string | null,
  normalizeStoredUploadUrl: (value: unknown) => string | null
) {
  if (!requestedImageUrl) return currentImageUrl || null

  const normalized = normalizeStoredUploadUrl(requestedImageUrl)
  if (normalized) return normalized

  return currentImageUrl || null
}

export function toNullableText(value: unknown) {
  const text = String(value || "").trim()
  return text || null
}

export const FISCAL_CODES = ["A", "B", "C", "D", "E", "F", "G"] as const

export function normalizeFiscalCode(value: unknown) {
  const code = String(value || "").trim().toUpperCase()
  if (!code) return null
  return FISCAL_CODES.includes(code as (typeof FISCAL_CODES)[number]) ? code : null
}

export async function ensureDefaultUoms(client: UomClient, tenantId: string, companyId: string) {
  const existing = await client.uom.findMany({
    where: {
      tenantId,
      OR: buildCompanyScope(companyId),
    },
  })
  const byCode = new Map(existing.map((item) => [item.code.trim().toLowerCase(), item]))

  for (const def of DEFAULT_UOMS) {
    const match = byCode.get(def.code)

    if (match) {
      const resolvedStandardCode = def.standardCode

      if (
        match.code !== def.code ||
        match.name !== def.name ||
        match.standardCode !== resolvedStandardCode ||
        !match.isActive
      ) {
        await client.uom.update({
          where: { id: match.id },
          data: {
            code: def.code,
            name: def.name,
            standardCode: resolvedStandardCode,
            isActive: true,
          },
        })
      }
      continue
    }

    await client.uom.create({
      data: {
        tenantId,
        companyId,
        code: def.code,
        name: def.name,
        standardCode: def.standardCode,
        isActive: true,
      },
    })
  }
}
