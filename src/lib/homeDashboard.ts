import type { DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions, decisionRank } from "./housekeeping"
import type { UsageWindowView } from "./usageTypes"

/**
 * ホーム(組織図のダッシュボード。⑧)の件数と一覧の選び方。ファイルにも通信にも触れない純粋な関数だけを置く。
 * 件数は、ほかのページと同じ関数・同じ基準で数える(整理ページの判断待ち・利用上限のゲージと食い違わないように)。
 */

/** 判断待ちの数。整理ページの「あなたの判断を待っているセッション」と同じ関数で数える(送信上限で停止も含む) */
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

/** 組織図に出ていないセッションの一覧の、1度に出す件数 */
export const OUTSIDE_PREVIEW_COUNT = 10

/**
 * 組織図に出ていないセッション。いま出している組織図のカードに無いもののうち、アーカイブ済みとサイドチャット
 * (親のカードに数で出ている)を除いたもの。ほかのグループ・指揮役のいないグループ・グループに入っていないセッションが入る。
 * 並びは、注意の要る順(判断待ち → 実行中 → それ以外)。判断待ちの中は整理ページと同じ順(許可待ち → 承認待ち → 判断待ち →
 * 送信上限 → エラー → 届かなかった送信。⑩)。同じなら最後の活動の新しい順(不明は最後)。待機は「それ以外」に入る。
 */
export function selectOutsideSessions(
  sessions: DesktopSessionSummary[],
  shownIds: ReadonlySet<string>,
  limit: number = OUTSIDE_PREVIEW_COUNT
): { items: DesktopSessionSummary[]; total: number } {
  const decisionRanks = new Map(collectDecisions(sessions).map((d) => [d.id, decisionRank(d)]))
  const rank = (s: DesktopSessionSummary) => decisionRanks.get(s.id) ?? (s.status === "running" ? 10 : 11)
  const outside = sessions
    .filter((s) => !s.isArchived && !s.isSideChat && !shownIds.has(s.id))
    .sort((a, b) => {
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      const ta = a.lastActivityAt ?? Number.NEGATIVE_INFINITY
      const tb = b.lastActivityAt ?? Number.NEGATIVE_INFINITY
      if (ta !== tb) return tb - ta
      return a.id < b.id ? -1 : 1
    })
  return { items: outside.slice(0, limit), total: outside.length }
}
