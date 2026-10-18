"use client"

import { Suspense } from "react"
import { DesktopDataNotices } from "@/components/desktopSessions/DesktopDataNotices"
import { OrgChartView } from "@/components/desktopSessions/OrgChartView"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { useSelectedSession } from "@/hooks/useSelectedSession"

export default function OrgChartPage() {
  // useSearchParams を使うため、静的生成時のためにSuspenseで包む
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
      <OrgChartContent />
    </Suspense>
  )
}

function OrgChartContent() {
  const { data, error, isLoading } = useDesktopSessions()
  const [selectedId, setSelectedId] = useSelectedSession()
  const highContextRatio = data?.highContextRatio ?? 0.8

  return (
    <div className="space-y-6">
      <DesktopDataNotices data={data} error={error} isLoading={isLoading} />

      {data && data.source !== "none" && (
        <OrgChartView sessions={data.sessions} groups={data.groups} highContextRatio={highContextRatio} onSelect={setSelectedId} />
      )}

      <SessionDetailDialog sessionId={selectedId} highContextRatio={highContextRatio} onClose={() => setSelectedId(null)} />
    </div>
  )
}
