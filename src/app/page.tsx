"use client"

import { Suspense, useCallback, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { DesktopDataNotices } from "@/components/desktopSessions/DesktopDataNotices"
import { DesktopSessionsFrame } from "@/components/desktopSessions/DesktopSessionsFrame"
import { OrgChartView } from "@/components/desktopSessions/OrgChartView"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { HomeSummaryCards } from "@/components/home/HomeSummaryCards"
import { OutsideSessionsList } from "@/components/home/OutsideSessionsList"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { useSelectedSession } from "@/hooks/useSelectedSession"
import { useUsage } from "@/hooks/useUsage"

/**
 * ホーム(⑧)。上に件数の帯(判断待ち・送信上限で停止・利用上限)、その下に組織図、いちばん下に組織図に出ていないセッション。
 * 件数の帯は一覧と利用上限の値だけで出し、組織図の出来事の読み込みを待たない。
 * 選んでいるプロジェクトは使わない(上のバーにプロジェクトの切り替えは出さない)。
 */
export default function HomePage() {
  // useSearchParams を使うため、静的生成時のためにSuspenseで包む
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
      <DesktopSessionsFrame>
        <HomeContent />
      </DesktopSessionsFrame>
    </Suspense>
  )
}

function HomeContent() {
  const { data, error, isLoading } = useDesktopSessions()
  const { data: usage } = useUsage()
  const [selectedId, setSelectedId] = useSelectedSession()
  const [shown, setShown] = useState<{ ids: string[] | null; failed: boolean }>({ ids: null, failed: false })
  const onShownChange = useCallback((ids: string[] | null, failed: boolean) => setShown({ ids, failed }), [])
  const highContextRatio = data?.highContextRatio ?? 0.8
  const available = data !== null && data.source !== "none"

  return (
    <div className="space-y-6">
      <HomeSummaryCards sessions={available ? data.sessions : null} usage={usage} />

      <DesktopDataNotices data={data} error={error} isLoading={isLoading} />

      {data && data.source === "none" && (
        <p className="text-sm">
          Claude Desktop を使っていないときは、Claude Code の設定を{" "}
          <Link href="/project" className="inline-flex items-center gap-1 text-primary hover:underline">
            プロジェクトの概要 <ArrowRight className="size-3.5" aria-hidden />
          </Link>{" "}
          から見られます。
        </p>
      )}

      {available && (
        <>
          <OrgChartView
            sessions={data.sessions}
            groups={data.groups}
            highContextRatio={highContextRatio}
            onSelect={setSelectedId}
            onShownChange={onShownChange}
          />
          <OutsideSessionsList sessions={data.sessions} shownIds={shown.ids} failed={shown.failed} onSelect={setSelectedId} />
        </>
      )}

      <SessionDetailDialog sessionId={selectedId} highContextRatio={highContextRatio} onClose={() => setSelectedId(null)} />
    </div>
  )
}
