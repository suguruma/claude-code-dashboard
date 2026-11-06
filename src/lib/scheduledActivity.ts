import type { StatusMark } from "./statusMark"
import { costPerPercentOf } from "./usageFormat"
import { familyOf } from "./usagePricing"
import type { UsageCalibration } from "./usageTypes"
import type { DefaultSelection, FamilyLabel, ScheduledRun } from "./scheduledActivityTypes"

/**
 * 予定タスクのタブ(⑯)の集計。サーバー(既定の選択)と画面(比べ・日ごとの表・一覧)の両方で使う純粋な関数だけを置く。
 * - 日と7日の期間は、PC の時刻(日本時間)の0時で切る(要件メモの決めたこと)
 * - 比べは7日の平均どうし。平均は「使用量が読めて、終わった回」だけ。どちらかが3回未満なら差を出さない
 * - 重さは前の7日の平均を100とした値(価格表による推定)
 */

/**
 * 予定タスク(Claude Desktop の scheduled task)の画面の呼び方。リソースのタブの名前と、セッション一覧の印で同じ語を使う(要件メモの言葉の表・A15)。
 * Claude Desktop の日本語の画面は「スケジュール済みタスク」と呼んでいる(2026-11-07 に同梱のファイルで数えた)。
 * オーナーの承認(ゲート1 の問1)は［予定タスク］。呼び方を合わせると決めたら、ここだけを直す
 */
export const SCHEDULED_TASK_LABEL = "予定タスク"

export const DAY_MS = 24 * 60 * 60 * 1000
export const RECENT_DAYS = 14
export const MIN_RUNS_FOR_DIFF = 3
export const UNKNOWN_AGENT_TYPE = "種類不明"

const LABELS: Record<string, FamilyLabel> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" }

export function familyLabel(model: string): FamilyLabel {
  const f = familyOf(model)
  return f ? LABELS[f] : "その他"
}

// ---------------------------------------------------------------------------
// 日(PC の時刻の0時で切る)

const pad = (n: number) => String(n).padStart(2, "0")

/** 時刻 → その日(YYYY-MM-DD。PC の時刻) */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** その日の0時(PC の時刻)の ms */
export function dayStart(key: string): number {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number)
  return dayKey(new Date(y, m - 1, d + days).getTime())
}

/** a − b の日数 */
export function diffDays(a: string, b: string): number {
  return Math.round((dayStart(a) - dayStart(b)) / DAY_MS)
}

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayKey(dayStart(value)) === value
}

/** 「M/DD」(11/03) */
export function shortDay(key: string): string {
  const [, m, d] = key.split("-").map(Number)
  return `${m}/${pad(d)}`
}

// ---------------------------------------------------------------------------
// 回の集まり

/** 回で使ったモデルの系統(本体とサブエージェント。系統の分からない物は数えない) */
function familiesOf(run: ScheduledRun): Set<FamilyLabel> {
  return new Set([...run.mainFamilies, ...run.subagentFamilies].filter((f) => f !== "その他"))
}

function byTask(runs: ScheduledRun[]): Map<string, ScheduledRun[]> {
  const map = new Map<string, ScheduledRun[]>()
  for (const r of runs) {
    const list = map.get(r.taskId)
    if (list) list.push(r)
    else map.set(r.taskId, [r])
  }
  return map
}

/**
 * 既定で選ぶ予定タスク(要件メモ 4-2)：
 * 直近14日に「新しいモデルの系統」が最初に出た回がいちばん新しい予定タスク。境目の日はその回の日。
 * - 系統で比べる(版の違いは同じ系統)。本体とサブエージェントのどちらに出ても同じに数える
 * - それより前の読める回のどれにも無かった系統だけ。前の回が読めない回(初回・読める範囲の最初の回)は数えない
 * - その系統が、最初に出た回から後の回の過半数で使われていること(時々だけ使う物は拾わない)
 * 該当が無ければ、直近14日の重さの合計が大きい順の1件目(境目は今日の7日前＝null)
 */
export function chooseDefault(runs: ScheduledRun[], now: number): DefaultSelection | null {
  const since = now - RECENT_DAYS * DAY_MS
  let best: { taskId: string; at: number } | null = null
  for (const [taskId, list] of byTask(runs)) {
    const readable = list.filter((r) => r.hasUsage).sort((a, b) => a.startedAt - b.startedAt)
    const seen = new Set<FamilyLabel>()
    readable.forEach((run, i) => {
      const fams = familiesOf(run)
      if (i > 0) {
        for (const f of fams) {
          if (seen.has(f)) continue
          const later = readable.slice(i)
          const used = later.filter((r) => familiesOf(r).has(f)).length
          if (used * 2 > later.length && run.startedAt >= since && run.startedAt <= now) {
            if (!best || run.startedAt > best.at) best = { taskId, at: run.startedAt }
          }
        }
      }
      for (const f of fams) seen.add(f)
    })
  }
  if (best) {
    const b = best as { taskId: string; at: number }
    return { taskId: b.taskId, reason: "new-family", boundaryDay: dayKey(b.at) }
  }
  let heavy: { taskId: string; cost: number } | null = null
  for (const [taskId, list] of byTask(runs)) {
    const recent = list.filter((r) => r.startedAt >= since && r.startedAt <= now)
    if (recent.length === 0) continue
    const cost = recent.reduce((sum, r) => sum + r.cost, 0)
    if (!heavy || cost > heavy.cost) heavy = { taskId, cost }
  }
  return heavy ? { taskId: (heavy as { taskId: string }).taskId, reason: "weight", boundaryDay: null } : null
}

/** 初めの境目の日：前に選んだ日 → 既定の選び方で選ばれた予定タスクなら理由の回の日 → 今日の7日前 */
export function initialBoundary(taskId: string, stored: string | null | undefined, selection: DefaultSelection | null, now: number): string {
  if (isDayKey(stored)) return stored
  if (selection && selection.taskId === taskId && selection.boundaryDay) return selection.boundaryDay
  return addDays(dayKey(now), -7)
}

// ---------------------------------------------------------------------------
// 段A：予定タスクの一覧

export interface TaskRow {
  taskId: string
  lastRun: ScheduledRun
  /** 直近14日の回数 */
  recentRuns: number
  /** 最後の回の本体のモデルの系統 */
  mainFamily: FamilyLabel | null
}

export interface TaskList {
  /** 直近14日に回がある予定タスク(最後の回の新しい順) */
  rows: TaskRow[]
  /** 直近14日に動いていない予定タスク(定義の名前と、記録に回がある物) */
  idle: string[]
}

export function buildTaskList(runs: ScheduledRun[], definitions: string[], now: number): TaskList {
  const since = now - RECENT_DAYS * DAY_MS
  const rows: TaskRow[] = []
  const idle = new Set<string>(definitions)
  for (const [taskId, list] of byTask(runs)) {
    const sorted = [...list].sort((a, b) => b.startedAt - a.startedAt)
    const recentRuns = sorted.filter((r) => r.startedAt >= since).length
    if (recentRuns === 0) {
      idle.add(taskId)
      continue
    }
    idle.delete(taskId)
    rows.push({ taskId, lastRun: sorted[0], recentRuns, mainFamily: sorted[0].mainFamilies[0] ?? null })
  }
  rows.sort((a, b) => b.lastRun.startedAt - a.lastRun.startedAt)
  return { rows, idle: [...idle].sort() }
}

export interface MarkCount {
  mark: StatusMark
  count: number
  /** 止まった物(× と ？)だけ、予定タスクの名前 */
  names: string[]
}

export interface TaskSummary {
  count: number
  marks: MarkCount[]
  /** 最後の回が24時間より前の数(色も印も付けない) */
  stale: number
}

/** 結論の1行目：最後の回の状態ごとの数と、24時間より前の数 */
export function summarizeTasks(rows: TaskRow[], now: number): TaskSummary {
  const groups = new Map<string, MarkCount>()
  for (const row of rows) {
    const m = row.lastRun.mark
    const key = `${m.symbol}${m.text}`
    const g = groups.get(key) ?? { mark: m, count: 0, names: [] }
    g.count++
    if (m.symbol === "×" || m.symbol === "？") g.names.push(row.taskId)
    groups.set(key, g)
  }
  const order = (m: StatusMark) => (m.symbol === "●" ? 0 : m.symbol === "◌" ? 1 : m.symbol === "‖" ? 2 : 3)
  const marks = [...groups.values()].sort((a, b) => order(a.mark) - order(b.mark) || b.count - a.count)
  return { count: rows.length, marks, stale: rows.filter((r) => now - r.lastRun.startedAt > DAY_MS).length }
}

// ---------------------------------------------------------------------------
// 段B：7日の平均どうしの比べ

export interface Side {
  /** 期間の始まりと終わりの日(終わりを含む) */
  from: string
  to: string
  /** 期間の中の回の数(全部) */
  total: number
  /** 使用量が読めない回 */
  noRecord: number
  /** 作業中の回 */
  running: number
  /** 読む期間より前に始まった回(記録の一部が読めていない) */
  outOfRecord: number
  /** 平均に入れた回 */
  valid: number
  avgCost: number | null
  minCost: number | null
  maxCost: number | null
  avgMainCost: number | null
  /** 1回あたりのサブエージェントの本数 */
  avgSubagents: number | null
  subagentFamilies: FamilyLabel[]
  /** 種類ごとの1回あたりの本数(多い順) */
  typesPerRun: { type: string; perRun: number }[]
}

export interface Comparison {
  boundary: string
  before: Side
  after: Side
  /** 前の7日の平均を100とした値。前の平均が無いときは null */
  index: {
    before: { total: number; main: number; min: number; max: number } | null
    after: { total: number; main: number; min: number; max: number } | null
  }
  /** 差(後 − 前。前を100とした値)。出さないときは null */
  diff: { total: number; main: number } | null
  /** 差を出さない理由 */
  blocked: "few" | "out-of-record" | null
  /** 後の7日が途中なら、何日目とあと何日。終わっていれば null */
  progress: { day: number; left: number } | null
}

function side(runs: ScheduledRun[], from: string, to: string, horizonStart: number): Side {
  const lo = dayStart(from)
  const hi = dayStart(addDays(to, 1))
  const inRange = runs.filter((r) => r.startedAt >= lo && r.startedAt < hi)
  const outOfRecord = inRange.filter((r) => r.startedAt < horizonStart)
  const valid = inRange.filter((r) => r.hasUsage && !r.running && r.startedAt >= horizonStart)
  const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const costs = valid.map((r) => r.cost)
  const typeTotals = new Map<string, number>()
  for (const r of valid) for (const [t, n] of Object.entries(r.subagentTypes)) typeTotals.set(t, (typeTotals.get(t) ?? 0) + n)
  const families = new Set<FamilyLabel>()
  for (const r of valid) for (const f of r.subagentFamilies) families.add(f)
  return {
    from,
    to,
    total: inRange.length,
    noRecord: inRange.filter((r) => !r.hasUsage && !r.running && r.startedAt >= horizonStart).length,
    running: inRange.filter((r) => r.running).length,
    outOfRecord: outOfRecord.length,
    valid: valid.length,
    avgCost: avg(costs),
    minCost: costs.length > 0 ? Math.min(...costs) : null,
    maxCost: costs.length > 0 ? Math.max(...costs) : null,
    avgMainCost: avg(valid.map((r) => r.mainCost)),
    avgSubagents: avg(valid.map((r) => r.subagentCount)),
    subagentFamilies: [...families],
    typesPerRun: [...typeTotals.entries()]
      .map(([type, n]) => ({ type, perRun: n / valid.length }))
      .sort((a, b) => b.perRun - a.perRun || a.type.localeCompare(b.type)),
  }
}

/** 選んだ予定タスクの回(ほかの予定タスクの回は渡さない)を、境目の日の前と後の7日で比べる */
export function compareRuns(runs: ScheduledRun[], boundary: string, now: number, horizonStart: number): Comparison {
  const before = side(runs, addDays(boundary, -7), addDays(boundary, -1), horizonStart)
  const after = side(runs, boundary, addDays(boundary, 6), horizonStart)
  const base = before.avgCost
  const mainBase = before.avgMainCost
  const idx = (s: Side) =>
    base && base > 0 && s.avgCost !== null
      ? {
          total: (s.avgCost / base) * 100,
          main: mainBase && mainBase > 0 && s.avgMainCost !== null ? (s.avgMainCost / mainBase) * 100 : 0,
          min: ((s.minCost ?? 0) / base) * 100,
          max: ((s.maxCost ?? 0) / base) * 100,
        }
      : null
  const index = { before: idx(before), after: idx(after) }
  let blocked: Comparison["blocked"] = null
  if (before.outOfRecord > 0) blocked = "out-of-record"
  else if (before.valid < MIN_RUNS_FOR_DIFF || after.valid < MIN_RUNS_FOR_DIFF) blocked = "few"
  const diff =
    blocked === null && index.before && index.after
      ? { total: index.after.total - index.before.total, main: index.after.main - index.before.main }
      : null
  const today = dayKey(now)
  const day = diffDays(today, boundary) + 1
  const progress = day <= 7 ? { day: Math.max(0, day), left: Math.min(7, 7 - day) } : null
  return { boundary, before, after, index, diff, blocked: diff ? null : (blocked ?? (index.before ? null : "few")), progress }
}

/** 回の重さを、前の7日の平均を100とした値にする。前の平均が無ければ null */
export function indexOf(cost: number, comparison: Comparison): number | null {
  const base = comparison.before.avgCost
  return base && base > 0 ? (cost / base) * 100 : null
}

/**
 * 1回あたりの消費を「週(全モデル)の上限の約％」にする(A12)。［利用上限］の係数(1%あたりの金額の範囲の中ほど)を、前と後に同じに当てる。
 * 係数が決まらない(公式値の記録が7日以内に無い・上限が無い)ときは null(画面は「出せません」の1行)
 */
export function limitPercents(
  comparison: Comparison,
  calibration: UsageCalibration | null
): { before: number; after: number } | null {
  const perPercent = costPerPercentOf(calibration)
  const { before, after } = comparison
  if (perPercent === null || before.avgCost === null || after.avgCost === null) return null
  return { before: before.avgCost / perPercent, after: after.avgCost / perPercent }
}

// ---------------------------------------------------------------------------
// 日ごとの表

export interface DayRow {
  day: string
  /** その日の回(新しい順)。動いていない日は空 */
  runs: ScheduledRun[]
}

/** 境目の前の7日と後の7日(今日まで)の日ごとの行(新しい順)。動いていない日も1行 */
export function dailyRows(runs: ScheduledRun[], boundary: string, now: number): DayRow[] {
  const first = addDays(boundary, -7)
  const lastOfAfter = addDays(boundary, 6)
  const today = dayKey(now)
  const last = diffDays(lastOfAfter, today) > 0 ? today : lastOfAfter
  const byDay = new Map<string, ScheduledRun[]>()
  for (const r of runs) {
    const k = dayKey(r.startedAt)
    const list = byDay.get(k)
    if (list) list.push(r)
    else byDay.set(k, [r])
  }
  const rows: DayRow[] = []
  for (let k = last; diffDays(k, first) >= 0; k = addDays(k, -1)) {
    rows.push({ day: k, runs: [...(byDay.get(k) ?? [])].sort((a, b) => b.startedAt - a.startedAt) })
  }
  return rows
}

/** 予定タスクのいつもの本体のモデルの系統(回の多い順の1位)。替わった回だけ印を付けるために使う */
export function usualMainFamily(runs: ScheduledRun[]): FamilyLabel | null {
  const counts = new Map<FamilyLabel, number>()
  for (const r of runs) {
    const f = r.mainFamilies[0]
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  let best: FamilyLabel | null = null
  let n = 0
  for (const [f, c] of counts) if (c > n) [best, n] = [f, c]
  return best
}
