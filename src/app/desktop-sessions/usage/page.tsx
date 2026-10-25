"use client"

import { NotificationToggle } from "@/components/desktopSessions/NotificationToggle"
import { UsagePanel } from "@/components/desktopSessions/UsagePanel"
import { LoadView } from "@/components/resources/LoadView"
import { ResourceAlertBand } from "@/components/resources/PcAlertBands"
import { WorkPlanView } from "@/components/resources/WorkPlanView"
import { UnderlineTabPanel, UnderlineTabs } from "@/components/ui/underline-tabs"
import { useState } from "react"
import { useUrlTab } from "@/hooks/useTabParam"

const RESOURCE_TABS = [
  { id: "usage", label: "利用上限" },
  { id: "plan", label: "作業と待ち" },
  { id: "load", label: "負荷" },
] as const
const TAB_IDS = RESOURCE_TABS.map((t) => t.id)
type ResourceTab = (typeof TAB_IDS)[number]

/**
 * リソース(⑭。前の「利用上限」のページ)。上のタブで［利用上限］［作業と待ち］［負荷］を切り替える。
 * タブの前回の選択は覚えない：サイドバーから開くと、いつも［利用上限］(要件メモ 14 の L7)。ホームの帯・通知は `?tab=load` で直に開く。
 * 見出しと上限ガードの帯は、Claude Desktop の各ページと共通の枠(DesktopSessionsFrame)が出す。
 */
export default function ResourcesPage() {
  const [tab, setTab] = useUrlTab<ResourceTab>(TAB_IDS)
  // 警告の帯の［ピークを見る］：［負荷］へ移り、その時刻を選ぶ(押すたびに nonce を変える)
  const [focus, setFocus] = useState<{ at: number; nonce: number } | null>(null)
  // URL を読むまで(ハイドレーションの間)は中身を出さない(違うタブの取得を始めないため)
  if (tab === null) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  return (
    <div className="space-y-4">
      <UnderlineTabs tabs={RESOURCE_TABS} value={tab} onChange={setTab} idPrefix="resources" label="リソースの表示" />
      <ResourceAlertBand
        onPeak={(at) => {
          setFocus((f) => ({ at, nonce: (f?.nonce ?? 0) + 1 }))
          setTab("load")
        }}
      />
      <UnderlineTabPanel idPrefix="resources" id="usage" value={tab}>
        <div className="space-y-6">
          <NotificationToggle />
          <UsagePanel showTitle={false} />
        </div>
      </UnderlineTabPanel>
      <UnderlineTabPanel idPrefix="resources" id="plan" value={tab}>
        <WorkPlanView />
      </UnderlineTabPanel>
      <UnderlineTabPanel idPrefix="resources" id="load" value={tab}>
        <LoadView focus={focus} />
      </UnderlineTabPanel>
    </div>
  )
}
