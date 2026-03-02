import SidebarNav from "./_components/SidebarNav"
import TenantBadge from "./_components/TenantBadge"

import type { ReactNode } from "react"
import { Suspense } from "react"

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 240, borderRight: "1px solid #ddd", padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 16 }}>GUFO Gestiune</div>
        <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.7 }}>Se încarcă meniul…</div>}>
          <SidebarNav />
        </Suspense>
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
          <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.7 }}>Tenant…</div>}>
            <TenantBadge />
          </Suspense>
        </header>

        <div style={{ padding: 16 }}>{children}</div>
      </main>
    </div>
  )
}
