import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRightLeft, Boxes, ClipboardList, RefreshCw } from "lucide-react"
import PageHeader from "../components/PageHeader"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { getActiveLocationId, subscribeToActiveLocation } from "../lib/location"
import { formatQtyRo } from "../lib/format"
import { getActiveWarehouseId, setActiveWarehouseId, subscribeToActiveWarehouse } from "../lib/warehouse"
import { getWarehouseConfig, subscribeToWarehouseConfig, type WarehouseConfig } from "../lib/warehouseConfig"

type PaginationState = {
  page: number
  limit: number
  total: number
  totalPages: number
}

type StockSection = "location" | "global" | "lots" | "moves"

function formatRon(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export default function StocPage() {
  const navigate = useNavigate()
  const token = getToken() || ""

  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const [locations, setLocations] = useState<any[]>([])
  const [locationId, setLocationId] = useState(getActiveLocationId())
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [warehouseId, setWarehouseId] = useState(getActiveWarehouseId())
  const [warehouseConfig, setWarehouseConfig] = useState<WarehouseConfig>(getWarehouseConfig())

  const [stock, setStock] = useState<any[]>([])
  const [globalStock, setGlobalStock] = useState<any[]>([])
  const [lots, setLots] = useState<any[]>([])
  const [moves, setMoves] = useState<any[]>([])

  const [loading, setLoading] = useState(false)
  const [movesLoading, setMovesLoading] = useState(false)
  const [error, setError] = useState("")

  const [movesSearch, setMovesSearch] = useState("")
  const [stockSearch, setStockSearch] = useState("")
  const [globalSearch, setGlobalSearch] = useState("")
  const [lotSearch, setLotSearch] = useState("")
  const [activeSection, setActiveSection] = useState<StockSection>("location")
  const [locationPage, setLocationPage] = useState(1)
  const [globalPage, setGlobalPage] = useState(1)
  const [lotPage, setLotPage] = useState(1)

  const [fromDate, setFromDate] = useState(
    `${monthStart.getFullYear()}-${`${monthStart.getMonth() + 1}`.padStart(2, "0")}-${`${monthStart.getDate()}`.padStart(2, "0")}`
  )
  const [toDate, setToDate] = useState(
    `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`
  )

  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  })

  const headers = authHeaders()
  const pageSize = 15
  const warehouseEnabled = warehouseConfig.multiWarehouseEnabled
  const activeWarehouseId = warehouseEnabled ? warehouseId : ""

  async function loadLocations() {
    const res = await fetch(`${API}/api/v1/meta/locations`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")
    setLocations(Array.isArray(data.locations) ? data.locations : [])
  }

  async function loadWarehouses(selectedLocationId: string) {
    if (!selectedLocationId) {
      setWarehouses([])
      setWarehouseId("")
      setActiveWarehouseId("")
      return
    }
    const res = await fetch(`${API}/api/v1/meta/warehouses?locationId=${encodeURIComponent(selectedLocationId)}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")
    const items = Array.isArray(data.items) ? data.items : []
    setWarehouses(items)
    setWarehouseId((current) => {
      const nextWarehouseId =
        current && items.some((item: any) => item.id === current)
          ? current
          : warehouseConfig.autoSelectSingleWarehouse && items.length === 1
            ? String(items[0].id || "")
            : ""
      setActiveWarehouseId(nextWarehouseId)
      return nextWarehouseId
    })
  }

  async function loadGlobalStock() {
    const qs = new URLSearchParams()
    if (globalSearch.trim()) qs.set("q", globalSearch.trim())

    const res = await fetch(`${API}/api/v1/stock/global${qs.toString() ? `?${qs.toString()}` : ""}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")
    setGlobalStock(Array.isArray(data.items) ? data.items : [])
  }

  async function loadLots(selectedLocationId?: string) {
    const qs = new URLSearchParams()
    if (selectedLocationId) qs.set("locationId", selectedLocationId)
    if (activeWarehouseId) qs.set("warehouseId", activeWarehouseId)
    if (lotSearch.trim()) qs.set("q", lotSearch.trim())

    const res = await fetch(`${API}/api/v1/stock/lots${qs.toString() ? `?${qs.toString()}` : ""}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")
    setLots(Array.isArray(data.items) ? data.items : [])
  }

  async function loadMoves(selectedLocationId?: string, selectedPage = pagination.page) {
    setMovesLoading(true)

    try {
      const qs = new URLSearchParams()
      if (selectedLocationId) qs.set("locationId", selectedLocationId)
      if (activeWarehouseId) qs.set("warehouseId", activeWarehouseId)
      if (movesSearch.trim()) qs.set("q", movesSearch.trim())
      if (fromDate) qs.set("fromDate", fromDate)
      if (toDate) qs.set("toDate", toDate)
      qs.set("page", String(selectedPage))
      qs.set("limit", String(pagination.limit))

      const res = await fetch(`${API}/api/v1/stock/moves?${qs.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")

      setMoves(Array.isArray(data.items) ? data.items : [])
      setPagination({
        page: Number(data.pagination?.page || selectedPage || 1),
        limit: Number(data.pagination?.limit || pagination.limit || 20),
        total: Number(data.pagination?.total || 0),
        totalPages: Number(data.pagination?.totalPages || 1),
      })
    } finally {
      setMovesLoading(false)
    }
  }

  async function loadLocationStock(id: string) {
    if (!token) return
    if (!id) {
      setStock([])
      return
    }

    const qs = new URLSearchParams()
    qs.set("locationId", id)
    if (activeWarehouseId) qs.set("warehouseId", activeWarehouseId)
    if (stockSearch.trim()) qs.set("q", stockSearch.trim())

    const res = await fetch(`${API}/api/v1/stock/by-location?${qs.toString()}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("Token expirat sau invalid. Fa login din nou.")
    setStock(Array.isArray(data.items) ? data.items : [])
  }

  async function loadAll(selectedLocationId = locationId, selectedPage = 1) {
    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      return
    }

    setLoading(true)
    setError("")

    try {
      await Promise.all([loadLocations(), loadGlobalStock(), loadMoves(selectedLocationId, selectedPage), loadWarehouses(selectedLocationId), loadLots(selectedLocationId)])

      if (selectedLocationId) {
        await loadLocationStock(selectedLocationId)
      } else {
        setStock([])
      }
    } catch (e: any) {
      setError(e?.message || "Nu pot incarca stocul.")
      setLocations([])
      setGlobalStock([])
      setLots([])
      setMoves([])
      setStock([])
      setPagination({ page: 1, limit: 20, total: 0, totalPages: 1 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll(getActiveLocationId(), 1)
  }, [])

  useEffect(() => {
    return subscribeToActiveLocation((nextLocationId) => {
      setLocationId(nextLocationId)
    })
  }, [])

  useEffect(() => {
    return subscribeToActiveWarehouse((nextWarehouseId) => {
      setWarehouseId(nextWarehouseId)
    })
  }, [])

  useEffect(() => {
    return subscribeToWarehouseConfig((nextConfig) => {
      setWarehouseConfig(nextConfig)
    })
  }, [])

  useEffect(() => {
    if (!token) return

    setLoading(true)
    setError("")

    Promise.all([loadMoves(locationId, 1), locationId ? loadLocationStock(locationId) : Promise.resolve(setStock([])), loadWarehouses(locationId), loadLots(locationId)])
      .then(() => {
        setPagination((prev) => ({ ...prev, page: 1 }))
      })
      .catch((e: any) => {
        setError(e?.message || "Nu pot incarca stocul.")
        setMoves([])
        setLots([])
        setStock([])
      })
      .finally(() => setLoading(false))
  }, [locationId])

  useEffect(() => {
    if (!token) return
    loadGlobalStock().catch((e: any) => setError(e?.message || "Nu pot incarca stocul global."))
  }, [globalSearch])

  useEffect(() => {
    if (!token || !locationId) return
    loadLocationStock(locationId).catch((e: any) => setError(e?.message || "Nu pot incarca stocul pe locatie."))
  }, [stockSearch, activeWarehouseId, warehouseEnabled])

  useEffect(() => {
    if (!token) return
    loadLots(locationId).catch((e: any) => setError(e?.message || "Nu pot incarca loturile."))
  }, [lotSearch, locationId, activeWarehouseId, warehouseEnabled])

  useEffect(() => {
    if (!token) return

    const timeout = setTimeout(() => {
      loadMoves(locationId, 1).catch((e: any) => setError(e?.message || "Nu pot incarca miscarile de stoc."))
    }, 250)

    return () => clearTimeout(timeout)
  }, [movesSearch, fromDate, toDate, activeWarehouseId, warehouseEnabled])

  useEffect(() => {
    if (warehouseEnabled) return
    setWarehouseId("")
    setActiveWarehouseId("")
  }, [warehouseEnabled])

  const filteredGlobalStock = useMemo(() => globalStock, [globalStock])
  const filteredLocationStock = useMemo(() => stock, [stock])
  const filteredLots = useMemo(() => lots, [lots])
  const lowStockCount = useMemo(
    () => filteredLocationStock.filter((item) => Number(item?.qty || 0) <= 0).length,
    [filteredLocationStock]
  )

  const locationTotalPages = Math.max(1, Math.ceil(filteredLocationStock.length / pageSize))
  const globalTotalPages = Math.max(1, Math.ceil(filteredGlobalStock.length / pageSize))
  const lotTotalPages = Math.max(1, Math.ceil(filteredLots.length / pageSize))

  const pagedLocationStock = useMemo(
    () => filteredLocationStock.slice((locationPage - 1) * pageSize, locationPage * pageSize),
    [filteredLocationStock, locationPage]
  )

  const pagedGlobalStock = useMemo(
    () => filteredGlobalStock.slice((globalPage - 1) * pageSize, globalPage * pageSize),
    [filteredGlobalStock, globalPage]
  )

  const pagedLots = useMemo(
    () => filteredLots.slice((lotPage - 1) * pageSize, lotPage * pageSize),
    [filteredLots, lotPage]
  )

  useEffect(() => {
    setLocationPage(1)
  }, [locationId, stockSearch, filteredLocationStock.length])

  useEffect(() => {
    setGlobalPage(1)
  }, [globalSearch, filteredGlobalStock.length])

  useEffect(() => {
    setLotPage(1)
  }, [lotSearch, filteredLots.length, locationId, activeWarehouseId])

  function goToPage(nextPage: number) {
    if (nextPage < 1 || nextPage > pagination.totalPages) return
    loadMoves(locationId, nextPage).catch((e: any) => {
      setError(e?.message || "Nu pot incarca miscarile de stoc.")
    })
  }

  function handleWarehouseChange(nextWarehouseId: string) {
    setWarehouseId(nextWarehouseId)
    setActiveWarehouseId(nextWarehouseId)
  }

  return (
    <div className="space-y-3">
      <PageHeader badge="gestiune" title="Stoc" />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => loadAll(locationId, 1)} style={btnSecondary}>
            <RefreshCw size={15} />
            Reincarca
          </button>

          <button style={btnPrimary} onClick={() => navigate("/inregistrare-document/nir/new")}>
            Intrare marfa
          </button>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <Card title="Produse" value={filteredGlobalStock.length} icon={<Boxes size={16} />} />
        <Card title="Miscari" value={pagination.total} icon={<ArrowRightLeft size={16} />} />
        <Card title="Locatii" value={locations.length} icon={<ClipboardList size={16} />} />
        <Card title="Fara stoc" value={lowStockCount} icon={<SearchDot />} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveSection("location")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeSection === "location"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Stoc pe locatie
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("global")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeSection === "global"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Stoc global
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("lots")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeSection === "lots"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Loturi
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("moves")}
          className={`inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[13px] font-semibold transition ${
            activeSection === "moves"
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Miscari
        </button>
      </div>

      {activeSection === "location" ? (
        <Section
          title="Stoc pe locatie"
          actions={
            <div className="min-w-[220px] md:w-[320px]">
              <input
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="Cauta in locatia activa..."
                style={filterInput}
                disabled={!locationId}
              />
            </div>
          }
        >
          <div style={filterBar}>
            <span style={infoChip}>{locationId ? "Locatia activa din topbar" : "Alege o locatie din topbar"}</span>
            {locationId && warehouseEnabled ? (
              <select value={warehouseId} onChange={(e) => handleWarehouseChange(e.target.value)} style={compactSelect}>
                <option value="">Toate gestiunile</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            ) : null}
            <span style={infoChip}>{filteredLocationStock.length} produse</span>
          </div>

          {locationId === "" ? (
            <Empty text="Alege o locatie din topbar." />
          ) : filteredLocationStock.length === 0 ? (
            <Empty text="Nu exista produse pentru aceasta locatie." />
          ) : (
            <>
              <Table
                headers={["Produs", "SKU", "UM", "Gestiune", "Stoc", "Status"]}
                rows={pagedLocationStock.map((s) => [
                  s.name,
                  s.sku,
                  s.uom,
                  s.warehouseName || "-",
                  formatQtyRo(Number(s.qty || 0), 3),
                  <span style={{ ...typeBadge, ...(Number(s.qty || 0) > 0 ? typeIn : typeOut) }}>
                    {Number(s.qty || 0) > 0 ? "In stoc" : "Fara stoc"}
                  </span>,
                ])}
              />
              <div style={paginationBar}>
                <div style={paginationInfo}>
                  Pagina {locationPage} din {locationTotalPages} • total produse: {filteredLocationStock.length}
                </div>
                <div style={paginationActions}>
                  <button onClick={() => setLocationPage(1)} style={btnSecondarySmall} disabled={locationPage <= 1}>Prima</button>
                  <button onClick={() => setLocationPage((prev) => Math.max(1, prev - 1))} style={btnSecondarySmall} disabled={locationPage <= 1}>Anterioara</button>
                  <button onClick={() => setLocationPage((prev) => Math.min(locationTotalPages, prev + 1))} style={btnSecondarySmall} disabled={locationPage >= locationTotalPages}>Urmatoarea</button>
                  <button onClick={() => setLocationPage(locationTotalPages)} style={btnSecondarySmall} disabled={locationPage >= locationTotalPages}>Ultima</button>
                </div>
              </div>
            </>
          )}
        </Section>
      ) : activeSection === "global" ? (
        <Section
          title="Stoc global"
          actions={
            <div className="flex min-w-[220px] items-center gap-2 md:w-[320px]">
              <input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Cauta in stocul global..."
                style={filterInput}
              />
            </div>
          }
        >
          <div style={filterBar}>
            <span style={infoChip}>{filteredGlobalStock.length} produse</span>
          </div>

          {filteredGlobalStock.length === 0 ? (
            <Empty text="Nu exista produse in stoc." />
          ) : (
            <>
              <Table
                headers={["Produs", "SKU", "UM", "Stoc total"]}
                rows={pagedGlobalStock.map((s) => [
                  s.name,
                  s.sku,
                  s.uom,
                  formatQtyRo(Number(s.totalQty || 0), 3),
                ])}
              />
              <div style={paginationBar}>
                <div style={paginationInfo}>
                  Pagina {globalPage} din {globalTotalPages} • total produse: {filteredGlobalStock.length}
                </div>
                <div style={paginationActions}>
                  <button onClick={() => setGlobalPage(1)} style={btnSecondarySmall} disabled={globalPage <= 1}>Prima</button>
                  <button onClick={() => setGlobalPage((prev) => Math.max(1, prev - 1))} style={btnSecondarySmall} disabled={globalPage <= 1}>Anterioara</button>
                  <button onClick={() => setGlobalPage((prev) => Math.min(globalTotalPages, prev + 1))} style={btnSecondarySmall} disabled={globalPage >= globalTotalPages}>Urmatoarea</button>
                  <button onClick={() => setGlobalPage(globalTotalPages)} style={btnSecondarySmall} disabled={globalPage >= globalTotalPages}>Ultima</button>
                </div>
              </div>
            </>
          )}
        </Section>
      ) : activeSection === "lots" ? (
        <Section
          title="Loturi disponibile"
          actions={
            <div className="min-w-[220px] md:w-[320px]">
              <input
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
                placeholder="Cauta dupa produs, SKU sau lot..."
                style={filterInput}
              />
            </div>
          }
        >
          <div style={filterBar}>
            <span style={infoChip}>{filteredLots.length} loturi</span>
            {warehouseEnabled ? (
              <select value={warehouseId} onChange={(e) => handleWarehouseChange(e.target.value)} style={compactSelect}>
                <option value="">Toate gestiunile</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            ) : null}
          </div>

          {filteredLots.length === 0 ? (
            <Empty text="Nu exista loturi disponibile pentru filtrele selectate." />
          ) : (
            <>
              <Table
                headers={["Produs", "Lot", "Expira", "Locatie", "Gestiune", "Cant. initiala", "Cant. ramasa", "Cost unitar", "Valoare ramasa"]}
                rows={pagedLots.map((lot) => [
                  <div>
                    <div style={{ fontWeight: 700 }}>{lot.productName}</div>
                    <div style={{ color: "#64748b", fontSize: 12 }}>{lot.sku || "-"}</div>
                  </div>,
                  lot.lotNo,
                  lot.expiryDate ? new Date(lot.expiryDate).toLocaleDateString("ro-RO") : "-",
                  lot.locationName || "-",
                  lot.warehouseName || "-",
                  `${formatQtyRo(Number(lot.initialQty || 0), 3)} ${lot.uom || ""}`.trim(),
                  `${formatQtyRo(Number(lot.remainingQty || 0), 3)} ${lot.uom || ""}`.trim(),
                  formatRon(Number(lot.unitCost || 0)),
                  formatRon(Number(lot.totalRemainingValue || 0)),
                ])}
              />
              <div style={paginationBar}>
                <div style={paginationInfo}>
                  Pagina {lotPage} din {lotTotalPages} • total loturi: {filteredLots.length}
                </div>
                <div style={paginationActions}>
                  <button onClick={() => setLotPage(1)} style={btnSecondarySmall} disabled={lotPage <= 1}>Prima</button>
                  <button onClick={() => setLotPage((prev) => Math.max(1, prev - 1))} style={btnSecondarySmall} disabled={lotPage <= 1}>Anterioara</button>
                  <button onClick={() => setLotPage((prev) => Math.min(lotTotalPages, prev + 1))} style={btnSecondarySmall} disabled={lotPage >= lotTotalPages}>Urmatoarea</button>
                  <button onClick={() => setLotPage(lotTotalPages)} style={btnSecondarySmall} disabled={lotPage >= lotTotalPages}>Ultima</button>
                </div>
              </div>
            </>
          )}
        </Section>
      ) : (
        <Section title="Miscari stoc">
          <div style={movesFiltersWrap}>
            <div style={movesFiltersGrid}>
              <div style={filterField}>
                <label style={filterLabel}>Cauta</label>
                <input
                  value={movesSearch}
                  onChange={(e) => setMovesSearch(e.target.value)}
                  placeholder="Produs, SKU, nota, document..."
                  style={filterInput}
                />
              </div>

              <div style={filterField}>
                <label style={filterLabel}>De la</label>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={filterInput} />
              </div>

              <div style={filterField}>
                <label style={filterLabel}>Pana la</label>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={filterInput} />
              </div>

              {warehouseEnabled ? <div style={filterField}>
                <label style={filterLabel}>Gestiune</label>
                <select value={warehouseId} onChange={(e) => handleWarehouseChange(e.target.value)} style={filterInput}>
                  <option value="">Toate gestiunile</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </div> : null}
            </div>
          </div>

          {moves.length === 0 ? (
            <Empty text="Nu exista miscari de stoc." />
          ) : (
            <>
              <div style={movesTableWrap}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>Data</th>
                      <th style={th}>Produs</th>
                      <th style={th}>SKU</th>
                      <th style={th}>UM</th>
                      <th style={th}>Locatie</th>
                      <th style={th}>Gestiune</th>
                      <th style={th}>Lot</th>
                      <th style={th}>Tip</th>
                      <th style={th}>Cantitate</th>
                      <th style={th}>Cost</th>
                      <th style={th}>Valoare</th>
                      <th style={th}>Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moves.map((m) => (
                      <tr key={m.id}>
                        <td style={td}>{new Date(m.createdAt).toLocaleString("ro-RO")}</td>
                        <td style={td}>{m.productName}</td>
                        <td style={td}>{m.sku}</td>
                        <td style={td}>{m.uom}</td>
                        <td style={td}>{m.locationName}</td>
                        <td style={td}>{m.warehouseName || "-"}</td>
                        <td style={td}>
                          {m.lotNo ? (
                            <div>
                              <div>{m.lotNo}</div>
                              <div style={{ color: "#64748b", fontSize: 12 }}>
                                {m.expiryDate ? new Date(m.expiryDate).toLocaleDateString("ro-RO") : "fara expirare"}
                              </div>
                            </div>
                          ) : "-"}
                        </td>
                        <td style={td}>
                          <span style={{ ...typeBadge, ...(m.type === "IN" ? typeIn : m.type === "OUT" ? typeOut : typeNeutral) }}>
                            {m.type}
                          </span>
                        </td>
                        <td style={td}>{formatQtyRo(Number(m.qty || 0), 3)}</td>
                        <td style={td}>{formatRon(Number(m.unitCost || 0))}</td>
                        <td style={td}>{formatRon(Number(m.totalValue || 0))}</td>
                        <td style={td}>{m.note || `${m.refType || "-"} ${m.refId || ""}`.trim()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={paginationBar}>
                <div style={paginationInfo}>
                  Pagina {pagination.page} din {pagination.totalPages} • total miscari: {pagination.total}
                </div>
                <div style={paginationActions}>
                  <button onClick={() => goToPage(1)} style={btnSecondarySmall} disabled={pagination.page <= 1 || movesLoading}>Prima</button>
                  <button onClick={() => goToPage(pagination.page - 1)} style={btnSecondarySmall} disabled={pagination.page <= 1 || movesLoading}>Anterioara</button>
                  <button onClick={() => goToPage(pagination.page + 1)} style={btnSecondarySmall} disabled={pagination.page >= pagination.totalPages || movesLoading}>Urmatoarea</button>
                  <button onClick={() => goToPage(pagination.totalPages)} style={btnSecondarySmall} disabled={pagination.page >= pagination.totalPages || movesLoading}>Ultima</button>
                </div>
              </div>
            </>
          )}
        </Section>
      )}

      {(loading || movesLoading) && <p style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>Se incarca...</p>}
    </div>
  )
}

function Card({ title, value, icon }: any) {
  return (
    <div style={metricCard}>
      <div style={metricHead}>
        <span style={metricIcon}>{icon}</span>
        <span style={metricTitle}>{title}</span>
      </div>
      <div style={metricValue}>{value}</div>
    </div>
  )
}

function Section({ title, actions, children }: any) {
  return (
    <div style={sectionWrap}>
      <div style={sectionHead}>
        <h2 style={sectionTitle}>{title}</h2>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

function Table({ headers, rows }: any) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {headers.map((h: string) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i}>
              {r.map((c: any, j: number) => (
                <td key={j} style={td}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Empty({ text }: any) {
  return <div style={emptyBox}>{text}</div>
}

function SearchDot() {
  return <span style={{ fontSize: 16, lineHeight: 1 }}>•</span>
}

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 15px",
  borderRadius: 12,
  border: "none",
  background: "#17324D",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
}

const btnSecondary = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 15px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "white",
  cursor: "pointer",
  fontWeight: 600,
  color: "#0f172a",
  fontSize: 13,
}

const btnSecondarySmall = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "white",
  cursor: "pointer",
  fontWeight: 600,
  color: "#0f172a",
  fontSize: 13,
}

const errorBox = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 12,
  padding: 12,
}

const tableWrap = {
  overflowX: "auto" as const,
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  background: "#fff",
}

const movesTableWrap = {
  overflowX: "auto" as const,
  overflowY: "auto" as const,
  maxHeight: 420,
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  background: "#fff",
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  minWidth: 860,
}

const th = {
  textAlign: "left" as const,
  padding: "9px 10px",
  borderBottom: "1px solid #ddd",
  background: "#f8fafc",
  position: "sticky" as const,
  top: 0,
  zIndex: 1,
  fontSize: 12,
  fontWeight: 700,
  color: "#64748b",
}

const td = {
  padding: "9px 10px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top" as const,
  fontSize: 13,
  color: "#0f172a",
}

const filterBar = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
  flexWrap: "wrap" as const,
}

const filterInput = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 13,
  boxSizing: "border-box" as const,
}

const compactSelect = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  outline: "none",
  fontSize: 13,
  color: "#0f172a",
}

const movesFiltersWrap = {
  marginBottom: 12,
}

const movesFiltersGrid = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr 1fr 1fr",
  gap: 10,
}

const filterField = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 5,
}

const filterLabel = {
  fontSize: 12,
  fontWeight: 600,
  color: "#475569",
}

const paginationBar = {
  marginTop: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap" as const,
}

const paginationInfo = {
  fontSize: 13,
  color: "#475569",
}

const paginationActions = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
}

const typeBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 70,
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
}

const typeIn = {
  background: "#dcfce7",
  color: "#166534",
}

const typeOut = {
  background: "#fee2e2",
  color: "#991b1b",
}

const typeNeutral = {
  background: "#e2e8f0",
  color: "#334155",
}

const metricCard = {
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 14,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const metricHead = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
}

const metricIcon = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: 999,
  background: "#f8fafc",
  color: "#17324D",
}

const metricTitle = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 600,
}

const metricValue = {
  fontSize: 28,
  fontWeight: 700,
  color: "#0f172a",
  lineHeight: 1.1,
}

const sectionWrap = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
}

const sectionHead = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap" as const,
  marginBottom: 12,
}

const sectionTitle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  color: "#0f172a",
}

const emptyBox = {
  padding: 16,
  border: "1px dashed #cbd5e1",
  borderRadius: 14,
  color: "#64748b",
  background: "#f8fafc",
  fontSize: 13,
}

const infoChip = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#475569",
  fontSize: 12,
  fontWeight: 600,
}

