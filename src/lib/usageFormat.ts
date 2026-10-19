/**
 * 利用上限の画面・通知で使う表示用の整形。サーバー専用モジュールをimportしない(クライアントからも使う)。
 * 時刻の計算はUTCのms(epoch)で行い、画面には日本時間で出す。
 */

import type { UsageCalibration, UsageGuard, UsageWindowView } from "./usageTypes"

export type UsageLevel = "ok" | "warning" | "serious" | "critical"

/** ゲージの色の段階: 80%で黄、90%で橙、95%で赤 */
export function usageLevel(percent: number | null): UsageLevel {
  if (percent === null) return "ok"
  if (percent >= 95) return "critical"
  if (percent >= 90) return "serious"
  if (percent >= 80) return "warning"
  return "ok"
}

/** あと何時間何分(1日以上なら日と時間)。過ぎていれば「まもなくリセット」 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "まもなくリセット"
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `あと${days}日${hours}時間`
  if (hours > 0) return `あと${hours}時間${minutes}分`
  return `あと${minutes}分`
}

const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** 日本時間の「月/日 時:分」 */
export function formatJst(ms: number): string {
  const parts = Object.fromEntries(jstFormatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

/** 日本時間の「時:分」(同じ日の中の時刻向け) */
export function formatJstTime(ms: number): string {
  const parts = Object.fromEntries(jstFormatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return `${parts.hour}:${parts.minute}`
}

export function formatDollars(value: number): string {
  if (value >= 100) return `$${value.toFixed(0)}`
  if (value >= 10) return `$${value.toFixed(1)}`
  return `$${value.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(Math.round(tokens))
}

/** %の表示。10未満は小数1桁、それ以上は整数 */
export function formatPercent(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

/** 画面に出す丸めた値(formatPercent と同じ丸め)。色・通知の判定はこの値で行い、表示と食い違わないようにする(⑧-2) */
export function shownPercent(value: number): number {
  return Number(formatPercent(value))
}

/** 表示する丸めた値で決める色の段階(94.6 は「95%」と出すので赤)。ゲージ・ホームのカードで共通 */
export function displayUsageLevel(percent: number | null): UsageLevel {
  return usageLevel(percent === null ? null : shownPercent(percent))
}

/**
 * 上限ガードの帯に添える、表示用の値(⑧-2)。帯は最新の公式値、ゲージ・カードは推定を含む表示用の値なので、同じ画面で%が違うことがある。
 * 根拠の窓の表示用の値が推定で、丸めた値が公式値と違うときだけ「ゲージ・カードは推定 n%」を返す(同じなら null)
 */
export function guardEstimateNote(guard: UsageGuard | null | undefined, windows: UsageWindowView[] | undefined): string | null {
  if (!guard || guard.percent === null || guard.windowLabel === null || !windows) return null
  const w = windows.find((x) => x.label === guard.windowLabel)
  if (!w || w.displayPercent === null || w.estimate.kind !== "estimate") return null
  const shown = formatPercent(w.displayPercent)
  if (shown === formatPercent(guard.percent)) return null
  return `ゲージ・カードは推定 ${shown}%`
}

/**
 * 1%あたりの金額(換算)。範囲の中央値を使う。範囲に上限が無い(公式値が0%だけ)・較正できないときは null
 * (そのときは、上限に対する%を出さず、全体に占める割合で表示する)。
 */
export function costPerPercentOf(calibration: UsageCalibration | null): number | null {
  if (!calibration || calibration.costPerPercentHigh === null) return null
  const mid = (calibration.costPerPercentLow + calibration.costPerPercentHigh) / 2
  return mid > 0 ? mid : null
}

/**
 * 積み上げ棒の値の表示。金額(ドル)は請求額と誤解されるため出さず、「上限の何%」(金額÷係数)で表す。
 * 係数が決まらないときは、全体(grand)に占める割合にする。
 */
export function formatLimitShare(cost: number, grand: number, costPerPercent: number | null): string {
  if (costPerPercent !== null) {
    const percent = cost / costPerPercent
    return percent < 0.1 ? "上限の0.1%未満" : `上限の約${formatPercent(percent)}%`
  }
  const share = grand > 0 ? (cost / grand) * 100 : 0
  return share < 0.1 ? "全体の0.1%未満" : `全体の${formatPercent(share)}%`
}
