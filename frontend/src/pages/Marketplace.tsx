import { ArrowLeft, CheckCircle2, Link2, Package2, RefreshCcw, Save, ShoppingBag, Truck } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import PageHeader from "../components/PageHeader"
import {
  DocumentField,
  DocumentMetric,
  DocumentSection,
  DocumentTabs,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
  documentInputClass,
  documentTextareaClass,
} from "../components/DocumentUi"
import { API_BASE, api, authHeaders, getToken } from "../lib/api"

type TabId = "integrari" | "mapari" | "comenzi"
type PlatformCode = "GLOVO" | "WOLT" | "BOLT_FOOD"

type PlatformItem = {
  code: PlatformCode
  label: string
  capabilities?: string[]
}

type LocationItem = {
  id: string
  name: string
  code?: string
}

type TerminalItem = {
  id: string
  label: string
  deviceId: string
  locationId?: string
  location?: {
    id: string
    name: string
    code?: string
  } | null
}

type ProductItem = {
  id: string
  sku: string
  name: string
  trackLot?: boolean
  trackExpiry?: boolean
  costMethod?: string
}

type IntegrationItem = {
  id: string
  platform: PlatformCode
  status: string
  authType: string
  merchantId?: string | null
  storeId?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  webhookSecret?: string | null
  locationId?: string | null
  settingsJson?: any
  contract?: {
    partnerName?: string
    storeId?: string
    checks?: Record<string, boolean>
    readyForLiveOrders?: boolean
  } | null
  location?: {
    id: string
    name: string
    code?: string
  } | null
}

type MappingItem = {
  id: string
  integrationId: string
  externalProductId: string
  externalName?: string | null
  status: string
  lastSeenAt?: string | null
  integration: IntegrationItem
  erpProduct?: ProductItem | null
}

type RecentExternalProduct = {
  integrationId?: string | null
  externalProductId?: string | null
  externalName?: string | null
  sku?: string | null
  mappingStatus?: string
  lastSeenAt?: string | null
  location?: LocationItem | null
  platform?: PlatformCode | null
  mapped?: boolean
}

type MarketplaceOrderItem = {
  id: string
  name: string
  qty: number | string
  unitPrice: number | string
  mappingStatus?: string
  erpProduct?: ProductItem | null
}

type MarketplaceOrder = {
  id: string
  externalOrderId: string
  externalOrderNumber?: string | null
  platform: PlatformCode
  status: string
  customerName?: string | null
  paymentLabel?: string | null
  total: number | string
  currency?: string
  updatedAt?: string
  location?: LocationItem | null
  kitchenTicket?: {
    id: string
    status: string
    displayNumber?: string | null
    readyAt?: string | null
  } | null
  items: MarketplaceOrderItem[]
  statusHistory?: Array<{
    id: string
    status: string
    source: string
    message?: string | null
    createdAt: string
  }>
}

type IntegrationForm = {
  locationId: string
  targetTerminalId: string
  targetTerminalDeviceId: string
  authType: "PARTNER" | "OAUTH" | "API_KEY"
  partnerName: string
  glovoClientId: string
  glovoClientSecret: string
  glovoChainId: string
  glovoDefaultPrepMinutes: string
  merchantId: string
  storeId: string
  accessToken: string
  refreshToken: string
  webhookSecret: string
  portalOrderNotificationsEnabled: boolean
  portalCancelNotificationsEnabled: boolean
  menuManagedByIntegration: boolean
  settingsJson: string
}

const tabs = [
  { id: "integrari", title: "Rutare" },
  { id: "mapari", title: "Mapare produse" },
  { id: "comenzi", title: "Operational" },
] as Array<{ id: TabId; title: string }>

const defaultPlatforms: PlatformItem[] = [
  { code: "GLOVO", label: "Glovo" },
  { code: "WOLT", label: "Wolt" },
  { code: "BOLT_FOOD", label: "Bolt Food" },
]

function emptyForm(): IntegrationForm {
  return {
    locationId: "",
    targetTerminalId: "",
    targetTerminalDeviceId: "",
    authType: "PARTNER",
    partnerName: "",
    glovoClientId: "",
    glovoClientSecret: "",
    glovoChainId: "",
    glovoDefaultPrepMinutes: "",
    merchantId: "",
    storeId: "",
    accessToken: "",
    refreshToken: "",
    webhookSecret: "",
    portalOrderNotificationsEnabled: false,
    portalCancelNotificationsEnabled: false,
    menuManagedByIntegration: false,
    settingsJson: "",
  }
}

function platformPill(platform: string) {
  if (platform === "GLOVO") return "bg-emerald-100 text-emerald-700"
  if (platform === "WOLT") return "bg-sky-100 text-sky-700"
  if (platform === "BOLT_FOOD") return "bg-lime-100 text-lime-700"
  return "bg-slate-100 text-slate-700"
}

function platformLogo(platform: string) {
  if (platform === "GLOVO") return "/marketplace/glovo-badge.png"
  if (platform === "WOLT") return "/marketplace/wolt-badge.png"
  if (platform === "BOLT_FOOD") return "/marketplace/bolt-food-badge.jpg"
  return "/marketplace/glovo-badge.png"
}

function platformCardTheme(platform: string) {
  if (platform === "GLOVO") return "from-[#FFF7CC] via-[#FFF1A3] to-[#FDE36A]"
  if (platform === "WOLT") return "from-[#D8F6FD] via-[#B7ECFA] to-[#8CE0F7]"
  if (platform === "BOLT_FOOD") return "from-[#DDF9E7] via-[#B6F0CD] to-[#86E4AF]"
  return "from-slate-100 via-slate-50 to-white"
}

function platformLabel(platform: string) {
  if (platform === "GLOVO") return "Glovo"
  if (platform === "WOLT") return "Wolt"
  if (platform === "BOLT_FOOD") return "Bolt Food"
  return platform || "Marketplace"
}

function PlatformBadge({ platform, uppercase = false }: { platform: string; uppercase?: boolean }) {
  const label = platformLabel(platform)
  const wrapperClass = `inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] ${platformPill(platform)}`

  return (
    <span className={wrapperClass}>
      <img src={platformLogo(platform)} alt={label} className="h-5 w-5 rounded-full object-cover" />
      <span>{uppercase ? platform || "MARKETPLACE" : label}</span>
    </span>
  )
}

function statusPill(status: string) {
  const value = String(status || "").toUpperCase()
  if (["READY_FOR_FISCAL", "READY", "FISCALIZED", "DELIVERED"].includes(value)) return "bg-emerald-100 text-emerald-700"
  if (["RECEIVED", "ACKNOWLEDGED", "IN_KITCHEN"].includes(value)) return "bg-amber-100 text-amber-700"
  if (["CANCELLED", "FAILED"].includes(value)) return "bg-red-100 text-red-700"
  return "bg-slate-100 text-slate-700"
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return "0.00 RON"
  return `${amount.toFixed(2)} RON`
}

function formatQty(value: number | string | null | undefined) {
  const qty = Number(value || 0)
  if (!Number.isFinite(qty)) return "0.000"
  return qty.toFixed(3)
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO")
}

const glovoDocs = {
  overview: "https://qcommerce-integrations.glovoapp.com/",
  portalGuide: "https://en-api-integration.docs.app.onlineservice.io/",
  partnerApi: "https://qcommerce-integrations.glovoapp.com/this-is-api-detail-page/",
}

export default function MarketplacePage() {
  const token = getToken() || ""
  const [activeTab, setActiveTab] = useState<TabId>("integrari")
  const [platforms, setPlatforms] = useState<PlatformItem[]>(defaultPlatforms)
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [terminals, setTerminals] = useState<TerminalItem[]>([])
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [mappings, setMappings] = useState<MappingItem[]>([])
  const [recentExternalProducts, setRecentExternalProducts] = useState<RecentExternalProduct[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformCode>("GLOVO")
  const [platformView, setPlatformView] = useState<PlatformCode | null>(null)
  const [mappingIntegrationId, setMappingIntegrationId] = useState("")
  const [testWoltOrderId, setTestWoltOrderId] = useState("")
  const [testGlovoOrderId, setTestGlovoOrderId] = useState("GLOVO-TEST-1001")
  const [testGlovoPaymentType, setTestGlovoPaymentType] = useState<"PAID" | "CASH">("PAID")
  const [testGlovoScenario, setTestGlovoScenario] = useState<"DELIVERY" | "CUSTOMER_PICKUP">("DELIVERY")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [forms, setForms] = useState<Record<PlatformCode, IntegrationForm>>({
    GLOVO: emptyForm(),
    WOLT: emptyForm(),
    BOLT_FOOD: emptyForm(),
  })

  useEffect(() => {
    void initialLoad()
  }, [])

  useEffect(() => {
    hydrateFormsFromIntegrations()
  }, [integrations, locations])

  useEffect(() => {
    if (activeTab === "comenzi") {
      void loadOrders()
    }
    if (activeTab === "mapari") {
      void loadMappings(mappingIntegrationId)
    }
  }, [activeTab, mappingIntegrationId])

  async function initialLoad() {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const [platformsData, locationsData, productsData, integrationsData] = await Promise.all([
        api<{ ok: boolean; items: PlatformItem[] }>("/api/v1/marketplace/platforms"),
        api<{ ok: boolean; locations: LocationItem[] }>("/api/v1/meta/locations"),
        api<{ items: ProductItem[] }>("/api/v1/products"),
        api<{ ok: boolean; items: IntegrationItem[] }>("/api/v1/marketplace/integrations"),
      ])

      setPlatforms(Array.isArray(platformsData?.items) ? platformsData.items : defaultPlatforms)
      setLocations(Array.isArray(locationsData?.locations) ? locationsData.locations : [])
      setProducts(Array.isArray(productsData?.items) ? productsData.items : [])
      const nextIntegrations = Array.isArray(integrationsData?.items) ? integrationsData.items : []
      setIntegrations(nextIntegrations)

      const firstIntegration = nextIntegrations[0]
      if (firstIntegration?.platform) setSelectedPlatform(firstIntegration.platform)
      if (firstIntegration?.id) setMappingIntegrationId(firstIntegration.id)
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca modulul Marketplace.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const locationId = forms[selectedPlatform]?.locationId || ""
    if (!locationId) {
      setTerminals([])
      return
    }
    void loadTerminals(locationId)
  }, [forms, selectedPlatform])

  useEffect(() => {
    const integrationForPlatform = integrations.find((item) => item.platform === selectedPlatform)
    if (integrationForPlatform?.id) {
      setMappingIntegrationId(integrationForPlatform.id)
    }
  }, [integrations, selectedPlatform])

  async function loadTerminals(locationId: string) {
    try {
      const data = await api<{ ok: boolean; terminals: TerminalItem[] }>(
        `/api/v1/meta/terminals?locationId=${encodeURIComponent(locationId)}`,
      )
      setTerminals(Array.isArray(data?.terminals) ? data.terminals : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca device-urile POS.")
      setTerminals([])
    }
  }

  function hydrateFormsFromIntegrations() {
    setForms((current) => {
      const next = { ...current }
      for (const platform of defaultPlatforms) {
        const integration = integrations.find((item) => item.platform === platform.code)
        next[platform.code] = integration
          ? {
              locationId: integration.locationId || "",
              authType: (integration.authType as IntegrationForm["authType"]) || "PARTNER",
              partnerName:
                typeof integration.settingsJson?.partnerName === "string"
                  ? integration.settingsJson.partnerName
                  : "",
              glovoClientId:
                typeof integration.settingsJson?.glovoClientId === "string"
                  ? integration.settingsJson.glovoClientId
                  : "",
              glovoClientSecret:
                typeof integration.settingsJson?.glovoClientSecret === "string"
                  ? integration.settingsJson.glovoClientSecret
                  : "",
              glovoChainId:
                typeof integration.settingsJson?.glovoChainId === "string"
                  ? integration.settingsJson.glovoChainId
                  : "",
              glovoDefaultPrepMinutes:
                integration.settingsJson?.glovoDefaultPrepMinutes != null
                  ? String(integration.settingsJson.glovoDefaultPrepMinutes)
                  : "",
              merchantId: integration.merchantId || "",
              storeId: integration.storeId || "",
              accessToken: integration.accessToken || "",
              refreshToken: integration.refreshToken || "",
              webhookSecret: integration.webhookSecret || "",
              portalOrderNotificationsEnabled: Boolean(integration.settingsJson?.portalOrderNotificationsEnabled),
              portalCancelNotificationsEnabled: Boolean(integration.settingsJson?.portalCancelNotificationsEnabled),
              menuManagedByIntegration: Boolean(integration.settingsJson?.menuManagedByIntegration),
              settingsJson: integration.settingsJson ? JSON.stringify(integration.settingsJson, null, 2) : "",
              targetTerminalId:
                typeof integration.settingsJson?.targetTerminalId === "string"
                  ? integration.settingsJson.targetTerminalId
                  : "",
              targetTerminalDeviceId:
                typeof integration.settingsJson?.targetTerminalDeviceId === "string"
                  ? integration.settingsJson.targetTerminalDeviceId
                  : "",
            }
          : current[platform.code] || emptyForm()
      }
      return next
    })
  }

  async function loadOrders() {
    setLoadingOrders(true)
    try {
      const data = await api<{ ok: boolean; items: MarketplaceOrder[] }>("/api/v1/marketplace/orders")
      setOrders(Array.isArray(data?.items) ? data.items : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca comenzile marketplace.")
    } finally {
      setLoadingOrders(false)
    }
  }

  async function loadMappings(integrationId?: string) {
    setLoadingMappings(true)
    try {
      const qs = integrationId ? `?integrationId=${encodeURIComponent(integrationId)}` : ""
      const data = await api<{ ok: boolean; mappings: MappingItem[]; recentExternalProducts: RecentExternalProduct[] }>(`/api/v1/marketplace/mappings${qs}`)
      setMappings(Array.isArray(data?.mappings) ? data.mappings : [])
      setRecentExternalProducts(Array.isArray(data?.recentExternalProducts) ? data.recentExternalProducts : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca maparile marketplace.")
    } finally {
      setLoadingMappings(false)
    }
  }

  async function saveIntegration(platform: PlatformCode) {
    const form = forms[platform]
    if (!form.locationId) {
      setError("Selecteaza locatia pentru integrare.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const settings = form.settingsJson.trim() ? JSON.parse(form.settingsJson) : undefined
      await api(`/api/v1/marketplace/integrations/${platform}/connect`, {
        method: "POST",
        body: JSON.stringify({
          locationId: form.locationId,
          authType: form.authType,
          merchantId: form.merchantId.trim() || undefined,
          storeId: form.storeId.trim() || undefined,
          accessToken: form.accessToken.trim() || undefined,
          refreshToken: form.refreshToken.trim() || undefined,
          webhookSecret: form.webhookSecret.trim() || undefined,
          settings: {
            ...(settings || {}),
            partnerName: form.partnerName.trim() || undefined,
            glovoClientId: form.glovoClientId.trim() || undefined,
            glovoClientSecret: form.glovoClientSecret.trim() || undefined,
            glovoChainId: form.glovoChainId.trim() || undefined,
            glovoDefaultPrepMinutes: form.glovoDefaultPrepMinutes.trim()
              ? Number(form.glovoDefaultPrepMinutes)
              : undefined,
            portalOrderNotificationsEnabled: form.portalOrderNotificationsEnabled,
            portalCancelNotificationsEnabled: form.portalCancelNotificationsEnabled,
            menuManagedByIntegration: form.menuManagedByIntegration,
            targetTerminalId: form.targetTerminalId || undefined,
            targetTerminalDeviceId: selectedTerminal?.deviceId || form.targetTerminalDeviceId || undefined,
            targetTerminalLabel: selectedTerminal?.label || undefined,
            dispatchMode: "POS_CONFIRM",
          },
        }),
      })

      setMessage(`${platform === "GLOVO" ? "Glovo" : platform === "WOLT" ? "Wolt" : "Bolt Food"} a fost conectat.`)
      await initialLoad()
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva integrarea.")
    } finally {
      setSaving(false)
    }
  }

  async function runWoltTest() {
    const integration = integrations.find((item) => item.platform === "WOLT")
    if (!integration?.id || !testWoltOrderId.trim()) {
      setError("Alege integrarea Wolt si completeaza orderId pentru test.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    try {
      await api("/api/v1/marketplace/integrations/wolt/test-pull", {
        method: "POST",
        body: JSON.stringify({
          integrationId: integration.id,
          orderId: testWoltOrderId.trim(),
        }),
      })
      setMessage("Comanda Wolt a fost importata pentru test.")
      await Promise.all([loadOrders(), loadMappings(mappingIntegrationId)])
    } catch (e: any) {
      setError(e?.message || "Nu am putut rula testul Wolt.")
    } finally {
      setSaving(false)
    }
  }

  async function runGlovoTest() {
    const integration = integrations.find((item) => item.platform === "GLOVO")
    if (!integration?.id) {
      setError("Conecteaza integrarea Glovo inainte de test.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    try {
      const normalizedOrderId = testGlovoOrderId.trim() || "GLOVO-TEST-1001"
      const isCustomerPickup = testGlovoScenario === "CUSTOMER_PICKUP"
      await api("/api/v1/marketplace/integrations/glovo/test-import", {
        method: "POST",
        body: JSON.stringify({
          integrationId: integration.id,
          order: {
            id: normalizedOrderId,
            order_code: normalizedOrderId.replace(/^GLOVO-?/i, ""),
            status: "RECEIVED",
            store_id: integration.storeId || "STORE-01",
            transport_type: "LOGISTICS_DELIVERY",
            order_type: isCustomerPickup ? "pickup" : "delivery",
            is_picked_up_by_customer: isCustomerPickup,
            pickup_code: isCustomerPickup ? "PU-1234" : undefined,
            estimated_pickup_time: isCustomerPickup ? "20 min" : undefined,
            customer: {
              name: "Client test Glovo",
              phone_number: "0722000000",
            },
            payment: {
              type: testGlovoPaymentType,
              payment_type: testGlovoPaymentType,
            },
            total_price: 19.5,
            delivery_address: isCustomerPickup
              ? undefined
              : {
                  label: "Strada Test 10, Bucuresti",
                },
            special_requirements: "Fara tacamuri",
            products: [
              {
                id: "LINE-1",
                product_id: "EXT-APA",
                name: "Apa plata",
                quantity: 1,
                price: 7.5,
              },
              {
                id: "LINE-2",
                product_id: "EXT-SANDWICH",
                name: "Sandwich pui",
                quantity: 1,
                price: 12,
              },
            ],
          },
        }),
      })
      setMessage("Comanda Glovo de test a fost importata.")
      await Promise.all([loadOrders(), loadMappings(mappingIntegrationId)])
    } catch (e: any) {
      setError(e?.message || "Nu am putut rula testul Glovo.")
    } finally {
      setSaving(false)
    }
  }

  async function saveMapping(integrationId: string, externalProductId: string, externalName: string, erpProductId: string) {
    if (!integrationId || !externalProductId) {
      setError("Lipsesc datele produsului extern.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    try {
      await api("/api/v1/marketplace/mappings", {
        method: "POST",
        body: JSON.stringify({
          integrationId,
          externalProductId,
          externalName,
          erpProductId: erpProductId || undefined,
        }),
      })
      setMessage("Maparea produsului a fost salvata.")
      await loadMappings(mappingIntegrationId)
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva maparea.")
    } finally {
      setSaving(false)
    }
  }

  const activeIntegrations = integrations.filter((item) => item.status === "ACTIVE")
  const unmappedCount = useMemo(
    () => recentExternalProducts.filter((item) => !item.mapped).length,
    [recentExternalProducts],
  )
  const connectedLocations = useMemo(() => new Set(activeIntegrations.map((item) => item.locationId).filter(Boolean)).size, [activeIntegrations])
  const currentForm = forms[selectedPlatform] || emptyForm()
  const selectedIntegration = integrations.find((item) => item.platform === selectedPlatform) || null
  const selectedTerminal = terminals.find((item) => item.id === currentForm.targetTerminalId) || null
  const platformMappings = mappings.filter((mapping) => mapping.integration.platform === selectedPlatform)
  const platformRecentExternalProducts = recentExternalProducts.filter(
    (item) => !item.platform || item.platform === selectedPlatform || item.integrationId === selectedIntegration?.id,
  )
  const platformOrders = orders.filter((order) => order.platform === selectedPlatform)
  const selectedPlatformMeta =
    platforms.find((item) => item.code === selectedPlatform) || defaultPlatforms.find((item) => item.code === selectedPlatform)
  const activePlatformIntegrationCount = integrations.filter((item) => item.status === "ACTIVE" && item.platform === selectedPlatform).length

  return (
    <div className="space-y-3">
      <PageHeader badge="marketplace" title="Marketplace" />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Integrari active" value={activeIntegrations.length} tone="emerald" />
        <DocumentMetric title="Locatii conectate" value={connectedLocations} tone="blue" />
        <DocumentMetric title="Produse nemapate" value={unmappedCount} tone="amber" />
        <DocumentMetric title="Comenzi in flux" value={orders.filter((item) => item.status !== "FISCALIZED" && item.status !== "DELIVERED").length} tone="slate" />
      </div>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {!platformView ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {defaultPlatforms.map((platform) => {
            const integrationCount = integrations.filter((item) => item.status === "ACTIVE" && item.platform === platform.code).length
            const orderCount = orders.filter((item) => item.platform === platform.code && item.status !== "FISCALIZED" && item.status !== "DELIVERED").length
            const productCount = recentExternalProducts.filter((item) => item.platform === platform.code).length

            return (
              <button
                key={platform.code}
                type="button"
                onClick={() => {
                  setSelectedPlatform(platform.code)
                  setPlatformView(platform.code)
                  setActiveTab("integrari")
                }}
                className={`group rounded-[28px] border border-slate-200 bg-gradient-to-br ${platformCardTheme(platform.code)} p-5 text-left shadow-sm shadow-slate-900/[0.04] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/[0.08]`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">Platforma</div>
                    <div className="mt-2 text-[26px] font-semibold tracking-tight text-[#17324D]">{platform.label}</div>
                  </div>
                  <img src={platformLogo(platform.code)} alt={platform.label} className="h-20 w-20 rounded-[24px] border border-white/70 bg-white/70 object-cover shadow-sm" />
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Integrari</div>
                    <div className="mt-1 text-lg font-semibold text-[#17324D]">{integrationCount}</div>
                  </div>
                  <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Comenzi</div>
                    <div className="mt-1 text-lg font-semibold text-[#17324D]">{orderCount}</div>
                  </div>
                  <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Produse</div>
                    <div className="mt-1 text-lg font-semibold text-[#17324D]">{productCount}</div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-[18px] border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-700">
                  <span>Deschide configurarea si operarea</span>
                  <span className="font-semibold text-[#17324D] transition group-hover:translate-x-0.5">Intra</span>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPlatformView(null)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                >
                  <ArrowLeft size={18} />
                </button>
                <img src={platformLogo(selectedPlatform)} alt={selectedPlatformMeta?.label || selectedPlatform} className="h-14 w-14 rounded-[18px] border border-slate-200 bg-white object-cover" />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Platforma marketplace</div>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-[26px] font-semibold tracking-tight text-[#17324D]">{selectedPlatformMeta?.label || selectedPlatform}</h2>
                    <PlatformBadge platform={selectedPlatform} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <DocumentMetric title="Integrari active" value={activePlatformIntegrationCount} tone="emerald" />
                <DocumentMetric title="Locatie" value={selectedIntegration?.location?.code || selectedIntegration?.location?.name || "-"} tone="blue" />
                <DocumentMetric title="Nemapate" value={platformRecentExternalProducts.filter((item) => !item.mapped).length} tone="amber" />
                <DocumentMetric title="In flux" value={platformOrders.filter((item) => item.status !== "FISCALIZED" && item.status !== "DELIVERED").length} tone="slate" />
              </div>
            </div>
          </div>

          <DocumentTabs items={tabs} activeId={activeTab} onChange={setActiveTab} />

          {activeTab === "integrari" ? (
            <div className="space-y-3">
              <DocumentSection title="Platforme marketplace">
                <div className="flex flex-wrap gap-2">
                  {platforms.map((platform) => (
                    <button
                      key={platform.code}
                      type="button"
                      onClick={() => {
                        setSelectedPlatform(platform.code)
                        setPlatformView(platform.code)
                        setActiveTab("integrari")
                      }}
                      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                        selectedPlatform === platform.code ? "bg-[#17324D] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <img src={platformLogo(platform.code)} alt={platform.label} className="h-5 w-5 rounded-full object-cover" />
                      {platform.label}
                    </button>
                  ))}
                </div>
              </DocumentSection>

              <DocumentSection
                title={`Rutare si conectare ${platforms.find((item) => item.code === selectedPlatform)?.label || selectedPlatform}`}
                actions={
                  <button type="button" className={documentButtonSecondaryClass} onClick={initialLoad} disabled={loading || saving}>
                    <RefreshCcw size={14} className="mr-1.5" />
                    Reincarca
                  </button>
                }
              >
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-3">
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Truck size={16} className="text-[#17324D]" />
                        Rutare operationala
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <DocumentField label="Locatie">
                          <select
                            value={currentForm.locationId}
                            onChange={(e) =>
                              setForms((prev) => ({
                                ...prev,
                                [selectedPlatform]: {
                                  ...prev[selectedPlatform],
                                  locationId: e.target.value,
                                  targetTerminalId: "",
                                  targetTerminalDeviceId: "",
                                },
                              }))
                            }
                            className={documentInputClass}
                          >
                            <option value="">Selecteaza locatia</option>
                            {locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.code ? `${location.name} (${location.code})` : location.name}
                              </option>
                            ))}
                          </select>
                        </DocumentField>

                        <DocumentField label="Device POS / licenta tinta">
                          <select
                            value={currentForm.targetTerminalId}
                            onChange={(e) =>
                              setForms((prev) => ({
                                ...prev,
                                [selectedPlatform]: {
                                  ...prev[selectedPlatform],
                                  targetTerminalId: e.target.value,
                                  targetTerminalDeviceId: terminals.find((terminal) => terminal.id === e.target.value)?.deviceId || "",
                                },
                              }))
                            }
                            className={documentInputClass}
                            disabled={!currentForm.locationId}
                          >
                            <option value="">Alege device-ul POS</option>
                            {terminals.map((terminal) => (
                              <option key={terminal.id} value={terminal.id}>
                                {terminal.label || terminal.deviceId} {terminal.deviceId ? `(${terminal.deviceId})` : ""}
                              </option>
                            ))}
                          </select>
                        </DocumentField>
                      </div>

                      <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                        {selectedTerminal
                          ? `Comenzile marketplace vor intra in POS-ul: ${selectedTerminal.label || selectedTerminal.deviceId}`
                          : "Alege device-ul/licenta Android POS care trebuie sa primeasca comenzile din platforma."}
                      </div>
                    </div>

                    <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Link2 size={16} className="text-[#17324D]" />
                        Date integrare platforma
                      </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DocumentField label="Tip autentificare">
                    <select
                      value={currentForm.authType}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [selectedPlatform]: { ...prev[selectedPlatform], authType: e.target.value as IntegrationForm["authType"] },
                        }))
                      }
                      className={documentInputClass}
                    >
                      <option value="PARTNER">Partner</option>
                      <option value="OAUTH">OAuth</option>
                      <option value="API_KEY">API Key</option>
                    </select>
                  </DocumentField>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {selectedPlatform === "GLOVO" ? (
                    <DocumentField label="Partner name Glovo">
                      <input
                        value={currentForm.partnerName}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], partnerName: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="numele POS-ului din portal"
                      />
                    </DocumentField>
                  ) : null}

                  {selectedPlatform === "GLOVO" ? (
                    <DocumentField label="Client ID Glovo Partner API">
                      <input
                        value={currentForm.glovoClientId}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], glovoClientId: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="client_id din Glovo Partner API"
                      />
                    </DocumentField>
                  ) : null}

                  {selectedPlatform === "GLOVO" ? (
                    <DocumentField label="Client Secret Glovo Partner API">
                      <input
                        value={currentForm.glovoClientSecret}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], glovoClientSecret: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="client_secret din Glovo Partner API"
                      />
                    </DocumentField>
                  ) : null}

                  <DocumentField label="Merchant ID">
                    <input
                      value={currentForm.merchantId}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], merchantId: e.target.value } }))}
                      className={documentInputClass}
                      placeholder="merchant-123"
                    />
                  </DocumentField>

                  <DocumentField label="Store ID">
                    <input
                      value={currentForm.storeId}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], storeId: e.target.value } }))}
                      className={documentInputClass}
                      placeholder={selectedPlatform === "GLOVO" ? "partner__store-id" : "store-01"}
                    />
                  </DocumentField>

                  {selectedPlatform === "GLOVO" ? (
                    <DocumentField label="Chain ID Glovo">
                      <input
                        value={currentForm.glovoChainId}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], glovoChainId: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="550e8400-e29b-41d4-a716-446655440000"
                      />
                    </DocumentField>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DocumentField label="Access token">
                    <input
                      value={currentForm.accessToken}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], accessToken: e.target.value } }))}
                      className={documentInputClass}
                      placeholder="token acces platforma"
                    />
                  </DocumentField>

                  <DocumentField label="Webhook secret">
                    <input
                      value={currentForm.webhookSecret}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], webhookSecret: e.target.value } }))}
                      className={documentInputClass}
                      placeholder="secret webhook"
                    />
                  </DocumentField>

                  {selectedPlatform === "GLOVO" ? (
                    <DocumentField label="Timp preparare fallback (minute)">
                      <input
                        value={currentForm.glovoDefaultPrepMinutes}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], glovoDefaultPrepMinutes: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="15"
                      />
                    </DocumentField>
                  ) : null}
                </div>

                  <DocumentField label="Setari suplimentare JSON">
                    <textarea
                      value={currentForm.settingsJson}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], settingsJson: e.target.value } }))}
                      className={documentTextareaClass}
                      rows={4}
                      placeholder='{"autoAccept": true}'
                    />
                  </DocumentField>

                  {selectedPlatform === "GLOVO" ? (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {[
                        ["portalOrderNotificationsEnabled", "In portal este activ 'Order notifications'"],
                        ["portalCancelNotificationsEnabled", "In portal este activ 'Canceled order notifications'"],
                        ["menuManagedByIntegration", "Meniul Glovo este gestionat prin integrare"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-start gap-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(currentForm[key as keyof IntegrationForm])}
                            onChange={(e) =>
                              setForms((prev) => ({
                                ...prev,
                                [selectedPlatform]: { ...prev[selectedPlatform], [key]: e.target.checked },
                              }))
                            }
                            className="mt-0.5"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className={documentButtonPrimaryClass} onClick={() => saveIntegration(selectedPlatform)} disabled={saving}>
                    <Save size={14} className="mr-1.5" />
                    {saving ? "Se salveaza..." : "Salveaza conectarea"}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Webhook</div>
                  <div className="mt-2 text-sm font-semibold text-[#17324D] break-all">
                    {selectedPlatform === "WOLT"
                      ? `${API_BASE}/api/v1/marketplace/webhooks/wolt`
                      : `${API_BASE}/api/v1/marketplace/webhooks/glovo/${currentForm.storeId || "{storeId}"}`}
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Link2 size={16} className="text-emerald-600" />
                    Status integrare
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${selectedIntegration?.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {selectedIntegration?.status || "DISCONNECTED"}
                    </span>
                    <span className="text-sm text-slate-600">
                      {selectedIntegration?.location?.name || "Alege locatia pentru conectare"}
                    </span>
                  </div>
                  {selectedTerminal ? (
                    <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      Device activ pentru comenzi: <span className="font-semibold">{selectedTerminal.label || selectedTerminal.deviceId}</span>
                    </div>
                  ) : null}
                </div>

                {selectedPlatform === "GLOVO" ? (
                  <div className="rounded-[18px] border border-slate-200 bg-emerald-50/60 p-4">
                    <div className="text-sm font-semibold text-slate-900">Documentatie Glovo</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Am lasat aici doar legaturile utile pentru activare si operare, fara checklistul lung din vechea pagina.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      <a className="text-[#17324D] underline underline-offset-2" href={glovoDocs.overview} target="_blank" rel="noreferrer">Overview Glovo</a>
                      <a className="text-[#17324D] underline underline-offset-2" href={glovoDocs.portalGuide} target="_blank" rel="noreferrer">Portal & setup</a>
                      <a className="text-[#17324D] underline underline-offset-2" href={glovoDocs.partnerApi} target="_blank" rel="noreferrer">Orders & status API</a>
                    </div>
                  </div>
                ) : null}

                {selectedPlatform === "WOLT" ? (
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-800">Test import Wolt</div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={testWoltOrderId}
                        onChange={(e) => setTestWoltOrderId(e.target.value)}
                        className={documentInputClass}
                        placeholder="orderId Wolt"
                      />
                      <button type="button" className={documentButtonSecondaryClass} onClick={runWoltTest} disabled={saving}>
                        Test
                      </button>
                    </div>
                  </div>
                ) : null}

                {selectedPlatform === "GLOVO" ? (
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-800">Test intern Glovo</div>
                    <div className="mt-1 text-sm text-slate-500">
                      Acest buton verifica fluxul intern ERP/POS. Activarea oficiala Glovo se face prin portalul lor si comenzi reale.
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        value={testGlovoOrderId}
                        onChange={(e) => setTestGlovoOrderId(e.target.value)}
                        className={documentInputClass}
                        placeholder="orderId Glovo"
                      />
                      <select value={testGlovoPaymentType} onChange={(e) => setTestGlovoPaymentType(e.target.value as "PAID" | "CASH")} className={documentInputClass}>
                        <option value="PAID">Plata PAID / Card</option>
                        <option value="CASH">Plata CASH</option>
                      </select>
                      <select value={testGlovoScenario} onChange={(e) => setTestGlovoScenario(e.target.value as "DELIVERY" | "CUSTOMER_PICKUP")} className={documentInputClass}>
                        <option value="DELIVERY">Delivery normal</option>
                        <option value="CUSTOMER_PICKUP">Ridicare de client</option>
                      </select>
                      <button type="button" className={documentButtonSecondaryClass} onClick={runGlovoTest} disabled={saving}>
                        Test
                      </button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Scenariul selectat seteaza automat plata si tipul comenzii pentru validare POS/KDS.
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </DocumentSection>
        </div>
      ) : null}

      {activeTab === "mapari" ? (
        <div className="space-y-3">
          <DocumentSection title="Filtru integrare">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,320px)_auto]">
              <select value={mappingIntegrationId} onChange={(e) => setMappingIntegrationId(e.target.value)} className={documentInputClass}>
                <option value="">Toate integrările</option>
                {integrations.filter((integration) => integration.platform === selectedPlatform).map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.platform} - {integration.location?.name || "Fara locatie"}
                  </option>
                ))}
              </select>
              <button type="button" className={documentButtonSecondaryClass} onClick={() => loadMappings(mappingIntegrationId)} disabled={loadingMappings}>
                <RefreshCcw size={14} className="mr-1.5" />
                Reincarca maparile
              </button>
            </div>
          </DocumentSection>

          <DocumentSection title="Produse externe detectate">
            <div className="space-y-2.5">
              {!platformRecentExternalProducts.length ? (
                <InlineNotice>Nu exista produse externe detectate inca pentru integrările selectate.</InlineNotice>
              ) : (
                platformRecentExternalProducts.map((item) => (
                  <div key={`${item.integrationId || "none"}::${item.externalProductId || item.externalName || "row"}`} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[15px] font-semibold text-slate-900">{item.externalName || "Produs extern fara nume"}</div>
                          <PlatformBadge platform={item.platform || ""} uppercase />
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${item.mapped ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {item.mapped ? "Mapat" : "Nemapat"}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                          ID extern: <span className="font-semibold text-slate-700">{item.externalProductId || "-"}</span>
                          {" · "}
                          Locatie: <span className="font-semibold text-slate-700">{item.location?.name || "-"}</span>
                          {" · "}
                          Vazut ultima data: <span className="font-semibold text-slate-700">{formatDate(item.lastSeenAt)}</span>
                        </div>
                      </div>

                      <select
                        className={documentInputClass}
                        defaultValue={mappings.find((mapping) => mapping.integrationId === item.integrationId && mapping.externalProductId === item.externalProductId)?.erpProduct?.id || ""}
                        onChange={(e) => saveMapping(item.integrationId || "", item.externalProductId || "", item.externalName || "", e.target.value)}
                      >
                        <option value="">Alege produs ERP</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} - {product.name}
                          </option>
                        ))}
                      </select>

                      <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {item.sku ? `SKU extern: ${item.sku}` : "Fara SKU extern"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DocumentSection>

          <DocumentSection title="Mapari salvate">
            <div className="space-y-2.5">
              {!platformMappings.length ? (
                <InlineNotice>Nu exista mapari salvate inca.</InlineNotice>
              ) : (
                platformMappings.map((mapping) => (
                  <div key={mapping.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformBadge platform={mapping.integration.platform} uppercase />
                          <div className="text-[15px] font-semibold text-slate-900">{mapping.externalName || mapping.externalProductId}</div>
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                          ID extern: <span className="font-semibold text-slate-700">{mapping.externalProductId}</span>
                          {" · "}
                          Locatie: <span className="font-semibold text-slate-700">{mapping.integration.location?.name || "-"}</span>
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        {mapping.erpProduct ? `${mapping.erpProduct.sku} - ${mapping.erpProduct.name}` : "Fara produs ERP"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DocumentSection>
        </div>
      ) : null}

      {activeTab === "comenzi" ? (
        <div className="space-y-3">
          <DocumentSection
            title="Comenzi marketplace"
            actions={
              <button type="button" className={documentButtonSecondaryClass} onClick={loadOrders} disabled={loadingOrders}>
                <RefreshCcw size={14} className="mr-1.5" />
                Reincarca comenzi
              </button>
            }
          >
            <div className="space-y-2.5">
              {!platformOrders.length ? (
                <InlineNotice>{loadingOrders ? "Se incarca..." : "Nu exista comenzi marketplace inca."}</InlineNotice>
              ) : (
                platformOrders.map((order) => (
                  <div key={order.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformBadge platform={order.platform} uppercase />
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPill(order.status)}`}>
                            {order.status}
                          </span>
                          <div className="text-[15px] font-semibold text-slate-900">{order.externalOrderNumber || order.externalOrderId}</div>
                        </div>

                        <div className="mt-2 text-sm text-slate-500">
                          Locatie: <span className="font-semibold text-slate-700">{order.location?.name || "-"}</span>
                          {" · "}
                          Client: <span className="font-semibold text-slate-700">{order.customerName || "-"}</span>
                          {" · "}
                          Plata: <span className="font-semibold text-slate-700">{order.paymentLabel || "-"}</span>
                          {" · "}
                          Actualizat: <span className="font-semibold text-slate-700">{formatDate(order.updatedAt)}</span>
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                        {formatMoney(order.total)}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
                      <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Produse</div>
                        <div className="mt-2 space-y-1.5">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                              <div className="min-w-0 text-slate-700">
                                {item.name}
                                <span className="ml-2 text-slate-400">x {formatQty(item.qty)}</span>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${item.mappingStatus === "MAPPED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                {item.mappingStatus || "UNMAPPED"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-slate-200 bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Istoric recent</div>
                        <div className="mt-2 space-y-2">
                          {(order.statusHistory || []).slice(0, 4).map((entry) => (
                            <div key={entry.id} className="rounded-[12px] bg-slate-50 px-3 py-2 text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-700">{entry.status}</span>
                                <span className="text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {entry.source} {entry.message ? `· ${entry.message}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DocumentSection>
        </div>
      ) : null}
        </>
      )}
    </div>
  )
}
