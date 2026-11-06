import { pickHomeWindows, USAGE_KIND_LABEL, usageValueKind } from "./homeDashboard"
import type { UsageResponse, UsageWindowView } from "./usageTypes"

/** 新しい指示を控える目安(%)。ホームの帯(USAGE_HOLD_PERCENT)と同じ値 */
export const CHIP_HOLD_PERCENT = 80

/**
 * 利用上限の札(⑮ OR-1・A1)。上のバーに出す、いちばんきつい窓。
 * - 「！ 控える」の判定は、ホームの帯と同じ式：上限ガード中、または 5時間・週(全モデル)の表示の値が80%以上
 * - 札に出す窓は、表示の値(推定があれば推定)のいちばん高い窓。同じなら 5時間 → 週 → モデル別の順
 */
export function chipHold(usage: UsageResponse | null): boolean {
  if (!usage) return false
  if (usage.guard != null && usage.guard.level !== "none") return true
  const { fiveHour, weekly } = pickHomeWindows(usage.windows)
  return [fiveHour, weekly].some((w) => (w?.displayPercent ?? 0) >= CHIP_HOLD_PERCENT)
}

const KEY_ORDER: Record<string, number> = { five_hour: 0, weekly_all: 1 }
const orderOf = (w: UsageWindowView) => KEY_ORDER[w.key] ?? 2

/** 小窓に出す窓を、表示の値の高い順に並べる(値の無い窓は最後) */
export function sortWindows(windows: UsageWindowView[]): UsageWindowView[] {
  return [...windows].sort((a, b) => {
    const pa = a.displayPercent ?? -1
    const pb = b.displayPercent ?? -1
    if (pa !== pb) return pb - pa
    return orderOf(a) - orderOf(b)
  })
}

/** 札に出す窓(いちばんきつい窓)。値のある窓が無ければ null */
export function tightestWindow(windows: UsageWindowView[]): UsageWindowView | null {
  const first = sortWindows(windows)[0]
  return first && first.displayPercent !== null ? first : null
}

/** リセットまでの時間「1:12」(時:分)。24時間以上は「4日21時間」。分からなければ null */
export function resetShort(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const min = Math.max(0, Math.round((resetsAt - now) / 60_000))
  if (min >= 24 * 60) return `${Math.floor(min / (24 * 60))}日${Math.floor((min % (24 * 60)) / 60)}時間`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

/** 窓の名前の短い形(札用)。「週(全モデル)」は「週」 */
export function chipLabel(w: UsageWindowView): string {
  return w.key === "weekly_all" && w.modelName === null ? "週" : w.label
}

/** 値の種類(推定・公式値)。小窓に出す */
export function kindLabel(w: UsageWindowView): string {
  return USAGE_KIND_LABEL[usageValueKind(w)]
}
