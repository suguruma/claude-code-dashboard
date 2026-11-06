"use client"

import { useMemo, useState, type KeyboardEvent } from "react"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { StatusMarkBadge } from "@/components/desktopSessions/statusMeta"
import { RetryNotice, Skeleton } from "@/components/home/HomeLoading"
import { Button } from "@/components/ui/button"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { useScheduledActivity } from "@/hooks/useScheduledActivity"
import { useUsage } from "@/hooks/useUsage"
import {
  SCHEDULED_TASK_LABEL,
  buildTaskList,
  compareRuns,
  dailyRows,
  dayKey,
  indexOf,
  initialBoundary,
  isDayKey,
  limitPercents,
  summarizeTasks,
  usualMainFamily,
  type Comparison,
} from "@/lib/scheduledActivity"
import {
  agoText,
  conclusionLine2,
  countText,
  dateTimeText,
  dayText,
  periodText,
  resetBoundaryOf,
  runSubagentText,
  signed,
  subagentText,
  timeText,
  tokensText,
  typesLine,
} from "@/lib/scheduledActivityText"
import type { ScheduledActivityResponse, ScheduledRun } from "@/lib/scheduledActivityTypes"
import type { UsageCalibration } from "@/lib/usageTypes"
import { cn } from "@/lib/utils"

/** 選んだ予定タスクと境目の日は、この画面の中(ブラウザの保存)にだけ覚える(AG-7。~/.claude にも設定フォルダにも書かない) */
const STORE_KEY = "ccd:scheduled-tab:v1"

interface Stored {
  taskId?: string
  boundaries?: Record<string, string>
}

/** 保存した値の形を確かめる(壊れた値・古い形は捨てる) */
function sanitize(raw: unknown): Stored {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const boundaries: Record<string, string> = {}
  if (r.boundaries && typeof r.boundaries === "object") {
    for (const [k, v] of Object.entries(r.boundaries as Record<string, unknown>)) if (isDayKey(v)) boundaries[k] = v
  }
  return { taskId: typeof r.taskId === "string" ? r.taskId : undefined, boundaries }
}

/** 灰色の濃淡(［利用上限］の積み上げ棒と同じ)。色に頼らず、棒の横に系統と数を書く */
const SHADES = [0.85, 0.6, 0.4, 0.25]

/**
 * リソースの［予定タスク］(⑯)。上から 結論の2行 → 段B 選んだ予定タスクの比べ → 日ごとの表 → 段A 予定タスクの一覧。
 * 読み取りだけ。重さは価格表による推定で、前の7日の平均を100とした値で出す。
 */
export function ScheduledView() {
  const { data, error, isLoading, isValidating, reload } = useScheduledActivity()
  const usage = useUsage()
  // 保存した選択(サーバーの描画では空。画面に出てから保存した値を読む)
  const [raw, update] = usePersistedState<unknown>(STORE_KEY, {})
  const stored = useMemo(() => sanitize(raw), [raw])
  const [openId, setOpenId] = useState<string | null>(null)

  if (isLoading && !data) return <ScheduledSkeleton />
  if (error && !data) {
    return <RetryNotice phase="failed" text="！ 予定タスクの記録を読み込めませんでした。" onRetry={async () => reload()} />
  }
  if (!data) return <ScheduledSkeleton />
  if (data.runs.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p>{SCHEDULED_TASK_LABEL}の記録がありません（Claude Desktop の予定を使うと、ここに出ます）。</p>
        {isValidating && <p className="text-muted-foreground">読み込んでいます</p>}
      </div>
    )
  }
  const calibration = usage.data?.windows.find((w) => w.id === "weekly_all")?.calibration ?? null
  return (
    <>
      <ScheduledBody data={data} stored={stored} onStore={update} onOpen={setOpenId} calibration={calibration} usageReady={usage.data !== null} />
      <SessionDetailDialog sessionId={openId} highContextRatio={0.8} onClose={() => setOpenId(null)} />
    </>
  )
}

function ScheduledBody({
  data,
  stored,
  onStore,
  onOpen,
  calibration,
  usageReady,
}: {
  data: ScheduledActivityResponse
  stored: Stored
  onStore: (s: Stored) => void
  onOpen: (desktopId: string) => void
  calibration: UsageCalibration | null
  usageReady: boolean
}) {
  const now = data.generatedAt
  const list = useMemo(() => buildTaskList(data.runs, data.definitions, now), [data, now])
  const known = new Set(data.runs.map((r) => r.taskId))
  const taskId =
    (stored.taskId && known.has(stored.taskId) ? stored.taskId : null) ?? data.defaultSelection?.taskId ?? list.rows[0]?.taskId ?? data.runs[0].taskId
  const boundary = initialBoundary(taskId, stored.boundaries?.[taskId], data.defaultSelection, now)
  const taskRuns = useMemo(() => data.runs.filter((r) => r.taskId === taskId), [data, taskId])
  const comparison = useMemo(() => compareRuns(taskRuns, boundary, now, data.horizonStart), [taskRuns, boundary, now, data.horizonStart])
  const mainFamily = usualMainFamily(taskRuns)
  const summary = summarizeTasks(list.rows, now)

  const select = (id: string) => onStore({ ...stored, taskId: id })
  const setBoundary = (day: string) => onStore({ ...stored, taskId, boundaries: { ...stored.boundaries, [taskId]: day } })

  return (
    <div className="space-y-6" data-testid="scheduled-view">
      <section aria-label="結論" className="space-y-1 text-sm" data-testid="scheduled-conclusion">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {SCHEDULED_TASK_LABEL} {summary.count}件：最後の回
          </span>
          {summary.marks.map((m) => (
            <span key={`${m.mark.symbol}${m.mark.text}`} className="inline-flex items-center gap-1">
              <StatusMarkBadge mark={{ ...m.mark, estimated: false }} />
              <span className="tabular-nums">{m.count}</span>
              {m.names.length > 0 && <span className="text-muted-foreground">（{m.names.slice(0, 2).join("・")}{m.names.length > 2 ? ` ほか${m.names.length - 2}` : ""}）</span>}
            </span>
          ))}
          <span className="text-muted-foreground">・最後の回が24時間より前 {summary.stale}件</span>
        </p>
        <p data-testid="scheduled-conclusion-2">{conclusionLine2(taskId, comparison, mainFamily, data.horizonDays)}</p>
      </section>

      <CompareSection
        taskId={taskId}
        comparison={comparison}
        mainFamily={mainFamily}
        today={dayKey(now)}
        onBoundary={setBoundary}
        calibration={calibration}
        usageReady={usageReady}
        horizonDays={data.horizonDays}
      />

      <DailySection runs={taskRuns} comparison={comparison} now={now} mainFamily={mainFamily} onOpen={onOpen} />

      <TaskListSection rows={list.rows} idle={list.idle} selected={taskId} now={now} onSelect={select} />

      <p className="text-sm text-muted-foreground">
        記録は15日まで（{SCHEDULED_TASK_LABEL}の回は{data.horizonDays}日まで）。回数と「動いていない」は直近14日。重さは推定（価格表による）で、前の7日の平均を100とした値。
      </p>
    </div>
  )
}

function CompareSection({
  taskId,
  comparison: c,
  mainFamily,
  today,
  onBoundary,
  calibration,
  usageReady,
  horizonDays,
}: {
  taskId: string
  comparison: Comparison
  mainFamily: string | null
  today: string
  onBoundary: (day: string) => void
  calibration: UsageCalibration | null
  usageReady: boolean
  horizonDays: number
}) {
  const percents = limitPercents(c, calibration)
  const idx = (v: number | undefined | null) => (v === undefined || v === null ? "―" : String(Math.round(v)))
  const reset = resetBoundaryOf(today)
  return (
    <section aria-labelledby="scheduled-compare-title" className="space-y-2" data-testid="scheduled-compare">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="scheduled-compare-title" className="text-base font-medium">
          {taskId} の比べ
        </h3>
        <label className="inline-flex items-center gap-2 text-sm">
          境目の日
          <input
            type="date"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={c.boundary}
            max={today}
            onChange={(e) => {
              if (isDayKey(e.target.value)) onBoundary(e.target.value)
            }}
          />
        </label>
        <Button type="button" variant="outline" className="h-9" disabled={c.boundary === reset} onClick={() => onBoundary(reset)}>
          今日から7日前に戻す
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="scheduled-period">
        {periodText(c)}。前の7日を100とした値（推定）
        {usageReady &&
          (percents
            ? `・週（全モデル）の上限で 約${percents.before.toFixed(1)}% → 約${percents.after.toFixed(1)}%（${signed(percents.after - percents.before)}ポイント）`
            : "。上限の約％は、公式値の記録が7日以内に無いため出せません")}
      </p>
      <table className="w-full text-sm" data-testid="scheduled-compare-table">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">期間</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">回数</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">重さ（合計）</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">本体{mainFamily ? `（${mainFamily}）` : ""}</th>
            <th className="py-1.5 font-normal whitespace-nowrap">サブエージェント（1回あたり）</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {(
            [
              ["前の7日", c.before, c.index.before],
              ["後の7日", c.after, c.index.after],
            ] as const
          ).map(([label, side, index]) => (
            <tr key={label} className="border-b">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap">
                {label}
              </th>
              <td className="py-1.5 pr-3">{countText(side)}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <strong>{idx(index?.total)}</strong>
                {index && side.valid > 1 && Math.round(index.min) !== Math.round(index.max) && (
                  <span className="text-muted-foreground">
                    （幅 {Math.round(index.min)}〜{Math.round(index.max)}）
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3">{idx(index?.main)}</td>
              <td className="py-1.5">{subagentText(side)}</td>
            </tr>
          ))}
          <tr data-testid="scheduled-diff-row">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap">
              差
            </th>
            {c.diff ? (
              <>
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 pr-3">
                  <strong>{signed(c.diff.total)}</strong>
                </td>
                <td className="py-1.5 pr-3">{signed(c.diff.main)}</td>
                <td className="py-1.5" />
              </>
            ) : (
              <td colSpan={4} className="py-1.5 text-muted-foreground">
                {c.blocked === "out-of-record"
                  ? `前の7日のうち${c.before.outOfRecord}回は記録の外（${horizonDays}日より前）のため、差を出しません`
                  : `回数が少ないため比べない（前${c.before.valid}回・後${c.after.valid}回。どちらも3回以上で差を出します）`}
              </td>
            )}
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground" data-testid="scheduled-types">
        {typesLine(c)}
      </p>
    </section>
  )
}

function TokenBar({ run }: { run: ScheduledRun }) {
  const total = run.tokens.reduce((s, t) => s + t.tokens, 0)
  if (total === 0) return null
  return (
    <span className="flex h-3 w-16 shrink-0 overflow-hidden rounded-sm bg-muted" aria-hidden>
      {run.tokens.map((t, i) => (
        <span
          key={`${t.subagent ? "s" : "m"}${t.family}`}
          className="h-full border-r-2 border-background last:border-r-0"
          style={{ width: `${(t.tokens / total) * 100}%`, background: "var(--primary)", opacity: SHADES[i % SHADES.length] }}
        />
      ))}
    </span>
  )
}

function DailySection({
  runs,
  comparison,
  now,
  mainFamily,
  onOpen,
}: {
  runs: ScheduledRun[]
  comparison: Comparison
  now: number
  mainFamily: string | null
  onOpen: (desktopId: string) => void
}) {
  const rows = dailyRows(runs, comparison.boundary, now)
  const open = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onOpen(id)
    }
  }
  return (
    <section aria-labelledby="scheduled-daily-title" className="space-y-2" data-testid="scheduled-daily">
      <h3 id="scheduled-daily-title" className="text-base font-medium">
        日ごとの表
      </h3>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">日付</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">時刻</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">最後の状態</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">サブエージェント</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">重さ</th>
            <th className="py-1.5 font-normal whitespace-nowrap">トークン（キャッシュの読み出しを含む）</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.flatMap((row) =>
            row.runs.length === 0
              ? [
                  <tr key={row.day} className={cn("border-b", row.day === comparison.boundary && "border-t-2 border-t-foreground/40")} data-testid="scheduled-day-idle">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{dayText(row.day)}</td>
                    <td colSpan={5} className="py-1.5 text-muted-foreground">
                      ― 動いていない
                    </td>
                  </tr>,
                ]
              : row.runs.map((run, i) => {
                  const w = run.hasUsage && !run.running ? indexOf(run.cost, comparison) : null
                  const changed = mainFamily && run.mainFamilies[0] && run.mainFamilies[0] !== mainFamily ? run.mainFamilies[0] : null
                  return (
                    <tr
                      key={run.desktopId}
                      tabIndex={0}
                      className={cn(
                        "cursor-pointer border-b outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                        row.day === comparison.boundary && i === 0 && "border-t-2 border-t-foreground/40"
                      )}
                      onClick={() => onOpen(run.desktopId)}
                      onKeyDown={(e) => open(e, run.desktopId)}
                      aria-label={`${dayText(row.day)} ${timeText(run.startedAt)} の回の詳細を開く`}
                      data-testid="scheduled-day-run"
                    >
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {dayText(row.day)}
                        {changed && <span className="ml-1 text-muted-foreground">本体 {changed}</span>}
                      </td>
                      <td className="py-1.5 pr-3">{timeText(run.startedAt)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {/* 印の中の「（推定）」が次の行へ落ちないよう、印の幅は中身の幅にする(1024 で行を折らない。A8) */}
                        <span className="inline-block w-max">
                          <StatusMarkBadge mark={run.mark} />
                          {run.stopReason && <span className="ml-1 text-muted-foreground">{run.stopReason}</span>}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{runSubagentText(run)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{w === null ? "―" : Math.round(w)}</td>
                      <td className="py-1.5">
                        {run.hasUsage ? (
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <TokenBar run={run} />
                            {tokensText(run.tokens)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">― 記録なし</span>
                        )}
                      </td>
                    </tr>
                  )
                })
          )}
        </tbody>
      </table>
    </section>
  )
}

function TaskListSection({
  rows,
  idle,
  selected,
  now,
  onSelect,
}: {
  rows: ReturnType<typeof buildTaskList>["rows"]
  idle: string[]
  selected: string
  now: number
  onSelect: (taskId: string) => void
}) {
  return (
    <section aria-labelledby="scheduled-list-title" className="space-y-2" data-testid="scheduled-list">
      <h3 id="scheduled-list-title" className="text-base font-medium">
        {SCHEDULED_TASK_LABEL}の一覧
      </h3>
      <table className="w-full text-sm" role="grid" aria-label={`${SCHEDULED_TASK_LABEL}の一覧（行を選ぶと、比べと日ごとの表が替わります）`}>
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">{SCHEDULED_TASK_LABEL}</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">最後の回</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">何時間前</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">最後の状態</th>
            <th className="py-1.5 pr-3 font-normal whitespace-nowrap">直近14日の回数</th>
            <th className="py-1.5 font-normal whitespace-nowrap">本体のモデル</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => {
            const isSelected = row.taskId === selected
            return (
              <tr
                key={row.taskId}
                aria-selected={isSelected}
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-b outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "bg-muted/40"
                )}
                onClick={() => onSelect(row.taskId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect(row.taskId)
                  }
                }}
                data-testid="scheduled-task-row"
              >
                <td className={cn("py-1.5 pr-3 pl-2 border-l-4", isSelected ? "border-l-foreground" : "border-l-transparent")}>
                  <span className="font-medium">{row.taskId}</span>
                  {isSelected && <span className="ml-2 text-muted-foreground">選択中</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{dateTimeText(row.lastRun.startedAt)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{agoText(row.lastRun.startedAt, now)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span className="inline-block w-max">
                    <StatusMarkBadge mark={row.lastRun.mark} />
                    {row.lastRun.stopReason && <span className="ml-1 text-muted-foreground">{row.lastRun.stopReason}</span>}
                  </span>
                </td>
                <td className="py-1.5 pr-3">{row.recentRuns}</td>
                <td className="py-1.5">{row.mainFamily ?? "―"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {idle.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="scheduled-idle">
          直近14日に動いていない {idle.length}件：{idle.join("・")}
        </p>
      )}
    </section>
  )
}

/** 読み込み中の骨組み(結論の2行・比べ・日ごとの表・一覧) */
function ScheduledSkeleton() {
  return (
    <div className="space-y-6" aria-busy data-testid="scheduled-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-32 w-full" />
      <span className="sr-only">{SCHEDULED_TASK_LABEL}の記録を読み込んでいます</span>
    </div>
  )
}
