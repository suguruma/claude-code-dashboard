/**
 * セッション間メッセージの送信回数と、送信上限での停止の判定。サーバー専用モジュール(fs等)をimportしない。
 *
 * Claude Desktopは、あるセッションが他のセッションへ送れる回数を「そのセッションで人が最後に入力してから10回まで」に
 * 制限している。他のセッションから届いたメッセージでは数え直されない。上限を超えた送信は届かず、
 * ツールの結果として上限に達した旨の文が返る。その文言は保証されていないため、判定の条件はこのファイルだけに置く。
 */

/** 他のセッションへメッセージを送るツール。この呼び出し1回を1回の送信として数える */
export const SEND_TOOLS: readonly string[] = ["SendMessage", "mcp__ccd_session_mgmt__send_message"]

/** 人が最後に入力してから送れる回数の上限 */
export const SEND_LIMIT = 10

/** 8回以上で注意(黄)、上限で赤 */
export const SEND_WARN_AT = 8

export type SendResultKind = "ok" | "limit" | "undelivered"

/**
 * 送信ツールの結果の文から、送信の結果を判定する。
 * - limit: 送信上限に達して届かなかった(「Not delivered」と「10 times」の両方を含む)
 * - undelivered: 上限以外の理由で届かなかった(「Not delivered」、または「No agent named …」と「reachable」を含む)
 * - ok: 上のどれでもない
 */
export function classifySendResult(text: string): SendResultKind {
  const notDelivered = text.includes("Not delivered")
  if (notDelivered && text.includes(`${SEND_LIMIT} times`)) return "limit"
  if (notDelivered || (text.includes("No agent named") && text.includes("reachable"))) return "undelivered"
  return "ok"
}

export function isSendTool(name: string): boolean {
  return SEND_TOOLS.includes(name)
}

export type SendLevel = "none" | "ok" | "warn" | "limit"

/** 送信回数の表示の段階。停止中は回数にかかわらず limit */
export function sendLevel(sent: number, stopped: boolean): SendLevel {
  if (stopped || sent >= SEND_LIMIT) return "limit"
  if (sent >= SEND_WARN_AT) return "warn"
  return sent > 0 ? "ok" : "none"
}

/** Claude Desktopのセッション識別子(`local_<uuid>` 形式)。会話ログだけの縮退表示のIDは当てはまらない */
export const DESKTOP_SESSION_ID = /^local_[A-Za-z0-9_-]{1,100}$/

/** Claude Desktopでそのセッションを開くためのURL。Desktopのセッション識別子でなければ null */
export function sessionDeepLink(sessionId: string): string | null {
  return DESKTOP_SESSION_ID.test(sessionId) ? `claude://claude.ai/epitaxy/${sessionId}` : null
}
