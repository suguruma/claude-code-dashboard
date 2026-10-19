import Link from "next/link"
import { Gauge, OctagonAlert, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { USAGE_KIND_LABEL, countDecisions, countSendLimitStopped, pickHomeWindows, usageValueKind } from "@/lib/homeDashboard"
import { displayUsageLevel, formatPercent } from "@/lib/usageFormat"
import type { UsageResponse, UsageWindowView } from "@/lib/usageTypes"
import { LEVEL_LABEL, LEVEL_TEXT_COLOR } from "@/components/desktopSessions/UsageGauge"

interface HomeSummaryCardsProps {
  /** セッション一覧(未取得・データなしは null)。組織図の出来事は使わないので、組織図より先に出る */
  sessions: DesktopSessionSummary[] | null
  usage: UsageResponse | null
}

const cardClass =
  "flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * ホームの上の件数の帯(⑧)。あなたの対応待ち・送信上限で停止・利用上限を並べ、押すとそれぞれのページへ移る。
 * 数え方は、整理ページ(あなたの対応待ち)・利用上限のページ(ゲージ)と同じ関数を使う。
 * 「判断待ち」は要対応の種類の名前(⑩)なので、件数のカードには使わない
 */
export function HomeSummaryCards({ sessions, usage }: HomeSummaryCardsProps) {
  const decisions = sessions ? countDecisions(sessions) : null
  const stopped = sessions ? countSendLimitStopped(sessions) : null
  const { fiveHour, weekly } = pickHomeWindows(usage?.windows ?? [])

  return (
    <section aria-label="件数の帯" className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="home-summary">
      <Link href="/desktop-sessions/housekeeping" className={cardClass} data-testid="home-decisions">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <OctagonAlert className="size-3.5" aria-hidden />
          あなたの対応待ち
        </span>
        <span className="text-2xl font-semibold tabular-nums">{decisions === null ? "—" : `${decisions}件`}</span>
        <span className="text-xs text-muted-foreground">全グループ。送信上限で停止を含む（整理ページと同じ数）</span>
      </Link>

      <Link
        href="/desktop-sessions/housekeeping"
        className={cn(cardClass, stopped !== null && stopped > 0 && "border-[var(--status-critical)]")}
        data-testid="home-send-limit"
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Send className="size-3.5" aria-hidden />
          送信上限で停止
        </span>
        <span
          className="text-2xl font-semibold tabular-nums"
          style={stopped !== null && stopped > 0 ? { color: "var(--status-critical-text)" } : undefined}
        >
          {stopped === null ? "—" : `${stopped}件`}
        </span>
        <span className="text-xs text-muted-foreground">
          {stopped !== null && stopped > 0 ? "セッションを開いて一言入力すると解除" : "送信上限で止まっているセッション"}
        </span>
      </Link>

      <Link href="/desktop-sessions/usage" className={cardClass} data-testid="home-usage">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Gauge className="size-3.5" aria-hidden />
          利用上限
        </span>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <UsageValue label="5時間" window={fiveHour} />
          <UsageValue label="週" window={weekly} />
        </span>
        <span className="text-xs text-muted-foreground">80% 黄・90% 橙・95% 赤（利用上限のページと同じ値）</span>
      </Link>
    </section>
  )
}

function UsageValue({ label, window: w }: { label: string; window: UsageWindowView | null }) {
  const display = w?.displayPercent ?? null
  const level = displayUsageLevel(display)
  const levelLabel = LEVEL_LABEL[level]
  return (
    <span className="inline-flex items-baseline gap-1" data-testid={`home-usage-${label === "5時間" ? "five-hour" : "weekly"}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums" style={level === "ok" ? undefined : { color: LEVEL_TEXT_COLOR[level] }}>
        {display === null ? "—" : `${formatPercent(display)}%`}
      </span>
      <span className="text-xs text-muted-foreground">{w ? USAGE_KIND_LABEL[usageValueKind(w)] : "公式値なし"}</span>
      {levelLabel && (
        <span className="text-xs font-medium" style={{ color: LEVEL_TEXT_COLOR[level] }}>
          {levelLabel}
        </span>
      )}
    </span>
  )
}
