"use client"

import { useState, type ReactNode } from "react"
import { DesktopNotificationWatcher } from "@/components/desktopSessions/DesktopNotificationWatcher"
import { SideNav } from "./SideNav"
import { StartupNoticeBanner } from "./StartupNoticeBanner"
import { TopBar } from "./TopBar"

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-full">
      <DesktopNotificationWatcher />
      <SideNav mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        <StartupNoticeBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
