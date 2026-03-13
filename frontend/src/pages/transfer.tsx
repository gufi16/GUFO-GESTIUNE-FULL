import { useEffect, useMemo, useState } from "react"

const API = "http://localhost:3001"

function makeLine() {
  return {
    id: crypto.randomUUID(),
    productId: "",
    search: "",
    sku: "",
    uomCode: "",
    qty: "1",
    unitPrice: "0"
  }
}

function ensureArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function getTransferIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get("id") || ""
}

function formatNumber(value: any) {
  return Number(value || 0).toFixed(2)
}

export default function TransferPage() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const transferId = getTransferIdFromUrl()

  const [locations, setLocations] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("DRAFT")
  const [error, setError] = useState("")

  const [header, setHeader] = useState({
    fromLocationId: "",
    toLocationId: "",
    docNo: "",
    docDate: new Date().toISOString().slice(0, 10),
    reason: "",
    note: "",
    delegateName: "",
    delegateCi: "",
    vehicle: "",
    vehicleNo: "",
    senderName: "",
    receiverName: "",
    approvedBy: ""
  })

  const [lines, setLines] = useState<any[]>([makeLine()])

  useEffect(() => {
    loadMeta()
  }, [])

  useEffect(() => {
    if (transferId) loadDoc()
  }, [transferId])

  async function loadMeta() {
    if (!token) return
    setLoadingMeta(true)
    setError("")

    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [locRes, prodRes] = await Promise.all([
        fetch(`${API}/api/v1/meta/locations`, { headers }),
        fetch(`${API}/api/v1/products`, { headers })
      ])

      const locData = await locRes.json().catch(() => ({}))
      const prodData = await prodRes.json().catch(() => ({}))

      if (locRes.status === 401 || prodRes.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      setLocations(ensureArray(locData.locations))
      setProducts(ensureArray(prodData.items))
    } catch {
      setError("Nu pot încărca datele pentru transfer.")
    } finally {
      setLoadingMeta(false)
    }
  }

  async function loadDoc() {
    if (!token || !transferId) return
    setLoadingDoc(true)
    setError("")

    try {
      const res = await fetch(`${API}/api/v1/transfers/${transferId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setError("Token expirat sau invalid. Fă login din nou.")
        return
      }

      if (!data.ok || !data.doc) {
        setError(data.error || "Nu pot încărca transferul.")
        return
      }

      const doc = data.doc
      setStatus(doc.status || "DRAFT")

      setHeader({
        fromLocationId: doc.fromLocationId || "",
        toLocationId: doc.toLocationId || "",
        docNo: doc.docNo || "",
        docDate: String(doc.docDate || "").slice(0, 10),
        reason: doc.reason || "",
        note: doc.note || "",
        delegateName: doc.delegateName || "",
        delegateCi: doc.delegateCi || "",
        vehicle: doc.vehicle || "",
        vehicleNo: doc.vehicleNo || "",
        senderName: doc.senderName || "",
        receiverName: doc.receiverName || "",
        approvedBy: doc.approvedBy || ""
      })

      const loadedLines = ensureArray(doc.items).map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        productId: item.productId,
        search: item.product?.name || "",
        sku: item.product?.sku || "",
        uomCode: item.uom?.code || item.product?.uom?.code || "",
        qty: String(item.qty ?? 1),
        unitPrice: String(item.unitPrice ?? 0)
      }))

      setLines(loadedLines.length ? loadedLines : [makeLine()])
    } catch {
      setError("Nu pot încărca transferul.")
    } finally {
      setLoadingDoc(false)
    }
  }

  function setLineValue(id: string, patch: any) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()])
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const next = prev.filter((x) => x.id !== id)
      return next.length ? next : [makeLine()]
    })
  }

  function productMatches(search: string) {
    const q = String(search || "").trim().toLowerCase()
    if (q.length < 2) return []
    return products
      .filter((p: any) => {
        const name = String(p.name || "").toLowerCase()
        const sku = String(p.sku || "").toLowerCase()
        return name.includes(q) || sku.includes(q)
      })
      .slice(0, 8)
  }

  function chooseProduct(lineId: string, product: any) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              productId: product.id,
              search: product.name,
              sku: product.sku || "",
              uomCode: product.uom?.code || "",
              unitPrice: String(product.price ?? 0)
            }
          : line
      )
    )
  }

  const validLines = useMemo(() => {
    return lines.filter((l) => l.productId && Number(l.qty || 0) > 0)
  }, [lines])

  const totals = useMemo(() => {
    return validLines.reduce(
      (acc, line) => {
        const qty = Number(line.qty || 0)
        const unitPrice = Number(line.unitPrice || 0)
        acc.totalQty += qty
        acc.totalValue += qty * unitPrice
        return acc
      },
      { totalQty: 0, totalValue: 0 }
    )
  }, [validLines])

  const isPosted = status === "POSTED"

  async function saveDoc(postNow = false) {
    if (!token) {
      alert("Nu există token de autentificare.")
      return
    }

    if (isPosted) {
      alert("Documentul POSTED este read-only.")
      return
    }

    if (!header.fromLocationId) {
      alert("Selectează gestiunea predătoare.")
      return
    }

    if (!header.toLocationId) {
      alert("Selectează gestiunea primitoare.")
      return
    }

    if (header.fromLocationId === header.toLocationId) {
      alert("Gestiunile trebuie să fie diferite.")
      return
    }

    if (!header.docNo.trim()) {
      alert("Completează nr. document.")
      return
    }

    if (!header.docDate) {
      alert("Completează data document.")
      return
    }

    if (!validLines.length) {
      alert("Adaugă cel puțin un produs.")
      return
    }

    setSaving(true)

    try {
      const res = await fetch(`${API}/api/v1/transfers/full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: transferId || null,
          header,
          items: validLines.map((l) => ({
            productId: l.productId,
            qty: Number(l.qty || 0),
            unitPrice: Number(l.unitPrice || 0)
          })),
          postNow
        })
      })

      const data = await res.json().catch(() => ({}))
      setSaving(false)

      if (res.status === 401) {
        alert("Token expirat sau invalid.")
        return
      }

      if (!data.ok) {
        alert(data.error || "Eroare la salvarea transferului.")
        return
      }

      if (!transferId && data.doc?.id) {
        window.location.href = `/transfer/edit?id=${data.doc.id}`
        return
      }

      setStatus(data.doc?.status || (postNow ? "POSTED" : "DRAFT"))
      alert(postNow ? "Transfer salvat și postat." : "Transfer salvat.")

      if (transferId) {
        await loadDoc()
      }
    } catch {
      setSaving(false)
      alert("Eroare la salvarea transferului.")
    }
  }

  async function exportPdf() {
    if (!transferId) {
      alert("Salvează documentul înainte.")
      return
    }

    const res = await fetch(`${API}/api/v1/transfers/${transferId}/pdf`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    if (!res.ok) {
      alert("Nu pot genera PDF.")
      return
    }

    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `TRANSFER_${header.docNo || "document"}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>
            {!transferId ? "Transfer nou" : isPosted ? "Vizualizare transfer" : "Editare transfer"}
          </h1>
          <p style={{ color: "#666", marginTop: 6 }}>
            Notă de transfer / transfer între gestiuni
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/transfer" style={{ textDecoration: "none" }}>
            <button style={btnSecondary}>Înapoi la listă</button>
          </a>

          <button style={btnSecondary} onClick={exportPdf} disabled={!transferId || loadingDoc}>
            Export PDF
          </button>

          {!isPosted && (
            <>
              <button style={btnSecondary} onClick={() => saveDoc(false)} disabled={saving || loadingDoc}>
                {saving ? "Se salvează..." : "Salvează draft"}
              </button>

              <button style={btnPrimary} onClick={() => saveDoc(true)} disabled={saving || loadingDoc}>
                {saving ? "Se salvează..." : "Salvează și postează"}
              </button>
            </>
          )}
        </div>
      </div>

      {status && <div style={{ marginBottom: 14 }}><StatusBadge status={status} /></div>}
      {error && <div style={errorBox}>{error}</div>}
      {loadingDoc && <div style={infoBox}>Se încarcă documentul...</div>}

      <Section title="Antet document">
        <div style={grid2}>
          <Field label="Gestiune predătoare">
            <select value={header.fromLocationId} onChange={(e) => setHeader({ ...header, fromLocationId: e.target.value })} style={input} disabled={isPosted}>
              <option value="">Selectează</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Gestiune primitoare">
            <select value={header.toLocationId} onChange={(e) => setHeader({ ...header, toLocationId: e.target.value })} style={input} disabled={isPosted}>
              <option value="">Selectează</option>
              {locations.filter((l) => l.id !== header.fromLocationId).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Nr. document">
            <input value={header.docNo} onChange={(e) => setHeader({ ...header, docNo: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Data document">
            <input type="date" value={header.docDate} onChange={(e) => setHeader({ ...header, docDate: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Motiv transfer">
            <input value={header.reason} onChange={(e) => setHeader({ ...header, reason: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Observații">
            <input value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Delegat / Transportator">
            <input value={header.delegateName} onChange={(e) => setHeader({ ...header, delegateName: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="CI / BI">
            <input value={header.delegateCi} onChange={(e) => setHeader({ ...header, delegateCi: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Mijloc transport">
            <input value={header.vehicle} onChange={(e) => setHeader({ ...header, vehicle: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Nr. auto">
            <input value={header.vehicleNo} onChange={(e) => setHeader({ ...header, vehicleNo: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Am predat">
            <input value={header.senderName} onChange={(e) => setHeader({ ...header, senderName: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Am primit">
            <input value={header.receiverName} onChange={(e) => setHeader({ ...header, receiverName: e.target.value })} style={input} disabled={isPosted} />
          </Field>

          <Field label="Avizat">
            <input value={header.approvedBy} onChange={(e) => setHeader({ ...header, approvedBy: e.target.value })} style={input} disabled={isPosted} />
          </Field>
        </div>
      </Section>

      <Section title="Linii transfer">
        {!isPosted && (
          <div style={{ marginBottom: 12 }}>
            <button style={btnPrimary} onClick={addLine}>+ Adaugă linie</button>
          </div>
        )}

        {lines.map((line) => {
          const matches = productMatches(line.search)
          const lineValue = Number(line.qty || 0) * Number(line.unitPrice || 0)

          return (
            <div key={line.id} style={lineCard}>
              <div style={gridLine}>
                <CompactField label="Produs">
                  <input
                    value={line.search}
                    onChange={(e) => setLineValue(line.id, { search: e.target.value, productId: "" })}
                    style={inputCompact}
                    disabled={isPosted}
                  />
                </CompactField>

                <CompactField label="Cod">
                  <input value={line.sku} readOnly style={{ ...inputCompact, background: "#f9fafb" }} />
                </CompactField>

                <CompactField label="UM">
                  <input value={line.uomCode} readOnly style={{ ...inputCompact, background: "#f9fafb" }} />
                </CompactField>

                <CompactField label="Cantitate">
                  <input value={line.qty} onChange={(e) => setLineValue(line.id, { qty: e.target.value })} style={inputCompact} disabled={isPosted} />
                </CompactField>

                <CompactField label="Preț">
                  <input value={line.unitPrice} onChange={(e) => setLineValue(line.id, { unitPrice: e.target.value })} style={inputCompact} disabled={isPosted} />
                </CompactField>

                <CompactField label="Valoare">
                  <input value={formatNumber(lineValue)} readOnly style={{ ...inputCompact, background: "#f9fafb", fontWeight: 600 }} />
                </CompactField>

                <div style={{ paddingTop: 22 }}>
                  {!isPosted && <button style={btnDangerSmall} onClick={() => removeLine(line.id)}>Șterge</button>}
                </div>
              </div>

              {line.search.trim().length >= 2 && !line.productId && !isPosted && (
                <div style={{ marginTop: 10 }}>
                  {matches.length > 0 ? (
                    <div style={resultsBox}>
                      {matches.map((p: any) => (
                        <button key={p.id} type="button" style={resultBtn} onClick={() => chooseProduct(line.id, p)}>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            {p.sku} · UM {p.uom?.code || "-"} · Preț {formatNumber(p.price)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#991b1b", fontSize: 13 }}>Nu există produse găsite pentru „{line.search}”.</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Section>

      <Section title="Totaluri">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card title="Total cantități" value={formatNumber(totals.totalQty)} />
          <Card title="Total valoare" value={`${formatNumber(totals.totalValue)} lei`} />
        </div>
      </Section>
    </div>
  )
}

function Field({ label, children }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 14, color: "#555" }}>{label}</label>
      {children}
    </div>
  )
}

function CompactField({ label, children }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={{ fontSize: 12, color: "#666" }}>{label}</label>
      {children}
    </div>
  )
}

function Section({ title, children }: any) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  )
}

function Card({ title, value }: any) {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 14, minWidth: 180, background: "#fafafa" }}>
      <div style={{ fontSize: 13, color: "#666" }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: any = {
    DRAFT: { bg: "#fff7ed", color: "#9a3412" },
    POSTED: { bg: "#ecfdf5", color: "#166534" },
    CANCELLED: { bg: "#f3f4f6", color: "#374151" }
  }
  const s = map[status] || { bg: "#f3f4f6", color: "#111827" }

  return (
    <span style={{ background: s.bg, color: s.color, padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  )
}

const errorBox: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
  padding: 12,
  marginBottom: 20
}

const infoBox: React.CSSProperties = {
  border: "1px solid #dbeafe",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 10,
  padding: 12,
  marginBottom: 20
}

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14
}

const gridLine: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 2.2fr) 110px 70px 100px 100px 110px 70px",
  gap: 8,
  alignItems: "end"
}

const lineCard: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
  background: "#fff"
}

const resultsBox: React.CSSProperties = {
  display: "grid",
  gap: 8
}

const resultBtn: React.CSSProperties = {
  textAlign: "left",
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 10,
  padding: 10,
  cursor: "pointer"
}

const input: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
  width: "100%",
  boxSizing: "border-box"
}

const inputCompact: React.CSSProperties = {
  padding: "8px 9px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontSize: 13
}

const btnPrimary: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer"
}

const btnSecondary: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer"
}

const btnDangerSmall: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  cursor: "pointer",
  fontSize: 12,
  width: "100%"
}