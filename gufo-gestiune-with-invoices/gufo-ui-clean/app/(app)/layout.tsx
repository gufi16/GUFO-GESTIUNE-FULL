import Link from "next/link"

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Produse" },
  { href: "/stock", label: "Stoc" },
  { href: "/partners", label: "Parteneri" },
  { href: "/settings", label: "Setări" },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 240, borderRight: "1px solid #ddd", padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 16 }}>GUFO Gestiune</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                textDecoration: "none",
                color: "#111",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #eee",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1 }}>
        <header
          style={{
            height: 56,
            borderBottom: "1px solid #ddd",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
          }}
        >
          <div style={{ fontWeight: 700 }}>Aplicație</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Tenant: <b>demo</b>
          </div>
        </header>

        <div style={{ padding: 16 }}>{children}</div>
      </main>
    </div>
  )
}
