import type { DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions } from "./housekeeping"
import type { UsageWindowView } from "./usageTypes"

/**
 * ホーム(組織図のダッシュボード。⑧)の件数と一覧の選び方。ファイルにも通信にも触れない純粋な関数だけを置く。
 * 件数は、ほかのページと同じ関数・同じ基準で数える(整理ページの判断待ち・利用上限のゲージと食い違わないように)。
 */

/** 判断待ちの数。整理ページの「あなたの対応待ち」と同じ関数で数える(送信上限で停止も含む) */
export function countDecisions(sessions: DesktopSessionSummary[]): number {
  return collectDecisions(sessions).length
}

/** 送信上限で止まっているセッションの数(アーカイブ済みは除く) */
export function countSendLimitStopped(sessions: DesktopSessionSummary[]): number {
  return sessions.filter((s) => !s.isArchived && s.messaging?.stopped === true).length
}

/**
 * 利用上限の値の種類。利用上限のページのゲージと同じ決め方:
 * 推定があれば estimate、推定が無く公式値で表示していれば official、どちらも無ければ none
 */
export function usageValueKind(w: UsageWindowView): "estimate" | "official" | "none" {
  if (w.estimate.kind === "estimate") return "estimate"
  return w.displayPercent === null ? "none" : "official"
}

/** 値の種類の文言(利用上限のゲージとホームの件数の帯で共通) */
export const USAGE_KIND_LABEL: Record<ReturnType<typeof usageValueKind>, string> = {
  estimate: "推定",
  official: "公式値",
  none: "公式値なし",
}

/** ホームに出す2つの窓(5時間・週〈全モデル〉)。無ければ null */
export function pickHomeWindows(windows: UsageWindowView[]): { fiveHour: UsageWindowView | null; weekly: UsageWindowView | null } {
  const find = (key: "five_hour" | "weekly_all") => windows.find((w) => w.key === key && w.modelName === null) ?? null
  return { fiveHour: find("five_hour"), weekly: find("weekly_all") }
}

/**
 * 組織図に出ていないセッションの数。いま出している組織図のカードに無いもののうち、アーカイブ済みとサイドチャット
 * (親のカードに数で出ている)を除いたもの。ほかのグループ・指揮役のいないグループ・グループに入っていないセッションが入る。
 * ホームは件数とセッション一覧への入口だけを出す(⑬ の棚卸しの行7。判断の要るものは「次にやる判断」に入る)
 */
export function countOutsideSessions(sessions: DesktopSessionSummary[], shownIds: ReadonlySet<string>): number {
  return sessions.filter((s) => !s.isArchived && !s.isSideChat && !shownIds.has(s.id)).length
}
