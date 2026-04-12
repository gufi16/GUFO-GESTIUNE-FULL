import { useState } from "react"
import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import Topbar from "./Topbar"
import GufoAiWidget from "./GufoAiWidget"

export default function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <div className="flex min-h-screen overflow-x-hidden">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMenu={() => setMobileSidebarOpen(true)} />

          <main className="flex-1 overflow-x-hidden p-2 md:p-3 xl:p-3">
            <div className="w-full min-w-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <GufoAiWidget />
    </div>
  )
}
