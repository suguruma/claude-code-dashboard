import type { DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import type { MarkTone, StatusMark } from "./statusMark"

/**
 * セッション一覧の看板(⑮ OR-3・A4・A13)。列の分け方は要件メモ 4-2 の対応表のとおり。
 * - 次にやる判断：判断の印の物(ホームの次にやる判断・「判断 n」と同じ)
 * - 作業中：実行中。下の枠「止まったかもしれない」に中断の可能性
 * - 完了：確認待ちはいつも。完了・待機・入力待ち・不明は、未読か直近24時間なら
 * - 静か：それ以外(24時間より前に動いた既読の物)
 * 確認待ち・中断の可能性・エラーは静かに入れない。アーカイブ済みは看板に出さない
 */

export type BoardColumn = "decision" | "running" | "stopped" | "done" | "quiet"
export const BOARD_COLUMNS: BoardColumn[] = ["decision", "running", "stopped", "done", "quiet"]
export const QUIET_AFTER_MS = 24 * 60 * 60_000

const SETTLED: DesktopSessionStatus[] = ["completed", "standby", "waiting", "unknown"]

export function columnOf(s: DesktopSessionSummary, mark: StatusMark | undefined, unread: boolean, now: number): BoardColumn {
  if (mark?.decision) return "decision"
  if (s.status === "running") return "running"
  if (s.status === "interrupted") return "stopped"
  if (s.status === "review_ready") return "done"
  // 判断に集まらない要対応・エラー(アーカイブ済みなど)は、静かに落とさず判断の列に置く
  if (s.status === "blocked" || s.status === "error") return "decision"
  if (SETTLED.includes(s.status)) {
    const recent = s.lastActivityAt !== null && now - s.lastActivityAt <= QUIET_AFTER_MS
    return unread || recent ? "done" : "quiet"
  }
  return "done"
}

const TONE_RANK: Record<MarkTone, number> = { red: 0, amber: 1, blue: 2, green: 3, gray: 4 }

/** 列の中の並び：印の色(急ぐ順) → 最後の動きの新しい順 → ID。同じ状態・同じ時刻なら同じ順になる */
export function compareCards(marks: Map<string, StatusMark>) {
  return (a: DesktopSessionSummary, b: DesktopSessionSummary) => {
    const ta = TONE_RANK[marks.get(a.id)?.tone ?? "gray"]
    const tb = TONE_RANK[marks.get(b.id)?.tone ?? "gray"]
    if (ta !== tb) return ta - tb
    const la = a.lastActivityAt ?? 0
    const lb = b.lastActivityAt ?? 0
    if (la !== lb) return lb - la
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
}

export type BoardColumns = Record<BoardColumn, DesktopSessionSummary[]>

/** 看板の列に分けて並べる。isUnread は「ターンが終わった」の知らせが未読か(鐘と同じ既読の記録) */
export function buildBoard(
  sessions: DesktopSessionSummary[],
  marks: Map<string, StatusMark>,
  isUnread: (s: DesktopSessionSummary) => boolean,
  now: number
): BoardColumns {
  const cols: BoardColumns = { decision: [], running: [], stopped: [], done: [], quiet: [] }
  for (const s of sessions) {
    if (s.isArchived) continue
    cols[columnOf(s, marks.get(s.id), isUnread(s), now)].push(s)
  }
  const cmp = compareCards(marks)
  for (const c of BOARD_COLUMNS) cols[c].sort(cmp)
  return cols
}

/**
 * 並びを止める(A13)。押している間・ポインタが看板の上にある間は、前の並びを保ち、
 * 消えた物を除き、新しく来た物を最後に足す。
 */
export function holdOrder(previous: string[], next: DesktopSessionSummary[]): DesktopSessionSummary[] {
  const byId = new Map(next.map((s) => [s.id, s]))
  const kept = previous.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const seen = new Set(previous)
  return [...kept, ...next.filter((s) => !seen.has(s.id))]
}
