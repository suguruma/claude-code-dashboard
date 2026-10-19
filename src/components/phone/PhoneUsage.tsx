"use client"

import { useUsage } from "@/hooks/useUsage"
import { USAGE_KIND_LABEL, pickHomeWindows, usageValueKind } from "@/lib/homeDashboard"
import { PHONE_SWR_OPTIONS } from "@/lib/phoneView"
import {
  costPerPercentOf,
  displayUsageLevel,
  formatJst,
  formatJstTime,
  formatLimitShare,
  formatPercent,
  formatRemaining,
} from "@/lib/usageFormat"
import type { UsageContributionSet, UsageWindowView } from "@/lib/usageTypes"
import { cn } from "@/lib/utils"
import { LEVEL_LABEL, LEVEL_TEXT_COLOR } from "@/components/desktopSessions/UsageGauge"
import { CARD, META, PhoneNotice, SectionTitle } from "./parts"

const LEVEL_FILL = {
  ok: "var(--primary)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const

/** 上位何件まで、誰が使っているかを出すか */
const TOP_CONTRIBUTORS = 5

/**
 * スマホの利用上限(⑪-2)。5時間と週(全モデル)を大きく出す(%・推定か公式値か・リセットまで・ペースの一言)。
 * 誰が使っているかは上位5件。モデル別の週・内訳・注記は畳む。値は PC の利用上限のページと同じ API・同じ関数で出す。
 */
export function PhoneUsage() {
  const { data, error, isLoading } = useUsage(true, PHONE_SWR_OPTIONS)
  const { fiveHour, weekly } = pickHomeWindows(data?.windows ?? [])
  const others = (data?.windows ?? []).filter((w) => w !== fiveHour && w !== weekly)
  const now = data?.generatedAt ?? 0

  return (
    <div className="space-y-4">
      <PhoneNotice error={error} isLoading={isLoading} hasData={data !== null} />

      {data && (
        <>
          {!data.snapshots.found && (
            <p className={cn(CARD, "p-4 text-base")}>公式値の記録が見つかりません。%は、公式値を記録すると出ます。</p>
          )}
          <BigWindow title="5時間" window={fiveHour} now={now} testId="phone-usage-five-hour" />
          <BigWindow title="週（全モデル）" window={weekly} now={now} testId="phone-usage-weekly" />

          <Contributors
            title="直近5時間に使ったセッション"
            set={data.contributions.fiveHour}
            costPerPercent={costPerPercentOf(fiveHour?.calibration ?? null)}
          />

          <details className={cn(CARD, "group")}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-base font-medium select-none">
              ほかの枠・今週・注記
              <span className={cn(META, "ml-auto group-open:hidden")}>開く</span>
              <span className={cn(META, "ml-auto hidden group-open:inline")}>閉じる</span>
            </summary>
            <div className="space-y-4 border-t px-4 py-3">
              {others.map((w) => (
                <SmallWindow key={w.id} window={w} now={now} />
              ))}
              <Contributors
                title="今週使ったセッション"
                set={data.contributions.week}
                costPerPercent={costPerPercentOf(weekly?.calibration ?? null)}
                bare
              />
              <p className={META}>
                {data.snapshots.lastRecordedAt !== null && `公式値の最新の記録: ${formatJst(data.snapshots.lastRecordedAt)}。`}
                {data.note}
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function percentText(w: UsageWindowView | null): string {
  const v = w?.displayPercent ?? null
  return v === null ? "—" : `${formatPercent(v)}%`
}

function PaceText({ window: w, now }: { window: UsageWindowView; now: number }) {
  const pace = w.pace
  if (!pace) return null
  if (pace.etaAt === null) return <p className={META}>いまのペースでは100%に達しません。</p>
  if (pace.etaAt <= now) return <p className={META}>すでに100%に達しています。</p>
  const eta = `このペースだと ${formatJstTime(pace.etaAt)} 頃に100%`
  if (pace.nearReset) return <p className={META}>{eta}（リセットとほぼ同時）。</p>
  return (
    <p className={cn(META, pace.beforeReset && "font-medium")} style={pace.beforeReset ? { color: "var(--status-serious-text)" } : undefined}>
      {eta}。{pace.beforeReset ? "リセットより先に達する見込みです。" : "リセットまでには達しない見込みです。"}
    </p>
  )
}

function BigWindow({ title, window: w, now, testId }: { title: string; window: UsageWindowView | null; now: number; testId: string }) {
  const display = w?.displayPercent ?? null
  const level = displayUsageLevel(display)
  const levelLabel = LEVEL_LABEL[level]
  const fill = Math.max(0, Math.min(100, display ?? 0))
  return (
    <section className={cn(CARD, "space-y-2 p-4")} aria-label={`${title}の利用上限`} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {levelLabel && (
          <span className="text-[0.8125rem] font-medium" style={{ color: LEVEL_TEXT_COLOR[level] }}>
            {levelLabel}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-4xl font-semibold tabular-nums" style={level === "ok" ? undefined : { color: LEVEL_TEXT_COLOR[level] }}>
          {percentText(w)}
        </span>
        <span className={META}>{w ? USAGE_KIND_LABEL[usageValueKind(w)] : "公式値なし"}</span>
      </div>
      <div
        role="img"
        aria-label={display === null ? `${title}: 公式値なし` : `${title}: ${formatPercent(display)}%`}
        className="relative h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${fill}%`, background: LEVEL_FILL[level] }} />
      </div>
      {w && (
        <p className="text-base">
          {w.resetsAt !== null ? (
            <>
              リセットまで {formatRemaining(w.resetsAt - now).replace(/^あと/, "")}
              <span className={cn(META, "ml-1")}>（{formatJst(w.resetsAt)}）</span>
            </>
          ) : (
            <span className="text-muted-foreground">次の枠はまだ始まっていません</span>
          )}
        </p>
      )}
      {w && <PaceText window={w} now={now} />}
    </section>
  )
}

function SmallWindow({ window: w, now }: { window: UsageWindowView; now: number }) {
  return (
    <div className="space-y-0.5">
      <p className="flex items-baseline justify-between gap-2 text-base">
        <span className="min-w-0 [overflow-wrap:anywhere]">{w.label}</span>
        <span className="font-semibold tabular-nums">{percentText(w)}</span>
      </p>
      <p className={META}>
        {USAGE_KIND_LABEL[usageValueKind(w)]}
        {w.resetsAt !== null && `・リセット ${formatRemaining(w.resetsAt - now)}`}
      </p>
    </div>
  )
}

function Contributors({
  title,
  set,
  costPerPercent,
  bare = false,
}: {
  title: string
  set: UsageContributionSet
  costPerPercent: number | null
  bare?: boolean
}) {
  const grand = set.items.reduce((sum, i) => sum + i.costUsd, 0)
  const top = [...set.items].sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_CONTRIBUTORS)
  return (
    <section className={cn(!bare && CARD, !bare && "p-4", "space-y-2")}>
      <SectionTitle>{title}</SectionTitle>
      {top.length === 0 ? (
        <p className={META}>まだありません。</p>
      ) : (
        <ol className="space-y-2">
          {top.map((item) => (
            <li key={item.sessionKey} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">{item.title}</span>
                {item.groupName && <span className={cn(META, "block truncate")}>{item.groupName}</span>}
              </span>
              <span className="shrink-0 text-[0.8125rem] tabular-nums">{formatLimitShare(item.costUsd, grand, costPerPercent)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
