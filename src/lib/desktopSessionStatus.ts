import type { DesktopSessionStatus } from "./desktopSessionTypes"
import type { DesktopMeta } from "./desktopSessions"
import type { TranscriptDigest } from "./transcriptDigest"

export interface StatusThresholds {
  /** 会話ログの最終更新がこの時間以内なら、何かが進行中とみなす */
  runningWindowMs: number
  /** ツールの結果待ち・応答待ちのまま、更新が無くてもこの時間までは実行中とみなす。超えると「中断の可能性」 */
  pendingWindowMs: number
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  runningWindowMs: 45_000,
  pendingWindowMs: 5 * 60_000,
}

export interface StatusInput {
  meta: DesktopMeta | null
  digest: TranscriptDigest | null
  /** 会話ログの最終更新時刻(ファイルの更新時刻)。無ければ null */
  transcriptMtimeMs: number | null
  now: number
}

export interface StatusResult {
  status: DesktopSessionStatus
  /** 判断の根拠。実行中などの推定であることを画面に出す */
  reason: string
}

/**
 * セッションの状態を決める。「実行中」を直接示す項目は無いため、複数の手がかりからの推定になる(検討書 付録A.6)。
 *
 * 1. 会話ログの最後が「ユーザーの入力・ツールの結果」または「ツールの結果待ち(tool_use)」で、更新が新しい → 実行中
 * 2. 同じ状態のまま更新が止まっている → 中断の可能性
 * 3. 直近のターンが終わっている → Desktopがターン後に付けた分類(要対応/確認待ち/完了)
 * 4. 分類が無い → 入力待ち
 */
export function inferStatus(input: StatusInput, thresholds: StatusThresholds = DEFAULT_THRESHOLDS): StatusResult {
  const { meta, digest, transcriptMtimeMs, now } = input
  const lastWriteMs = transcriptMtimeMs ?? meta?.lastActivityAt ?? null
  const sinceWrite = lastWriteMs === null ? Infinity : Math.max(0, now - lastWriteMs)
  // ターンが開いたままかの判断には、会話の行の時刻を使う。ファイルの更新時刻は、タイトルの書き直しなど
  // 会話以外の書き込みでも進むため、止まったセッションを動いているように見せてしまう
  const activityMs = digest?.lastEventAt ?? lastWriteMs
  const sinceActivity = activityMs === null ? Infinity : Math.max(0, now - activityMs)

  const lastRow = digest?.lastRow ?? null
  const turnOpen =
    lastRow !== null &&
    !lastRow.interrupted &&
    (lastRow.role === "user" || lastRow.stopReason === "tool_use")

  // ターン後の要約が最後の応答に対応していれば、そのターンは終わっている(終了直後の書き込みを実行中と誤判定しない)
  const summaryCurrent =
    meta !== null &&
    meta.statusCategory !== null &&
    digest?.lastAssistantUuid != null &&
    meta.summaryFor === digest.lastAssistantUuid

  if (turnOpen && sinceActivity <= thresholds.pendingWindowMs && !summaryCurrent) {
    const what = lastRow.role === "user" ? "入力またはツールの結果を処理中" : "ツールの結果待ち"
    return { status: "running", reason: `${what}で、会話が${formatAgo(sinceActivity)}に進んでいる(推定)` }
  }
  if (sinceWrite <= thresholds.runningWindowMs && !(lastRow && !turnOpen && summaryCurrent)) {
    return { status: "running", reason: `会話ログが${formatAgo(sinceWrite)}に更新されている(推定)` }
  }
  if (turnOpen && !summaryCurrent) {
    return {
      status: "interrupted",
      reason: `${lastRow.role === "user" ? "入力の処理中" : "ツールの結果待ち"}のまま、会話が${formatAgo(sinceActivity)}から進んでいない`,
    }
  }

  if (meta?.hasError) return { status: "error", reason: "Desktopがエラーを記録している" }

  switch (meta?.statusCategory) {
    case "blocked":
      return { status: "blocked", reason: "Desktopが「要対応」と記録している" }
    case "review_ready":
      return { status: "review_ready", reason: "Desktopが「確認待ち」と記録している" }
    case "completed":
      return { status: "completed", reason: "Desktopが「完了」と記録している" }
  }

  if (lastRow && !turnOpen) {
    return { status: "waiting", reason: "ターンは終わっているが、ターン後の要約が無い" }
  }
  return { status: "unknown", reason: "判断材料が無い(会話ログが見つからない、またはターン後の要約が無い)" }
}

function formatAgo(ms: number): string {
  if (!Number.isFinite(ms)) return "不明な時刻"
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}分前`
  const hours = Math.round(min / 60)
  if (hours < 48) return `${hours}時間前`
  return `${Math.round(hours / 24)}日前`
}
