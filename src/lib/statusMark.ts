import type { DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import { buildNextDecisions, type NextDecision, type Urgency } from "./nextDecisions"

/**
 * 状態の印(⑮ OR-2・A3)。全画面で同じ部品・同じ対応で、記号と文字と色を出す(要件メモ 4-2 の対応表)。
 * - 判断に入る物(要対応・送信上限・エラー・届かない送信)は、ホームの次にやる判断と同じ集め方(`buildNextDecisions`)で決める。
 *   色は次にやる判断の段(急ぎ＝赤・今日中＝琥珀・いつでも＝灰)。送信上限とエラーは「×」、ほかは「？」
 * - 判断でない物は状態で決める：実行中＝◌ 青、中断の可能性＝‖ 琥珀、確認待ち・完了・待機・入力待ち＝● 緑、不明＝● 灰
 * - 静か(看板の24時間より前)は、看板の側で quietMark に替える
 */
export type MarkTone = "red" | "amber" | "green" | "blue" | "gray"
export type MarkSymbol = "？" | "×" | "◌" | "‖" | "●" | "－"

export interface StatusMark {
  symbol: MarkSymbol
  /** 記号の横の文字(色だけに頼らない) */
  text: string
  tone: MarkTone
  /** 推定による表示か(「（推定）」を添える) */
  estimated: boolean
  /** 次にやる判断に入っているか */
  decision: boolean
}

const URGENCY_TONE: Record<Urgency, MarkTone> = { urgent: "red", today: "amber", anytime: "gray" }

/** 次にやる判断の1件の印。種類が分からない要対応は「判断」だけにする */
export function markOfDecision(d: NextDecision): StatusMark {
  const stopped = d.kindLabel === "送信上限" || d.kindLabel === "エラー"
  const text = stopped ? d.kindLabel : d.kindLabel === "種類不明" ? "判断" : `判断・${d.kindLabel}`
  return { symbol: stopped ? "×" : "？", text, tone: URGENCY_TONE[d.urgency], estimated: d.estimated, decision: true }
}

const STATUS_MARK: Record<DesktopSessionStatus, Omit<StatusMark, "decision">> = {
  running: { symbol: "◌", text: "作業中", tone: "blue", estimated: true },
  interrupted: { symbol: "‖", text: "止まったかも", tone: "amber", estimated: true },
  review_ready: { symbol: "●", text: "確認待ち", tone: "green", estimated: false },
  completed: { symbol: "●", text: "完了", tone: "green", estimated: false },
  standby: { symbol: "●", text: "待機", tone: "green", estimated: false },
  waiting: { symbol: "●", text: "入力待ち", tone: "green", estimated: false },
  unknown: { symbol: "●", text: "不明", tone: "gray", estimated: false },
  // 判断に集めない物(アーカイブ済みなど)だけがここに来る
  blocked: { symbol: "？", text: "判断", tone: "gray", estimated: false },
  error: { symbol: "×", text: "エラー", tone: "red", estimated: false },
}

/** 判断でないときの、状態からの印。待機は、言葉から決めたものに「推定」を添える */
export function markOfStatus(s: Pick<DesktopSessionSummary, "status" | "standbyInfo">): StatusMark {
  const base = STATUS_MARK[s.status]
  const estimated = s.status === "standby" ? (s.standbyInfo?.estimated ?? false) : base.estimated
  return { ...base, estimated, decision: false }
}

/** 静か(看板で、24時間より前に動いた既読の物)。もとの状態の文字は残す */
export function quietMark(mark: StatusMark): StatusMark {
  return { symbol: "－", text: `静か・${mark.text}`, tone: "gray", estimated: false, decision: false }
}

const cache = new WeakMap<DesktopSessionSummary[], { minute: number; marks: Map<string, StatusMark> }>()

/**
 * 一覧の全セッションの印。判断の段は待ち時間で変わるので、同じ一覧でも分が変われば作り直す。
 * 同じ一覧を何か所で読んでも、計算は1回だけ
 */
export function buildMarks(sessions: DesktopSessionSummary[], now: number): Map<string, StatusMark> {
  const minute = Math.floor(now / 60_000)
  const hit = cache.get(sessions)
  if (hit && hit.minute === minute) return hit.marks
  const decisions = new Map(buildNextDecisions(sessions, now).map((d) => [d.id, d]))
  const marks = new Map<string, StatusMark>()
  for (const s of sessions) {
    const d = decisions.get(s.id)
    marks.set(s.id, d ? markOfDecision(d) : markOfStatus(s))
  }
  cache.set(sessions, { minute, marks })
  return marks
}
