import type { MonitorFileStatus, PlanGroup } from "./monitorTypes"

/**
 * ［作業と待ち］の画面の文を作る(⑭ WC-1・WC-2・WC-14)。画面とテストで同じ文を使う。
 */

/** 回復の見込み：「09:30（あと 1時間20分）」。時刻が無い・過ぎたときは「回復の時刻を過ぎた」(A2) */
export function resetText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return "回復の時刻が分かりません"
  if (resetsAt <= now) return "回復の時刻を過ぎた"
  const d = new Date(resetsAt)
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const day = new Date(now).toDateString() === d.toDateString() ? "" : `${d.getMonth() + 1}/${d.getDate()} `
  return `${day}${hhmm}（あと ${remainText(resetsAt - now)}）`
}

export function remainText(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

/** グループの見出しの行：「アプリ　作業中 2・これから 1」。0件の状態は書かない */
export function groupHeadline(g: PlanGroup): string {
  const parts: string[] = []
  if (g.counts.doing) parts.push(`作業中 ${g.counts.doing}`)
  if (g.counts.waiting) parts.push(`待ち（上限） ${g.counts.waiting}`)
  if (g.counts.todo) parts.push(`これから ${g.counts.todo}`)
  if (g.counts.later) parts.push(`後で ${g.counts.later}`)
  return parts.join("・")
}

/** 「1・大・易」(順・大きさ・再開)。空の値は「—」 */
export function orderCell(order: number | null, size: string, resume: string): string {
  return [order === null ? "—" : String(order), size || "—", resume || "—"].join("・")
}

/** ファイルを読めなかったときの文(WC-14)。ok のときは null */
export function fileStatusText(status: MonitorFileStatus, what: string): string | null {
  switch (status) {
    case "ok":
      return null
    case "unset":
      return `${what}の場所が設定されていません（config/monitor.json）。`
    case "missing":
      return `${what}のファイルが見つかりません。`
    case "refused":
      return `${what}の場所は、認証情報などを含むおそれがあるため読みません。`
    case "unreadable":
      return `${what}のファイルを読めませんでした（大きすぎるか、開けません）。`
  }
}
