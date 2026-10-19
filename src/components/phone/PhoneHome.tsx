"use client"

import Link from "next/link"
import { Activity, ChevronRight, Gauge, OctagonAlert, Send } from "lucide-react"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { useUsage } from "@/hooks/useUsage"
import { USAGE_KIND_LABEL, pickHomeWindows, usageValueKind } from "@/lib/homeDashboard"
import { displayUsageLevel, formatPercent, formatRemaining } from "@/lib/usageFormat"
import type { UsageWindowView } from "@/lib/usageTypes"
import {
  PHONE_SWR_OPTIONS,
  countRunning,
  decisionWaitLabel,
  phoneDecisionRows,
  sendLimitStopped,
  summarizeGroups,
} from "@/lib/phoneView"
import { cn } from "@/lib/utils"
import { LEVEL_LABEL, LEVEL_TEXT_COLOR } from "@/components/desktopSessions/UsageGauge"
import { formatAgo } from "@/components/desktopSessions/format"
import { CARD, META, PhoneNotice, SectionTitle, TAPPABLE } from "./parts"
import { openSession } from "./sessionHash"

/**
 * スマホのホーム(⑪-2)。PC から離れているときに知りたいことを上から順に出す:
 * あなたの対応待ち(件数と上位3件)→ 送信上限で停止と実行中の数 → 利用上限(5時間・週)→ グループごとの短い一覧(Q15)。
 * 組織図は出さない(スマホの幅では線と粒が読めないため)。
 */
export function PhoneHome() {
  const { data, error, isLoading } = useDesktopSessions(true, PHONE_SWR_OPTIONS)
  const { data: usage } = useUsage(true, PHONE_SWR_OPTIONS)
  const available = data !== null && data.source !== "none"
  const sessions = available ? data.sessions : []
  const decisions = phoneDecisionRows(sessions)
  const stopped = sendLimitStopped(sessions)
  const running = countRunning(sessions)
  const groups = available ? summarizeGroups(sessions, data.groups) : []
  const { fiveHour, weekly } = pickHomeWindows(usage?.windows ?? [])
  const now = usage?.generatedAt ?? null

  return (
    <div className="space-y-4">
      <PhoneNotice
        error={error}
        isLoading={isLoading}
        hasData={data !== null}
        empty={data?.source === "none" ? "Claude Desktop のデータが見つかりません。PC の画面で、データの場所を確かめてください。" : null}
      />

      {available && (
        <>
          <section className={cn(CARD, "overflow-hidden")} aria-labelledby="phone-home-decisions" data-testid="phone-home-decisions">
            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
              <OctagonAlert className="size-5 shrink-0 text-[var(--status-critical)]" aria-hidden />
              <h2 id="phone-home-decisions" className="flex-1 text-base font-semibold">
                あなたの対応待ち
              </h2>
              <span className="text-2xl font-semibold tabular-nums" data-testid="phone-home-decisions-count">
                {decisions.total}件
              </span>
            </div>
            {decisions.items.length === 0 ? (
              <p className={cn(META, "px-4 pb-3")}>いまはありません。</p>
            ) : (
              <ul className="divide-y">
                {decisions.items.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => openSession(d.id)} className={cn(TAPPABLE, "flex items-center gap-2 px-4 py-2.5")}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">{d.title}</span>
                        <span className={cn(META, "block truncate")}>
                          <span className="font-medium text-[var(--status-critical-text)]">{decisionWaitLabel(d)}</span>
                          {d.groupName && `・${d.groupName}`}・{formatAgo(d.lastActivityAt)}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {decisions.total > decisions.items.length && (
              <Link
                href="/desktop-sessions?status=attention"
                className={cn(TAPPABLE, "flex items-center justify-center border-t px-4 py-2.5 text-base text-primary")}
              >
                すべて見る（{decisions.total}件）
              </Link>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/desktop-sessions/housekeeping"
              className={cn(CARD, TAPPABLE, "p-3", stopped.length > 0 && "border-[var(--status-critical)]")}
              data-testid="phone-home-send-limit"
            >
              <span className={cn(META, "flex items-center gap-1")}>
                <Send className="size-4" aria-hidden />
                送信上限で停止
              </span>
              <span
                className="block text-2xl font-semibold tabular-nums"
                style={stopped.length > 0 ? { color: "var(--status-critical-text)" } : undefined}
              >
                {stopped.length}件
              </span>
              {stopped.length > 0 && <span className={cn(META, "block truncate")}>{stopped.map((s) => s.title).join("・")}</span>}
            </Link>
            <Link href="/desktop-sessions?status=running" className={cn(CARD, TAPPABLE, "p-3")} data-testid="phone-home-running">
              <span className={cn(META, "flex items-center gap-1")}>
                <Activity className="size-4" aria-hidden />
                実行中（推定）
              </span>
              <span className="block text-2xl font-semibold tabular-nums">{running}件</span>
            </Link>
          </div>
        </>
      )}

      <Link href="/desktop-sessions/usage" className={cn(CARD, TAPPABLE, "p-3")} data-testid="phone-home-usage">
        <span className={cn(META, "flex items-center gap-1")}>
          <Gauge className="size-4" aria-hidden />
          利用上限
        </span>
        <span className="mt-1 grid grid-cols-2 gap-3">
          <HomeUsageValue label="5時間" window={fiveHour} now={now} testId="phone-home-usage-five-hour" />
          <HomeUsageValue label="週" window={weekly} now={now} testId="phone-home-usage-weekly" />
        </span>
      </Link>

      {groups.length > 0 && (
        <section className="space-y-2" aria-labelledby="phone-home-groups">
          <SectionTitle>
            <span id="phone-home-groups">グループ</span>
          </SectionTitle>
          <ul className={cn(CARD, "divide-y overflow-hidden")} data-testid="phone-home-groups">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/desktop-sessions?group=${encodeURIComponent(g.id)}`}
                  className={cn(TAPPABLE, "flex items-center gap-2 px-4 py-2.5")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base">{g.name}</span>
                    <span className={cn(META, "block")}>
                      {g.total}件・実行中 {g.running}
                      {g.attention > 0 && (
                        <span className="font-medium text-[var(--status-critical-text)]">・対応待ち {g.attention}</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function HomeUsageValue({
  label,
  window: w,
  now,
  testId,
}: {
  label: string
  window: UsageWindowView | null
  now: number | null
  testId: string
}) {
  const display = w?.displayPercent ?? null
  const level = displayUsageLevel(display)
  const levelLabel = LEVEL_LABEL[level]
  return (
    <span className="block min-w-0" data-testid={testId}>
      <span className="block text-[0.8125rem] text-muted-foreground">{label}</span>
      <span className="block text-2xl font-semibold tabular-nums" style={level === "ok" ? undefined : { color: LEVEL_TEXT_COLOR[level] }}>
        {display === null ? "—" : `${formatPercent(display)}%`}
      </span>
      <span className={cn(META, "block")}>
        {w ? USAGE_KIND_LABEL[usageValueKind(w)] : "公式値なし"}
        {levelLabel && <span style={{ color: LEVEL_TEXT_COLOR[level] }}>・{levelLabel}</span>}
      </span>
      {w?.resetsAt != null && now !== null && <span className={cn(META, "block")}>リセット {formatRemaining(w.resetsAt - now)}</span>}
    </span>
  )
}
