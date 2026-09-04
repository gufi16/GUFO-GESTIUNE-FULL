import { ArrowLeft, CheckCircle2, Crosshair, Link2, MapPin, Package2, Plus, RefreshCcw, Save, Search, ShoppingBag, Trash2, Truck } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { API_BASE, api, authHeaders, getToken, resolvePublicAssetUrl } from "../lib/api"

type TabId = "integrari" | "acoperire" | "mapari" | "optiuni" | "comenzi"
type PlatformCode = "GLOVO" | "WOLT" | "BOLT_FOOD" | "GUFO_DELIVERY"

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

type CategoryItem = {
  id: string
  name: string
  imageUrl?: string | null
  isVisibleInPos?: boolean
  parentCategory?: {
    id: string
    name: string
  } | null
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
  imageUrl?: string | null
  isVisibleInPos?: boolean
  categoryId?: string | null
  category?: {
    id: string
    name: string
  } | null
  trackLot?: boolean
  trackExpiry?: boolean
  costMethod?: string
  price?: number | string
}

type DeliveryOptionGroup = {
  id: string
  name: string
  description?: string | null
  selectionMode: "SINGLE" | "MULTIPLE"
  minSelections: number
  maxSelections: number
  sortOrder: number
  isActive: boolean
  productLinks: Array<{ productId: string; sortOrder: number }>
  items: Array<{ id: string; productId: string; priceAdjustment: number | string; isDefault: boolean; isActive: boolean; product: ProductItem }>
}

type DeliveryOptionDraft = {
  name: string
  description: string
  selectionMode: "SINGLE" | "MULTIPLE"
  minSelections: string
  maxSelections: string
}

const emptyDeliveryOptionDraft = (): DeliveryOptionDraft => ({
  name: "",
  description: "",
  selectionMode: "MULTIPLE",
  minSelections: "0",
  maxSelections: "1",
})

type DeliveryCatalogMode = "ALL_VISIBLE" | "CATEGORY_SELECTION" | "MANUAL_SELECTION"
type DeliveryPaymentMethodCode = "CASH" | "CARD" | "GOOGLE_PAY" | "APPLE_PAY"
type DeliveryServiceAreaMode = "RADIUS" | "POLYGON"
type DeliveryGeoPoint = { lat: number; lng: number }
type DeliveryServiceAreaForm = {
  mode: DeliveryServiceAreaMode
  centerLat: string
  centerLng: string
  radiusKm: string
  polygon: DeliveryGeoPoint[]
}

function resolveDeliveryRestaurantImageUrl(rawUrl: string) {
  const value = String(rawUrl || "").trim()
  if (!value) return ""

  try {
    const parsed = /^https?:\/\//i.test(value) ? new URL(value) : null
    if (parsed?.pathname.startsWith("/uploads/")) {
      return resolvePublicAssetUrl(`/api${parsed.pathname}${parsed.search}`)
    }
  } catch {
    // Keep the original value so the normal asset resolver can handle it.
  }

  return resolvePublicAssetUrl(value.startsWith("/uploads/") ? `/api${value}` : value)
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

type GlovoCatalogPreview = {
  integration?: {
    id: string
    storeId?: string | null
    location?: LocationItem | null
  }
  summary: {
    totalPublished: number
    readyForUpdates: number
    explicitlyMapped: number
    usingSkuFallback: number
    missingExternalId: number
    inactiveOrHidden: number
    zeroPrice: number
  }
  items: Array<{
    productId: string
    sku: string
    name: string
    price: number
    stockQty?: number | null
    available: boolean
    externalProductId?: string | null
    mapped: boolean
    issues: string[]
  }>
}

type GlovoCatalogPushResult = {
  integrationId: string
  storeId: string
  apiBaseUrl: string
  endpoint: string
  transactionId: string
  payload: {
    products: Array<{
      id: string
      name: string
      price: number
      available: boolean
      image_url?: string
    }>
  }
  summary: GlovoCatalogPreview["summary"]
}

type GlovoCatalogPushStatus = {
  integrationId: string
  storeId: string
  apiBaseUrl: string
  endpoint: string
  transactionId: string
  status: string
  details: unknown[]
  rejectedProductIds: string[]
  promotionStatuses: unknown[]
}

type GlovoCatalogPushHistoryEntry = {
  transactionId: string
  createdAt: string
  updatedAt: string
  status: string
  endpoint: string
  payload: {
    products: Array<{
      id: string
      name: string
      price: number
      available: boolean
      image_url?: string
    }>
  }
  summary?: Record<string, unknown>
  details: string[]
  rejectedProductIds: string[]
}

type GufoDeliveryCatalogPreview = {
  restaurant: {
    id: string
    slug: string
    name: string
    code?: string | null
    address?: string | null
    city?: string | null
    county?: string | null
    country?: string | null
    postalCode?: string | null
  }
  catalog: {
    mode: DeliveryCatalogMode
    showCategories: boolean
    categories: Array<{
      id: string
      name: string
      parentCategoryId?: string | null
      posSortOrder?: number | null
    }>
    products: Array<{
      id: string
      sku?: string | null
      name: string
      price: number
      currency?: string
      isAvailable?: boolean
      categoryId?: string | null
      category?: {
        id: string
        name: string
        parentCategoryId?: string | null
      } | null
      posSortOrder?: number
    }>
  }
  updatedAt: string
}

type IntegrationForm = {
  locationId: string
  targetTerminalId: string
  targetTerminalDeviceId: string
  deliveryEnabled: boolean
  deliveryCatalogMode: DeliveryCatalogMode
  deliveryShowCategories: boolean
  deliveryPaymentMethods: DeliveryPaymentMethodCode[]
  deliveryOnlineProvider: string
  deliveryVivaEnvironment: "demo" | "production"
  deliveryVivaClientId: string
  deliveryVivaClientSecret: string
  deliveryVivaSourceCode: string
  deliveryVivaConfigured: boolean
  deliveryRestaurantImageUrl: string
  deliveryServiceArea: DeliveryServiceAreaForm
  includedCategoryIds: string[]
  includedProductIds: string[]
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

const gufoDeliveryTabs = [
  { id: "integrari", title: "Configurare" },
  { id: "acoperire", title: "Zona de livrare" },
  { id: "mapari", title: "Catalog" },
  { id: "optiuni", title: "Optiuni produse" },
] as Array<{ id: TabId; title: string }>

const defaultPlatforms: PlatformItem[] = [
  { code: "GLOVO", label: "Glovo" },
  { code: "WOLT", label: "Wolt" },
  { code: "BOLT_FOOD", label: "Bolt Food" },
  { code: "GUFO_DELIVERY", label: "Gufo Delivery" },
]

const deliveryPaymentMethodOptions: Array<{
  code: DeliveryPaymentMethodCode
  label: string
  description: string
}> = [
  { code: "CASH", label: "Cash la livrare", description: "Clientul plateste numerar la livrare sau la ridicare." },
  { code: "CARD", label: "Card online", description: "Plata online standard prin checkout-ul securizat Viva." },
  { code: "GOOGLE_PAY", label: "Google Pay", description: "Disponibil pentru clientii care au Google Pay activ pe device." },
  { code: "APPLE_PAY", label: "Apple Pay", description: "Pregatit pentru clientii iPhone atunci cand flow-ul Apple Pay este activ." },
]

function normalizeDeliveryPaymentMethods(value: unknown): DeliveryPaymentMethodCode[] {
  const supported = new Set<DeliveryPaymentMethodCode>(["CASH", "CARD", "GOOGLE_PAY", "APPLE_PAY"])
  const items = Array.isArray(value) ? value.filter((item): item is DeliveryPaymentMethodCode => typeof item === "string" && supported.has(item as DeliveryPaymentMethodCode)) : []
  return items.length ? items : ["CASH", "CARD", "GOOGLE_PAY"]
}

function emptyDeliveryServiceArea(): DeliveryServiceAreaForm {
  return { mode: "RADIUS", centerLat: "", centerLng: "", radiusKm: "5", polygon: [] }
}

function readDeliveryServiceArea(value: any): DeliveryServiceAreaForm {
  const mode: DeliveryServiceAreaMode = value?.mode === "POLYGON" ? "POLYGON" : "RADIUS"
  const center = value?.center && typeof value.center === "object" ? value.center : null
  const polygon = Array.isArray(value?.polygon)
    ? value.polygon
        .filter((point: any) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)))
        .map((point: any) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
    : []
  return {
    mode,
    centerLat: Number.isFinite(Number(center?.lat)) ? String(center.lat) : "",
    centerLng: Number.isFinite(Number(center?.lng)) ? String(center.lng) : "",
    radiusKm: Number.isFinite(Number(value?.radiusKm)) ? String(value.radiusKm) : "5",
    polygon,
  }
}

function buildDeliveryServiceArea(value: DeliveryServiceAreaForm) {
  const centerLat = Number(value.centerLat)
  const centerLng = Number(value.centerLng)
  const radiusKm = Number(value.radiusKm)
  const hasAnyValue = value.centerLat.trim() || value.centerLng.trim() || value.polygon.length > 0
  if (!hasAnyValue) return undefined
  if (value.mode === "RADIUS") {
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new Error("Alege centrul pe harta si o raza de livrare valida.")
    }
    return { mode: "RADIUS", center: { lat: centerLat, lng: centerLng }, radiusKm }
  }
  if (value.polygon.length < 3) throw new Error("Poligonul de livrare trebuie sa aiba cel putin trei puncte.")
  return { mode: "POLYGON", polygon: value.polygon }
}

function getDeliveryAreaMapCenter(value: DeliveryServiceAreaForm): DeliveryGeoPoint {
  const centerLat = Number(value.centerLat)
  const centerLng = Number(value.centerLng)
  if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) return { lat: centerLat, lng: centerLng }
  if (value.polygon.length) {
    const total = value.polygon.reduce((accumulator, point) => ({ lat: accumulator.lat + point.lat, lng: accumulator.lng + point.lng }), { lat: 0, lng: 0 })
    return { lat: total.lat / value.polygon.length, lng: total.lng / value.polygon.length }
  }
  return { lat: 45.9432, lng: 24.9668 }
}

function buildPolygonFromCircle(center: DeliveryGeoPoint, radiusKm: number, points = 10): DeliveryGeoPoint[] {
  const latitudeOffset = radiusKm / 111.32
  const longitudeOffset = radiusKm / Math.max(111.32 * Math.cos(center.lat * Math.PI / 180), 0.01)
  return Array.from({ length: points }, (_, index) => {
    const angle = (Math.PI * 2 * index) / points
    return {
      lat: Number((center.lat + latitudeOffset * Math.cos(angle)).toFixed(6)),
      lng: Number((center.lng + longitudeOffset * Math.sin(angle)).toFixed(6)),
    }
  })
}

function emptyForm(): IntegrationForm {
  return {
    locationId: "",
    targetTerminalId: "",
    targetTerminalDeviceId: "",
    deliveryEnabled: true,
    deliveryCatalogMode: "ALL_VISIBLE",
    deliveryShowCategories: true,
    deliveryPaymentMethods: ["CASH", "CARD"],
    deliveryOnlineProvider: "VIVA",
    deliveryVivaEnvironment: "demo",
    deliveryVivaClientId: "",
    deliveryVivaClientSecret: "",
    deliveryVivaSourceCode: "",
    deliveryVivaConfigured: false,
    deliveryRestaurantImageUrl: "",
    deliveryServiceArea: emptyDeliveryServiceArea(),
    includedCategoryIds: [],
    includedProductIds: [],
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

let googleMapsScriptPromise: Promise<void> | null = null

function loadGoogleMapsScript() {
  if ((window as any).google?.maps) return Promise.resolve()
  if (googleMapsScriptPromise) return googleMapsScriptPromise

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_WEB_API_KEY
  if (!apiKey) return Promise.reject(new Error("Lipseste cheia Google Maps din configurarea frontend."))

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Google Maps nu a putut fi incarcat."))
    document.head.appendChild(script)
  })
  return googleMapsScriptPromise
}

function DeliveryServiceAreaEditor({ value, onChange }: { value: DeliveryServiceAreaForm; onChange: (next: DeliveryServiceAreaForm) => void }) {
  const mapElement = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const mapInstance = useRef<any>(null)
  const circleInstance = useRef<any>(null)
  const polygonInstance = useRef<any>(null)
  const latestValue = useRef(value)
  const latestOnChange = useRef(onChange)
  const hasFittedSavedArea = useRef(false)
  const isPolygonDrawingRef = useRef(false)
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading")
  const [isPolygonDrawing, setIsPolygonDrawing] = useState(false)

  // Google Maps emits edits outside React's event cycle. Keep the ref in sync
  // immediately so a following Save always uses the latest map geometry.
  const publishValue = (next: DeliveryServiceAreaForm) => {
    latestValue.current = next
    latestOnChange.current(next)
  }

  useEffect(() => {
    latestValue.current = value
    latestOnChange.current = onChange
  }, [onChange, value])

  useEffect(() => {
    isPolygonDrawingRef.current = isPolygonDrawing
  }, [isPolygonDrawing])

  useEffect(() => {
    let disposed = false
    loadGoogleMapsScript()
      .then(() => {
        if (!disposed) setMapStatus("ready")
      })
      .catch(() => {
        if (!disposed) setMapStatus("error")
      })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (mapStatus !== "ready" || !mapElement.current || mapInstance.current) return
    const maps = (window as any).google.maps
    const initialCenter = getDeliveryAreaMapCenter(value)
    const map = new maps.Map(mapElement.current, {
      center: initialCenter,
      zoom: value.centerLat || value.centerLng || value.polygon.length ? 12 : 6,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    })
    mapInstance.current = map
    map.addListener("click", (event: any) => {
      const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
      const currentValue = latestValue.current
      if (currentValue.mode === "POLYGON" && isPolygonDrawingRef.current) {
        publishValue({ ...currentValue, polygon: [...currentValue.polygon, point] })
      } else if (currentValue.mode === "RADIUS") {
        publishValue({ ...currentValue, centerLat: point.lat.toFixed(6), centerLng: point.lng.toFixed(6) })
      }
    })
    if (searchInput.current && maps.places?.Autocomplete) {
      const autocomplete = new maps.places.Autocomplete(searchInput.current, {
        componentRestrictions: { country: "ro" },
        fields: ["geometry", "formatted_address", "name"],
        types: ["geocode"],
      })
      autocomplete.bindTo("bounds", map)
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace()
        const location = place.geometry?.location
        if (!location) return
        const point = { lat: location.lat(), lng: location.lng() }
        const currentValue = latestValue.current
        map.panTo(point)
        map.setZoom(14)
        publishValue({ ...currentValue, centerLat: point.lat.toFixed(6), centerLng: point.lng.toFixed(6) })
      })
    }
  }, [mapStatus, onChange, value])

  useEffect(() => {
    if (mapStatus !== "ready" || !mapInstance.current) return
    const maps = (window as any).google.maps

    if (value.mode === "RADIUS") {
      polygonInstance.current?.setMap(null)
      polygonInstance.current = null
      const lat = Number(value.centerLat)
      const lng = Number(value.centerLng)
      const radiusKm = Number(value.radiusKm)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      if (!circleInstance.current) {
        const circle = new maps.Circle({
          map: mapInstance.current,
          center: { lat, lng },
          radius: (Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 5) * 1000,
          editable: true,
          draggable: true,
          fillColor: "#ff5a1f",
          fillOpacity: 0.16,
          strokeColor: "#ff5a1f",
          strokeOpacity: 0.9,
          strokeWeight: 2,
        })
        circle.addListener("center_changed", () => {
          const center = circle.getCenter()
          const currentValue = latestValue.current
          if (center && (Math.abs(Number(currentValue.centerLat) - center.lat()) > 0.000001 || Math.abs(Number(currentValue.centerLng) - center.lng()) > 0.000001)) {
            publishValue({ ...currentValue, centerLat: center.lat().toFixed(6), centerLng: center.lng().toFixed(6) })
          }
        })
        circle.addListener("radius_changed", () => {
          const nextRadius = (circle.getRadius() / 1000).toFixed(2)
          if (latestValue.current.radiusKm !== nextRadius) publishValue({ ...latestValue.current, radiusKm: nextRadius })
        })
        circleInstance.current = circle
        if (!hasFittedSavedArea.current) {
          const bounds = circle.getBounds()
          if (bounds) mapInstance.current.fitBounds(bounds, 48)
          hasFittedSavedArea.current = true
        }
        return
      }

      const circle = circleInstance.current
      const center = circle.getCenter()
      if (!center || Math.abs(center.lat() - lat) > 0.000001 || Math.abs(center.lng() - lng) > 0.000001) circle.setCenter({ lat, lng })
      const nextRadiusMeters = (Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 5) * 1000
      if (Math.abs(circle.getRadius() - nextRadiusMeters) > 1) circle.setRadius(nextRadiusMeters)
      if (!hasFittedSavedArea.current) {
        const bounds = circle.getBounds()
        if (bounds) mapInstance.current.fitBounds(bounds, 48)
        hasFittedSavedArea.current = true
      }
      return
    }

    circleInstance.current?.setMap(null)
    circleInstance.current = null
    if (value.polygon.length >= 2 && !polygonInstance.current) {
      const polygon = new maps.Polygon({
        map: mapInstance.current,
        paths: value.polygon,
        editable: true,
        fillColor: "#ff5a1f",
        fillOpacity: 0.16,
        strokeColor: "#ff5a1f",
        strokeOpacity: 0.9,
        strokeWeight: 2,
      })
      const syncPolygon = () => {
        const path = polygon.getPath()
        const points = Array.from({ length: path.getLength() }, (_, index) => {
          const point = path.getAt(index)
          return { lat: point.lat(), lng: point.lng() }
        })
        publishValue({ ...latestValue.current, polygon: points })
      }
      polygon.getPath().addListener("set_at", syncPolygon)
      polygon.getPath().addListener("insert_at", syncPolygon)
      polygon.getPath().addListener("remove_at", syncPolygon)
      polygonInstance.current = polygon
      if (!hasFittedSavedArea.current) {
        const bounds = new maps.LatLngBounds()
        value.polygon.forEach((point) => bounds.extend(point))
        mapInstance.current.fitBounds(bounds, 48)
        hasFittedSavedArea.current = true
      }
    } else if (value.polygon.length >= 2 && polygonInstance.current) {
      polygonInstance.current.setPaths(value.polygon)
    }
  }, [mapStatus, value])

  const setField = (field: keyof DeliveryServiceAreaForm, fieldValue: string) => onChange({ ...value, [field]: fieldValue })

  return (
    <div className="space-y-3 rounded-[18px] border border-[#BFDBFE] bg-[#F8FBFF] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#17324D]"><MapPin size={16} /> Zona de livrare</div>
          <p className="mt-1 text-xs leading-5 text-slate-600">Clientii vad restaurantul numai cand adresa lor este in aceasta zona. Zona salvata se redeschide automat pe harta si este verificata din nou la checkout.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#17324D] shadow-sm">Verificata si la checkout</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DocumentField label="Tip zona">
          <select value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value === "POLYGON" ? "POLYGON" : "RADIUS" })} className={documentInputClass}>
            <option value="RADIUS">Cerc / raza in jurul locatiei</option>
            <option value="POLYGON">Poligon desenat pe harta</option>
          </select>
        </DocumentField>
        {value.mode === "RADIUS" ? (
          <DocumentField label="Raza de livrare (km)">
            <input value={value.radiusKm} onChange={(event) => setField("radiusKm", event.target.value)} inputMode="decimal" className={documentInputClass} />
          </DocumentField>
        ) : (
          <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Puncte salvate: <span className="font-semibold text-slate-900">{value.polygon.length}</span></div>
        )}
      </div>

      <DocumentField label="Cauta strada si numarul">
        <input ref={searchInput} className={documentInputClass} placeholder="Ex.: Strada Memorandumului 21, Cluj-Napoca" autoComplete="off" />
      </DocumentField>

      {value.mode === "RADIUS" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <DocumentField label="Latitudine centru"><input value={value.centerLat} onChange={(event) => setField("centerLat", event.target.value)} inputMode="decimal" className={documentInputClass} /></DocumentField>
          <DocumentField label="Longitudine centru"><input value={value.centerLng} onChange={(event) => setField("centerLng", event.target.value)} inputMode="decimal" className={documentInputClass} /></DocumentField>
        </div>
      ) : null}

      <div ref={mapElement} className="h-80 overflow-hidden rounded-[16px] border border-slate-200 bg-slate-100" />
      {mapStatus === "loading" ? <div className="text-xs text-slate-500">Se incarca harta...</div> : null}
      {mapStatus === "error" ? <div className="text-xs text-rose-700">Harta nu s-a incarcat. Verifica cheia Google Maps si domeniul autorizat.</div> : null}
      {value.mode === "POLYGON" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const center = getDeliveryAreaMapCenter(value)
              const radiusKm = Number(value.radiusKm)
              if (!Number.isFinite(Number(value.centerLat)) || !Number.isFinite(Number(value.centerLng)) || !Number.isFinite(radiusKm) || radiusKm <= 0) return
              setIsPolygonDrawing(false)
              onChange({ ...value, polygon: buildPolygonFromCircle(center, radiusKm) })
            }}
            disabled={!Number.isFinite(Number(value.centerLat)) || !Number.isFinite(Number(value.centerLng)) || !Number.isFinite(Number(value.radiusKm)) || Number(value.radiusKm) <= 0}
            className={documentButtonSecondaryClass}
          >
            Porneste poligon din cerc
          </button>
          <button type="button" onClick={() => setIsPolygonDrawing((current) => !current)} className={isPolygonDrawing ? documentButtonPrimaryClass : documentButtonSecondaryClass}>
            {isPolygonDrawing ? "Opreste adaugarea punctelor" : "Adauga puncte pe harta"}
          </button>
          <button type="button" onClick={() => onChange({ ...value, polygon: value.polygon.slice(0, -1) })} disabled={!value.polygon.length} className={documentButtonSecondaryClass}>Sterge ultimul punct</button>
          <button type="button" onClick={() => { setIsPolygonDrawing(false); onChange({ ...value, polygon: [] }) }} disabled={!value.polygon.length} className={documentButtonSecondaryClass}>Sterge poligonul</button>
          <span className="self-center text-xs text-slate-600">Porneste din cerc, apoi trage de varfuri. Activeaza adaugarea de puncte numai cand vrei sa extinzi zona.</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-600"><Crosshair size={14} /> Poti trage cercul sau marginea lui pentru a regla acoperirea.</div>
      )}
    </div>
  )
}

function platformPill(platform: string) {
  if (platform === "GLOVO") return "bg-emerald-100 text-emerald-700"
  if (platform === "WOLT") return "bg-sky-100 text-sky-700"
  if (platform === "BOLT_FOOD") return "bg-lime-100 text-lime-700"
  if (platform === "GUFO_DELIVERY") return "bg-[#E7F4FF] text-[#0F5EA8]"
  return "bg-slate-100 text-slate-700"
}

function platformLogo(platform: string) {
  if (platform === "GLOVO") return "/marketplace/glovo-badge.png"
  if (platform === "WOLT") return "/marketplace/wolt-badge.png"
  if (platform === "BOLT_FOOD") return "/marketplace/bolt-food-badge.jpg"
  if (platform === "GUFO_DELIVERY") return "/gufo-logo.png"
  return "/marketplace/glovo-badge.png"
}

function platformCardTheme(platform: string) {
  if (platform === "GLOVO") return "from-[#FFF7CC] via-[#FFF1A3] to-[#FDE36A]"
  if (platform === "WOLT") return "from-[#D8F6FD] via-[#B7ECFA] to-[#8CE0F7]"
  if (platform === "BOLT_FOOD") return "from-[#DDF9E7] via-[#B6F0CD] to-[#86E4AF]"
  if (platform === "GUFO_DELIVERY") return "from-[#D8ECFF] via-[#B5DAFF] to-[#8CC7FF]"
  return "from-slate-100 via-slate-50 to-white"
}

function platformLabel(platform: string) {
  if (platform === "GLOVO") return "Glovo"
  if (platform === "WOLT") return "Wolt"
  if (platform === "BOLT_FOOD") return "Bolt Food"
  if (platform === "GUFO_DELIVERY") return "Gufo Delivery"
  return platform || "Marketplace"
}

function platformSuccessMessage(platform: PlatformCode) {
  if (platform === "GUFO_DELIVERY") return "Gufo Delivery a fost configurat pentru rutare interna."
  return `${platformLabel(platform)} a fost conectat.`
}

function buildGufoDeliveryInternalCode(location: LocationItem | null | undefined) {
  const base = String(location?.code || location?.name || "locatie")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "locatie"
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
  const [categories, setCategories] = useState<CategoryItem[]>([])
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
  const [productMappingSearch, setProductMappingSearch] = useState("")
  const [deliveryProductSearch, setDeliveryProductSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploadingRestaurantImage, setUploadingRestaurantImage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [glovoPreview, setGlovoPreview] = useState<GlovoCatalogPreview | null>(null)
  const [loadingGlovoPreview, setLoadingGlovoPreview] = useState(false)
  const [glovoPushResult, setGlovoPushResult] = useState<GlovoCatalogPushResult | null>(null)
  const [glovoPushStatus, setGlovoPushStatus] = useState<GlovoCatalogPushStatus | null>(null)
  const [glovoPushHistory, setGlovoPushHistory] = useState<GlovoCatalogPushHistoryEntry[]>([])
  const [loadingGlovoPush, setLoadingGlovoPush] = useState(false)
  const [loadingGlovoPushStatus, setLoadingGlovoPushStatus] = useState(false)
  const [retryingGlovoPush, setRetryingGlovoPush] = useState(false)
  const [gufoDeliveryPreview, setGufoDeliveryPreview] = useState<GufoDeliveryCatalogPreview | null>(null)
  const [loadingGufoDeliveryPreview, setLoadingGufoDeliveryPreview] = useState(false)
  const [deliveryOptionGroups, setDeliveryOptionGroups] = useState<DeliveryOptionGroup[]>([])
  const [deliveryOptionDraft, setDeliveryOptionDraft] = useState<DeliveryOptionDraft>(emptyDeliveryOptionDraft)
  const [savingDeliveryOption, setSavingDeliveryOption] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [forms, setForms] = useState<Record<PlatformCode, IntegrationForm>>({
    GLOVO: emptyForm(),
    WOLT: emptyForm(),
    BOLT_FOOD: emptyForm(),
    GUFO_DELIVERY: emptyForm(),
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

  useEffect(() => {
    const integration = integrations.find((item) => item.platform === "GLOVO")
    if (!integration?.id) {
      setGlovoPreview(null)
      setGlovoPushHistory([])
      return
    }
    void loadGlovoPreview(integration.id)
    void loadGlovoPushHistory(integration.id)
  }, [integrations])

  useEffect(() => {
    if (selectedPlatform !== "GUFO_DELIVERY") return
    const integration = integrations.find((item) => item.platform === "GUFO_DELIVERY")
    if (!integration?.id) {
      setGufoDeliveryPreview(null)
      return
    }
    void loadGufoDeliveryPreview(integration.id)
  }, [integrations, selectedPlatform])

  async function initialLoad(preferredPlatform?: PlatformCode) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const [platformsData, locationsData, categoriesData, productsData, integrationsData, deliveryOptionsData] = await Promise.all([
        api<{ ok: boolean; items: PlatformItem[] }>("/api/v1/marketplace/platforms"),
        api<{ ok: boolean; locations: LocationItem[] }>("/api/v1/meta/locations"),
        api<{ ok: boolean; items: CategoryItem[] }>("/api/v1/meta/categories"),
        api<{ items: ProductItem[] }>("/api/v1/products"),
        api<{ ok: boolean; items: IntegrationItem[] }>("/api/v1/marketplace/integrations"),
        api<{ ok: boolean; items: DeliveryOptionGroup[] }>("/api/v1/delivery-option-groups"),
      ])

      setPlatforms(Array.isArray(platformsData?.items) ? platformsData.items : defaultPlatforms)
      setLocations(Array.isArray(locationsData?.locations) ? locationsData.locations : [])
      setCategories(Array.isArray(categoriesData?.items) ? categoriesData.items : [])
      setProducts(Array.isArray(productsData?.items) ? productsData.items : [])
      setDeliveryOptionGroups(Array.isArray(deliveryOptionsData?.items) ? deliveryOptionsData.items : [])
      const nextIntegrations = Array.isArray(integrationsData?.items) ? integrationsData.items : []
      setIntegrations(nextIntegrations)

      const activeIntegration =
        nextIntegrations.find((item) => item.platform === (preferredPlatform ?? selectedPlatform)) ?? nextIntegrations[0]
      if (activeIntegration?.platform) setSelectedPlatform(activeIntegration.platform)
      if (activeIntegration?.id) setMappingIntegrationId(activeIntegration.id)
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
        `/api/v1/meta/terminals?locationId=${encodeURIComponent(locationId)}&deviceType=POS`,
      )
      setTerminals(Array.isArray(data?.terminals) ? data.terminals : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca device-urile POS.")
      setTerminals([])
    }
  }

  async function loadDeliveryOptionGroups() {
    try {
      const data = await api<{ ok: boolean; items: DeliveryOptionGroup[] }>("/api/v1/delivery-option-groups")
      setDeliveryOptionGroups(Array.isArray(data?.items) ? data.items : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca optiunile produselor.")
    }
  }

  async function saveDeliveryOptionGroup() {
    const name = deliveryOptionDraft.name.trim()
    if (!name) {
      setError("Completeaza numele grupului, de exemplu «Alege sosurile». ")
      return
    }
    setSavingDeliveryOption(true)
    setError("")
    try {
      await api("/api/v1/delivery-option-groups", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: deliveryOptionDraft.description.trim() || null,
          selectionMode: deliveryOptionDraft.selectionMode,
          minSelections: Number(deliveryOptionDraft.minSelections || 0),
          maxSelections: Number(deliveryOptionDraft.maxSelections || 1),
        }),
      })
      setDeliveryOptionDraft(emptyDeliveryOptionDraft())
      setMessage("Grupul de optiuni a fost salvat si va aparea in Gufo Delivery.")
      await loadDeliveryOptionGroups()
      if (selectedIntegration?.id) await loadGufoDeliveryPreview(selectedIntegration.id)
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva grupul de optiuni.")
    } finally {
      setSavingDeliveryOption(false)
    }
  }

  async function deleteDeliveryOptionGroup(id: string) {
    if (!window.confirm("Stergi acest grup de optiuni din Gufo Delivery?")) return
    try {
      await api(`/api/v1/delivery-option-groups/${encodeURIComponent(id)}`, { method: "DELETE" })
      setMessage("Grupul de optiuni a fost sters.")
      await loadDeliveryOptionGroups()
    } catch (e: any) {
      setError(e?.message || "Nu am putut sterge grupul.")
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
              deliveryEnabled: integration.settingsJson?.deliveryEnabled !== false,
              deliveryCatalogMode:
                integration.settingsJson?.deliveryCatalogMode === "CATEGORY_SELECTION" ||
                integration.settingsJson?.deliveryCatalogMode === "MANUAL_SELECTION"
                  ? integration.settingsJson.deliveryCatalogMode
                  : "ALL_VISIBLE",
              deliveryShowCategories: integration.settingsJson?.deliveryShowCategories !== false,
              deliveryPaymentMethods: normalizeDeliveryPaymentMethods(integration.settingsJson?.deliveryPaymentMethods),
              deliveryOnlineProvider:
                typeof integration.settingsJson?.deliveryOnlineProvider === "string" && integration.settingsJson.deliveryOnlineProvider.trim()
                  ? integration.settingsJson.deliveryOnlineProvider.trim().toUpperCase()
                  : "VIVA",
              deliveryVivaEnvironment:
                integration.settingsJson?.deliveryVivaEnvironment === "production" ? "production" : "demo",
              deliveryVivaClientId:
                typeof integration.settingsJson?.deliveryVivaClientId === "string"
                  ? integration.settingsJson.deliveryVivaClientId
                  : "",
              deliveryVivaClientSecret: "",
              deliveryVivaSourceCode:
                typeof integration.settingsJson?.deliveryVivaSourceCode === "string"
                  ? integration.settingsJson.deliveryVivaSourceCode
                  : "",
              deliveryVivaConfigured: Boolean(integration.settingsJson?.deliveryVivaConfigured),
              deliveryRestaurantImageUrl:
                typeof integration.settingsJson?.deliveryRestaurantImageUrl === "string"
                  ? integration.settingsJson.deliveryRestaurantImageUrl
                  : "",
              deliveryServiceArea: readDeliveryServiceArea(integration.settingsJson?.deliveryServiceArea),
              includedCategoryIds: Array.isArray(integration.settingsJson?.includedCategoryIds)
                ? integration.settingsJson.includedCategoryIds.filter((item: unknown): item is string => typeof item === "string")
                : [],
              includedProductIds: Array.isArray(integration.settingsJson?.includedProductIds)
                ? integration.settingsJson.includedProductIds.filter((item: unknown): item is string => typeof item === "string")
                : [],
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

  async function loadGlovoPreview(integrationId: string) {
    setLoadingGlovoPreview(true)
    try {
      const data = await api<{ ok: boolean } & GlovoCatalogPreview>(
        `/api/v1/marketplace/integrations/glovo/catalog-preview?integrationId=${encodeURIComponent(integrationId)}`
      )
      setGlovoPreview(data)
    } catch (e: any) {
      setGlovoPreview(null)
      setError(e?.message || "Nu am putut incarca preview-ul de catalog Glovo.")
    } finally {
      setLoadingGlovoPreview(false)
    }
  }

  async function pushGlovoCatalog(integrationId: string) {
    setLoadingGlovoPush(true)
    setError("")
    setMessage("")
    try {
      const data = await api<{ ok: boolean } & GlovoCatalogPushResult>("/api/v1/marketplace/integrations/glovo/push-catalog", {
        method: "POST",
        body: JSON.stringify({ integrationId }),
      })
      setGlovoPushResult(data)
      setMessage(`Push Glovo pornit. Transaction ID: ${data.transactionId}`)
      await loadGlovoPreview(integrationId)
      await loadGlovoPushStatus(integrationId, data.transactionId)
      await loadGlovoPushHistory(integrationId)
    } catch (e: any) {
      setError(e?.message || "Nu am putut porni push-ul real de catalog Glovo.")
    } finally {
      setLoadingGlovoPush(false)
    }
  }

  async function loadGlovoPushStatus(integrationId: string, transactionId: string) {
    setLoadingGlovoPushStatus(true)
    try {
      const data = await api<{ ok: boolean } & GlovoCatalogPushStatus>(
        `/api/v1/marketplace/integrations/glovo/push-status?integrationId=${encodeURIComponent(integrationId)}&transactionId=${encodeURIComponent(transactionId)}`
      )
      setGlovoPushStatus(data)
    } catch (e: any) {
      setError(e?.message || "Nu am putut verifica statusul push-ului Glovo.")
    } finally {
      setLoadingGlovoPushStatus(false)
    }
  }

  async function loadGlovoPushHistory(integrationId: string) {
    try {
      const data = await api<{ ok: boolean; items: GlovoCatalogPushHistoryEntry[] }>(
        `/api/v1/marketplace/integrations/glovo/push-history?integrationId=${encodeURIComponent(integrationId)}`
      )
      setGlovoPushHistory(Array.isArray(data?.items) ? data.items : [])
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca istoricul Glovo.")
      setGlovoPushHistory([])
    }
  }

  async function loadGufoDeliveryPreview(integrationId: string) {
    setLoadingGufoDeliveryPreview(true)
    try {
      const data = await api<GufoDeliveryCatalogPreview>(`/api/v1/public/delivery/restaurants/${encodeURIComponent(integrationId)}/menu`)
      setGufoDeliveryPreview(data)
    } catch (e: any) {
      setError(e?.message || "Nu am putut incarca preview-ul public Gufo Delivery.")
      setGufoDeliveryPreview(null)
    } finally {
      setLoadingGufoDeliveryPreview(false)
    }
  }

  async function retryGlovoCatalogPush(integrationId: string, transactionId?: string) {
    setRetryingGlovoPush(true)
    setError("")
    setMessage("")
    try {
      const data = await api<{ ok: boolean; retriedFromTransactionId: string } & GlovoCatalogPushResult>(
        "/api/v1/marketplace/integrations/glovo/retry-push",
        {
          method: "POST",
          body: JSON.stringify({ integrationId, transactionId }),
        }
      )
      setGlovoPushResult(data)
      setMessage(`Retry Glovo pornit din ${data.retriedFromTransactionId}. Nou transaction ID: ${data.transactionId}`)
      await loadGlovoPushStatus(integrationId, data.transactionId)
      await loadGlovoPushHistory(integrationId)
    } catch (e: any) {
      setError(e?.message || "Nu am putut relansa push-ul Glovo.")
    } finally {
      setRetryingGlovoPush(false)
    }
  }

  async function saveIntegration(platform: PlatformCode, deliveryRestaurantImageUrlOverride?: string) {
    const form = {
      ...forms[platform],
      ...(deliveryRestaurantImageUrlOverride !== undefined
        ? { deliveryRestaurantImageUrl: deliveryRestaurantImageUrlOverride }
        : {}),
    }
    if (!form.locationId) {
      setError("Selecteaza locatia pentru integrare.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")

    try {
      const settings = form.settingsJson.trim() ? JSON.parse(form.settingsJson) : undefined
      const deliveryServiceArea = platform === "GUFO_DELIVERY" ? buildDeliveryServiceArea(form.deliveryServiceArea) : undefined
      if (platform === "GUFO_DELIVERY" && !form.targetTerminalId) {
        setError("Alege POS-ul care trebuie sa primeasca comenzile Gufo Delivery.")
        setSaving(false)
        return
      }
      if (platform === "GUFO_DELIVERY" && form.deliveryPaymentMethods.length === 0) {
        setError("Selecteaza cel putin o metoda de plata pentru Gufo Delivery.")
        setSaving(false)
        return
      }
      if (platform === "GUFO_DELIVERY" && form.deliveryCatalogMode === "CATEGORY_SELECTION" && form.includedCategoryIds.length === 0) {
        setError("Selecteaza cel putin o categorie pentru catalogul Gufo Delivery.")
        setSaving(false)
        return
      }
      if (platform === "GUFO_DELIVERY" && form.deliveryCatalogMode === "MANUAL_SELECTION" && form.includedProductIds.length === 0) {
        setError("Selecteaza cel putin un produs pentru catalogul Gufo Delivery.")
        setSaving(false)
        return
      }
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
            deliveryEnabled: form.deliveryEnabled,
            deliveryCatalogMode: form.deliveryCatalogMode,
            deliveryShowCategories: form.deliveryShowCategories,
            deliveryPaymentMethods: form.deliveryPaymentMethods,
            deliveryOnlineProvider: form.deliveryOnlineProvider || "VIVA",
            deliveryVivaEnvironment: form.deliveryVivaEnvironment,
            deliveryVivaClientId: form.deliveryVivaClientId.trim() || undefined,
            deliveryVivaClientSecret: form.deliveryVivaClientSecret.trim() || undefined,
            deliveryVivaSourceCode: form.deliveryVivaSourceCode.trim() || undefined,
            deliveryRestaurantImageUrl: form.deliveryRestaurantImageUrl.trim() || undefined,
            deliveryServiceArea,
            includedCategoryIds: form.includedCategoryIds,
            includedProductIds: form.includedProductIds,
          },
        }),
      })

      setMessage(platformSuccessMessage(platform))
      await initialLoad(platform)
    } catch (e: any) {
      setError(e?.message || "Nu am putut salva integrarea.")
    } finally {
      setSaving(false)
    }
  }

  async function uploadDeliveryRestaurantImage(file: File) {
    if (!token) {
      setError("Sesiunea a expirat. Autentifica-te din nou.")
      return
    }
    const body = new FormData()
    body.append("image", file)
    setUploadingRestaurantImage(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/v1/products/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok || !data.imageUrl) throw new Error(data.error || "Nu am putut incarca fotografia.")
      const imageUrl = String(data.imageUrl)
      setForms((prev) => ({
        ...prev,
        GUFO_DELIVERY: { ...prev.GUFO_DELIVERY, deliveryRestaurantImageUrl: imageUrl },
      }))
      await saveIntegration("GUFO_DELIVERY", imageUrl)
      setMessage("Fotografia restaurantului a fost incarcata si publicata in Gufo Delivery.")
    } catch (error: any) {
      setError(error?.message || "Nu am putut incarca fotografia restaurantului.")
    } finally {
      setUploadingRestaurantImage(false)
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
  const visibleCategories = useMemo(
    () => categories.filter((item) => item.isVisibleInPos !== false),
    [categories],
  )
  const visibleProducts = useMemo(
    () => products.filter((item) => item.isVisibleInPos !== false),
    [products],
  )
  const publishedGufoProducts = useMemo(() => {
    const items = gufoDeliveryPreview?.catalog?.products || []
    const query = deliveryProductSearch.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) =>
      [item.name, item.sku, item.category?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [deliveryProductSearch, gufoDeliveryPreview])
  const filteredDeliveryProducts = useMemo(() => {
    const query = deliveryProductSearch.trim().toLowerCase()
    if (!query) return visibleProducts
    return visibleProducts.filter((item) =>
      [item.name, item.sku, item.category?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [deliveryProductSearch, visibleProducts])
  const selectedLocation = locations.find((item) => item.id === currentForm.locationId) || selectedIntegration?.location || null
  const gufoDeliveryInternalCode = buildGufoDeliveryInternalCode(selectedLocation)
  const currentTabs = selectedPlatform === "GUFO_DELIVERY" ? gufoDeliveryTabs : tabs
  const platformMappings = mappings.filter((mapping) => mapping.integration.platform === selectedPlatform)
  const platformRecentExternalProducts = recentExternalProducts.filter(
    (item) => !item.platform || item.platform === selectedPlatform || item.integrationId === selectedIntegration?.id,
  )
  const rejectedPreviewItems = useMemo(() => {
    const rejectedIds = new Set(glovoPushStatus?.rejectedProductIds || [])
    if (!rejectedIds.size) return []
    return (glovoPreview?.items || []).filter((item) => item.externalProductId && rejectedIds.has(item.externalProductId))
  }, [glovoPreview, glovoPushStatus])
  const platformOrders = orders.filter((order) => order.platform === selectedPlatform)
  const selectedPlatformMeta =
    platforms.find((item) => item.code === selectedPlatform) || defaultPlatforms.find((item) => item.code === selectedPlatform)
  const activePlatformIntegrationCount = integrations.filter((item) => item.status === "ACTIVE" && item.platform === selectedPlatform).length
  const gufoDeliveryPublishedCategories = gufoDeliveryPreview?.catalog?.categories || []
  const gufoDeliveryPublishedProducts = gufoDeliveryPreview?.catalog?.products || []
  const filteredPlatformRecentExternalProducts = useMemo(() => {
    const query = productMappingSearch.trim().toLowerCase()
    if (!query) return platformRecentExternalProducts
    return platformRecentExternalProducts.filter((item) =>
      [item.externalName, item.externalProductId, item.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [platformRecentExternalProducts, productMappingSearch])

  return (
    <div className="space-y-3">
      <PageHeader
        badge={selectedPlatform === "GUFO_DELIVERY" ? "gufo delivery" : "marketplace"}
        title={selectedPlatform === "GUFO_DELIVERY" ? "Gufo Delivery" : "Marketplace"}
        subtitle={
          selectedPlatform === "GUFO_DELIVERY"
            ? "Activezi locatiile Gufo Delivery, alegi POS-ul care primeste comenzile si controlezi catalogul publicat in aplicatia noastra."
            : "Controlezi integrarile, maparile de produse si comenzile care intra din platforme externe, totul din acelasi registru operational."
        }
      />

      {selectedPlatform === "GUFO_DELIVERY" ? (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
          <DocumentMetric title="Locatii active" value={activePlatformIntegrationCount} tone="emerald" />
          <DocumentMetric title="POS selectat" value={selectedTerminal ? 1 : 0} tone="blue" />
          <DocumentMetric title="Categorii vizibile" value={visibleCategories.length} tone="amber" />
          <DocumentMetric title="Produse vizibile" value={visibleProducts.length} tone="slate" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
          <DocumentMetric title="Integrari active" value={activeIntegrations.length} tone="emerald" />
          <DocumentMetric title="Locatii conectate" value={connectedLocations} tone="blue" />
          <DocumentMetric title="Produse nemapate" value={unmappedCount} tone="amber" />
          <DocumentMetric title="Comenzi in flux" value={orders.filter((item) => item.status !== "FISCALIZED" && item.status !== "DELIVERED").length} tone="slate" />
        </div>
      )}

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {!platformView ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {defaultPlatforms.map((platform) => {
            const integrationCount = integrations.filter((item) => item.status === "ACTIVE" && item.platform === platform.code).length
            const orderCount = orders.filter((item) => item.platform === platform.code && item.status !== "FISCALIZED" && item.status !== "DELIVERED").length
            const productCount = recentExternalProducts.filter((item) => item.platform === platform.code).length
            const isGufoDelivery = platform.code === "GUFO_DELIVERY"

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
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                      {isGufoDelivery ? "Aplicatie proprie" : "Platforma"}
                    </div>
                    <div className="mt-2 text-[26px] font-semibold tracking-tight text-[#17324D]">{platform.label}</div>
                  </div>
                  <img src={platformLogo(platform.code)} alt={platform.label} className="h-20 w-20 rounded-full object-cover shadow-lg shadow-slate-900/10 ring-4 ring-white/35" />
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  {isGufoDelivery ? (
                    <>
                      <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Locatii</div>
                        <div className="mt-1 text-lg font-semibold text-[#17324D]">{integrationCount}</div>
                      </div>
                      <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Categorii</div>
                        <div className="mt-1 text-lg font-semibold text-[#17324D]">{visibleCategories.length}</div>
                      </div>
                      <div className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Produse</div>
                        <div className="mt-1 text-lg font-semibold text-[#17324D]">{visibleProducts.length}</div>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between rounded-[18px] border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-700">
                  <span>{isGufoDelivery ? "Deschide configurarea aplicatiei" : "Deschide configurarea si operarea"}</span>
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
                <img src={platformLogo(selectedPlatform)} alt={selectedPlatformMeta?.label || selectedPlatform} className="h-14 w-14 rounded-full object-cover shadow-sm ring-2 ring-slate-100" />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {selectedPlatform === "GUFO_DELIVERY" ? "Aplicatie proprie Gufo" : "Platforma marketplace"}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-[26px] font-semibold tracking-tight text-[#17324D]">{selectedPlatformMeta?.label || selectedPlatform}</h2>
                    <PlatformBadge platform={selectedPlatform} />
                  </div>
                </div>
              </div>

              {selectedPlatform === "GUFO_DELIVERY" ? (
                <div className="flex items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className={currentForm.deliveryEnabled ? "h-2 w-2 rounded-full bg-emerald-500" : "h-2 w-2 rounded-full bg-slate-300"} />
                  <span className="font-semibold text-slate-800">{currentForm.deliveryEnabled ? "Gufo Delivery activ" : "Gufo Delivery oprit"}</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <DocumentMetric title="Integrari active" value={activePlatformIntegrationCount} tone="emerald" />
                  <DocumentMetric title="Locatie" value={selectedIntegration?.location?.code || selectedIntegration?.location?.name || "-"} tone="blue" />
                  <DocumentMetric title="Nemapate" value={platformRecentExternalProducts.filter((item) => !item.mapped).length} tone="amber" />
                  <DocumentMetric title="In flux" value={platformOrders.filter((item) => item.status !== "FISCALIZED" && item.status !== "DELIVERED").length} tone="slate" />
                </div>
              )}
            </div>
          </div>

          <DocumentTabs items={currentTabs} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "integrari" ? (
            <div className="space-y-3">
              <DocumentSection
                title={
                  selectedPlatform === "GUFO_DELIVERY"
                    ? "Configurare locatie si POS"
                    : `Rutare si conectare ${platforms.find((item) => item.code === selectedPlatform)?.label || selectedPlatform}`
                }
                description={
                  selectedPlatform === "GUFO_DELIVERY"
                    ? "Configureaza restaurantul pentru aplicatia Gufo Delivery: unde ajung comenzile, ce meniu este public si cum incasezi online."
                    : "Configurezi locatia, device-ul tinta si credentialele platformei, apoi verifici rapid daca integrarea este pregatita pentru comenzi reale."
                }
                actions={null}
              >
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-3">
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                        <span className="flex items-center gap-2"><Truck size={16} className="text-[#17324D]" />Restaurant si POS</span>
                        {selectedPlatform === "GUFO_DELIVERY" ? (
                          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                            <input
                              type="checkbox"
                              checked={currentForm.deliveryEnabled}
                              onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryEnabled: e.target.checked } }))}
                            />
                            Activ
                          </label>
                        ) : null}
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
                          ? selectedPlatform === "GUFO_DELIVERY"
                            ? `Comenzile din aplicatia Gufo Delivery vor intra in POS-ul: ${selectedTerminal.label || selectedTerminal.deviceId}`
                            : `Comenzile marketplace vor intra in POS-ul: ${selectedTerminal.label || selectedTerminal.deviceId}`
                          : "Alege device-ul/licenta Android POS care trebuie sa primeasca comenzile din platforma."}
                      </div>
                      {!terminals.length && currentForm.locationId ? (
                        <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          Pentru locatia selectata nu exista inca niciun POS Android configurat in ERP.
                        </div>
                      ) : null}
                      {selectedPlatform === "GUFO_DELIVERY" ? (
                        <div className="mt-3">
                          <DocumentField label="Fotografie restaurant in Gufo Delivery">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className={`${documentButtonSecondaryClass} cursor-pointer`}>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadingRestaurantImage} onChange={(event) => {
                                  const file = event.target.files?.[0]
                                  if (file) void uploadDeliveryRestaurantImage(file)
                                  event.currentTarget.value = ""
                                }} />
                                {uploadingRestaurantImage ? "Se incarca..." : "Alege fotografie"}
                              </label>
                              {currentForm.deliveryRestaurantImageUrl ? <span className="text-xs font-medium text-emerald-700">Fotografie selectata</span> : null}
                            </div>
                            {currentForm.deliveryRestaurantImageUrl ? (
                              <img
                                src={resolveDeliveryRestaurantImageUrl(currentForm.deliveryRestaurantImageUrl)}
                                alt="Previzualizare fotografie restaurant"
                                className="mt-3 h-28 w-44 rounded-xl border border-slate-200 object-cover"
                              />
                            ) : null}
                          </DocumentField>
                          <p className="mt-1 text-xs text-slate-500">Fotografia aleasa se incarca si se publica automat. Daca nu alegi una, se foloseste automat o imagine din produse sau categorii.</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Link2 size={16} className="text-[#17324D]" />
                        {selectedPlatform === "GUFO_DELIVERY" ? "Configurare interna Gufo Delivery" : "Date integrare platforma"}
                      </div>

                {selectedPlatform === "GUFO_DELIVERY" ? (
                  <div className="space-y-3">
                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Metode de plata</div>
                          <div className="mt-1 text-xs text-slate-500">Alege o singura configuratie pentru acest restaurant.</div>
                        </div>
                        <span className="rounded-full bg-[#EFF6FF] px-2 py-1 text-xs font-semibold text-[#17324D]">Checkout securizat</span>
                      </div>
                      <DocumentField label="Clientul poate plati cu">
                        <select
                          value={
                            currentForm.deliveryPaymentMethods.includes("GOOGLE_PAY") || currentForm.deliveryPaymentMethods.includes("APPLE_PAY")
                              ? "CARD,GOOGLE_PAY,APPLE_PAY"
                              : currentForm.deliveryPaymentMethods.includes("CARD") && currentForm.deliveryPaymentMethods.includes("CASH")
                                ? "CASH,CARD"
                                : currentForm.deliveryPaymentMethods.includes("CARD")
                                  ? "CARD"
                                  : "CASH"
                          }
                          onChange={(e) => {
                            const methods = e.target.value.split(",").filter(Boolean) as DeliveryPaymentMethodCode[]
                            setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryPaymentMethods: methods, deliveryOnlineProvider: "VIVA" } }))
                          }}
                          className={documentInputClass}
                        >
                          <option value="CASH,CARD">Numerar la livrare si card online</option>
                          <option value="CARD">Doar card online</option>
                          <option value="CASH">Doar numerar la livrare</option>
                          <option value="CARD,GOOGLE_PAY,APPLE_PAY">Card, Google Pay si Apple Pay</option>
                        </select>
                      </DocumentField>
                      <div className="mt-3 rounded-[16px] border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Cont plata online al locatiei</div>
                            <div className="mt-1 text-xs text-slate-500">Datele sunt folosite numai de server pentru aceasta locatie. Secretul nu este afisat dupa salvare.</div>
                          </div>
                          <span className={currentForm.deliveryVivaConfigured ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700" : "rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"}>
                            {currentForm.deliveryVivaConfigured ? "Configurat" : "Neconfigurat"}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <DocumentField label="Mediu">
                            <select value={currentForm.deliveryVivaEnvironment} onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryVivaEnvironment: e.target.value === "production" ? "production" : "demo" } }))} className={documentInputClass}>
                              <option value="demo">Test / demo</option>
                              <option value="production">Productie</option>
                            </select>
                          </DocumentField>
                          <DocumentField label="Client ID">
                            <input value={currentForm.deliveryVivaClientId} onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryVivaClientId: e.target.value } }))} className={documentInputClass} autoComplete="off" />
                          </DocumentField>
                          <DocumentField label="Client Secret">
                            <input type="password" value={currentForm.deliveryVivaClientSecret} onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryVivaClientSecret: e.target.value } }))} placeholder={currentForm.deliveryVivaConfigured ? "Lasă gol pentru a păstra secretul salvat" : "Introdu Client Secret"} className={documentInputClass} autoComplete="new-password" />
                          </DocumentField>
                          <DocumentField label="Source Code">
                            <input value={currentForm.deliveryVivaSourceCode} onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryVivaSourceCode: e.target.value } }))} className={documentInputClass} autoComplete="off" />
                          </DocumentField>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {selectedPlatform !== "GUFO_DELIVERY" ? (
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
                ) : null}

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

                  {selectedPlatform !== "GUFO_DELIVERY" ? (
                    <DocumentField label="Merchant ID">
                      <input
                        value={currentForm.merchantId}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], merchantId: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="merchant-123"
                      />
                    </DocumentField>
                  ) : null}

                  {selectedPlatform !== "GUFO_DELIVERY" ? (
                    <DocumentField label="Store ID">
                      <input
                        value={currentForm.storeId}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], storeId: e.target.value } }))}
                        className={documentInputClass}
                        placeholder={selectedPlatform === "GLOVO" ? "partner__store-id" : "store-01"}
                      />
                    </DocumentField>
                  ) : null}

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
                  {selectedPlatform !== "GUFO_DELIVERY" ? (
                    <DocumentField label="Access token">
                      <input
                        value={currentForm.accessToken}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], accessToken: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="token acces platforma"
                      />
                    </DocumentField>
                  ) : null}

                  {selectedPlatform !== "GUFO_DELIVERY" ? (
                    <DocumentField label="Webhook secret">
                      <input
                        value={currentForm.webhookSecret}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], webhookSecret: e.target.value } }))}
                        className={documentInputClass}
                        placeholder="secret webhook"
                      />
                    </DocumentField>
                  ) : null}

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

                {selectedPlatform === "GUFO_DELIVERY" ? (
                    <div className="space-y-3 rounded-[18px] border border-[#BFDBFE] bg-[#F8FBFF] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[#17324D]">Catalog Gufo Delivery</div>
                        <div className="text-sm text-slate-600">
                          Alegi daca publicam toate produsele vizibile in POS, doar anumite categorii sau produse selectate manual.
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <DocumentField label="Mod publicare catalog">
                        <select
                          value={currentForm.deliveryCatalogMode}
                          onChange={(e) =>
                            setForms((prev) => ({
                              ...prev,
                              [selectedPlatform]: {
                                ...prev[selectedPlatform],
                                deliveryCatalogMode: e.target.value as DeliveryCatalogMode,
                                includedCategoryIds: e.target.value === "CATEGORY_SELECTION" ? prev[selectedPlatform].includedCategoryIds : [],
                                includedProductIds: e.target.value === "MANUAL_SELECTION" ? prev[selectedPlatform].includedProductIds : [],
                                deliveryShowCategories: e.target.value === "MANUAL_SELECTION" ? false : prev[selectedPlatform].deliveryShowCategories,
                              },
                            }))
                          }
                          className={documentInputClass}
                        >
                          <option value="ALL_VISIBLE">Toate produsele active din ERP</option>
                          <option value="CATEGORY_SELECTION">Doar categorii selectate</option>
                          <option value="MANUAL_SELECTION">Selectie manuala de produse</option>
                        </select>
                      </DocumentField>

                      <DocumentField label="Afisare categorii in aplicatie">
                        <select
                          value={currentForm.deliveryShowCategories ? "yes" : "no"}
                          disabled={currentForm.deliveryCatalogMode === "MANUAL_SELECTION"}
                          onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryShowCategories: e.target.value === "yes" } }))}
                          className={documentInputClass}
                        >
                          <option value="yes">Afiseaza categorii</option>
                          <option value="no">Afiseaza toate produsele impreuna</option>
                        </select>
                      </DocumentField>
                    </div>

                    {currentForm.deliveryCatalogMode === "ALL_VISIBLE" ? (
                      <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Vor fi incluse toate produsele active din ERP pentru aceasta locatie.
                      </div>
                    ) : null}

                    {currentForm.deliveryCatalogMode === "CATEGORY_SELECTION" ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-slate-800">Categorii incluse</div>
                        <div className="grid max-h-72 grid-cols-1 gap-2 overflow-auto rounded-[16px] border border-slate-200 bg-white p-3 md:grid-cols-2">
                          {visibleCategories.map((category) => {
                            const checked = currentForm.includedCategoryIds.includes(category.id)
                            return (
                              <label key={category.id} className="flex items-start gap-2 rounded-[14px] border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setForms((prev) => ({
                                      ...prev,
                                      [selectedPlatform]: {
                                        ...prev[selectedPlatform],
                                        includedCategoryIds: e.target.checked
                                          ? [...prev[selectedPlatform].includedCategoryIds, category.id]
                                          : prev[selectedPlatform].includedCategoryIds.filter((item) => item !== category.id),
                                      },
                                    }))
                                  }
                                  className="mt-0.5"
                                />
                                <span>{category.parentCategory?.name ? `${category.parentCategory.name} / ${category.name}` : category.name}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}

                    {currentForm.deliveryCatalogMode === "MANUAL_SELECTION" ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.9fr_1.1fr]">
                          <DocumentField label="Cauta produs">
                            <input
                              value={deliveryProductSearch}
                              onChange={(e) => setDeliveryProductSearch(e.target.value)}
                              className={documentInputClass}
                              placeholder="pizza, cola, burger..."
                            />
                          </DocumentField>
                          <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            Selectate acum: <span className="font-semibold text-slate-900">{currentForm.includedProductIds.length}</span> produse
                          </div>
                        </div>

                        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-auto rounded-[16px] border border-slate-200 bg-white p-3">
                          {filteredDeliveryProducts.map((product) => {
                            const checked = currentForm.includedProductIds.includes(product.id)
                            return (
                              <label key={product.id} className="flex items-start justify-between gap-3 rounded-[14px] border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                <span className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      setForms((prev) => ({
                                        ...prev,
                                        [selectedPlatform]: {
                                          ...prev[selectedPlatform],
                                          includedProductIds: e.target.checked
                                            ? [...prev[selectedPlatform].includedProductIds, product.id]
                                            : prev[selectedPlatform].includedProductIds.filter((item) => item !== product.id),
                                        },
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>
                                    <span className="block font-medium text-slate-900">{product.name}</span>
                                    <span className="block text-xs text-slate-500">
                                      {[product.sku, product.category?.name].filter(Boolean).join(" • ") || "Fara categorie"}
                                    </span>
                                  </span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                  {selectedPlatform !== "GUFO_DELIVERY" ? (
                    <DocumentField label="Setari suplimentare JSON">
                      <textarea
                        value={currentForm.settingsJson}
                        onChange={(e) => setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], settingsJson: e.target.value } }))}
                        className={documentTextareaClass}
                        rows={4}
                        placeholder='{"autoAccept": true}'
                      />
                    </DocumentField>
                  ) : null}

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
                    {saving ? "Se salveaza..." : selectedPlatform === "GUFO_DELIVERY" ? "Salveaza configurarea" : "Salveaza conectarea"}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {selectedPlatform !== "GUFO_DELIVERY" ? (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Webhook</div>
                    <div className="mt-2 text-sm font-semibold text-[#17324D] break-all">
                      {selectedPlatform === "WOLT"
                        ? `${API_BASE}/api/v1/marketplace/webhooks/wolt`
                        : `${API_BASE}/api/v1/marketplace/webhooks/glovo/${currentForm.storeId || "{storeId}"}`}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Rutare interna</div>
                    <div className="mt-2 text-sm font-semibold text-[#17324D]">
                      Comenzile Gufo Delivery vor fi rutate intern catre locatia si POS-ul selectat, fara webhook extern.
                    </div>
                  </div>
                )}

                <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Link2 size={16} className="text-emerald-600" />
                    {selectedPlatform === "GUFO_DELIVERY" ? "Status activare" : "Status integrare"}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${selectedIntegration?.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {selectedIntegration?.status || "INACTIV"}
                    </span>
                    <span className="text-sm text-slate-600">
                      {selectedIntegration?.location?.name || (selectedPlatform === "GUFO_DELIVERY" ? "Alege locatia pentru activare" : "Alege locatia pentru conectare")}
                    </span>
                  </div>
                  {selectedTerminal ? (
                    <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      POS selectat pentru comenzi: <span className="font-semibold">{selectedTerminal.label || selectedTerminal.deviceId}</span>
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

                {selectedPlatform === "GLOVO" ? (
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Preview catalog Glovo</div>
                        <div className="mt-1 text-sm text-slate-500">
                          Aici vezi ce produse din ERP sunt pregatite pentru fluxul real de pret/stoc si unde mai lipseste maparea.
                        </div>
                      </div>
                      {selectedIntegration?.id ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={documentButtonSecondaryClass}
                            onClick={() => loadGlovoPreview(selectedIntegration.id)}
                            disabled={loadingGlovoPreview}
                          >
                            <RefreshCcw size={14} className="mr-1.5" />
                            {loadingGlovoPreview ? "Reincarc..." : "Reincarca"}
                          </button>
                          <button
                            type="button"
                            className={documentButtonPrimaryClass}
                            onClick={() => pushGlovoCatalog(selectedIntegration.id)}
                            disabled={loadingGlovoPush}
                          >
                            {loadingGlovoPush ? "Trimitem..." : "Push catalog real"}
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                      <DocumentMetric title="Publicate" value={String(glovoPreview?.summary.totalPublished || 0)} tone="slate" />
                      <DocumentMetric title="Gata update" value={String(glovoPreview?.summary.readyForUpdates || 0)} tone="emerald" />
                      <DocumentMetric title="Mapate" value={String(glovoPreview?.summary.explicitlyMapped || 0)} tone="blue" />
                      <DocumentMetric title="Fallback SKU" value={String(glovoPreview?.summary.usingSkuFallback || 0)} tone="amber" />
                      <DocumentMetric title="Fara ID extern" value={String(glovoPreview?.summary.missingExternalId || 0)} tone="amber" />
                      <DocumentMetric title="Pret 0 / ascunse" value={String((glovoPreview?.summary.zeroPrice || 0) + (glovoPreview?.summary.inactiveOrHidden || 0))} tone="amber" />
                    </div>

                    <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {glovoPreview?.integration?.storeId
                        ? `Store activ: ${glovoPreview.integration.storeId}`
                        : "Store ID lipsa pe integrarea Glovo."}
                    </div>

                    {glovoPushResult ? (
                      <div className="mt-3 rounded-[14px] border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900">Ultimul push real</div>
                            <div className="text-xs text-slate-500">
                              Transaction ID: {glovoPushResult.transactionId} | {glovoPushResult.payload.products.length} produse
                            </div>
                          </div>
                          {selectedIntegration?.id ? (
                            <button
                              type="button"
                              className={documentButtonSecondaryClass}
                              onClick={() => loadGlovoPushStatus(selectedIntegration.id, glovoPushResult.transactionId)}
                              disabled={loadingGlovoPushStatus}
                            >
                              <RefreshCcw size={14} className="mr-1.5" />
                              {loadingGlovoPushStatus ? "Verificam..." : "Verifica status"}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Endpoint: {glovoPushResult.endpoint}
                        </div>
                      </div>
                    ) : null}

                    {glovoPushStatus ? (
                      <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">Status Glovo bulk update</div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              glovoPushStatus.status === "SUCCESS"
                                ? "bg-emerald-100 text-emerald-700"
                                : glovoPushStatus.status === "PROCESSING"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-rose-100 text-rose-700"
                            }`}
                          >
                            {glovoPushStatus.status || "necunoscut"}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          {(glovoPushStatus.details || []).length ? (
                            glovoPushStatus.details.map((detail, index) => (
                              <div key={`glovo-status-${index}`}>{String(detail)}</div>
                            ))
                          ) : (
                            <div>Glovo nu a returnat detalii suplimentare.</div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {rejectedPreviewItems.length ? (
                      <div className="mt-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-3">
                        <div className="text-sm font-semibold text-rose-800">Produse respinse de Glovo</div>
                        <div className="mt-2 space-y-2">
                          {rejectedPreviewItems.map((item) => (
                            <div key={`rejected-${item.productId}`} className="rounded-[12px] border border-rose-200 bg-white px-3 py-2">
                              <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                              <div className="text-xs text-slate-500">
                                SKU: {item.sku} | ID extern: {item.externalProductId || "-"} | {formatMoney(item.price)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {glovoPushHistory.length ? (
                      <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">Istoric push Glovo</div>
                          {selectedIntegration?.id ? (
                            <button
                              type="button"
                              className={documentButtonSecondaryClass}
                              onClick={() => loadGlovoPushHistory(selectedIntegration.id)}
                            >
                              <RefreshCcw size={14} className="mr-1.5" />
                              Reincarca istoric
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-2">
                          {glovoPushHistory.slice(0, 8).map((item) => (
                            <div key={item.transactionId} className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold text-slate-800">{item.transactionId}</div>
                                  <div className="text-xs text-slate-500">
                                    {new Date(item.createdAt).toLocaleString("ro-RO")} | {item.payload.products.length} produse
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                      item.status === "SUCCESS"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : item.status === "PROCESSING"
                                          ? "bg-amber-100 text-amber-700"
                                          : "bg-rose-100 text-rose-700"
                                    }`}
                                  >
                                    {item.status}
                                  </span>
                                  {selectedIntegration?.id ? (
                                    <>
                                      <button
                                        type="button"
                                        className={documentButtonSecondaryClass}
                                        onClick={() => loadGlovoPushStatus(selectedIntegration.id, item.transactionId)}
                                        disabled={loadingGlovoPushStatus}
                                      >
                                        Status
                                      </button>
                                      <button
                                        type="button"
                                        className={documentButtonPrimaryClass}
                                        onClick={() => retryGlovoCatalogPush(selectedIntegration.id, item.transactionId)}
                                        disabled={retryingGlovoPush}
                                      >
                                        Retry
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              {item.rejectedProductIds.length ? (
                                <div className="mt-2 text-xs text-rose-700">
                                  Respinse: {item.rejectedProductIds.join(", ")}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 space-y-2">
                      {(glovoPreview?.items || []).slice(0, 8).map((item) => (
                        <div key={item.productId} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                              <div className="text-xs text-slate-500">
                                SKU: {item.sku} | ID extern: {item.externalProductId || "-"} | {formatMoney(item.price)}
                              </div>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.available ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                              {item.available ? "activ" : "inactiv"}
                            </span>
                          </div>
                          {item.issues.length > 0 ? (
                            <div className="mt-2 text-xs text-amber-700">{item.issues.join(" | ")}</div>
                          ) : (
                            <div className="mt-2 text-xs text-emerald-700">Pregatit pentru update Glovo.</div>
                          )}
                        </div>
                      ))}
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

      {activeTab === "acoperire" && selectedPlatform === "GUFO_DELIVERY" ? (
        <div className="space-y-3">
          <DocumentSection
            title="Zona de livrare"
            description="Deseneaza aria in care acest restaurant accepta comenzi. Filtrarea este aplicata dupa adresa clientului si este verificata din nou la checkout."
          >
            <DeliveryServiceAreaEditor
              value={currentForm.deliveryServiceArea}
              onChange={(deliveryServiceArea) =>
                setForms((prev) => ({ ...prev, [selectedPlatform]: { ...prev[selectedPlatform], deliveryServiceArea } }))
              }
            />
            <div className="mt-4 flex justify-end">
              <button type="button" className={documentButtonPrimaryClass} onClick={() => void saveIntegration("GUFO_DELIVERY")} disabled={saving}>
                <Save size={15} className="mr-1.5" />
                {saving ? "Se salveaza..." : "Salveaza zona"}
              </button>
            </div>
          </DocumentSection>
        </div>
      ) : null}

      {activeTab === "optiuni" && selectedPlatform === "GUFO_DELIVERY" ? (
        <div className="space-y-3">
          <DocumentSection
            title="Sosuri, ingrediente si alegeri pentru produs"
            description="Configurezi o data un grup reutilizabil, apoi il trimiti spre produsele dorite. Exemplu: «Adauga sosuri», obligatoriu, pentru toate shaormele."
            actions={
              <button type="button" className={documentButtonSecondaryClass} onClick={() => void loadDeliveryOptionGroups()}>
                <RefreshCcw size={14} className="mr-1.5" /> Reincarca
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[20px] border border-[#BFDBFE] bg-[#F8FBFF] p-4">
                <div className="text-sm font-semibold text-[#17324D]">Grup nou de optiuni</div>
                <div className="mt-1 text-sm text-slate-600">Definesti aici doar regula grupului. Produsele in care apare si produsele care devin alegeri se asociaza din editorul de produs.</div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DocumentField label="Nume grup">
                    <input value={deliveryOptionDraft.name} onChange={(e) => setDeliveryOptionDraft((value) => ({ ...value, name: e.target.value }))} className={documentInputClass} placeholder="Adauga sosuri" />
                  </DocumentField>
                  <DocumentField label="Tip selectie">
                    <select value={deliveryOptionDraft.selectionMode} onChange={(e) => setDeliveryOptionDraft((value) => ({ ...value, selectionMode: e.target.value as DeliveryOptionDraft["selectionMode"] }))} className={documentInputClass}>
                      <option value="MULTIPLE">Mai multe alegeri</option>
                      <option value="SINGLE">O singura alegere</option>
                    </select>
                  </DocumentField>
                  <DocumentField label="Minim selectii">
                    <input type="number" min="0" value={deliveryOptionDraft.minSelections} onChange={(e) => setDeliveryOptionDraft((value) => ({ ...value, minSelections: e.target.value }))} className={documentInputClass} />
                  </DocumentField>
                  <DocumentField label="Maxim selectii">
                    <input type="number" min="1" value={deliveryOptionDraft.maxSelections} onChange={(e) => setDeliveryOptionDraft((value) => ({ ...value, maxSelections: e.target.value }))} className={documentInputClass} />
                  </DocumentField>
                </div>

                <div className="mt-3">
                  <DocumentField label="Explicatie pentru client (optional)">
                    <input value={deliveryOptionDraft.description} onChange={(e) => setDeliveryOptionDraft((value) => ({ ...value, description: e.target.value }))} className={documentInputClass} placeholder="Alege sosurile preferate" />
                  </DocumentField>
                </div>
                <div className="mt-3 text-xs text-slate-500">Daca minimul este `0`, grupul este optional. Daca minimul este mai mare ca `0`, grupul devine obligatoriu in catalog.</div>
                <div className="mt-4 flex justify-end">
                  <button type="button" className={documentButtonPrimaryClass} onClick={() => void saveDeliveryOptionGroup()} disabled={savingDeliveryOption}>
                    <Plus size={15} className="mr-1.5" /> {savingDeliveryOption ? "Se salveaza..." : "Adauga grup"}
                  </button>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Grupuri configurate</div>
                    <div className="mt-1 text-sm text-slate-500">{deliveryOptionGroups.length} grupuri disponibile pentru catalogul acestei firme.</div>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {!deliveryOptionGroups.length ? <InlineNotice tone="info">Nu exista inca grupuri. Creeaza „Adauga sosuri” sau „Alege legumele” din formularul alaturat.</InlineNotice> : null}
                  {deliveryOptionGroups.map((group) => (
                    <div key={group.id} className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{group.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{group.minSelections > 0 ? `Obligatoriu: ${group.minSelections}-${group.maxSelections}` : `Optional: maxim ${group.maxSelections}`} · {group.selectionMode === "SINGLE" ? "o alegere" : "alegeri multiple"}</div>
                        </div>
                        <button type="button" onClick={() => void deleteDeliveryOptionGroup(group.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50" title="Sterge grupul"><Trash2 size={15} /></button>
                      </div>
                      {group.description ? <div className="mt-2 text-sm text-slate-600">{group.description}</div> : null}
                      <div className="mt-3 text-xs text-slate-500">
                        {group.productLinks.length} produse afiseaza grupul · {group.items.length} produse sunt disponibile ca alegere
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DocumentSection>
        </div>
      ) : null}

      {activeTab === "mapari" && selectedPlatform === "GUFO_DELIVERY" ? (
        <div className="space-y-3">
          <DocumentSection
            title="Catalog Gufo Delivery"
            description="Verifici exact ce restaurant si ce produse pleaca acum spre aplicatia clientului, pe baza configuratiei ERP."
            actions={
              <button
                type="button"
                className={documentButtonSecondaryClass}
                onClick={() => {
                  void initialLoad()
                  if (selectedIntegration?.id) {
                    void loadGufoDeliveryPreview(selectedIntegration.id)
                  }
                }}
                disabled={loading || saving || loadingGufoDeliveryPreview}
              >
                <RefreshCcw size={14} className="mr-1.5" />
                {loadingGufoDeliveryPreview ? "Se verifica..." : "Reincarca"}
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <DocumentMetric title="Mod catalog" value={currentForm.deliveryCatalogMode} tone="blue" />
              <DocumentMetric title="Categorii alese" value={currentForm.includedCategoryIds.length} tone="amber" />
              <DocumentMetric title="Produse alese" value={currentForm.includedProductIds.length} tone="slate" />
              <DocumentMetric title="Produse publicate" value={gufoDeliveryPublishedProducts.length} tone="emerald" />
            </div>

            <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {currentForm.deliveryCatalogMode === "ALL_VISIBLE"
                ? "Pentru aceasta locatie vor merge in Gufo Delivery toate produsele active din ERP."
                : currentForm.deliveryCatalogMode === "CATEGORY_SELECTION"
                  ? `Pentru aceasta locatie vor merge doar produsele din ${currentForm.includedCategoryIds.length} categorii selectate.`
                  : `Pentru aceasta locatie vor merge doar cele ${currentForm.includedProductIds.length} produse selectate manual.`}
            </div>

            {!selectedIntegration?.id ? (
              <div className="mt-4">
                <InlineNotice>Salveaza mai intai configurarea locatiei ca sa putem verifica preview-ul public.</InlineNotice>
              </div>
            ) : null}

            {gufoDeliveryPreview ? (
              <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-[#BFDBFE] bg-[#F8FBFF] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0F5EA8]">Restaurant public</div>
                    <div className="mt-2 text-[22px] font-semibold tracking-tight text-[#17324D]">
                      {gufoDeliveryPreview.restaurant.name}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {[gufoDeliveryPreview.restaurant.address, gufoDeliveryPreview.restaurant.city, gufoDeliveryPreview.restaurant.county]
                        .filter(Boolean)
                        .join(", ") || "Adresa nu este completata in locatie."}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div className="rounded-[14px] border border-white bg-white px-3 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Slug public</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{gufoDeliveryPreview.restaurant.slug}</div>
                      </div>
                      <div className="rounded-[14px] border border-white bg-white px-3 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Ultima regenerare</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{formatDate(gufoDeliveryPreview.updatedAt)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-900">Rutare activa</div>
                    <div className="mt-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      Comenzile plasate de client intra in locatia <span className="font-semibold">{selectedIntegration?.location?.name || "-"}</span> si ajung in POS-ul
                      {" "}
                      <span className="font-semibold">{selectedTerminal?.label || selectedTerminal?.deviceId || "-"}</span>.
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-900">Structura publicata</div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <DocumentMetric title="Categorii publice" value={gufoDeliveryPublishedCategories.length} tone="amber" />
                      <DocumentMetric title="Produse publice" value={gufoDeliveryPublishedProducts.length} tone="emerald" />
                      <DocumentMetric title="Categorii afisate" value={gufoDeliveryPreview.catalog.showCategories ? "Da" : "Nu"} tone="blue" />
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Preview produse publicate</div>
                      <div className="mt-1 text-sm text-slate-500">
                        Aici vezi exact ce poate comanda clientul in aplicatia Gufo Delivery.
                      </div>
                    </div>
                    <div className="w-full md:w-[280px]">
                      <DocumentField label="Cauta in preview">
                        <input
                          value={deliveryProductSearch}
                          onChange={(e) => setDeliveryProductSearch(e.target.value)}
                          className={documentInputClass}
                          placeholder="pizza, cola, burger..."
                        />
                      </DocumentField>
                    </div>
                  </div>

                  {gufoDeliveryPublishedCategories.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {gufoDeliveryPublishedCategories.map((category) => (
                        <span key={category.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                          {category.name}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 grid max-h-[520px] grid-cols-1 gap-2 overflow-auto">
                    {!publishedGufoProducts.length ? (
                      <InlineNotice>
                        {deliveryProductSearch.trim()
                          ? "Nu exista produse in preview pentru cautarea actuala."
                          : "Nu exista produse publicate pentru configuratia curenta."}
                      </InlineNotice>
                    ) : (
                      publishedGufoProducts.map((product) => (
                        <div key={product.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {[product.sku, product.category?.name].filter(Boolean).join(" • ") || "Fara categorie"}
                              </div>
                            </div>
                            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              {formatMoney(product.price)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : selectedIntegration?.id && !loadingGufoDeliveryPreview ? (
              <div className="mt-4">
                <InlineNotice tone="info">
                  Preview-ul public nu a putut fi generat inca. Verifica daca locatia are POS selectat si produse vizibile in POS.
                </InlineNotice>
              </div>
            ) : null}
          </DocumentSection>
        </div>
      ) : activeTab === "mapari" ? (
        <div className="space-y-3">
          <DocumentSection
            title={`Catalog merchant ${selectedPlatformMeta?.label || selectedPlatform}`}
            description="Filtrezi produsele detectate in merchant si pregatesti zona de mapare dintre platforma si produsele ERP."
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,260px)_auto]">
              <select value={mappingIntegrationId} onChange={(e) => setMappingIntegrationId(e.target.value)} className={documentInputClass}>
                <option value="">Toate integrările</option>
                {integrations.filter((integration) => integration.platform === selectedPlatform).map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.location?.name || "Fara locatie"} · {integration.storeId || integration.platform}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={productMappingSearch}
                  onChange={(e) => setProductMappingSearch(e.target.value)}
                  className={`${documentInputClass} pl-9`}
                  placeholder="Cauta dupa produs, SKU sau ID extern"
                />
              </div>
              <button type="button" className={documentButtonSecondaryClass} onClick={() => loadMappings(mappingIntegrationId)} disabled={loadingMappings}>
                <RefreshCcw size={14} className="mr-1.5" />
                Reincarca maparile
              </button>
            </div>
            <div className="mt-3 text-sm text-slate-500">
              Aici vezi produsele detectate in merchant-ul platformei si le mapezi catre produsele tale ERP.
            </div>
          </DocumentSection>

          <DocumentSection title="Produse merchant pentru mapare" description="Alegi produsul ERP potrivit pentru fiecare produs extern si elimini rapid zonele nemapate care blocheaza fluxul.">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {!filteredPlatformRecentExternalProducts.length ? (
                <InlineNotice>Nu exista produse detectate pentru platforma selectata sau filtrul ales.</InlineNotice>
              ) : (
                filteredPlatformRecentExternalProducts.map((item) => (
                  <div key={`${item.integrationId || "none"}::${item.externalProductId || item.externalName || "row"}`} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformBadge platform={item.platform || selectedPlatform} uppercase />
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${item.mapped ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {item.mapped ? "Mapat" : "Nemapat"}
                          </span>
                        </div>
                        <div className="mt-3 text-[18px] font-semibold text-slate-900">{item.externalName || "Produs extern fara nume"}</div>
                        <div className="mt-2 text-sm text-slate-500">
                          ID extern: <span className="font-semibold text-slate-700">{item.externalProductId || "-"}</span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          SKU extern: <span className="font-semibold text-slate-700">{item.sku || "-"}</span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          Locatie: <span className="font-semibold text-slate-700">{item.location?.name || "-"}</span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          Vazut ultima data: <span className="font-semibold text-slate-700">{formatDate(item.lastSeenAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Produs ERP</div>
                      <select
                        className={`${documentInputClass} mt-2`}
                        defaultValue={mappings.find((mapping) => mapping.integrationId === item.integrationId && mapping.externalProductId === item.externalProductId)?.erpProduct?.id || ""}
                        onChange={(e) => saveMapping(item.integrationId || "", item.externalProductId || "", item.externalName || "", e.target.value)}
                      >
                        <option value="">Alege produs ERP pentru mapare</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} - {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DocumentSection>

          <DocumentSection title="Mapari salvate" description="Revizuiesti maparile deja create si confirmi rapid ce produs ERP este folosit in fiecare integrare activa.">
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

      {activeTab === "comenzi" && selectedPlatform !== "GUFO_DELIVERY" ? (
        <div className="space-y-3">
          <DocumentSection
            title="Comenzi marketplace"
            description="Monitorizezi comenzile venite din platforme, vezi starea lor curenta si intri rapid in istoricul de procesare."
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
