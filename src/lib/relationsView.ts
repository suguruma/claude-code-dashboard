import { formatDuration } from "./housekeepingFormat"
import type { LedgerMark, RelationEffects, RelationSession, RelationsResponse } from "./relationsTypes"

/**
 * 関係性マップ(⑬ 組織の「つながり」)の画面の文を作る純粋な関数。画面の部品から分けて、自動テストで確かめる。
 * データの無い行はカードに書かない(「分からない」「設定なし」を並べない。AP12 の N3)。かわりにグループの見出しに
 * 「ブランチが分かるもの n/m・指示の置き場を設定したもの n/m」の1行を出す。
 */

/** 1つのグループで最初に出すカードの数(ほかは「ほか n件を出す」) */
export const FIRST_CARDS = 6

const pad = (n: number) => String(n).padStart(2, "0")

/** 時刻の短い表記：今日は「今日 06:10」、昨日は「昨日 22:30」、それより前は「10/20」 */
export function formatWhen(at: number | null, now: number): string {
  if (at === null) return "—"
  const d = new Date(at)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (at >= startOfToday) return `今日 ${clock}`
  if (at >= startOfToday - 24 * 60 * 60_000) return `昨日 ${clock}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function clockOf(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 担当のカードの「指示 06:10・報告 05:20 → 報告待ち 50分」(A14)。番号だけは並べない(指示と報告は数え方が違うので、時刻で比べる)。
 * 設定で結んでいなければ null(カードに書かない)。報告待ちは、指示の更新が報告の更新より新しいとき。
 */
export function ledgerLine(
  orders: LedgerMark | null,
  reports: LedgerMark | null,
  now: number
): { text: string; waiting: string | null } | null {
  if (!orders && !reports) return null
  const part = (word: string, m: LedgerMark | null) => {
    if (!m) return null
    if (m.status === "ok" && m.updatedAt !== null) return `${word} ${clockOf(m.updatedAt)}`
    if (m.status === "missing") return `${word}のファイルが無い`
    return `${word}のファイルを読めない`
  }
  const text = [part("指示", orders), part("報告", reports)].filter(Boolean).join("・")
  const ordered = orders?.status === "ok" ? orders.updatedAt : null
  const reported = reports?.status === "ok" ? reports.updatedAt : null
  const waiting = ordered !== null && (reported === null || ordered > reported) ? `報告待ち ${formatDuration(now - ordered)}` : null
  return { text, waiting }
}

/** グループの見出しの下の1行(N3) */
export function coverageLine(sessions: ReadonlyArray<RelationSession>): string {
  const m = sessions.length
  const branch = sessions.filter((s) => s.branch !== null).length
  const ledger = sessions.filter((s) => s.orders !== null || s.reports !== null).length
  return `ブランチが分かるもの ${branch}/${m}・指示の置き場を設定したもの ${ledger}/${m}（分からないものは、カードに書きません）`
}

const ROLE_ORDER = { leader: 0, member: 1, helper: 2 } as const

/** カードの並び：指揮役 → 担当 → 確認役・補助。同じ役割の中は題名の順 */
export function orderCards(sessions: ReadonlyArray<RelationSession>): RelationSession[] {
  return [...sessions].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.title.localeCompare(b.title, "ja"))
}

/** 指揮役以外のカードを、最初の6枚と残りに分ける(A13) */
export function splitCards<T>(cards: ReadonlyArray<T>, expanded: boolean): { shown: T[]; hidden: T[] } {
  if (expanded || cards.length <= FIRST_CARDS + 1) return { shown: [...cards], hidden: [] }
  return { shown: cards.slice(0, FIRST_CARDS), hidden: cards.slice(FIRST_CARDS) }
}

/** そのグループで選べる最初のセッション(効いているものの表の「このセッションに」の列) */
export function defaultSelection(sessions: ReadonlyArray<RelationSession>): string | null {
  return orderCards(sessions).find((s) => s.role === "member")?.id ?? sessions[0]?.id ?? null
}

export interface EffectRow {
  key: string
  kind: string
  what: string
  target: string
  updatedAt: number | null
  /** 選んだセッションに効くか(「効く」「—」、スキルは「使った n個」) */
  forSelected: string
  decide: string
}

/**
 * 効いているものの表(A16)。効く先は、推さずに決められる出どころだけ。スキルの判断の文は「全セッションで直近30日に使っていない n個」(N4)。
 * group は選んだグループのセッション、selected は選んだセッション。
 */
export function effectRows(
  data: Pick<RelationsResponse, "effects" | "sessions">,
  group: ReadonlyArray<RelationSession>,
  selected: RelationSession | null
): EffectRow[] {
  const e: RelationEffects = data.effects
  const total = data.sessions.length
  const ids = new Set(group.map((s) => s.id))
  const rows: EffectRow[] = []
  const applies = (sessionIds: ReadonlyArray<string>) => (selected && sessionIds.includes(selected.id) ? "効く" : "—")

  if (e.global.status !== "disabled") {
    rows.push({
      key: "global",
      kind: "全体の決まり",
      what: e.global.status === "ok" ? "グローバルの CLAUDE.md" : "グローバルの CLAUDE.md（見つからない）",
      target: `全セッション（${total}件）`,
      updatedAt: e.global.updatedAt,
      forSelected: e.global.status === "ok" && selected ? "効く" : "—",
      decide: "直すと全員に効く。食い違いは「決まり」で読む",
    })
  }
  for (const rule of e.folderRules) {
    const inGroup = rule.sessionIds.filter((id) => ids.has(id))
    if (inGroup.length === 0) continue
    rows.push({
      key: rule.key,
      kind: "作業フォルダの決まり",
      what: `${rule.label} の CLAUDE.md`,
      target: `作業フォルダが ${rule.label} かその下の${rule.sessionIds.length}件`,
      updatedAt: rule.updatedAt,
      forSelected: applies(rule.sessionIds),
      decide: `直すと、この${rule.sessionIds.length}件に効く`,
    })
  }
  for (const mem of e.memories) {
    if (!mem.sessionIds.some((id) => ids.has(id))) continue
    rows.push({
      key: mem.key,
      kind: "記憶",
      what: `${mem.label}（${mem.count ?? 0}ファイル）`,
      target: `会話ログが同じフォルダにある${mem.sessionIds.length}件`,
      updatedAt: mem.updatedAt,
      forSelected: applies(mem.sessionIds),
      decide: "古い記憶が効いていないか（本文は「決まり」で読む）",
    })
  }
  if (e.userSkills !== null) {
    const usedInGroup = e.usedSkills.filter((u) => u.sessionIds.some((id) => ids.has(id))).length
    const usedBySelected = selected ? e.usedSkills.filter((u) => u.sessionIds.includes(selected.id)).length : 0
    const unused = Math.max(0, e.userSkills - e.usedSkills.length)
    rows.push({
      key: "skills",
      kind: "スキル",
      what: `ユーザーのスキル ${e.userSkills}個`,
      target: `全セッション（このグループが直近30日に使ったのは${usedInGroup}個）`,
      updatedAt: null,
      forSelected: selected ? `使った ${usedBySelected}個` : "—",
      decide: `全セッションで直近30日に使っていない${unused}個を片付けるか`,
    })
  }
  for (const s of group) {
    if (!s.orders) continue
    rows.push({
      key: `orders:${s.id}`,
      kind: "指示ファイル",
      what: s.orders.name,
      target: `${s.title}（設定で結んだ担当）`,
      updatedAt: s.orders.updatedAt,
      forSelected: selected?.id === s.id ? "効く" : "—",
      decide: "報告待ちの担当を催促するか",
    })
  }
  return rows
}

/** グループの一覧の1行の補足(「9件・判断 2・頼みの返事なし 1」「立てた線なし」) */
export function groupMeta(g: { count: number; decisions: number; unansweredRequests: number; spawnedLinks: number }): string {
  const parts = [`${g.count}件`, `判断 ${g.decisions}`]
  if (g.unansweredRequests > 0) parts.push(`頼みの返事なし ${g.unansweredRequests}`)
  if (g.spawnedLinks === 0) parts.push("立てた線なし")
  return parts.join("・")
}
