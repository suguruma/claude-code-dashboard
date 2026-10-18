import type { DesktopSessionSummary } from "./desktopSessionTypes"

/**
 * 「最新の指示」が、まだ確定していない暫定の値か。DOM・fsに触れない純粋な関数。
 *
 * 起動直後は、会話ログの末尾だけを解析した暫定の要約（digest が partial）になる。末尾に人の指示が無いと、
 * 最新の指示は他セッション・通知などの本文になり、全体の解析が終わると（約45秒後）人の指示に置き換わる。
 * そのあいだは、表示されている本文が確定した値ではないと分かる印（「解析中」）を出す。
 * 人の指示が見つかっているときは、末尾から見つかった最新の人の指示なので、暫定でも置き換わらない。
 */
export function isInstructionProvisional(s: Pick<DesktopSessionSummary, "digest" | "latestInstruction">): boolean {
  if (s.digest !== "partial") return false
  return s.latestInstruction === null || s.latestInstruction.origin !== "human"
}
