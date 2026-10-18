import type { CleanupReason, DecisionReason, PercentRange, ResumeCost, UnansweredKind } from "./housekeepingTypes"
import { formatDollars, formatPercent } from "./usageFormat"

/** 画面の文言。判定は housekeeping.ts、ここは表示用の文字列だけ(DOM に触れないのでテストできる) */

export const CLEANUP_REASON_LABEL: Record<CleanupReason, string> = {
  large: "コンテキストが大きい",
  idle: "長く止まっている",
}

export const UNANSWERED_KIND_LABEL: Record<UnansweredKind, string> = {
  "ended-without-report": "報告なしで終了",
  "awaiting-report": "報告待ち",
  "possibly-undelivered": "未達の疑い",
}

export const UNANSWERED_KIND_HINT: Record<UnansweredKind, string> = {
  "ended-without-report": "相手のセッションは、この指示のあと、報告を返さずにターンを終えています。",
  "awaiting-report": "相手のセッションが指示を受け取った記録はありますが、報告も、ターンの終了もまだ見つかりません。",
  "possibly-undelivered":
    "送り手の送信記録しかなく、相手のセッションに届いた記録がありません。届いていない、または記録がまだ無い可能性があります。",
}

export const DECISION_REASON_LABEL: Record<DecisionReason, string> = {
  "needs-action": "要対応",
  "send-limit": "送信上限で停止中",
  error: "エラー",
  undelivered: "届かなかった送信",
}

/**
 * 割合の幅の表示。幅が表示上同じになるときは1つの値にする。
 * 下限が決まらないとき(min が null)は「最大で約x%」。0.1%に満たないときは「0.1%未満」。
 */
export function formatPercentRange(range: PercentRange): string {
  const show = (v: number) => (v < 0.1 ? "0.1" : formatPercent(v))
  if (range.max < 0.1) return "0.1%未満"
  if (range.min === null) return `最大で約${show(range.max)}%`
  const lo = show(range.min)
  const hi = show(range.max)
  return lo === hi ? `約${hi}%` : `約${lo}〜${hi}%`
}

/**
 * 再開コストの表示。割合は、その枠の較正があるものだけを「5時間の枠 約x%・週 約y%」で並べ、金額(API価格換算)を添える。
 * 較正が無いときは金額だけ。
 */
export function describeResumeCost(cost: ResumeCost): { shares: string[]; dollars: string } {
  const shares: string[] = []
  if (cost.fiveHour) shares.push(`5時間の枠 ${formatPercentRange(cost.fiveHour)}`)
  if (cost.weekly) shares.push(`週 ${formatPercentRange(cost.weekly)}`)
  return { shares, dollars: `API価格換算 ${formatDollars(cost.usd)}` }
}

/** 経過時間の短い表記(「45分」「3時間12分」「2日5時間」) */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "1分未満"
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`
  }
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days}日` : `${days}日${restHours}時間`
}
