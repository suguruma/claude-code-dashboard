import type { ReactNode } from "react"
import { Gauge, OctagonAlert, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { USAGE_KIND_LABEL, countDecisions, countSendLimitStopped, pickHomeWindows, usageValueKind } from "@/lib/homeDashboard"
import type { SectionPhase } from "@/lib/homeStartup"
import { HoverPrefetchLink } from "@/components/layout/HoverPrefetchLink"
import { RetryNotice, Skeleton } from "./HomeLoading"
import { displayUsageLevel, formatPercent } from "@/lib/usageFormat"
import type { UsageResponse, UsageWindowView } from "@/lib/usageTypes"
import { LEVEL_LABEL, LEVEL_TEXT_COLOR } from "@/components/desktopSessions/UsageGauge"

interface HomeSummaryCardsProps {
  /** セッション一覧(未取得・データなしは null)。組織図の出来事は使わないので、組織図より先に出る */
  sessions: DesktopSessionSummary[] | null
  usage: UsageResponse | null
  /**
   * 件数の状態(⑫ ST-5)。ready でないあいだは、数字の場所を灰色の枠にする(「—」は、答えが来て本当に無いときだけ)。
   * failed は「取得できません」(文と［もう一度読み込む］は、2枚の下に1行で、ホームが出す)
   */
  countsPhase?: SectionPhase
  /** 利用上限の状態。利用上限は独立した欄なので、時間がかかる・失敗の文とボタンはカードの中に出す */
  usagePhase?: SectionPhase
  onRetryUsage?: () => Promise<unknown>
}

const cardClass =
  "flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * ホームの上の件数の帯(⑧)。あなたの対応待ち・送信上限で停止・利用上限を並べ、押すとそれぞれのページへ移る。
 * 数え方は、整理ページ(あなたの対応待ち)・利用上限のページ(ゲージ)と同じ関数を使う。
 * 「判断待ち」は要対応の種類の名前(⑩)なので、件数のカードには使わない
 */
export function HomeSummaryCards({ sessions, usage, countsPhase = "ready", usagePhase = "ready", onRetryUsage }: HomeSummaryCardsProps) {
  const countsReady = countsPhase === "ready"
  const decisions = countsReady && sessions ? countDecisions(sessions) : null
  const stopped = countsReady && sessions ? countSendLimitStopped(sessions) : null
  const { fiveHour, weekly } = pickHomeWindows(usage?.windows ?? [])
  const countValue = (text: string): ReactNode =>
    countsReady ? text : countsPhase === "failed" ? <CountUnavailable /> : <Skeleton className="my-0.5 h-7 w-16" />

  return (
    <section
      id="home-counts"
      aria-label="件数の帯"
      aria-busy={!countsReady && countsPhase !== "failed"}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      data-testid="home-summary"
      data-counts-phase={countsPhase}
    >
      <HoverPrefetchLink href="/desktop-sessions/housekeeping" className={cardClass} data-testid="home-decisions">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <OctagonAlert className="size-3.5" aria-hidden />
          あなたの対応待ち
        </span>
        <span className="text-2xl font-semibold tabular-nums">{countValue(decisions === null ? "—" : `${decisions}件`)}</span>
        <span className="text-xs text-muted-foreground">全グループ。送信上限で停止を含む（整理ページと同じ数）</span>
      </HoverPrefetchLink>

      <HoverPrefetchLink
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
          {countValue(stopped === null ? "—" : `${stopped}件`)}
        </span>
        <span className="text-xs text-muted-foreground">
          {stopped !== null && stopped > 0 ? "セッションを開いて一言入力すると解除" : "送信上限で止まっているセッション"}
        </span>
      </HoverPrefetchLink>

      {usagePhase === "ready" ? (
        <HoverPrefetchLink href="/desktop-sessions/usage" id="home-usage-card" className={cardClass} data-testid="home-usage">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden />
            利用上限
          </span>
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <UsageValue label="5時間" window={fiveHour} />
            <UsageValue label="週" window={weekly} />
          </span>
          {usage?.phase === "official" ? (
            // 公式値だけの軽い答え(⑫ ST-7)。推定は後から来る答えで、数字とラベル(公式値→推定)が入れ替わる
            <span className="text-sm text-muted-foreground" data-testid="home-usage-estimating">
              推定を読み込んでいます
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">80% 黄・90% 橙・95% 赤（利用上限のページと同じ値）</span>
          )}
        </HoverPrefetchLink>
      ) : (
        // 読み込み中・時間がかかる・失敗のあいだは、押せるカードにしない(カードの中にボタンを置くため)
        <div
          id="home-usage-card"
          className={cn(cardClass, "hover:border-border")}
          style={usagePhase === "failed" ? { borderColor: "var(--status-critical)" } : undefined}
          aria-busy={usagePhase !== "failed"}
          data-testid="home-usage"
          data-usage-phase={usagePhase}
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden />
            利用上限
          </span>
          {usagePhase === "loading" && (
            <>
              <Skeleton className="my-0.5 h-7 w-56" />
              <span className="text-sm text-muted-foreground">読み込んでいます</span>
            </>
          )}
          {usagePhase === "slow" && onRetryUsage && (
            <RetryNotice phase="slow" text="時間がかかっています（30秒以上）。このまま待てます。" onRetry={onRetryUsage} />
          )}
          {usagePhase === "failed" && onRetryUsage && <RetryNotice phase="failed" text="！ 取得できません" onRetry={onRetryUsage} />}
        </div>
      )}
    </section>
  )
}

/** 一覧を読めなかったときの件数(「—」は「データが無い」だけの意味にするため、別の文を出す) */
function CountUnavailable() {
  return (
    <span className="block text-sm leading-8 font-normal" style={{ color: "var(--status-critical-text)" }}>
      取得できません
    </span>
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
