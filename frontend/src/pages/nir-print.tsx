import { useEffect, useMemo, useRef, useState } from "react"
import { API_BASE as API, getToken, authHeaders } from "../lib/api"
import { formatNumberRo } from "../lib/format"


type PrintRow = {
  no: number
  type: "PRODUCT" | "SGR"
  productName: string
  qty: number
  uom: string
  unitCostNetFc: number
  vatRateValue: number
  lineNetFc: number
  lineVatFc: number
  lineGrossFc: number
  lineGrossRon: number
}

function getParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    id: params.get("id") || "",
    mode: params.get("mode") || "print"
  }
}

function formatNumber(value: any, digits = 2) {
  return formatNumberRo(value, digits)
}

function formatDate(value: any) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("ro-RO")
}

function sanitizeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
}

function textOrDash(value: any) {
  const text = String(value || "").trim()
  return text || "-"
}

function toNumber(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default function NirPrintPage() {
  const token =
    getToken() || ""

  const { id: receiptId, mode } = getParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [autoStarted, setAutoStarted] = useState(false)

  const shouldAutoCloseRef = useRef(false)
  const originalTitleRef = useRef(document.title)

  useEffect(() => {
    loadData()
  }, [receiptId])

  useEffect(() => {
    if (!loading && !error && receipt && !autoStarted) {
      const supplierName = receipt?.supplier?.name || receipt?.supplierName || "Furnizor"
      const docNo = receipt?.docNo || "document"

      const safeSupplier = sanitizeFilePart(supplierName)
      const safeDocNo = sanitizeFilePart(docNo)

      document.title = `NIR_${safeDocNo}_${safeSupplier}.pdf`

      setAutoStarted(true)

      setTimeout(() => {
        shouldAutoCloseRef.current = true
        window.print()
      }, 350)
    }
  }, [loading, error, receipt, autoStarted])

  useEffect(() => {
    const handleAfterPrint = () => {
      document.title = originalTitleRef.current

      if (shouldAutoCloseRef.current) {
        window.close()
      }
    }

    window.addEventListener("afterprint", handleAfterPrint)
    return () => {
      window.removeEventListener("afterprint", handleAfterPrint)
      document.title = originalTitleRef.current
    }
  }, [])

  async function loadData() {
    if (!receiptId) {
      setError("Lipseste id-ul documentului.")
      setLoading(false)
      return
    }

    if (!token) {
      setError("Nu exista token de autentificare. Fa login din nou.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`
      }

      const [receiptRes, companyRes] = await Promise.all([
        fetch(`${API}/api/v1/purchase-receipts/${receiptId}`, { headers }),
        fetch(`${API}/api/v1/company`, { headers })
      ])

      const receiptData = await receiptRes.json().catch(() => ({}))
      const companyData = await companyRes.json().catch(() => ({}))

      if (receiptRes.status === 401 || companyRes.status === 401) {
        setError("Token expirat sau invalid. Fa login din nou.")
        setLoading(false)
        return
      }

      if (!receiptData.ok || !receiptData.receipt) {
        setError(receiptData.error || "Nu pot incarca documentul NIR.")
        setLoading(false)
        return
      }

      setReceipt(receiptData.receipt)
      setCompany(companyData?.company || null)
    } catch {
      setError("Nu pot incarca documentul pentru print.")
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo<PrintRow[]>(() => {
    const items = Array.isArray(receipt?.items) ? receipt.items : []
    const builtRows: PrintRow[] = []

    items.forEach((item: any) => {
      const qty = toNumber(item.qty)
      const unitCostNetFc = toNumber(item.unitCostNetFc)
      const vatRateValue = toNumber(item.vatRateValue)
      const lineNetFc = toNumber(item.lineNetFc || qty * unitCostNetFc)
      const lineVatFc = toNumber(item.lineVatFc || (lineNetFc * vatRateValue) / 100)
      const lineGrossFc = toNumber(item.lineGrossFc || lineNetFc + lineVatFc)
      const lineGrossRon = toNumber(item.lineGrossRon || lineGrossFc)

      builtRows.push({
        no: 0,
        type: "PRODUCT",
        productName: textOrDash(item.product?.name),
        qty,
        uom: item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code || "-",
        unitCostNetFc,
        vatRateValue,
        lineNetFc,
        lineVatFc,
        lineGrossFc,
        lineGrossRon
      })

      const isSgr = Boolean(item.product?.isSgr)
      const sgrUnit = isSgr ? toNumber(item.product?.sgrValue || 0.5) : 0
      const sgrNetFc = qty * sgrUnit
      const sgrGrossFc = sgrNetFc
      const sgrGrossRon = sgrGrossFc * toNumber(receipt?.fxRate || 1)

      if (isSgr && sgrNetFc > 0) {
        builtRows.push({
          no: 0,
          type: "SGR",
          productName: "SGR",
          qty,
          uom: item.uom?.code || item.product?.purchaseUom?.code || item.product?.uom?.code || "-",
          unitCostNetFc: sgrUnit,
          vatRateValue: 0,
          lineNetFc: sgrNetFc,
          lineVatFc: 0,
          lineGrossFc: sgrGrossFc,
          lineGrossRon: sgrGrossRon
        })
      }
    })

    return builtRows.map((row, index) => ({
      ...row,
      no: index + 1
    }))
  }, [receipt])

  const currency = receipt?.currency || "RON"
  const isRon = currency === "RON"
  const supplierName = receipt?.supplier?.name || receipt?.supplierName || "-"
  const supplierCode = receipt?.supplier?.code || receipt?.supplierCode || "-"
  const fxRate = Number(receipt?.fxRate || 1)

  const totalSgrFc = useMemo(() => {
    return rows
      .filter((row) => row.type === "SGR")
      .reduce((sum, row) => sum + toNumber(row.lineGrossFc), 0)
  }, [rows])

  const totalSgrRon = useMemo(() => {
    return rows
      .filter((row) => row.type === "SGR")
      .reduce((sum, row) => sum + toNumber(row.lineGrossRon), 0)
  }, [rows])

  const totalWithSgrFc = toNumber(receipt?.totalGrossFc) + totalSgrFc
  const totalWithSgrRon = toNumber(receipt?.totalGrossRon) + totalSgrRon

  function printAgain() {
    shouldAutoCloseRef.current = false
    window.print()
  }

  return (
    <div style={{ padding: 20, background: "#fff", minHeight: "100vh" }}>
      <style>{`
        @page {
          size: A4 landscape;
          margin: 9mm;
        }

        html, body {
          background: #fff;
          margin: 0;
          padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
        }

        * {
          box-sizing: border-box;
        }

        .print-sheet {
          width: 100%;
        }

        .header-block {
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .meta-block {
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .table-block {
          page-break-inside: auto;
          break-inside: auto;
        }

        .totals-block {
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .signature-block-print {
          page-break-inside: avoid;
          break-inside: avoid;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          page-break-inside: auto;
          break-inside: auto;
        }

        thead {
          display: table-header-group;
        }

        tfoot {
          display: table-footer-group;
        }

        tr {
          page-break-inside: avoid;
          break-inside: avoid;
          page-break-after: auto;
        }

        td, th {
          page-break-inside: avoid;
          break-inside: avoid;
        }

        @media print {
          .no-print {
            display: none !important;
          }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .print-root {
            padding: 0 !important;
            min-height: auto !important;
          }

          .print-sheet {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
          }

          .document-border {
            border: 1.5px solid #111 !important;
            padding: 10px !important;
          }

          .header-block {
            margin-bottom: 8px !important;
          }

          .meta-block {
            margin-bottom: 8px !important;
          }

          .table-block {
            margin-bottom: 8px !important;
          }

          .totals-block {
            margin-top: 8px !important;
          }

          .signature-block-print {
            margin-top: 18px !important;
          }
        }
      `}</style>

      <div className="print-root" style={{ padding: 20, background: "#fff", minHeight: "100vh" }}>
        <div className="no-print" style={{ marginBottom: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={printAgain} style={btnPrimary} disabled={loading || !!error || !receipt}>
            {mode === "pdf" ? "Export PDF" : "Printeaza"}
          </button>

          <button onClick={() => window.close()} style={btnSecondary}>
            Inchide
          </button>
        </div>

        {loading ? (
          <div style={infoBox}>Se incarca documentul pentru {mode === "pdf" ? "export PDF" : "print"}...</div>
        ) : error ? (
          <div style={errorBox}>{error}</div>
        ) : (
          <div style={sheet} className="print-sheet">
            <div style={documentBorder} className="document-border">
              <div style={headerGrid} className="header-block">
                <div style={companyPanel}>
                  <div style={companyNameStyle}>{textOrDash(company?.name)}</div>
                  <div><b>CUI:</b> {textOrDash(company?.cui)}</div>
                  <div><b>Nr. Reg. Com.:</b> {textOrDash(company?.regNo)}</div>
                  <div><b>Adresa:</b> {textOrDash(company?.address)}</div>
                  <div><b>Banca:</b> {textOrDash(company?.bank)}</div>
                  <div><b>IBAN:</b> {textOrDash(company?.iban)}</div>
                  <div><b>Email:</b> {textOrDash(company?.email)}</div>
                  <div><b>Telefon:</b> {textOrDash(company?.phone)}</div>
                </div>

                <div>
                  <div style={docTitle}>NOTA DE RECEPTIE SI CONSTATARE DE DIFERENTE</div>
                  <div style={docIntro}>
                    Subsemnatii, membrii comisiei de receptie, am procedat la receptionarea valorilor materiale furnizate de <b>{supplierName}</b>, constatandu-se urmatoarele:
                  </div>
                </div>
              </div>

              <div style={metaTableWrap} className="meta-block">
                <table style={metaTable}>
                  <tbody>
                    <tr>
                      <td style={metaLabel}>Furnizor</td>
                      <td style={metaValue}>{supplierName}</td>
                      <td style={metaLabel}>Cod furnizor</td>
                      <td style={metaValue}>{supplierCode}</td>
                      <td style={metaLabel}>Document</td>
                      <td style={metaValue}>{textOrDash(receipt?.docNo)}</td>
                    </tr>
                    <tr>
                      <td style={metaLabel}>Locatie</td>
                      <td style={metaValue}>{receipt?.location?.name || "-"}</td>
                      <td style={metaLabel}>Moneda</td>
                      <td style={metaValue}>{currency}</td>
                      <td style={metaLabel}>Data document</td>
                      <td style={metaValue}>{formatDate(receipt?.docDate)}</td>
                    </tr>
                    <tr>
                      <td style={metaLabel}>Curs</td>
                      <td style={metaValue}>{isRon ? "1.00" : formatNumber(fxRate, 4)}</td>
                      <td style={metaLabel}>Status</td>
                      <td style={metaValue}>{textOrDash(receipt?.status)}</td>
                      <td style={metaValue} colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={tableWrap} className="table-block">
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 42 }}>Nr.</th>
                      <th style={{ ...thLeft, width: "28%" }}>Denumirea produselor</th>
                      <th style={{ ...th, width: 62 }}>UM</th>
                      <th style={{ ...th, width: 74 }}>Cant.</th>
                      <th style={{ ...th, width: 86 }}>Pret unitar</th>
                      <th style={{ ...th, width: 60 }}>TVA %</th>
                      <th style={{ ...th, width: 98 }}>Valoare fara TVA</th>
                      <th style={{ ...th, width: 92 }}>TVA</th>
                      <th style={{ ...th, width: 108 }}>Valoare cu TVA</th>
                      {!isRon && <th style={{ ...th, width: 104 }}>Valoare RON</th>}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.type}-${row.no}`}>
                        <td style={tdCenter}>{row.no}</td>
                        <td style={row.type === "SGR" ? tdLeftSgr : tdLeft}>
                          {row.type === "SGR" ? `↳ ${row.productName}` : row.productName}
                        </td>
                        <td style={tdCenter}>{row.uom}</td>
                        <td style={tdRight}>{formatNumber(row.qty, 3)}</td>
                        <td style={tdRight}>{formatNumber(row.unitCostNetFc)}</td>
                        <td style={tdCenter}>{formatNumber(row.vatRateValue)}</td>
                        <td style={tdRight}>{formatNumber(row.lineNetFc)}</td>
                        <td style={tdRight}>{formatNumber(row.lineVatFc)}</td>
                        <td style={tdRight}>{formatNumber(row.lineGrossFc)}</td>
                        {!isRon && <td style={tdRight}>{formatNumber(row.lineGrossRon)}</td>}
                      </tr>
                    ))}

                    {!rows.length && (
                      <tr>
                        <td style={tdEmpty} colSpan={isRon ? 9 : 10}>
                          Nu exista pozitii in document.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={totalsWrap} className="totals-block">
                <div style={totalsBox}>
                  <div style={totalsRow}>
                    <span>Total fara TVA {currency}</span>
                    <b>{formatNumber(receipt?.totalNetFc)}</b>
                  </div>
                  <div style={totalsRow}>
                    <span>Total TVA {currency}</span>
                    <b>{formatNumber(receipt?.totalVatFc)}</b>
                  </div>
                  <div style={totalsRow}>
                    <span>Total SGR {currency}</span>
                    <b>{formatNumber(totalSgrFc)}</b>
                  </div>
                  <div style={totalsRowStrong}>
                    <span>Total general cu SGR {currency}</span>
                    <b>{formatNumber(totalWithSgrFc)}</b>
                  </div>

                  {!isRon && (
                    <>
                      <div style={totalsDivider}></div>
                      <div style={totalsRow}>
                        <span>Total fara TVA RON</span>
                        <b>{formatNumber(receipt?.totalNetRon)}</b>
                      </div>
                      <div style={totalsRow}>
                        <span>Total TVA RON</span>
                        <b>{formatNumber(receipt?.totalVatRon)}</b>
                      </div>
                      <div style={totalsRow}>
                        <span>Total SGR RON</span>
                        <b>{formatNumber(totalSgrRon)}</b>
                      </div>
                      <div style={totalsRowStrong}>
                        <span>Total general cu SGR RON</span>
                        <b>{formatNumber(totalWithSgrRon)}</b>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={footerBox} className="signature-block-print">
                <div style={signatureBlock}>
                  <div style={signatureLabel}>Gestionar</div>
                  <div style={signatureLine}></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const sheet: React.CSSProperties = {
  width: "100%",
  maxWidth: 1460,
  margin: "0 auto",
  background: "#fff",
  color: "#111"
}

const documentBorder: React.CSSProperties = {
  border: "1.5px solid #111",
  padding: 12
}

const headerGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "340px 1fr",
  gap: 14,
  alignItems: "start",
  marginBottom: 10
}

const companyPanel: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.45,
  border: "1px solid #111",
  padding: 10,
  minHeight: 128
}

const companyNameStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 6,
  textTransform: "uppercase"
}

const docTitle: React.CSSProperties = {
  border: "1px solid #111",
  padding: "11px 12px",
  fontSize: 24,
  fontWeight: 700,
  letterSpacing: 0.4,
  textAlign: "center",
  textTransform: "uppercase"
}

const docIntro: React.CSSProperties = {
  marginTop: 10,
  border: "1px solid #111",
  padding: 10,
  fontSize: 12,
  lineHeight: 1.45,
  textAlign: "justify"
}

const metaTableWrap: React.CSSProperties = {
  marginBottom: 10,
  border: "1px solid #111"
}

const metaTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12
}

const metaLabel: React.CSSProperties = {
  border: "1px solid #111",
  padding: "6px 8px",
  fontWeight: 700,
  width: "12%",
  background: "#f4f4f4"
}

const metaValue: React.CSSProperties = {
  border: "1px solid #111",
  padding: "6px 8px",
  width: "21%"
}

const tableWrap: React.CSSProperties = {
  overflow: "visible",
  border: "1px solid #111"
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11.5
}

const th: React.CSSProperties = {
  border: "1px solid #111",
  padding: 6,
  textAlign: "center",
  background: "#f3f4f6",
  fontWeight: 700,
  verticalAlign: "middle"
}

const thLeft: React.CSSProperties = {
  ...th,
  textAlign: "left"
}

const tdCenter: React.CSSProperties = {
  border: "1px solid #111",
  padding: 6,
  textAlign: "center",
  verticalAlign: "top"
}

const tdLeft: React.CSSProperties = {
  border: "1px solid #111",
  padding: 6,
  textAlign: "left",
  verticalAlign: "top"
}

const tdLeftSgr: React.CSSProperties = {
  ...tdLeft,
  paddingLeft: 18,
  fontStyle: "italic"
}

const tdRight: React.CSSProperties = {
  border: "1px solid #111",
  padding: 6,
  textAlign: "right",
  verticalAlign: "top"
}

const tdEmpty: React.CSSProperties = {
  border: "1px solid #111",
  padding: 16,
  textAlign: "center",
  color: "#555"
}

const totalsWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 10
}

const totalsBox: React.CSSProperties = {
  width: 360,
  border: "1px solid #111",
  padding: 10,
  fontSize: 12,
  background: "#fff"
}

const totalsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "4px 0"
}

const totalsRowStrong: React.CSSProperties = {
  ...totalsRow,
  fontSize: 13,
  fontWeight: 700,
  borderTop: "1px solid #111",
  marginTop: 4,
  paddingTop: 7
}

const totalsDivider: React.CSSProperties = {
  borderTop: "1px dashed #777",
  margin: "7px 0"
}

const footerBox: React.CSSProperties = {
  marginTop: 28,
  display: "flex",
  justifyContent: "flex-end"
}

const signatureBlock: React.CSSProperties = {
  width: 240
}

const signatureLabel: React.CSSProperties = {
  marginBottom: 36,
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center"
}

const signatureLine: React.CSSProperties = {
  borderBottom: "1px solid #111",
  width: "100%"
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer"
}

const btnSecondary: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  cursor: "pointer"
}

const infoBox: React.CSSProperties = {
  padding: 16,
  borderRadius: 10,
  background: "#f9fafb",
  border: "1px solid #e5e7eb"
}

const errorBox: React.CSSProperties = {
  padding: 16,
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b"
}
