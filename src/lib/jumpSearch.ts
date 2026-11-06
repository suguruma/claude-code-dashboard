import type { DesktopSessionGroup, DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import type { StatusMark } from "./statusMark"

/**
 * 飛び先の検索(⑮ OR-5・A9)の中身。画面とテストで同じものを使う。
 * - 空のとき：束ごとに最大3件。束は 次にやる判断(新しい順) → 終わった → 止まったかもしれない
 * - 打ったとき：セッション(題名・グループ・作業フォルダの名前)・グループ・ページを、部分一致で探す。
 *   全角と半角、大文字と小文字は区別しない。セッションの並びは 判断待ち → 新しい順
 * - アーカイブ済みのセッションは探さない(O08 で、使ってから決める)
 */

export const EMPTY_PER_BUCKET = 3
export const MAX_SESSIONS = 8
export const MAX_OTHERS = 5

export type JumpItem =
  | { kind: "session"; id: string; title: string; sub: string | null; mark: StatusMark | null }
  | { kind: "group"; id: string; title: string; sub: string }
  | { kind: "page"; id: string; title: string; sub: null; href: string }

export interface JumpBucket {
  label: string
  items: JumpItem[]
}

export interface JumpPage {
  href: string
  label: string
}

/** 比べるための形：全角・半角をそろえ(NFKC)、小文字にし、空白をつめる */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
}

const DONE: DesktopSessionStatus[] = ["completed", "standby", "waiting", "review_ready"]
const newest = (a: DesktopSessionSummary, b: DesktopSessionSummary) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)

function sessionItem(s: DesktopSessionSummary, marks: Map<string, StatusMark> | null): JumpItem {
  return { kind: "session", id: s.id, title: s.title, sub: s.group?.name ?? "グループ外", mark: marks?.get(s.id) ?? null }
}

/** 空のときの3つの束(件数0の束は出さない) */
export function emptyBuckets(sessions: DesktopSessionSummary[], marks: Map<string, StatusMark> | null): JumpBucket[] {
  const live = sessions.filter((s) => !s.isArchived)
  const isDecision = (s: DesktopSessionSummary) => marks?.get(s.id)?.decision === true
  const pick = (f: (s: DesktopSessionSummary) => boolean) => live.filter(f).sort(newest).slice(0, EMPTY_PER_BUCKET).map((s) => sessionItem(s, marks))
  const buckets: JumpBucket[] = [
    { label: "次にやる判断", items: pick(isDecision) },
    { label: "終わった", items: pick((s) => !isDecision(s) && DONE.includes(s.status)) },
    { label: "止まったかもしれない", items: pick((s) => !isDecision(s) && s.status === "interrupted") },
  ]
  return buckets.filter((b) => b.items.length > 0)
}

/** 打った言葉で探す。言葉が空なら空の配列(画面は emptyBuckets を出す) */
export function searchJump(
  query: string,
  sessions: DesktopSessionSummary[],
  groups: DesktopSessionGroup[],
  pages: JumpPage[],
  marks: Map<string, StatusMark> | null
): JumpBucket[] {
  const q = normalizeForSearch(query)
  if (!q) return []
  const hit = (...texts: (string | null | undefined)[]) => texts.some((t) => t && normalizeForSearch(t).includes(q))
  const isDecision = (s: DesktopSessionSummary) => marks?.get(s.id)?.decision === true
  const found = sessions
    .filter((s) => !s.isArchived && hit(s.title, s.group?.name, s.folderName))
    .sort((a, b) => Number(isDecision(b)) - Number(isDecision(a)) || newest(a, b))
    .slice(0, MAX_SESSIONS)
    .map((s) => sessionItem(s, marks))
  const foundGroups: JumpItem[] = groups
    .filter((g) => hit(g.name))
    .slice(0, MAX_OTHERS)
    .map((g) => ({ kind: "group", id: g.id, title: g.name, sub: `${g.count}件` }))
  const foundPages: JumpItem[] = pages
    .filter((p) => hit(p.label))
    .slice(0, MAX_OTHERS)
    .map((p) => ({ kind: "page", id: p.href, title: p.label, sub: null, href: p.href }))
  return [
    { label: "セッション", items: found },
    { label: "グループ", items: foundGroups },
    { label: "ページ", items: foundPages },
  ].filter((b) => b.items.length > 0)
}

/** セッションの詳細を開く先。詳細のダイアログ(?session=)を持つページならそのまま、ほかはセッション一覧 */
const DETAIL_PAGES = new Set(["/", "/desktop-sessions", "/desktop-sessions/housekeeping"])
export function detailHref(pathname: string, sessionId: string): string {
  const base = DETAIL_PAGES.has(pathname) ? pathname : "/desktop-sessions"
  return `${base}?session=${encodeURIComponent(sessionId)}`
}
