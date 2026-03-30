import { useState } from "react"
import { Outlet } from "react-router-dom"
import ControlPanelSidebar from "./ControlPanelSidebar"
import ControlPanelTopbar from "./ControlPanelTopbar"

export default function ControlPanelLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="flex min-h-screen">
        <ControlPanelSidebar
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ControlPanelTopbar onOpenMenu={() => setMobileSidebarOpen(true)} />

          <main className="flex-1 p-2.5 md:p-6 xl:p-8">
            <div className="mx-auto w-full max-w-[1600px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
