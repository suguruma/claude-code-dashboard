"use client"

import { NotificationToggle } from "@/components/desktopSessions/NotificationToggle"
import { UsagePanel } from "@/components/desktopSessions/UsagePanel"

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <NotificationToggle />
      <UsagePanel showTitle={false} />
    </div>
  )
}
