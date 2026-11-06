import type { DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import type { MonitorAlertSummary } from "./monitor/monitorTypes"
import type { StatusMark } from "./statusMark"
import type { UsageResponse } from "./usageTypes"

/**
 * 知らせの鐘(⑮ OR-4・A7・A8)。知らせは、今読んでいる時刻つきの記録(会話ログから作ったセッションの一覧・利用上限の記録・
 * PC の警告の記録)から組み立てる。画面の中に記憶を持たないので、窓を閉じていた間の分も開いたときに出て、
 * デスクトップ通知のスイッチとも関係なく溜まる。既読は「見た時刻・対象の ID・知らせの種類」だけを Dashboard の中に覚える。
 */

export type InboxKind = "decision" | "turn-end" | "send-limit" | "pc-alert" | "usage"
export const INBOX_KINDS: InboxKind[] = ["decision", "turn-end", "send-limit", "pc-alert", "usage"]
export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  decision: "新しく判断待ちになった",
  "turn-end": "報告してターンが終わった",
  "send-limit": "送信上限で止まった",
  "pc-alert": "PC の警告",
  usage: "利用上限",
}

/** 小窓に出す数 */
export const INBOX_SHOWN = 20
/** 「ターンが終わった」を拾う範囲(看板の完了の列と同じ24時間) */
export const TURN_END_WINDOW_MS = 24 * 60 * 60_000
/** 既読の記録を残す日数 */
export const INBOX_KEEP_DAYS = 30

export interface InboxItem {
  /** 1件を見分ける名前(種類・対象・時刻) */
  key: string
  kind: InboxKind
  /** 対象の ID。セッションは local_…、PC の警告は pc:cpu など、利用上限は usage:five_hour など */
  target: string
  at: number
  title: string
  /** 何が起きたか(短い文。会話の本文は入れない) */
  what: string
  mark: StatusMark | null
  /** 押したときに移る先 */
  href: string
}

export interface InboxRead {
  target: string
  kind: InboxKind
  seenAt: number
}

export interface InboxReadData {
  reads: InboxRead[]
}

const DONE: DesktopSessionStatus[] = ["completed", "standby", "waiting", "review_ready"]
const USAGE_LEVELS = [95, 80]

/** 押したときの行き先。セッションは看板の該当カード(#card-<ID>。看板が受け取って、そのカードへ送り、枠で目立たせる) */
export function sessionHref(sessionId: string): string {
  return `/desktop-sessions#${cardAnchor(sessionId)}`
}

export function cardAnchor(sessionId: string): string {
  return `card-${sessionId}`
}

export interface InboxSources {
  sessions: DesktopSessionSummary[]
  marks: Map<string, StatusMark>
  alerts: MonitorAlertSummary | null
  usage: UsageResponse | null
  now: number
}

/** 今の記録から知らせを組み立て、新しい順に並べる */
export function buildInbox({ sessions, marks, alerts, usage, now }: InboxSources): InboxItem[] {
  const items: InboxItem[] = []
  for (const s of sessions) {
    if (s.isArchived || s.lastActivityAt === null) continue
    const mark = marks.get(s.id) ?? null
    const base = { target: s.id, at: s.lastActivityAt, title: s.title, mark, href: sessionHref(s.id) }
    if (mark?.decision) {
      // 判断待ちは、ホームの次にやる判断・サイドバーの「判断 n」と同じ元(印)から作る
      const kind: InboxKind = mark.text === "送信上限" ? "send-limit" : "decision"
      items.push({ ...base, kind, key: `${kind}:${s.id}:${s.lastActivityAt}`, what: INBOX_KIND_LABEL[kind] })
    } else if (DONE.includes(s.status) && now - s.lastActivityAt <= TURN_END_WINDOW_MS) {
      items.push({ ...base, kind: "turn-end", key: `turn-end:${s.id}:${s.lastActivityAt}`, what: INBOX_KIND_LABEL["turn-end"] })
    }
  }
  for (const a of alerts?.items ?? []) {
    const what = `${a.key === "cpu" ? "CPU" : "メモリ"}${a.band.max === null ? "" : ` ${Math.round(a.band.max)}%`}`
    items.push({
      kind: "pc-alert",
      target: `pc:${a.key}`,
      at: a.band.end,
      key: `pc-alert:${a.key}:${a.band.start}`,
      title: `PC の警告（${what}）`,
      what: INBOX_KIND_LABEL["pc-alert"],
      mark: null,
      href: "/desktop-sessions/usage?tab=load",
    })
  }
  for (const w of usage?.windows ?? []) {
    const p = w.displayPercent
    const level = p === null ? undefined : USAGE_LEVELS.find((l) => p >= l)
    if (level === undefined) continue
    // 超えた時刻は、記録の時刻(公式値の記録か、一覧を作った時刻)。同じ枠・同じ境では1件
    const at = w.official?.recordedAt ?? usage?.generatedAt ?? now
    items.push({
      kind: "usage",
      target: `usage:${w.id}`,
      at,
      key: `usage:${w.id}:${level}:${w.resetsAt ?? 0}`,
      title: `利用上限 ${w.label} が ${level}% を超えた`,
      what: INBOX_KIND_LABEL.usage,
      mark: null,
      href: "/desktop-sessions/usage",
    })
  }
  return items.sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1))
}

/** 未読か：同じ対象・同じ種類を、その知らせの時刻より後に見ていなければ未読 */
export function isUnread(item: InboxItem, reads: InboxRead[]): boolean {
  const seen = reads.find((r) => r.target === item.target && r.kind === item.kind)
  return !seen || seen.seenAt < item.at
}

export function unreadCount(items: InboxItem[], reads: InboxRead[]): number {
  return items.filter((i) => isUnread(i, reads)).length
}

/** 経過時間の短い書き方(「12分前」。状態の理由の書き方と同じ区切り) */
export function agoText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}秒前`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}分前`
  const hours = Math.round(min / 60)
  if (hours < 48) return `${hours}時間前`
  return `${Math.round(hours / 24)}日前`
}

/** 鐘の数の書き方(100以上は「99+」) */
export function countText(n: number): string {
  return n > 99 ? "99+" : String(n)
}

const TARGET = /^[A-Za-z0-9_:.-]{1,200}$/

/** 届いた既読の形を確かめる(形の違う物は捨てずに例外にする。API では 400) */
export function parseReadTargets(input: unknown): Array<Pick<InboxRead, "target" | "kind">> | null {
  const items = (input as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return null
  const out: Array<Pick<InboxRead, "target" | "kind">> = []
  for (const it of items) {
    const target = (it as { target?: unknown })?.target
    const kind = (it as { kind?: unknown })?.kind
    if (typeof target !== "string" || !TARGET.test(target) || !INBOX_KINDS.includes(kind as InboxKind)) return null
    out.push({ target, kind: kind as InboxKind })
  }
  return out
}

/** 30日より前の既読と、形の違う行を消す */
export function pruneReads(reads: unknown, now: number): InboxRead[] {
  if (!Array.isArray(reads)) return []
  const since = now - INBOX_KEEP_DAYS * 24 * 60 * 60_000
  return reads.filter(
    (r): r is InboxRead =>
      !!r &&
      typeof r.target === "string" &&
      TARGET.test(r.target) &&
      INBOX_KINDS.includes(r.kind) &&
      typeof r.seenAt === "number" &&
      r.seenAt >= since
  )
}

/** 既読にする(同じ対象・種類は、見た時刻を新しくする) */
export function markRead(reads: InboxRead[], targets: Array<Pick<InboxRead, "target" | "kind">>, seenAt: number): InboxRead[] {
  const next = reads.filter((r) => !targets.some((t) => t.target === r.target && t.kind === r.kind))
  for (const t of targets) next.push({ target: t.target, kind: t.kind, seenAt })
  return next
}

/** 未読に戻す(その対象・種類の既読を消す) */
export function markUnread(reads: InboxRead[], targets: Array<Pick<InboxRead, "target" | "kind">>): InboxRead[] {
  return reads.filter((r) => !targets.some((t) => t.target === r.target && t.kind === r.kind))
}
