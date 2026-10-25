import type { DecisionDetail } from "./decisionDetail"
import type { DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions } from "./housekeeping"
import { formatDuration } from "./housekeepingFormat"
import type { DecisionItem } from "./housekeepingTypes"

/**
 * 次にやる判断(⑬ ND-1〜ND-7)。ホームのいちばん上の一覧の、並べ方・件数・1行の文。ファイルにも通信にも触れない純粋な関数だけを置く。
 * 何を数えるかは、整理ページの「あなたの対応待ち」と同じ関数(collectDecisions)で決める(件数が食い違わないように。A7)。
 */

export type Urgency = "urgent" | "today" | "anytime"

/** 急ぎの度合いの札(記号と文字。色だけに頼らない) */
export const URGENCY_LABEL: Record<Urgency, string> = {
  urgent: "！ 急ぎ",
  today: "今日中",
  anytime: "いつでも",
}

const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, today: 1, anytime: 2 }

/** 種類の札(7つ) */
export type DecisionKindLabel = "許可" | "承認" | "質問" | "送信上限" | "エラー" | "届かない送信" | "種類不明"

/** 最初に見せる件数(急ぎは、これを超えても全部出す) */
export const DECISION_PREVIEW_COUNT = 5
/** この時間を超えて待っているものは、種類によらず今日中に上げる(推定・種類不明も。M7) */
export const LONG_WAIT_MS = 2 * 60 * 60_000

export interface NextDecision {
  id: string
  title: string
  /** グループに入っていなければ null(画面は「グループ外」) */
  groupName: string | null
  kindLabel: DecisionKindLabel
  /** 言葉からの推定(札に「（推定）」) */
  estimated: boolean
  urgency: Urgency
  /** 待ち時間(最後の活動から)。分からなければ null */
  waitMs: number | null
  /** 問いの文と答えの候補(サーバーが判断を待つセッションにだけ付ける)。無ければ null */
  detail: DecisionDetail | null
  /** 問いの無い種類(送信上限・エラー・届かない送信)の「何が起きたか」の1文 */
  happened: string | null
  /** 待ち時間の横に出す急ぎの理由・ほかの理由(作る側の言葉は入れない) */
  notes: string[]
}

function kindLabelOf(item: DecisionItem): DecisionKindLabel {
  switch (item.reasons[0]) {
    case "needs-action":
      switch (item.needsAction?.kind) {
        case "permission":
          return "許可"
        case "approval":
          return "承認"
        case "decision":
          return "質問"
        default:
          return "種類不明"
      }
    case "send-limit":
      return "送信上限"
    case "error":
      return "エラー"
    case "undelivered":
      return "届かない送信"
  }
}

/** 配下(このセッションが立てたセッション)のうち、手が止まっているもの(入力待ち・待機)の数 */
function waitingChildrenOf(id: string, sessions: DesktopSessionSummary[]): number {
  const idle: DesktopSessionStatus[] = ["waiting", "standby"]
  return sessions.filter((s) => s.spawnedFromId === id && !s.isArchived && idle.includes(s.status)).length
}

/**
 * 急ぐ順(ND-3・A3)。
 * - 急ぎ：送信上限、許可(推定を含む)、エラー、配下が答えを待っているもの
 * - 今日中：承認(推定を含む)、届かない送信、待ちが2時間以上のもの(推定・種類不明を含む)
 * - いつでも：それ以外
 */
export function urgencyOf(item: DecisionItem, waitMs: number | null, waitingChildren: number): Urgency {
  const needs = item.reasons.includes("needs-action")
  const kind = item.needsAction?.kind
  if (item.reasons.includes("send-limit") || item.reasons.includes("error") || (needs && kind === "permission") || waitingChildren > 0) {
    return "urgent"
  }
  if ((needs && kind === "approval") || item.reasons.includes("undelivered")) return "today"
  if (waitMs !== null && waitMs >= LONG_WAIT_MS) return "today"
  return "anytime"
}

export function buildNextDecisions(sessions: DesktopSessionSummary[], now: number): NextDecision[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const list = collectDecisions(sessions).map((item): NextDecision => {
    const s = byId.get(item.id)
    const waitMs = item.lastActivityAt === null ? null : Math.max(0, now - item.lastActivityAt)
    const children = waitingChildrenOf(item.id, sessions)
    const urgency = urgencyOf(item, waitMs, children)
    const kindLabel = kindLabelOf(item)
    const messaging = s?.messaging ?? null
    const detail = s?.decision ?? null

    let happened: string | null = null
    if (kindLabel === "送信上限") {
      const sent = messaging ? `（${messaging.sent}/${messaging.limit}）` : ""
      happened = `送信の上限${sent}で止まっています。開いて一言入力すると、また送れます。`
    } else if (kindLabel === "エラー") {
      happened = detail?.errorText ? `エラーで止まっています：${detail.errorText}` : "エラーで止まっています。"
    } else if (kindLabel === "届かない送信") {
      happened = `送った相手が見つからず、${item.undeliveredCount}件が届いていません。`
    }

    const notes: string[] = []
    if (children > 0) notes.push(`立てたセッション ${children}件が、この答えを待っています`)
    const first = item.reasons[0]
    if (first !== "send-limit" && item.reasons.includes("send-limit")) notes.push("送信の上限でも止まっています")
    if (first !== "error" && item.reasons.includes("error")) notes.push("エラーも記録されています")
    if (first !== "undelivered" && item.undeliveredCount > 0) notes.push(`届かなかった送信も${item.undeliveredCount}件あります`)
    const byKindToday = (item.reasons.includes("needs-action") && item.needsAction?.kind === "approval") || item.reasons.includes("undelivered")
    if (urgency === "today" && !byKindToday) notes.push("2時間を超えたので今日中")

    return {
      id: item.id,
      title: item.title,
      groupName: item.groupName,
      kindLabel,
      estimated: item.reasons[0] === "needs-action" && item.needsAction?.estimated === true,
      urgency,
      waitMs,
      detail,
      happened,
      notes,
    }
  })
  return list.sort((a, b) => {
    const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (r !== 0) return r
    // 同じ段では、待ちの長いものを先に(分からないものは後)
    const wa = a.waitMs ?? -1
    const wb = b.waitMs ?? -1
    if (wa !== wb) return wb - wa
    return a.id < b.id ? -1 : 1
  })
}

export interface DecisionCounts {
  total: number
  urgent: number
  today: number
  anytime: number
}

export function countByUrgency(list: NextDecision[]): DecisionCounts {
  return {
    total: list.length,
    urgent: list.filter((d) => d.urgency === "urgent").length,
    today: list.filter((d) => d.urgency === "today").length,
    anytime: list.filter((d) => d.urgency === "anytime").length,
  }
}

/** 見出しの件数の文(「11件（急ぎ 3・今日中 5・いつでも 3）」) */
export function countsText(c: DecisionCounts): string {
  if (c.total === 0) return "0件"
  const parts = (["urgent", "today", "anytime"] as const)
    .filter((u) => c[u] > 0)
    .map((u) => `${URGENCY_LABEL[u].replace("！ ", "")} ${c[u]}`)
  return `${c.total}件（${parts.join("・")}）`
}

/** 最初に見せる行(最大5件。急ぎは全部)と、畳む行 */
export function splitPreview(list: NextDecision[], max: number = DECISION_PREVIEW_COUNT): { shown: NextDecision[]; hidden: NextDecision[] } {
  const urgent = list.filter((d) => d.urgency === "urgent").length
  const n = Math.max(max, urgent)
  return { shown: list.slice(0, n), hidden: list.slice(n) }
}

/** 畳んだ行の内訳(「ほか 6件を出す（今日中 3・いつでも 3）」) */
export function hiddenText(hidden: NextDecision[]): string {
  const c = countByUrgency(hidden)
  const parts = (["urgent", "today", "anytime"] as const)
    .filter((u) => c[u] > 0)
    .map((u) => `${URGENCY_LABEL[u].replace("！ ", "")} ${c[u]}`)
  return `ほか ${hidden.length}件を出す（${parts.join("・")}）`
}

export function formatWait(waitMs: number | null): string | null {
  return waitMs === null ? null : `待ち ${formatDuration(waitMs)}`
}

/** 判断待ちではないセッション(ND-6・D8)。アーカイブ・サイドチャットと、次にやる判断に入ったものを除いて、状態ごとに数える */
export interface RestCounts {
  running: number
  waiting: number
  reviewReady: number
  standby: number
  /** 中断した可能性(推定)。判断が要らないとは言い切れないので、別の文で出す */
  interrupted: number
}

export function countRest(sessions: DesktopSessionSummary[]): RestCounts {
  const decided = new Set(collectDecisions(sessions).map((d) => d.id))
  const rest = sessions.filter((s) => !s.isArchived && !s.isSideChat && !decided.has(s.id))
  const count = (status: DesktopSessionStatus) => rest.filter((s) => s.status === status).length
  return {
    running: count("running"),
    waiting: count("waiting"),
    reviewReady: count("review_ready"),
    standby: count("standby"),
    interrupted: count("interrupted"),
  }
}

/** 「判断待ちではないセッション：作業中 2・確認待ち 3・入力待ち 1・待機 2」。0 の状態は出さない。全部0なら null */
export function restText(c: RestCounts): string | null {
  const parts = [
    ["作業中", c.running],
    ["確認待ち", c.reviewReady],
    ["入力待ち", c.waiting],
    ["待機", c.standby],
  ]
    .filter(([, n]) => (n as number) > 0)
    .map(([label, n]) => `${label} ${n}`)
  return parts.length === 0 ? null : `判断待ちではないセッション：${parts.join("・")}`
}

/** 中断した可能性(推定)の1文。0 なら null */
export function interruptedText(c: RestCounts): string | null {
  return c.interrupted === 0 ? null : `中断した可能性（推定）${c.interrupted}：再開するかを、セッション一覧で確かめる`
}
