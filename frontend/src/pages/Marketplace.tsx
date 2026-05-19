import { CheckCircle2, Link2, Package2, RefreshCcw, Save, ShoppingBag, Store, Truck } from "lucide-react"
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
  authType: "PARTNER" | "OAUTH" | "API_KEY"
  merchantId: string
  storeId: string
  accessToken: string
  refreshToken: string
  webhookSecret: string
  settingsJson: string
}

const tabs = [
  { id: "integrari", title: "Integrari" },
  { id: "mapari", title: "Mapare produse" },
  { id: "comenzi", title: "Comenzi" },
] as Array<{ id: TabId; title: string }>

const defaultPlatforms: PlatformItem[] = [
  { code: "GLOVO", label: "Glovo" },
  { code: "WOLT", label: "Wolt" },
  { code: "BOLT_FOOD", label: "Bolt Food" },
]

function emptyForm(): IntegrationForm {
  return {
    locationId: "",
    authType: "PARTNER",
    merchantId: "",
    storeId: "",
    accessToken: "",
    refreshToken: "",
    webhookSecret: "",
    settingsJson: "",
  }
}

function platformPill(platform: string) {
  if (platform === "GLOVO") return "bg-emerald-100 text-emerald-700"
  if (platform === "WOLT") return "bg-sky-100 text-sky-700"
  if (platform === "BOLT_FOOD") return "bg-lime-100 text-lime-700"
  return "bg-slate-100 text-slate-700"
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
  return `${amount.toFixed(2)} RON`
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ro-RO")
}

export default function MarketplacePage() {
  const token = getToken() || ""
  const [activeTab, setActiveTab] = useState<TabId>("integrari")
  const [platforms, setPlatforms] = useState<PlatformItem[]>(defaultPlatforms)
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [mappings, setMappings] = useState<MappingItem[]>([])
  const [recentExternalProducts, setRecentExternalProducts] = useState<RecentExternalProduct[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformCode>("GLOVO")
  const [mappingIntegrationId, setMappingIntegrationId] = useState("")
  const [testWoltOrderId, setTestWoltOrderId] = useState("")
  const [testGlovoOrderId, setTestGlovoOrderId] = useState("GLOVO-TEST-1001")
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

  function hydrateFormsFromIntegrations() {
    setForms((current) => {
      const next = { ...current }
      for (const platform of defaultPlatforms) {
        const integration = integrations.find((item) => item.platform === platform.code)
        next[platform.code] = integration
          ? {
              locationId: integration.locationId || "",
              authType: (integration.authType as IntegrationForm["authType"]) || "PARTNER",
              merchantId: integration.merchantId || "",
              storeId: integration.storeId || "",
              accessToken: integration.accessToken || "",
              refreshToken: integration.refreshToken || "",
              webhookSecret: integration.webhookSecret || "",
              settingsJson: integration.settingsJson ? JSON.stringify(integration.settingsJson, null, 2) : "",
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
          settings,
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
      await api("/api/v1/marketplace/integrations/glovo/test-import", {
        method: "POST",
        body: JSON.stringify({
          integrationId: integration.id,
          order: {
            id: testGlovoOrderId.trim() || "GLOVO-TEST-1001",
            order_code: "ERP-TEST",
            status: "ACCEPTED",
            store_id: integration.storeId || "STORE-01",
            total_price: 19.5,
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

      <DocumentTabs items={tabs} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "integrari" ? (
        <div className="space-y-3">
          <DocumentSection title="Platforme marketplace">
            <div className="flex flex-wrap gap-2">
              {platforms.map((platform) => (
                <button
                  key={platform.code}
                  type="button"
                  onClick={() => setSelectedPlatform(platform.code)}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                    selectedPlatform === platform.code ? "bg-[#17324D] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Store size={14} />
                  {platform.label}
                </button>
              ))}
            </div>
          </DocumentSection>

          <DocumentSection
            title={`Conectare ${platforms.find((item) => item.code === selectedPlatform)?.label || selectedPlatform}`}
            actions={
              <button type="button" className={documentButtonSecondaryClass} onClick={initialLoad} disabled={loading || saving}>
                <RefreshCcw size={14} className="mr-1.5" />
                Reincarca
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DocumentField label="Locatie">
                    <select
                      value={currentForm.locationId}
                      onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], locationId: e.target.value } }))}
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
                      placeholder="store-01"
                    />
                  </DocumentField>
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
                </div>

                <DocumentField label="Setari suplimentare JSON">
                  <textarea
                    value={currentForm.settingsJson}
                    onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], settingsJson: e.target.value } }))}
                    className={documentTextareaClass}
                    rows={5}
                    placeholder='{"autoAccept": true}'
                  />
                </DocumentField>

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
                </div>

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
                    <div className="text-sm font-semibold text-slate-800">Test import Glovo</div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={testGlovoOrderId}
                        onChange={(e) => setTestGlovoOrderId(e.target.value)}
                        className={documentInputClass}
                        placeholder="orderId Glovo"
                      />
                      <button type="button" className={documentButtonSecondaryClass} onClick={runGlovoTest} disabled={saving}>
                        Test
                      </button>
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
                {integrations.map((integration) => (
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
              {!recentExternalProducts.length ? (
                <InlineNotice>Nu exista produse externe detectate inca pentru integrările selectate.</InlineNotice>
              ) : (
                recentExternalProducts.map((item) => (
                  <div key={`${item.integrationId || "none"}::${item.externalProductId || item.externalName || "row"}`} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[15px] font-semibold text-slate-900">{item.externalName || "Produs extern fara nume"}</div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${platformPill(item.platform || "")}`}>
                            {item.platform || "Marketplace"}
                          </span>
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
              {!mappings.length ? (
                <InlineNotice>Nu exista mapari salvate inca.</InlineNotice>
              ) : (
                mappings.map((mapping) => (
                  <div key={mapping.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${platformPill(mapping.integration.platform)}`}>
                            {mapping.integration.platform}
                          </span>
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
              {!orders.length ? (
                <InlineNotice>{loadingOrders ? "Se incarca..." : "Nu exista comenzi marketplace inca."}</InlineNotice>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${platformPill(order.platform)}`}>
                            {order.platform}
                          </span>
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
                                <span className="ml-2 text-slate-400">x {Number(item.qty || 0).toFixed(3)}</span>
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
    </div>
  )
}
