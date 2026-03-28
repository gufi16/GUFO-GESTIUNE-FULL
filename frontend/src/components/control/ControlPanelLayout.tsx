import { Outlet } from "react-router-dom"
import ControlPanelSidebar from "./ControlPanelSidebar"
import ControlPanelTopbar from "./ControlPanelTopbar"

export default function ControlPanelLayout() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="flex min-h-screen">
        <ControlPanelSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <ControlPanelTopbar />

          <main className="flex-1 p-4 md:p-6 xl:p-8">
            <div className="mx-auto w-full max-w-[1600px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
