import { formatTokens } from "./usageFormat"
import { addDays, shortDay, type Comparison, type Side } from "./scheduledActivity"
import type { FamilyLabel, RunTokens, ScheduledRun } from "./scheduledActivityTypes"

/**
 * 予定タスクのタブ(⑯)の画面の文。言葉は要件メモの言葉の表のとおり(回・本体・サブエージェント・重さ・最後の状態)。
 * トークンは［利用上限］と同じ関数(formatTokens)で書く(A15)
 */

/** 符号つきの整数(−22・+5・0)。負は全角のマイナスに近い記号(U+2212)で、ハイフンと見間違えないようにする */
export function signed(value: number): string {
  const n = Math.round(value)
  if (n === 0) return "0"
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`
}

/** 「7（記録なし1・作業中1 を除く）」 */
export function countText(side: Side): string {
  const parts: string[] = []
  if (side.noRecord > 0) parts.push(`記録なし${side.noRecord}`)
  if (side.running > 0) parts.push(`作業中${side.running}`)
  if (side.outOfRecord > 0) parts.push(`記録の外${side.outOfRecord}`)
  return parts.length > 0 ? `${side.total}（${parts.join("・")} を除く）` : String(side.total)
}

/** 「前の7日 10/31〜11/06・後の7日 11/07〜11/13」 */
export function periodText(c: Comparison): string {
  return `前の7日 ${shortDay(c.before.from)}〜${shortDay(c.before.to)}・後の7日 ${shortDay(c.after.from)}〜${shortDay(c.after.to)}`
}

export function progressText(c: Comparison): string | null {
  if (!c.progress) return null
  if (c.progress.day <= 0) return "後の7日はまだ始まっていない"
  return `途中（${c.progress.day}日目・あと${c.progress.left}日）`
}

/** 差を出さない理由の文 */
export function blockedText(c: Comparison, horizonDays: number): string | null {
  if (c.blocked === "out-of-record") return `前の7日のうち${c.before.outOfRecord}回は記録の外（${horizonDays}日より前）のため比べない`
  if (c.blocked === "few") return `回数が少ないため比べない（前${c.before.valid}回・後${c.after.valid}回）`
  return null
}

/** 結論の2行目 */
export function conclusionLine2(taskId: string, c: Comparison, mainFamily: FamilyLabel | null, horizonDays: number): string {
  const progress = progressText(c)
  const tail = progress ? `・${progress}` : ""
  if (c.diff && c.index.after) {
    const main = mainFamily ? `本体 ${mainFamily}` : "本体"
    const mainValue = c.index.after.main === null ? "―" : String(Math.round(c.index.after.main))
    return `${taskId}：後の7日は1回あたりの重さ ${Math.round(c.index.after.total)}・${main} ${mainValue}（前の7日を100）・${c.after.valid}回と${c.before.valid}回の平均（推定）${tail}`
  }
  return `${taskId}：${blockedText(c, horizonDays) ?? "比べられる回がない"}${tail}`
}

/** 「1.0本（Haiku）」 */
export function subagentText(side: Side): string {
  if (side.avgSubagents === null) return "―"
  const n = side.avgSubagents.toFixed(1)
  return side.subagentFamilies.length > 0 ? `${n}本（${side.subagentFamilies.join("・")}）` : `${n}本`
}

/** 表の下の1行「種類（1回あたり）：前 web-fetch 1.0 → 後 general-purpose 2.1」 */
export function typesLine(c: Comparison): string {
  const one = (s: Side) => (s.typesPerRun.length === 0 ? "なし" : s.typesPerRun.slice(0, 3).map((t) => `${t.type} ${t.perRun.toFixed(1)}`).join("・"))
  return `種類（1回あたり）：前 ${one(c.before)} → 後 ${one(c.after)}`
}

/** 日ごとの表のトークンの文「Opus 2.4M・サブ Haiku 680K」 */
export function tokensText(tokens: RunTokens[]): string {
  return tokens.map((t) => `${t.subagent ? "サブ " : ""}${t.family} ${formatTokens(t.tokens)}`).join("・")
}

/** 日ごとの表のサブエージェントの欄「2（Sonnet）」 */
export function runSubagentText(run: ScheduledRun): string {
  if (run.subagentCount === 0) return "0"
  return run.subagentFamilies.length > 0 ? `${run.subagentCount}（${run.subagentFamilies.join("・")}）` : String(run.subagentCount)
}

/** 「3時間前」(1時間より前は分、48時間より前は時間、それより前は日) */
export function agoText(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000))
  if (min < 60) return `${min}分前`
  const hours = Math.floor(min / 60)
  if (hours < 48) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}

const pad = (n: number) => String(n).padStart(2, "0")

/** 「11/07 07:09」(PC の時刻) */
export function dateTimeText(at: number): string {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 「07:09」 */
export function timeText(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 日ごとの表の日付「11/07（金）」 */
export function dayText(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()]
  return `${m}/${pad(d)}（${w}）`
}

/** 境目の日を戻すボタンの日(今日の7日前) */
export function resetBoundaryOf(today: string): string {
  return addDays(today, -7)
}
