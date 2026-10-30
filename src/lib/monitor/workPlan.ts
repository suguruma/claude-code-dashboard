import { redactPathsInText } from "@/lib/lanAccess/redact"
import { maskSecrets } from "@/lib/secretMask"
import type { PlanGroup, PlanState, WaitingItem } from "./monitorTypes"
import { hasColumns, parseLocalTime, parseNumber, parseTsv } from "./tsv"

/**
 * 作業計画(work_plan.tsv)と利用上限の待ち行列(resume_queue.tsv)を読む(⑭ WC-1・WC-2)。読み取り専用。
 * どちらも各セッションが追記するだけのファイルなので、同じ組の最後の行を「今」とする。
 */

const PLAN_COLUMNS = ["date", "session", "group", "task", "size", "resume", "order", "state"] as const
const QUEUE_COLUMNS = ["date", "session", "group", "resets_at", "state", "next"] as const

/** 画面に出す文は、秘密とパスを伏せてから(作業の名前・次の一歩は各セッションが自由に書く) */
const safeText = (v: string | undefined) => redactPathsInText(maskSecrets((v ?? "").trim()))

/** セッションの名前を決める(WC-7)。Desktop で結べたら今の題名、ID の形でなければファイルの値、それも無ければ ID の先頭8文字 */
export function sessionLabel(sessionId: string, titles: ReadonlyMap<string, string>, fileTitle?: string | null): string {
  const known = titles.get(sessionId)
  if (known) return known
  if (fileTitle && fileTitle.trim()) return safeText(fileTitle)
  if (!sessionId.startsWith("local_")) return safeText(sessionId)
  return `${sessionId.slice(0, "local_".length + 8)}…`
}

export interface QueueSummary {
  items: WaitingItem[]
  resumedToday: number
  sentToday: number
  skipped: number
  /** いま待っているセッションの ID(作業計画の「待ち（上限）」に使う) */
  waitingIds: Set<string>
}

/** 待ち行列：セッションごとの最後の行が wait のものだけが「待っている」(A2)。今日の再開した・起こした件数を数える */
export function summarizeQueue(text: string, titles: ReadonlyMap<string, string>, now: number): QueueSummary {
  const { rows } = parseTsv(text)
  const last = new Map<string, Record<string, string | undefined>>()
  let skipped = 0
  let resumedToday = 0
  let sentToday = 0
  const dayStart = new Date(now).setHours(0, 0, 0, 0)
  for (const row of rows) {
    const session = row.session?.trim()
    if (!hasColumns(row, QUEUE_COLUMNS.slice(0, 5)) || !session) {
      skipped++
      continue
    }
    const at = parseLocalTime(row.date)
    const state = row.state?.trim()
    if (at !== null && at >= dayStart) {
      if (state === "resumed") resumedToday++
      if (state === "sent") sentToday++
    }
    last.set(session, row)
  }
  const items: WaitingItem[] = []
  for (const [sessionId, row] of last) {
    if (row.state?.trim() !== "wait") continue
    items.push({
      sessionId,
      title: sessionLabel(sessionId, titles),
      group: safeText(row.group),
      resetsAt: parseLocalTime(row.resets_at),
      next: safeText(row.next),
    })
  }
  // 回復の早い順。時刻の無いもの(回復の時刻が分からない)は最後
  items.sort((a, b) => (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity))
  return { items, resumedToday, sentToday, skipped, waitingIds: new Set(items.map((i) => i.sessionId)) }
}

export interface PlanSummary {
  groups: PlanGroup[]
  doneCount: number
  skipped: number
}

const STATES: ReadonlySet<string> = new Set(["doing", "todo", "later", "done"])
const STATE_RANK: Record<PlanState, number> = { doing: 0, waiting: 1, todo: 2, later: 3 }

/**
 * 作業計画：同じセッションと作業の最後の行を今の状態にする(A1)。列の足りない行・状態の読めない行は飛ばして数える。
 * 済んだもの(done)は件数だけ。待ち行列にいるセッションの「作業中」は「待ち（上限）」にする(A28)。
 * グループは、ファイルに最初に出た順。グループの中は、状態(作業中→待ち→これから→後で)と順の小さい順。
 */
export function summarizePlan(text: string, titles: ReadonlyMap<string, string>, waitingIds: ReadonlySet<string>): PlanSummary {
  const { rows } = parseTsv(text)
  const last = new Map<string, Record<string, string | undefined>>()
  let skipped = 0
  for (const row of rows) {
    const session = row.session?.trim()
    const state = row.state?.trim()
    if (!hasColumns(row, PLAN_COLUMNS) || !session || !state || !STATES.has(state)) {
      skipped++
      continue
    }
    last.set(`${session}\t${row.task?.trim() ?? ""}`, row)
  }

  const groups = new Map<string, PlanGroup>()
  let doneCount = 0
  for (const row of last.values()) {
    const fileState = row.state!.trim()
    if (fileState === "done") {
      doneCount++
      continue
    }
    const sessionId = row.session!.trim()
    const state: PlanState = fileState === "doing" && waitingIds.has(sessionId) ? "waiting" : (fileState as PlanState)
    const name = safeText(row.group) || "グループなし"
    const group = groups.get(name) ?? { name, counts: { doing: 0, waiting: 0, todo: 0, later: 0 }, items: [] }
    group.counts[state]++
    group.items.push({
      sessionId,
      title: sessionLabel(sessionId, titles),
      task: safeText(row.task),
      state,
      order: parseNumber(row.order),
      size: safeText(row.size),
      resume: safeText(row.resume),
      updatedAt: parseLocalTime(row.date),
    })
    groups.set(name, group)
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (a.order ?? Infinity) - (b.order ?? Infinity))
  }
  return { groups: [...groups.values()], doneCount, skipped }
}
