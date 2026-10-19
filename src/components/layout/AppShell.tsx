"use client"

import { useState, type ReactNode } from "react"
import { useSelectedLayoutSegments } from "next/navigation"
import { DesktopNotificationWatcher } from "@/components/desktopSessions/DesktopNotificationWatcher"
import { PHONE_SEGMENT } from "@/lib/lanAccess/phoneRoutes"
import { SideNav } from "./SideNav"
import { StartupNoticeBanner } from "./StartupNoticeBanner"
import { TopBar } from "./TopBar"

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const segments = useSelectedLayoutSegments()

  // スマホ用のページ(app/phone。入り口の経由のときだけ proxy が振り替える)は、自分の枠(PhoneShell)を持つ。
  // PC の枠(サイドバー・上のバー・通知の見張り)は出さない(⑪-2)
  if (segments[0] === PHONE_SEGMENT) return <>{children}</>

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
