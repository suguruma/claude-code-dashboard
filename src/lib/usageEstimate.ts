import { costOf, type PriceBook } from "./usagePricing"
import type { UsageRow } from "./usageLedger"
import type { SnapshotWindow, UsageSnapshot } from "./usageSnapshots"
import type {
  UsageAccuracy,
  UsageCalibration,
  UsageContribution,
  UsageContributionSet,
  UsageEstimate,
  UsageGuard,
  UsageOfficialValue,
  UsagePace,
  UsageTokens,
  UsageWindowKey,
  UsageWindowView,
} from "./usageTypes"

/**
 * 利用上限の推定。公式値(usage-snapshots.jsonl)と会話記録の使用量から、次を計算する純粋な関数群。
 * 時刻はすべてUTCのms(epoch)で計算する。画面での日本時間への変換は画面側で行う。
 *
 * 考え方: 会話記録の使用量をAPI価格で金額に換算し、公式値の%で割った「1%あたりの金額(係数)」を較正する。
 * 公式値は整数に丸められているため、1点の公式値(p%)から、係数の範囲 [金額/(p+0.5), 金額/(p-0.5)] が決まる。
 * 直近7日の公式値の範囲を重ねて絞り込む(重ならない値は、記録に残らない利用があった等の外れ値として使わない)。
 * 推定は「その枠の中の最新の公式値」を起点に、その後に増えた金額を係数で割った分を足す。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const FIVE_HOUR_MS = 5 * HOUR
export const WEEK_MS = 7 * DAY
/** 較正に使う公式値の範囲(直近) */
const CALIBRATION_SPAN_MS = 7 * DAY
/** 同じ枠とみなすresetsAtの許容差(記録によって秒の端数がずれる) */
const SAME_WINDOW_TOLERANCE_MS = 60 * 1000
/** 係数の範囲を重ねるときの許容(金額の換算誤差・時刻のずれで、丸め以外の理由で重ならない場合に備える) */
const RANGE_TOLERANCE = 0.02
const GUARD_WARN = 80
const GUARD_HIGH = 90
const PACE_HALF_LIFE_MIN = 20
const PACE_EWMA_SPAN_MIN = 180
/** ペースを出すのに必要な、枠の始まりからの最短の経過 */
const PACE_MIN_ELAPSED_MIN = 5
/** 100%到達の予測がリセットより前でも、差がこれ以内なら「リセットとほぼ同時」とする(5時間の枠は15分、週の枠は2時間) */
const NEAR_RESET_MARGIN_MS: Record<UsageWindowKey, number> = {
  five_hour: 15 * MINUTE,
  weekly_all: 2 * HOUR,
  weekly_model: 2 * HOUR,
}

export const USAGE_NOTE =
  "推定は、会話記録のトークン量をAPI価格で金額に換算し、公式値で較正した係数で割った値です。公式値は整数に丸められ、" +
  "claude.aiやスマホなど会話記録に残らない利用は含まれません。会話記録の時刻は応答が終わった時刻のため、数分の遅れが出ることがあります。"

// ---------------------------------------------------------------------------
// 窓の識別と名前

export interface WindowIdentity {
  key: UsageWindowKey
  modelName: string | null
}

function identityId(identity: WindowIdentity): string {
  return identity.key === "weekly_model" ? `weekly_model:${identity.modelName}` : identity.key
}

export function windowLabel(identity: WindowIdentity): string {
  if (identity.key === "five_hour") return "5時間"
  if (identity.key === "weekly_all") return "週（全モデル）"
  return `週（${identity.modelName}）`
}

function durationOf(key: UsageWindowKey): number {
  return key === "five_hour" ? FIVE_HOUR_MS : WEEK_MS
}

function sameIdentity(w: SnapshotWindow, identity: WindowIdentity): boolean {
  return w.key === identity.key && (identity.key !== "weekly_model" || w.modelName?.toLowerCase() === identity.modelName?.toLowerCase())
}

/** weekly_model の窓は、message.model に窓のモデル名(Fable等)を含む行だけが対象(大文字小文字を区別しない) */
function rowMatches(row: UsageRow, identity: WindowIdentity): boolean {
  if (identity.key !== "weekly_model" || !identity.modelName) return true
  return row.model.toLowerCase().includes(identity.modelName.toLowerCase())
}

function snapshotWindowOf(snapshot: UsageSnapshot, identity: WindowIdentity): SnapshotWindow | null {
  return snapshot.windows.find((w) => sameIdentity(w, identity)) ?? null
}

// ---------------------------------------------------------------------------
// 金額の累積(二分探索で、任意の区間の金額をすぐ求める)

class CostIndex {
  private readonly times: number[] = []
  private readonly cumulative: number[] = [0]

  constructor(rows: UsageRow[], costs: (row: UsageRow) => number) {
    let sum = 0
    for (const row of rows) {
      this.times.push(row.at)
      sum += costs(row)
      this.cumulative.push(sum)
    }
  }

  private lowerBound(t: number): number {
    let lo = 0
    let hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private upperBound(t: number): number {
    let lo = 0
    let hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** from <= 時刻 <= to の金額(fromInclusive=false なら from < 時刻 <= to) */
  between(from: number, to: number, fromInclusive = true): number {
    if (to < from) return 0
    const a = fromInclusive ? this.lowerBound(from) : this.upperBound(from)
    const b = this.upperBound(to)
    return b > a ? this.cumulative[b] - this.cumulative[a] : 0
  }
}

function emptyTokens(): UsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function addTokens(into: UsageTokens, row: UsageRow): void {
  into.input += row.input
  into.output += row.output
  into.cacheRead += row.cacheRead
  into.cacheWrite += row.cacheWrite5m + row.cacheWrite1h
}

// ---------------------------------------------------------------------------
// 較正

interface CoefficientRange {
  lo: number
  /** 上限が無い(公式値が0%だけ)ときは Infinity */
  hi: number
}

function rangeFromSnapshot(cost: number, percent: number): CoefficientRange | null {
  if (!(cost > 0) || percent < 0) return null
  return { lo: cost / (percent + 0.5), hi: percent >= 1 ? cost / (percent - 0.5) : Infinity }
}

interface CalibrationResult {
  calibration: UsageCalibration
  /** 推定に使う係数(範囲の中央。上限が無いときは下限=控えめに見て%が大きく出る側) */
  mid: number
  lo: number
  hi: number
}

/**
 * 直近7日(upToTs以前)の公式値から、1%あたりの金額の範囲を決める。新しい公式値から順に範囲を重ね、
 * 重ならないものは外れ値として使わない。使える公式値が無ければ null。
 */
function calibrate(
  identity: WindowIdentity,
  snapshots: UsageSnapshot[],
  index: CostIndex,
  upToTs: number
): CalibrationResult | null {
  const duration = durationOf(identity.key)
  const ranges: CoefficientRange[] = []
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i]
    if (snap.ts > upToTs) continue
    if (snap.ts < upToTs - CALIBRATION_SPAN_MS) break
    const w = snapshotWindowOf(snap, identity)
    if (!w) continue
    const range = rangeFromSnapshot(index.between(w.resetsAt - duration, snap.ts), w.percentUsed)
    if (range) ranges.push(range)
  }
  if (ranges.length === 0) return null

  let { lo, hi } = ranges[0]
  let samples = 1
  for (const r of ranges.slice(1)) {
    const nextLo = Math.max(lo, r.lo * (1 - RANGE_TOLERANCE))
    const nextHi = Math.min(hi, r.hi * (1 + RANGE_TOLERANCE))
    if (nextLo <= nextHi) {
      lo = nextLo
      hi = nextHi
      samples++
    }
  }
  const mid = Number.isFinite(hi) ? (lo + hi) / 2 : lo
  return {
    calibration: {
      costPerPercentLow: lo,
      costPerPercentHigh: Number.isFinite(hi) ? hi : null,
      mode: samples >= 2 ? "intersect" : "single",
      samples,
    },
    mid,
    lo,
    hi,
  }
}

/** 公式値 anchor(p%) の後に増えた金額 delta から、いまの%と幅を求める */
function estimateFrom(anchorPercent: number, delta: number, cal: CalibrationResult): { percent: number; low: number; high: number } {
  const percent = anchorPercent + delta / cal.mid
  const low = Math.max(0, anchorPercent - 0.5) + (Number.isFinite(cal.hi) ? delta / cal.hi : 0)
  const high = anchorPercent + 0.5 + delta / cal.lo
  return { percent, low: Math.min(low, percent), high: Math.max(high, percent) }
}

// ---------------------------------------------------------------------------
// 現在の枠

interface CurrentWindow {
  start: number | null
  resetsAt: number | null
}

function firstRowAtOrAfter(rows: UsageRow[], t: number): UsageRow | null {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].at < t) lo = mid + 1
    else hi = mid
  }
  return lo < rows.length ? rows[lo] : null
}

/**
 * 現在の枠の始まりと終わり。
 * - 最新の記録の resetsAt が未来なら、その枠(始まり = resetsAt − 5時間 / 7日)
 * - 週の枠が切り替わっていれば、resetsAt を7日ずつ進める
 * - 5時間の枠が切り替わっていれば、「前の枠が終わった後の最初のリクエスト」を新しい枠の始まりとする
 *   (isSidechain・サブエージェントの行も含める。どれも上限を消費するため)
 */
function currentWindow(identity: WindowIdentity, last: SnapshotWindow, rows: UsageRow[], now: number): CurrentWindow {
  const duration = durationOf(identity.key)
  if (last.resetsAt > now) return { start: last.resetsAt - duration, resetsAt: last.resetsAt }

  if (identity.key !== "five_hour") {
    const periods = Math.floor((now - last.resetsAt) / duration) + 1
    const resetsAt = last.resetsAt + periods * duration
    return { start: resetsAt - duration, resetsAt }
  }

  let boundary = last.resetsAt
  for (let guard = 0; guard < 200; guard++) {
    const first = firstRowAtOrAfter(rows, boundary)
    if (!first) return { start: null, resetsAt: null }
    const end = first.at + duration
    if (end > now) return { start: first.at, resetsAt: end }
    boundary = end
  }
  return { start: null, resetsAt: null }
}

// ---------------------------------------------------------------------------
// ペース

function ewmaRatePerMinute(costs: Array<{ at: number; cost: number }>, now: number, spanMin: number): number {
  const lambda = Math.LN2 / PACE_HALF_LIFE_MIN
  let weighted = 0
  for (const c of costs) weighted += c.cost * Math.exp((-lambda * (now - c.at)) / MINUTE)
  return (weighted * lambda) / (1 - Math.exp(-lambda * spanMin))
}

/**
 * 100%に達する予測時刻がリセットより前で、その差が小さいか。ペースの予測はもともと数十分〜数時間ぶれるため、
 * 差が小さいときは「リセットより先に達する」と警告せず、「ほぼ同時」として扱う。
 */
export function isNearReset(
  key: UsageWindowKey,
  etaAt: number | null,
  resetsAt: number | null,
  percentNow: number
): boolean {
  if (etaAt === null || resetsAt === null || percentNow >= 100) return false
  return etaAt < resetsAt && resetsAt - etaAt <= NEAR_RESET_MARGIN_MS[key]
}

function buildPace(
  identity: WindowIdentity,
  rows: UsageRow[],
  costOfRow: (row: UsageRow) => number,
  window: CurrentWindow,
  percentNow: number,
  coefficient: number,
  now: number
): UsagePace | null {
  if (window.start === null) return null
  const elapsedMin = (now - window.start) / MINUTE
  if (elapsedMin < PACE_MIN_ELAPSED_MIN) return null
  const inWindow = rows.filter((r) => r.at >= (window.start as number) && r.at <= now && rowMatches(r, identity))

  let ratePerHour: number
  let basis: UsagePace["basis"]
  let mean60PerHour: number | null = null
  if (identity.key === "five_hour") {
    const spanMin = Math.min(PACE_EWMA_SPAN_MIN, elapsedMin)
    const recent = inWindow.filter((r) => now - r.at <= spanMin * MINUTE).map((r) => ({ at: r.at, cost: costOfRow(r) }))
    ratePerHour = (ewmaRatePerMinute(recent, now, spanMin) * 60) / coefficient
    basis = "ewma30"
    const span60 = Math.min(60, elapsedMin)
    const cost60 = inWindow.filter((r) => now - r.at <= 60 * MINUTE).reduce((s, r) => s + costOfRow(r), 0)
    mean60PerHour = cost60 / (span60 / 60) / coefficient
  } else {
    // 週は、直近24時間(枠が始まって24時間に満たなければ、その経過)の平均
    const spanHours = Math.min(24, elapsedMin / 60)
    const cost = inWindow.filter((r) => now - r.at <= spanHours * HOUR).reduce((s, r) => s + costOfRow(r), 0)
    ratePerHour = cost / spanHours / coefficient
    basis = "mean24h"
  }

  let etaAt: number | null = null
  if (percentNow >= 100) etaAt = now
  else if (ratePerHour > 0) etaAt = now + ((100 - percentNow) / ratePerHour) * HOUR
  const beforeReset = etaAt !== null && window.resetsAt !== null && etaAt < window.resetsAt
  const nearReset = isNearReset(identity.key, etaAt, window.resetsAt, percentNow)
  return { ratePerHour, basis, mean60PerHour, etaAt, beforeReset, nearReset }
}

// ---------------------------------------------------------------------------
// 窓ごとの組み立て

export interface BuildUsageInput {
  now: number
  /** 記録の時刻順(古い順) */
  snapshots: UsageSnapshot[]
  /** 重複を除いた応答。時刻順(古い順) */
  rows: UsageRow[]
  prices: PriceBook
}

export interface BuildUsageOutput {
  windows: UsageWindowView[]
  guard: UsageGuard
  accuracy: UsageAccuracy
  unregisteredModels: string[]
  /** 窓の始まり(5時間・週)。積み上げ棒の集計期間に使う。分からなければ null */
  fiveHourStart: number | null
  weekStart: number | null
}

function identitiesOf(snapshots: UsageSnapshot[], now: number): WindowIdentity[] {
  const seen = new Map<string, WindowIdentity>()
  for (const snap of snapshots) {
    if (snap.ts < now - 8 * DAY) continue
    for (const w of snap.windows) {
      const identity: WindowIdentity = { key: w.key, modelName: w.modelName }
      const id = identityId(identity).toLowerCase()
      if (!seen.has(id)) seen.set(id, identity)
    }
  }
  const order: Record<UsageWindowKey, number> = { five_hour: 0, weekly_all: 1, weekly_model: 2 }
  return [...seen.values()].sort((a, b) => order[a.key] - order[b.key] || (a.modelName ?? "").localeCompare(b.modelName ?? ""))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

export function buildUsage(input: BuildUsageInput): BuildUsageOutput {
  const { now, snapshots, rows, prices } = input

  // モデルごとの単価は1回だけ引く
  const priceCache = new Map<string, (row: UsageRow) => number>()
  const unregistered = new Set<string>()
  function costOfRow(row: UsageRow): number {
    let cost = priceCache.get(row.model)
    if (!cost) {
      const resolved = prices.resolve(row.model)
      if (resolved.via === "none") unregistered.add(row.model)
      cost = (r) => costOf(r, resolved.price)
      priceCache.set(row.model, cost)
    }
    return cost(row)
  }

  const allIndex = new CostIndex(rows, costOfRow)
  const indexByIdentity = new Map<string, CostIndex>()
  function indexFor(identity: WindowIdentity): CostIndex {
    if (identity.key !== "weekly_model") return allIndex
    const id = identityId(identity).toLowerCase()
    let index = indexByIdentity.get(id)
    if (!index) {
      index = new CostIndex(rows.filter((r) => rowMatches(r, identity)), costOfRow)
      indexByIdentity.set(id, index)
    }
    return index
  }

  const windows: UsageWindowView[] = []
  const accuracySamples: number[] = []
  let fiveHourStart: number | null = null
  let weekStart: number | null = null

  for (const identity of identitiesOf(snapshots, now)) {
    const history = snapshots.filter((s) => snapshotWindowOf(s, identity))
    const lastSnap = history[history.length - 1]
    const last = lastSnap ? snapshotWindowOf(lastSnap, identity) : null
    if (!lastSnap || !last) continue

    const index = indexFor(identity)
    const current = currentWindow(identity, last, rows, now)
    const toOfficial = (snap: UsageSnapshot, w: SnapshotWindow): UsageOfficialValue => ({
      percentUsed: w.percentUsed,
      recordedAt: snap.ts,
      resetsAt: w.resetsAt,
    })

    // 現在の枠の中で最新の公式値
    let official: UsageOfficialValue | null = null
    let anchorTs = 0
    if (current.resetsAt !== null) {
      for (let i = history.length - 1; i >= 0; i--) {
        const w = snapshotWindowOf(history[i], identity)
        if (w && Math.abs(w.resetsAt - current.resetsAt) <= SAME_WINDOW_TOLERANCE_MS) {
          official = toOfficial(history[i], w)
          anchorTs = history[i].ts
          break
        }
      }
    }
    const previousOfficial = official === null ? toOfficial(lastSnap, last) : null

    const cal = calibrate(identity, history, index, now)
    let estimate: UsageEstimate
    if (official === null) {
      estimate = { kind: "none", reason: "no-official" }
    } else if (!cal) {
      estimate = { kind: "none", reason: "no-calibration" }
    } else {
      const delta = index.between(anchorTs, now, false)
      estimate = { kind: "estimate", ...estimateFrom(official.percentUsed, delta, cal) }
    }

    const displayPercent =
      estimate.kind === "estimate" ? estimate.percent : official ? official.percentUsed : null

    const tokens = emptyTokens()
    let windowCost = 0
    if (current.start !== null) {
      for (const row of rows) {
        if (row.at < current.start || row.at > now || !rowMatches(row, identity)) continue
        addTokens(tokens, row)
        windowCost += costOfRow(row)
      }
    }

    const pace =
      cal && displayPercent !== null && estimate.kind === "estimate"
        ? buildPace(identity, rows, costOfRow, current, displayPercent, cal.mid, now)
        : null

    if (identity.key === "five_hour") fiveHourStart = current.start
    if (identity.key === "weekly_all") weekStart = current.start

    windows.push({
      id: identityId(identity),
      key: identity.key,
      label: windowLabel(identity),
      modelName: identity.modelName,
      windowStart: current.start,
      resetsAt: current.resetsAt,
      official,
      previousOfficial,
      estimate,
      displayPercent,
      tokens,
      costUsd: windowCost,
      calibration: cal?.calibration ?? null,
      pace,
    })

    // 精度: 直近7日の公式値それぞれについて、その直前の公式値を起点にした推定を再現し、実際の値との差を取る
    const recent = history.filter((s) => s.ts >= now - CALIBRATION_SPAN_MS)
    for (let i = 1; i < recent.length; i++) {
      const wPrev = snapshotWindowOf(recent[i - 1], identity)
      const wCur = snapshotWindowOf(recent[i], identity)
      if (!wPrev || !wCur || Math.abs(wPrev.resetsAt - wCur.resetsAt) > SAME_WINDOW_TOLERANCE_MS) continue
      const before = calibrate(identity, history, index, recent[i - 1].ts)
      if (!before) continue
      const delta = index.between(recent[i - 1].ts, recent[i].ts, false)
      const est = wPrev.percentUsed + delta / before.mid
      accuracySamples.push(Math.abs(est - wCur.percentUsed))
    }
  }

  const sortedErrors = [...accuracySamples].sort((a, b) => a - b)
  const accuracy: UsageAccuracy = {
    samples: sortedErrors.length,
    medianAbsError: sortedErrors.length > 0 ? percentile(sortedErrors, 0.5) : null,
    p90AbsError: sortedErrors.length > 0 ? percentile(sortedErrors, 0.9) : null,
  }

  // 上限ガード: 現在の枠の中の最新の公式値だけで決める(推定は使わない)
  let guard: UsageGuard = { level: "none", windowLabel: null, percent: null }
  for (const w of windows) {
    if (!w.official) continue
    const p = w.official.percentUsed
    if (p >= GUARD_WARN && (guard.percent === null || p > guard.percent)) {
      guard = { level: p >= GUARD_HIGH ? "high" : "warn", windowLabel: w.label, percent: p }
    }
  }

  return { windows, guard, accuracy, unregisteredModels: [...unregistered].sort(), fiveHourStart, weekStart }
}

// ---------------------------------------------------------------------------
// 誰が使っているか

export interface SessionIdentity {
  desktopId: string | null
  title: string
  groupId: string | null
  groupName: string | null
}

const OTHER_KEY = "__other__"
const MAX_CONTRIBUTIONS = 40
const UNKNOWN_TITLE = "（Desktopのセッションに対応しない会話記録）"

/** since 以降の使用量を、セッション別に金額換算(=上限への寄与)で集計する */
export function buildContributions(
  rows: UsageRow[],
  since: number,
  now: number,
  prices: PriceBook,
  identityOf: (sessionKey: string) => SessionIdentity | null
): UsageContributionSet {
  const bySession = new Map<string, UsageContribution>()
  for (const row of rows) {
    if (row.at < since || row.at > now) continue
    let item = bySession.get(row.sessionKey)
    if (!item) {
      const identity = identityOf(row.sessionKey)
      item = {
        sessionKey: row.sessionKey,
        desktopId: identity?.desktopId ?? null,
        title: identity?.title ?? UNKNOWN_TITLE,
        groupId: identity?.groupId ?? null,
        groupName: identity?.groupName ?? null,
        costUsd: 0,
        tokens: emptyTokens(),
      }
      bySession.set(row.sessionKey, item)
    }
    item.costUsd += costOf(row, prices.resolve(row.model).price)
    addTokens(item.tokens, row)
  }

  const sorted = [...bySession.values()].sort((a, b) => b.costUsd - a.costUsd)
  if (sorted.length <= MAX_CONTRIBUTIONS) return { since, items: sorted }
  // 多いときは、上位だけを個別に出し、残りを1件にまとめる
  const head = sorted.slice(0, MAX_CONTRIBUTIONS)
  const rest = sorted.slice(MAX_CONTRIBUTIONS)
  const other: UsageContribution = {
    sessionKey: OTHER_KEY,
    desktopId: null,
    title: `ほか${rest.length}件`,
    groupId: null,
    groupName: null,
    costUsd: rest.reduce((s, r) => s + r.costUsd, 0),
    tokens: rest.reduce((t, r) => {
      t.input += r.tokens.input
      t.output += r.tokens.output
      t.cacheRead += r.tokens.cacheRead
      t.cacheWrite += r.tokens.cacheWrite
      return t
    }, emptyTokens()),
  }
  return { since, items: [...head, other] }
}
