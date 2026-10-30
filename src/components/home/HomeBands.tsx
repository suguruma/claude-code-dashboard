"use client"

import type { ReactNode } from "react"
import { Gauge } from "lucide-react"
import { HoverPrefetchLink } from "@/components/layout/HoverPrefetchLink"
import { LEVEL_TEXT_COLOR } from "@/components/desktopSessions/UsageGauge"
import { USAGE_KIND_LABEL, pickHomeWindows, usageValueKind } from "@/lib/homeDashboard"
import type { SectionPhase } from "@/lib/homeStartup"
import { displayUsageLevel, formatPercent } from "@/lib/usageFormat"
import type { UsageResponse, UsageWindowView } from "@/lib/usageTypes"
import { RetryNotice, Skeleton } from "./HomeLoading"

/** 新しい指示を控える目安(%) */
export const USAGE_HOLD_PERCENT = 80

/**
 * ホームの上の帯の枠(⑬ 4-5)。帯を優先の順に積む：PC の警告(⑭ が登録する) → 利用上限。出ない帯は高さ0。
 * 帯どうしは混ぜず、別の行にする。次にやる判断の件数には入れない。
 */
export function HomeBands({ pcAlert, usage }: { pcAlert?: ReactNode; usage: ReactNode }) {
  return (
    <div className="space-y-2" data-testid="home-bands">
      {pcAlert}
      {usage}
    </div>
  )
}

interface UsageStripProps {
  usage: UsageResponse | null
  phase: SectionPhase
  onRetry: () => Promise<unknown>
}

/**
 * 利用上限の帯(1行)。5時間・週の%と「80%で新しい指示を控える」。凡例の3色はやめた(棚卸し 行55)。
 * どちらかの窓が80%以上のときは「！ 新しい指示を控える」を太字にする(色だけに頼らない)。
 */
export function UsageStrip({ usage, phase, onRetry }: UsageStripProps) {
  const { fiveHour, weekly } = pickHomeWindows(usage?.windows ?? [])
  // 上限ガード(最新の公式値が80%以上)か、出している値が80%以上なら強調する
  const guarded = usage?.guard != null && usage.guard.level !== "none"
  const high = guarded || [fiveHour, weekly].some((w) => (w?.displayPercent ?? 0) >= USAGE_HOLD_PERCENT)
  return (
    <div
      id="home-usage-strip"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm"
      style={high ? { borderColor: "var(--status-warning)" } : undefined}
      aria-busy={phase === "loading"}
      data-testid="home-usage"
      data-usage-phase={phase}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Gauge className="size-4" aria-hidden />
        利用上限
      </span>
      {phase === "ready" ? (
        <>
          <UsageValue label="5時間" window={fiveHour} />
          <UsageValue label="週" window={weekly} />
          {usage?.phase === "official" && (
            <span className="text-muted-foreground" data-testid="home-usage-estimating">
              推定を読み込んでいます
            </span>
          )}
          {high ? (
            <strong data-testid="home-usage-hold">！ 新しい指示を控える</strong>
          ) : (
            <span className="text-muted-foreground">{USAGE_HOLD_PERCENT}%で新しい指示を控える</span>
          )}
          <HoverPrefetchLink href="/desktop-sessions/usage" className="ml-auto text-primary hover:underline">
            利用上限を見る
          </HoverPrefetchLink>
        </>
      ) : phase === "loading" ? (
        <>
          <Skeleton className="h-4 w-48" />
          <span className="text-muted-foreground">読み込んでいます</span>
        </>
      ) : phase === "slow" ? (
        <RetryNotice phase="slow" text="時間がかかっています（30秒以上）。このまま待てます。" onRetry={onRetry} />
      ) : (
        <RetryNotice phase="failed" text="！ 取得できません" onRetry={onRetry} />
      )}
    </div>
  )
}

function UsageValue({ label, window: w }: { label: string; window: UsageWindowView | null }) {
  const display = w?.displayPercent ?? null
  const level = displayUsageLevel(display)
  return (
    <span className="inline-flex items-baseline gap-1" data-testid={`home-usage-${label === "5時間" ? "five-hour" : "weekly"}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums" style={level === "ok" ? undefined : { color: LEVEL_TEXT_COLOR[level] }}>
        {display === null ? "—" : `${formatPercent(display)}%`}
      </span>
      <span className="text-muted-foreground">{w ? USAGE_KIND_LABEL[usageValueKind(w)] : "公式値なし"}</span>
    </span>
  )
}
