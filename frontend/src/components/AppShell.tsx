import { useState } from "react"
import { Outlet } from "react-router-dom"
import MobileBottomNav from "./MobileBottomNav"
import Sidebar from "./Sidebar"
import Topbar from "./Topbar"
import GufoAiWidget from "./GufoAiWidget"

export default function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F3F6FA] text-slate-900">
      <div className="flex min-h-screen overflow-x-hidden">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMenu={() => setMobileSidebarOpen(true)} />

          <main className="flex-1 overflow-x-hidden px-3 pb-28 pt-3 md:px-4 md:pb-6 md:pt-4 xl:px-5 xl:pb-8 xl:pt-5">
            <div className="mx-auto w-full min-w-0 max-w-[1680px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MobileBottomNav onOpenMenu={() => setMobileSidebarOpen(true)} />
      <GufoAiWidget />
    </div>
  )
}
