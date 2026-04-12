type AuditLogItem = {
  actorType?: string
  actorName?: string | null
  actorEmail?: string | null
  action: string
  entityType: string
  entityId?: string | null
  payload?: Record<string, unknown> | null
  createdAt: string
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizeWords(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getPathSegments(payload?: Record<string, unknown> | null) {
  const path = typeof payload?.path === "string" ? payload.path : ""
  return path
    .replace(/^\/api\/v1\//, "")
    .split("/")
    .filter(Boolean)
}

function sectionLabelFromPath(payload?: Record<string, unknown> | null) {
  const segments = getPathSegments(payload)
  const section = segments.join(" ")

  if (!section) return "ERP"

  const map: Record<string, string> = {
    products: "Produse",
    company: "Firma",
    users: "Utilizatori",
    dashboard: "Panou principal",
    reports: "Rapoarte",
    stock: "Stoc",
    inventory: "Inventar",
    purchase: "Achizitii",
    transfer: "Transferuri",
    production: "Productie",
    consumption: "Bonuri de consum",
    consumptiondocs: "Bonuri de consum",
    "consumption docs": "Bonuri de consum",
    salesinvoices: "Facturi",
    "sales invoices": "Facturi",
    customers: "Clienti",
    "meta locations": "Locatii",
    "meta suppliers": "Furnizori",
    "meta departments": "Departamente",
    "meta categories": "Categorii",
    "meta vat": "TVA",
    "meta uom": "Unitati de masura",
  }

  const normalized = normalizeWords(section).toLowerCase()
  return map[normalized] || toTitleCase(normalizeWords(section))
}

function entityLabel(entityType: string) {
  const map: Record<string, string> = {
    Product: "produs",
    Company: "firma",
    User: "utilizator",
    Location: "locatie",
    Terminal: "device POS",
    License: "licenta",
    Customer: "client",
    Supplier: "furnizor",
    Dashboard: "panou principal",
    Report: "raport",
    Meta: "nomenclator",
    AuthSession: "sesiune",
    Consumptiondocs: "bon de consum",
    ConsumptionDocs: "bon de consum",
    Salesinvoices: "factura",
    SalesInvoices: "factura",
    Purchase: "achizitie",
    Products: "produs",
  }

  return map[entityType] || normalizeWords(entityType).toLowerCase()
}

function nameFromPayload(payload?: Record<string, unknown> | null) {
  const keys = ["name", "fullName", "email", "deviceId", "label", "tenantName", "companyName", "filename"]
  for (const key of keys) {
    const value = payload?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

export function formatAuditDateTime(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function getAuditActorLabel(entry: AuditLogItem) {
  return entry.actorName || entry.actorEmail || (entry.actorType === "SYSTEM" ? "Sistem" : "Utilizator")
}

export function getAuditArea(entry: AuditLogItem) {
  return sectionLabelFromPath(entry.payload)
}

export function getAuditActionLabel(entry: AuditLogItem) {
  const named = nameFromPayload(entry.payload)
  const target = entityLabel(entry.entityType)

  const explicit: Record<string, string> = {
    AUTH_LOGIN_SUCCESS: "S-a autentificat in ERP",
    USER_PASSWORD_RESET: named ? `A resetat parola pentru ${named}` : "A resetat o parola",
    ADMIN_PANEL_USER_CREATED: named ? `A creat utilizatorul ${named}` : "A creat un utilizator",
    ADMIN_PANEL_USER_UPDATED: named ? `A actualizat utilizatorul ${named}` : "A actualizat un utilizator",
    TENANT_SUBDOMAIN_UPDATED: "A modificat subdomeniul",
    TENANT_EXPORT_CREATED: "A generat exportul clientului",
    POS_DEVICE_DELETED: named ? `A sters device-ul ${named}` : "A sters un device POS",
    POS_DEVICE_CREATED: named ? `A adaugat device-ul ${named}` : "A adaugat un device POS",
    LOCATION_CREATED: named ? `A adaugat locatia ${named}` : "A adaugat o locatie",
    LOCATION_DELETED: named ? `A dezactivat locatia ${named}` : "A dezactivat o locatie",
    LICENSE_UPDATED: "A actualizat licenta",
    PLATFORM_EFACTURA_UPDATED: "A actualizat setarile e-Factura",
    TENANT_EFACTURA_MODULE_UPDATED: "A modificat modulul e-Factura",
    TENANT_CREATED: named ? `A creat clientul ${named}` : "A creat un client",
  }

  if (explicit[entry.action]) return explicit[entry.action]

  if (entry.action.startsWith("POST_")) {
    return named ? `A creat ${target}: ${named}` : `A creat ${target}`
  }
  if (entry.action.startsWith("PATCH_") || entry.action.startsWith("PUT_")) {
    return named ? `A modificat ${target}: ${named}` : `A modificat ${target}`
  }
  if (entry.action.startsWith("DELETE_")) {
    return named ? `A sters ${target}: ${named}` : `A sters ${target}`
  }

  return toTitleCase(normalizeWords(entry.action).toLowerCase())
}

export function matchesAuditSearch(entry: AuditLogItem, term: string) {
  const normalized = term.trim().toLowerCase()
  if (!normalized) return true

  const haystack = [
    getAuditActorLabel(entry),
    getAuditActionLabel(entry),
    getAuditArea(entry),
    entry.entityType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(normalized)
}
