"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useMemo } from "react"

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/invoices", label: "Facturi" },
  { href: "/products", label: "Produse" },
  { href: "/stock", label: "Stoc" },
  { href: "/partners", label: "Parteneri" },
  { href: "/settings", label: "Setări" },
]

export default function SidebarNav() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const tenantId = (sp.get("tenantId") || "").trim()

  const qs = useMemo(() => {
    if (!tenantId) return ""
    const p = new URLSearchParams()
    p.set("tenantId", tenantId)
    return `?${p.toString()}`
  }, [tenantId])

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {nav.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={`${item.href}${qs}`}
            style={{
              textDecoration: "none",
              color: "#111",
              padding: "8px 10px",
              borderRadius: 8,
              border: active ? "1px solid #bbb" : "1px solid #eee",
              background: active ? "#fafafa" : "transparent",
              fontWeight: active ? 700 : 500,
            }}
          >
            {item.label}
          </Link>
        )
      })}

      {!tenantId && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8, lineHeight: 1.4 }}>
          Tip: adaugă <code>?tenantId=REST-1</code> în URL ca să păstrezi tenant-ul când navighezi.
        </div>
      )}
    </nav>
  )
}
