"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { DataLocationLine, DesktopDataNotices } from "@/components/desktopSessions/DesktopDataNotices"
import { DesktopSessionsFrame } from "@/components/desktopSessions/DesktopSessionsFrame"
import { OrgChartView, useOrgFrameHeightBeforeList } from "@/components/desktopSessions/OrgChartView"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { OrgLoadingFrame, OrgTabsSkeleton } from "@/components/home/HomeLoading"
import { HomeBands, UsageStrip } from "@/components/home/HomeBands"
import { PcAlertStrip } from "@/components/resources/PcAlertBands"
import { NextDecisions } from "@/components/home/NextDecisions"
import { OutsideSessionsList } from "@/components/home/OutsideSessionsList"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { publishHomeStages } from "@/hooks/useHomeStages"
import { clearTimes, recordTime, useNowAt, useStartupTimes } from "@/hooks/useStartupTimes"
import { adoptEarlyRequests, earlyFetchScript, takeEarlyStart } from "@/lib/earlyFetch"
import { useSelectSession, useSelectedSessionId } from "@/hooks/useSelectedSession"
import { useUsage, useUsageOfficial } from "@/hooks/useUsage"
import {
  MARKS_DELAY_MS,
  OFFICIAL_WAIT_MS,
  SLOW_NOTICE_MS,
  countsVisible,
  failureReason,
  marksView,
  sectionPhase,
  type SectionPhase,
  type StageMark,
} from "@/lib/homeStartup"

/**
 * ホーム(⑧・⑬)。上から、帯の枠(PC の警告〈⑭〉・利用上限の1行)、次にやる判断(急ぐ順。最大5件)、判断待ちではないセッションの1行、
 * 組織図、組織図に出ていないセッション、データの出どころの行。次にやる判断は一覧と利用上限の値だけで出し、組織図の出来事の読み込みを待たない。
 * 選んでいるプロジェクトは使わない(上のバーにプロジェクトの切り替えは出さない)。
 *
 * 段階的な表示(⑫)：見出し・件数の枠・組織図の枠は、ビルドのときの静的な HTML に入る(窓が出た最初の描画に枠がある)。
 * そのため、`?session=` を読む部分(詳細のダイアログ)だけを Suspense に入れる(useSearchParams は、いちばん近い Suspense までを
 * 画面の側での描画に回すため。Next 16.2 の use-search-params.md の「Prerendering」)。
 */

// ホームの HTML のスクリプトが始めた早めの要求を、最初の取得より前に取得へ渡す(⑫ ST-7。このモジュールが読み込まれたとき1回だけ。
// 画面の内での移動でホームを開いたときは、スクリプトが動いていないので何もしない)
if (typeof window !== "undefined") adoptEarlyRequests()

export default function HomePage() {
  const { data, error, retry: retryList } = useDesktopSessions()
  const { data: fullUsage, error: usageError, retry: retryUsageRequest } = useUsage()
  // 推定を含む答えが来るまでは、公式値だけの軽い答えを先に出す(⑫ ST-7・Q8)
  const { data: officialUsage } = useUsageOfficial(fullUsage === null)
  const usage = fullUsage ?? officialUsage
  const setSelectedId = useSelectSession()
  const [shown, setShown] = useState<{ ids: string[] | null; failed: boolean }>({ ids: null, failed: false })
  const onShownChange = useCallback((ids: string[] | null, failed: boolean) => setShown({ ids, failed }), [])
  const [orgPhase, setOrgPhase] = useState<SectionPhase>("loading")
  const highContextRatio = data?.highContextRatio ?? 0.8
  const available = data !== null && data.source !== "none"
  const frameHeightBeforeList = useOrgFrameHeightBeforeList()

  // ---- 時刻の記録(静的な HTML と最初の描画では空 = 読み込み中)。描画の後と押したときに記録する
  const times = useStartupTimes()
  useEffect(() => {
    // 窓を開いて最初に読んだホームは、HTML を読んだ時刻から数える(遅い PC では、ここに来るまでにもう待っている)
    recordTime("home:start", false, takeEarlyStart() ?? undefined)
    return () => clearTimes("home:")
  }, [])
  const startedAt = times["home:start"] ?? 0
  const listStartedAt = times["home:list-retry"] ?? startedAt
  const usageStartedAt = times["home:usage-retry"] ?? startedAt
  const listReadyAt = times["home:list-ready"] ?? null
  const usageReadyAt = times["home:usage-ready"] ?? null
  const firstLoadDone = times["home:first-load-done"] !== undefined
  const failureDismissed = (times["home:failure-dismissed"] ?? 0) > (times["home:failure-seen"] ?? 0)
  // 時計は、境目(印を出す1.5秒・公式値を待つ1.5秒・30秒の案内)にだけ進める。毎秒の描き直しはしない(秒は上のバーの部品が数える)
  const deadlines = [
    startedAt > 0 ? startedAt + MARKS_DELAY_MS : 0,
    listReadyAt !== null ? listReadyAt + OFFICIAL_WAIT_MS : 0,
    usageReadyAt !== null ? usageReadyAt + OFFICIAL_WAIT_MS : 0,
    data === null && listStartedAt > 0 ? listStartedAt + SLOW_NOTICE_MS : 0,
    usage === null && usageStartedAt > 0 ? usageStartedAt + SLOW_NOTICE_MS : 0,
  ].filter((t) => t > 0)
  const now = useNowAt(deadlines)

  const listPhase = sectionPhase({ hasData: data !== null, failed: Boolean(error) && data === null, startedAt: listStartedAt, now })
  const usagePhase = sectionPhase({ hasData: usage !== null, failed: Boolean(usageError) && usage === null, startedAt: usageStartedAt, now })
  // 件数は、公式値を最長1.5秒だけ待って一緒に出す(公式値が遅い・失敗しても、件数は出す)
  const countsPhase: SectionPhase =
    listPhase === "ready" ? (countsVisible({ listReadyAt, usagePhase, now }) ? "ready" : "loading") : listPhase
  const listIsReady = listPhase === "ready"
  const usageIsReady = usagePhase === "ready"
  useEffect(() => {
    if (listIsReady) recordTime("home:list-ready")
  }, [listIsReady])
  useEffect(() => {
    if (usageIsReady) recordTime("home:usage-ready")
  }, [usageIsReady])

  const marks: StageMark[] = useMemo(
    () => [
      { id: "counts", phase: countsPhase },
      { id: "usage", phase: usagePhase },
      // 一覧が読めないと組織図も出せない。Claude Desktop のデータが無いときは、組織図を出さないので済みとする
      { id: "org", phase: available ? orgPhase : listPhase === "failed" ? "failed" : data?.source === "none" ? "ready" : "loading" },
    ],
    [countsPhase, usagePhase, available, orgPhase, listPhase, data?.source]
  )
  const allReady = marks.every((m) => m.phase === "ready")
  const anyFailed = marks.some((m) => m.phase === "failed")
  useEffect(() => {
    if (allReady) recordTime("home:first-load-done")
  }, [allReady])
  useEffect(() => {
    // 新しく失敗したら、前に閉じた印も、もう一度出す
    if (anyFailed) recordTime("home:failure-seen", true)
  }, [anyFailed])

  const view = marksView({ marks, startedAt, now, firstLoadDone, failureDismissed })
  const dismissFailure = useCallback(() => recordTime("home:failure-dismissed", true), [])
  useEffect(() => {
    publishHomeStages({ marks, view, startedAt, dismissFailure })
  }, [marks, view.visible, view.done, startedAt, dismissFailure]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => publishHomeStages(null), [])

  const retryListNow = useCallback(() => {
    recordTime("home:list-retry", true)
    return retryList()
  }, [retryList])
  const retryUsage = useCallback(() => {
    recordTime("home:usage-retry", true)
    return retryUsageRequest()
  }, [retryUsageRequest])

  // 上限ガードの帯は、件数と同じときに出す(件数の数字が出た後に、カードを動かさない)。件数がまだのまま公式値を1.5秒待ったら出す
  const bandReady = countsPhase !== "loading" || (usageReadyAt !== null && now - usageReadyAt >= OFFICIAL_WAIT_MS)

  return (
    <DesktopSessionsFrame guardFrom={{ usage: bandReady ? usage : null }} hideGuard>
      {/* 一覧と利用上限の要求を、JS の読み込み・ハイドレーションと並べて始める(静的な HTML でだけ動く。earlyFetch.ts) */}
      <script dangerouslySetInnerHTML={{ __html: earlyFetchScript() }} />
      <div className="space-y-6">
        {/* ホームの上の帯の枠(⑬ 4-5)。PC の警告(⑭)は、この枠の利用上限の上に入る */}
        <HomeBands pcAlert={<PcAlertStrip />} usage={<UsageStrip usage={bandReady ? usage : null} phase={bandReady ? usagePhase : "loading"} onRetry={retryUsage} />} />

        <NextDecisions sessions={available ? data.sessions : data ? [] : null} phase={countsPhase} now={data?.generatedAt ?? 0} failure={failureReason(error)} onRetry={retryListNow} />

        {/* 一覧を読めなかったことは次にやる判断の欄で出すので、ここでは、前の答えがあるときの再取得の失敗だけを出す。
            データの場所の1行は、ホームのいちばん下に出す(⑬) */}
        <DesktopDataNotices data={data} error={data ? error : undefined} isLoading={false} showLocation={false} />

        {data && data.source === "none" && (
          <p className="text-sm">
            Claude Desktop を使っていないときは、Claude Code の設定を{" "}
            <Link href="/rules" className="inline-flex items-center gap-1 text-primary hover:underline">
              ルール管理 <ArrowRight className="size-3.5" aria-hidden />
            </Link>{" "}
            から見られます。
          </p>
        )}

        <div id="home-org" className="space-y-6">
          {available ? (
            <>
              <OrgChartView
                sessions={data.sessions}
                groups={data.groups}
                highContextRatio={highContextRatio}
                onSelect={setSelectedId}
                onShownChange={onShownChange}
                onPhaseChange={setOrgPhase}
              />
              <OutsideSessionsList sessions={data.sessions} shownIds={shown.ids} failed={shown.failed} />
            </>
          ) : (
            data === null && (
              // 読み込み後と同じ並び(タブの行 → 組織図のカード)の枠
              <div className="space-y-3">
                <OrgTabsSkeleton />
                <OrgLoadingFrame height={frameHeightBeforeList} state={listPhase === "failed" ? "blocked" : "loading"} />
              </div>
            )
          )}
        </div>

        {/* 関係性マップ(⑬)への入口の一文だけ。中身は組織のページの「つながり」 */}
        <p className="text-sm text-muted-foreground">
          誰がどのグループにいて、どの決まり・記憶が効いているかは{" "}
          <Link href="/org-rules?tab=links" className="inline-flex items-center gap-1 text-primary hover:underline">
            組織の「つながり」 <ArrowRight className="size-3.5" aria-hidden />
          </Link>{" "}
          で見ます。
        </p>

        {/* データの出どころの行(設定・環境変数で場所を指定したときだけ。自動で見つけたときは出さない。⑬) */}
        {data?.dataLocation && data.dataLocation.origin !== "auto" && <DataLocationLine location={data.dataLocation} />}

        {/* `?session=` を読む部分だけを Suspense に入れる(ほかを静的な HTML に入れるため) */}
        <Suspense fallback={null}>
          <HomeSessionDialog highContextRatio={highContextRatio} />
        </Suspense>
      </div>
    </DesktopSessionsFrame>
  )
}

function HomeSessionDialog({ highContextRatio }: { highContextRatio: number }) {
  const selectedId = useSelectedSessionId()
  const setSelectedId = useSelectSession()
  return <SessionDetailDialog sessionId={selectedId} highContextRatio={highContextRatio} onClose={() => setSelectedId(null)} />
}
