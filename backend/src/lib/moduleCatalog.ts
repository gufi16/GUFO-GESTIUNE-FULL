import { ModuleTarget } from "@prisma/client"

export type LicenseModuleCode =
  | "dashboard"
  | "documents"
  | "inventory"
  | "nomenclature"
  | "settings"
  | "pos"
  | "kds"
  | "reports"

export type LicenseModuleState = Partial<Record<LicenseModuleCode, boolean>>

export type ControlPanelModuleDefinition = {
  code: string
  name: string
  description: string
  target: ModuleTarget
  isCore: boolean
  area: "catalog" | "settings" | "stock" | "documents" | "fiscal" | "reports" | "pos"
  inheritedFrom: LicenseModuleCode[]
}

type TenantModuleRowLike = {
  id?: string | null
  enabled?: boolean | null
  limitValue?: number | null
  source?: string | null
  module?: {
    code?: string | null
    name?: string | null
    description?: string | null
    target?: ModuleTarget | null
    isCore?: boolean | null
  } | null
}

const CONTROL_PANEL_MODULE_CATALOG: ControlPanelModuleDefinition[] = [
  {
    code: "products",
    name: "Produse",
    description: "Produse, articole si coduri de baza pentru vanzare.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "pos"],
  },
  {
    code: "categories",
    name: "Categorii",
    description: "Categorii si gruparea produselor in nomenclator.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "pos"],
  },
  {
    code: "departments",
    name: "Departamente",
    description: "Departamente operationale folosite in clasificarea produselor.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "pos"],
  },
  {
    code: "uoms",
    name: "Unitati de masura",
    description: "UM-uri si conversiile folosite in documente si retete.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "pos"],
  },
  {
    code: "tax_rates",
    name: "Cote TVA",
    description: "Cotele TVA disponibile in ERP si pe documente.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "settings", "pos"],
  },
  {
    code: "recipes",
    name: "Retete",
    description: "Retete, semifabricate si structuri de productie.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "inventory", "pos"],
  },
  {
    code: "customers",
    name: "Clienti",
    description: "Registrul de clienti pentru facturi si operatiuni comerciale.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "documents"],
  },
  {
    code: "suppliers",
    name: "Furnizori",
    description: "Registrul de furnizori pentru receptii si facturi primite.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "catalog",
    inheritedFrom: ["nomenclature", "documents"],
  },
  {
    code: "warehouses",
    name: "Gestiuni",
    description: "Configurarea gestiunilor si a structurii logistice.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "stock",
    inheritedFrom: ["inventory", "settings"],
  },
  {
    code: "company_profile",
    name: "Firma",
    description: "Date firma, identificare fiscala si profil comercial.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings"],
  },
  {
    code: "numbering",
    name: "Serii si numerotare",
    description: "Serii, contoare si reguli de numerotare pentru documente.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings"],
  },
  {
    code: "erp_users",
    name: "Utilizatori ERP",
    description: "Administrarea utilizatorilor, rolurilor si permisiunilor ERP.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings"],
  },
  {
    code: "backup_restore",
    name: "Backup si restore",
    description: "Backup manual, restore selectiv si sync cloud pentru client.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings"],
  },
  {
    code: "audit_logs",
    name: "Istoric actiuni",
    description: "Audit log si trasabilitate pentru modificarile din ERP.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings"],
  },
  {
    code: "pos_sync",
    name: "Sync POS",
    description: "Setari de sincronizare intre ERP si terminalele POS.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "settings",
    inheritedFrom: ["settings", "pos"],
  },
  {
    code: "purchase_receipts",
    name: "Receptii",
    description: "NIR-uri, receptii de marfa si documente de intrare.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "inventory"],
  },
  {
    code: "transfers",
    name: "Transferuri",
    description: "Transferuri intre gestiuni si miscari logistice.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "inventory"],
  },
  {
    code: "inventories",
    name: "Inventare",
    description: "Inventare de stoc, diferente si regularizari.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "inventory"],
  },
  {
    code: "consumption_docs",
    name: "Consumuri",
    description: "Bonuri de consum si scaderi operationale de stoc.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "inventory"],
  },
  {
    code: "production_docs",
    name: "Productie",
    description: "Documente de productie, retete si incarcare produs finit.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "inventory"],
  },
  {
    code: "sales_invoices",
    name: "Facturi iesire",
    description: "Facturi de vanzare, emitere si administrare documente fiscale.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents"],
  },
  {
    code: "sales_history",
    name: "Vanzari si bonuri",
    description: "Vanzari, bonuri fiscale si istoric comercial.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "documents",
    inheritedFrom: ["documents", "pos"],
  },
  {
    code: "efactura",
    name: "e-Factura",
    description: "Integrare ANAF e-Factura si trimitere facturi.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "fiscal",
    inheritedFrom: [],
  },
  {
    code: "spv_incoming",
    name: "Facturi primite SPV",
    description: "Descarcare si procesare facturi primite din SPV.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "fiscal",
    inheritedFrom: [],
  },
  {
    code: "etrtransport",
    name: "e-Transport",
    description: "Registru e-Transport si documente de transport fiscal.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "fiscal",
    inheritedFrom: [],
  },
  {
    code: "marketplace",
    name: "Marketplace",
    description: "Integrari Glovo, Wolt si Bolt Food.",
    target: ModuleTarget.BOTH,
    isCore: false,
    area: "fiscal",
    inheritedFrom: [],
  },
  {
    code: "reports_advanced",
    name: "Rapoarte",
    description: "Rapoarte avansate, stocuri si analize comerciale.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "reports",
    inheritedFrom: ["reports"],
  },
  {
    code: "accounting_export",
    name: "Export contabilitate",
    description: "Exporturi contabile si fisiere pentru contabilitate.",
    target: ModuleTarget.GESTIUNE,
    isCore: false,
    area: "reports",
    inheritedFrom: ["reports"],
  },
  {
    code: "kds_orders",
    name: "KDS",
    description: "Flux bucatarie si afisare comenzi pe KDS.",
    target: ModuleTarget.POS,
    isCore: false,
    area: "pos",
    inheritedFrom: ["kds"],
  },
]

const CONTROL_PANEL_MODULE_MAP = new Map(CONTROL_PANEL_MODULE_CATALOG.map((item) => [item.code, item]))

export function getControlPanelModuleDefinition(code: string) {
  return CONTROL_PANEL_MODULE_MAP.get(code) || null
}

export function listControlPanelModuleDefinitions() {
  return [...CONTROL_PANEL_MODULE_CATALOG]
}

export function expandLicenseModuleCodes(licenseModules?: LicenseModuleState | null) {
  const enabled = new Set<string>()
  if (!licenseModules) return enabled

  for (const [code, active] of Object.entries(licenseModules)) {
    if (active) enabled.add(code)
  }

  for (const item of CONTROL_PANEL_MODULE_CATALOG) {
    if (item.inheritedFrom.some((licenseCode) => licenseModules[licenseCode])) {
      enabled.add(item.code)
    }
  }

  return enabled
}

export function resolveEffectiveModuleCodes(
  licenseModules?: LicenseModuleState | null,
  tenantModules?: TenantModuleRowLike[] | null,
) {
  const enabled = expandLicenseModuleCodes(licenseModules)

  for (const row of tenantModules || []) {
    const code = String(row?.module?.code || "").trim()
    if (!code) continue
    if (row.enabled) {
      enabled.add(code)
    } else {
      enabled.delete(code)
    }
  }

  return enabled
}

export function buildEffectiveControlPanelModules(
  licenseModules?: LicenseModuleState | null,
  tenantModules?: TenantModuleRowLike[] | null,
  discoveredModules?: Array<{
    code: string
    name: string
    description?: string | null
    target?: ModuleTarget | null
    isCore?: boolean | null
  }> | null,
) {
  const catalog = new Map(CONTROL_PANEL_MODULE_CATALOG.map((item) => [item.code, item]))

  for (const discovered of discoveredModules || []) {
    if (!discovered?.code || catalog.has(discovered.code)) continue
    catalog.set(discovered.code, {
      code: discovered.code,
      name: discovered.name,
      description: discovered.description || "Modul personalizat configurat pentru acest client.",
      target: discovered.target || ModuleTarget.BOTH,
      isCore: Boolean(discovered.isCore),
      area: "settings",
      inheritedFrom: [],
    })
  }

  const tenantModuleByCode = new Map<string, TenantModuleRowLike>()
  for (const row of tenantModules || []) {
    const code = String(row?.module?.code || "").trim()
    if (!code) continue
    tenantModuleByCode.set(code, row)
  }

  return Array.from(catalog.values()).map((definition) => {
    const override = tenantModuleByCode.get(definition.code)
    const inheritedEnabled = definition.inheritedFrom.some((licenseCode) => Boolean(licenseModules?.[licenseCode]))
    return {
      ...definition,
      defaultEnabled: inheritedEnabled,
      enabled: override ? Boolean(override.enabled) : inheritedEnabled,
      limitValue: override?.limitValue ?? null,
      relationId: override?.id ?? null,
      source: override?.source ?? (inheritedEnabled ? "license_default" : null),
      overrideEnabled: override ? Boolean(override.enabled) : null,
    }
  })
}
