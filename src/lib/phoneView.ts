import type { DesktopSessionGroup, DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions } from "./housekeeping"
import { DECISION_REASON_LABEL } from "./housekeepingFormat"
import type { DecisionItem } from "./housekeepingTypes"
import { NEEDS_ACTION_KIND_LABEL } from "./needsActionKind"

/**
 * スマホ用のページ(⑪-2)の並び・絞り込み・選び方。ファイルにも通信にも DOM にも触れない純粋な関数だけを置く。
 * 対応待ちの数え方は、ホーム・整理ページと同じ関数(collectDecisions)を使う。
 */

/** スマホの更新の間隔(Q16)。画面が隠れているあいだは止める(SWR の refreshWhenHidden: false) */
export const PHONE_POLL_MS = 15_000

/** スマホのデータの取り方(SWR の設定に重ねる) */
export const PHONE_SWR_OPTIONS = { refreshInterval: PHONE_POLL_MS, refreshWhenHidden: false } as const

/** ホームに出す対応待ちの行の数 */
export const PHONE_DECISION_PREVIEW = 3

/** 対応待ちの1行で「何を待っているか」の言葉。要対応は種類(許可待ち・承認待ち・判断待ち)、それ以外は理由の名前 */
export function decisionWaitLabel(item: DecisionItem): string {
  const first = item.reasons[0]
  if (first === "needs-action") return NEEDS_ACTION_KIND_LABEL[item.needsAction?.kind ?? "unknown"]
  return DECISION_REASON_LABEL[first]
}

/**
 * 対応待ちの行に出す問いの文(⑬ の D5・ND-15)。LAN の応答では、サーバーが秘密とパスを伏せた問いだけを返す。
 * 要約から取った問いは「要約：」を付ける(PC のホームと同じ)。問いが無ければ null
 */
export function phoneQuestion(session: DesktopSessionSummary | undefined): string | null {
  const q = session?.decision?.question
  if (!q) return null
  return session?.decision?.questionSource === "summary" ? `要約：${q}` : q
}

/** ホームの対応待ち(上位 limit 件と、全体の件数)。並びは整理ページと同じ(すぐ押せるものが上) */
export function phoneDecisionRows(
  sessions: DesktopSessionSummary[],
  limit: number = PHONE_DECISION_PREVIEW
): { items: DecisionItem[]; total: number } {
  const all = collectDecisions(sessions)
  return { items: all.slice(0, limit), total: all.length }
}

/** アーカイブされていない、実行中のセッションの数 */
export function countRunning(sessions: DesktopSessionSummary[]): number {
  return sessions.filter((s) => !s.isArchived && s.status === "running").length
}

/** 送信上限で止まっている、アーカイブされていないセッション */
export function sendLimitStopped(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
  return sessions.filter((s) => !s.isArchived && s.messaging?.stopped === true)
}

/** 一覧の絞り込み(状態)。スマホは選択肢を絞る */
export type PhoneStatusFilter = "all" | "attention" | "running" | "standby" | "highContext"

export const PHONE_STATUS_OPTIONS: Array<{ value: PhoneStatusFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "attention", label: "あなたの対応待ち" },
  { value: "running", label: "実行中" },
  { value: "standby", label: "待機" },
  { value: "highContext", label: "コンテキストが高い" },
]

export interface PhoneFilters {
  status: PhoneStatusFilter
  /** グループの ID。all: すべて / none: グループなし */
  group: string
}

export const DEFAULT_PHONE_FILTERS: PhoneFilters = { status: "all", group: "all" }

/** URL の検索の値から絞り込みを作る(知らない値は既定に戻す) */
export function parsePhoneFilters(params: { get(name: string): string | null }): PhoneFilters {
  const status = params.get("status")
  const group = params.get("group")
  return {
    status: PHONE_STATUS_OPTIONS.some((o) => o.value === status) ? (status as PhoneStatusFilter) : "all",
    group: group && /^[A-Za-z0-9_-]{1,100}$/.test(group) ? group : "all",
  }
}

/** 絞り込みを URL の検索の文字列にする(既定の値は書かない) */
export function phoneFiltersToSearch(filters: PhoneFilters): string {
  const params = new URLSearchParams()
  if (filters.status !== "all") params.set("status", filters.status)
  if (filters.group !== "all") params.set("group", filters.group)
  const s = params.toString()
  return s ? `?${s}` : ""
}

/** 既定から変えている絞り込みの数(ボタンに出す) */
export function activeFilterCount(filters: PhoneFilters): number {
  return (filters.status !== "all" ? 1 : 0) + (filters.group !== "all" ? 1 : 0)
}

/**
 * スマホの一覧(Q21)。アーカイブ済みは出さない。並びは、対応待ち → 実行中 → そのほか。それぞれの中は、最後の動きが新しい順
 * (不明は最後)。同じなら ID の順
 */
export function sortPhoneSessions(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
  const attention = new Set(collectDecisions(sessions).map((d) => d.id))
  const rank = (s: DesktopSessionSummary) => (attention.has(s.id) ? 0 : s.status === "running" ? 1 : 2)
  return sessions
    .filter((s) => !s.isArchived)
    .sort((a, b) => {
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      const ta = a.lastActivityAt ?? Number.NEGATIVE_INFINITY
      const tb = b.lastActivityAt ?? Number.NEGATIVE_INFINITY
      if (ta !== tb) return tb - ta
      return a.id < b.id ? -1 : 1
    })
}

/** 一覧の絞り込みを当てる(並びは sortPhoneSessions のまま) */
export function applyPhoneFilters(
  sorted: DesktopSessionSummary[],
  filters: PhoneFilters,
  highContextRatio: number
): DesktopSessionSummary[] {
  const attention = new Set(collectDecisions(sorted).map((d) => d.id))
  return sorted.filter((s) => {
    if (filters.group === "none" ? s.group !== null : filters.group !== "all" && s.group?.id !== filters.group) return false
    switch (filters.status) {
      case "all":
        return true
      case "attention":
        return attention.has(s.id)
      case "running":
        return s.status === "running"
      case "standby":
        return s.status === "standby"
      case "highContext":
        return s.context !== null && s.context.ratio >= highContextRatio
    }
  })
}

export interface PhoneGroupSummary {
  /** グループの ID。グループに入っていないセッションは "none" */
  id: string
  name: string
  total: number
  running: number
  attention: number
}

/**
 * 組織図の代わりの、グループごとの短い一覧(Q15)。アーカイブ済みは数えない。セッションの無いグループは出さない。
 * 並びはグループの順(Desktop の並び)。グループに入っていないセッションは最後に「グループなし」でまとめる
 */
export function summarizeGroups(sessions: DesktopSessionSummary[], groups: DesktopSessionGroup[]): PhoneGroupSummary[] {
  const attention = new Set(collectDecisions(sessions).map((d) => d.id))
  const byId = new Map<string, PhoneGroupSummary>()
  const ordered = [...groups].sort((a, b) => a.order - b.order)
  for (const g of ordered) byId.set(g.id, { id: g.id, name: g.name, total: 0, running: 0, attention: 0 })
  const none: PhoneGroupSummary = { id: "none", name: "グループなし", total: 0, running: 0, attention: 0 }
  for (const s of sessions) {
    if (s.isArchived) continue
    let row = s.group ? byId.get(s.group.id) : none
    if (!row && s.group) {
      // 一覧のグループに無い(並びの情報が無い)グループは、名前だけで後ろに足す
      row = { id: s.group.id, name: s.group.name, total: 0, running: 0, attention: 0 }
      byId.set(s.group.id, row)
    }
    if (!row) continue
    row.total++
    if (s.status === "running") row.running++
    if (attention.has(s.id)) row.attention++
  }
  return [...byId.values(), none].filter((r) => r.total > 0)
}

/** 詳細のシートの印(`#session=<ID>`。Q19)。ID は Desktop の識別子か UUID の形だけを受け取る */
const SESSION_ID = /^(?:local_[A-Za-z0-9_-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

export function parseSessionHash(hash: string): string | null {
  const m = /^#session=(.+)$/.exec(hash)
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return SESSION_ID.test(id) ? id : null
}

export function sessionHash(id: string): string {
  return `#session=${encodeURIComponent(id)}`
}
