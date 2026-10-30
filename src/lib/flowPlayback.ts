import { FLOW_WORK_LAP, type FlowEvent, type FlowInstruct, type FlowMember, type FlowReceipt, type FlowResponse } from "./flowTypes"
import { formatTokens } from "./usageFormat"

/**
 * 組織図アニメーション(⑤)の、画面側の純粋な計算。DOM・時計に触れず、APIの応答(FlowResponse)から、
 * ある時刻のカードの状態・新しい出来事の選び方・色の段階などを返す。
 * (振り返りの再生〈⑬ の棚卸しの行5〉と作業量のバー〈行48〉はやめた)
 */

/** 直近これ以内にツール呼び出しがあれば「作業中」 */
export const WORKING_WINDOW_MS = 60_000
/** コンテキストが、これ以上増えたときに、増えた分を強調する */
export const CTX_FLASH_MIN_TOKENS = 1_000
/** 粒の半径(px)。作業量0〜満杯で、最小〜最大 */
export const PARTICLE_MIN_RADIUS = 4
export const PARTICLE_MAX_RADIUS = 11

// ---------------------------------------------------------------------------
// タイムライン

export interface ToolPoint {
  /** 時刻(ms) */
  t: number
  /** members の添字 */
  member: number
  /** コンテキスト(トークン)。不明は null */
  ctx: number | null
  /** まとめたツール呼び出しの回数 */
  n: number
}

export interface FlowTimeline {
  since: number
  until: number
  members: FlowMember[]
  /** 時刻の昇順 */
  events: FlowEvent[]
  /** 時刻の昇順 */
  tools: ToolPoint[]
  indexById: Map<string, number>
}

export function buildTimeline(flow: FlowResponse): FlowTimeline {
  return {
    since: flow.since,
    until: flow.generatedAt,
    members: flow.members,
    events: flow.events,
    tools: flow.tools.map(([dt, member, ctx, n]) => ({ t: flow.since + dt, member, ctx: ctx >= 0 ? ctx : null, n })),
    indexById: new Map(flow.members.map((m, i) => [m.id, i] as const)),
  }
}

// ---------------------------------------------------------------------------
// ある時刻の状態

/** idle: 待機 / working: 作業中 / reported: 報告済み / noreport: 報告なしで終了 */
export type CardPhase = "idle" | "working" | "reported" | "noreport"

export interface MemberState {
  id: string
  phase: CardPhase
  /** 作業量: 直近の指示に対するツール呼び出し回数(結果が出ていれば、その時点まで) */
  tools: number
  /** コンテキスト(トークン)。分からなければ null */
  ctx: number | null
  /** 直近の指示の要約 */
  lastInstruct: string | null
  /** 最後の出来事(指示・報告・終了・ツール呼び出し)の時刻 */
  lastEventAt: number | null
  /** 直近1分のツール呼び出し回数(脈動の速さに使う) */
  callsPerMinute: number
  /** 直近に圧縮が起きた時刻(表示の印に使う)。無ければ null */
  lastCompactAt: number | null
}

export interface ChartCounts {
  /** 指示・報告の本数。3層目の親子の間の出来事も含む(「出来事」の一覧・概要の数) */
  instructs: number
  reports: number
  ends: number
  working: number
  /** うち、指揮役自身が出した指示・受けた報告(指揮役のカードの「指示 n／報告 n」)。3層目の出来事は含まない */
  leaderInstructs: number
  leaderReports: number
}

export interface ChartState {
  t: number
  members: MemberState[]
  counts: ChartCounts
}

/** 時刻 t 以前で最後の要素の添字(時刻の昇順の配列から。無ければ -1) */
function lastIndexAtOrBefore(list: Array<{ t: number }>, t: number): number {
  let lo = 0
  let hi = list.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].t <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function stateAt(timeline: FlowTimeline, t: number): ChartState {
  const { events, tools, members } = timeline
  const visibleEnd = lastIndexAtOrBefore(events, t)
  const visible = visibleEnd >= 0 ? events.slice(0, visibleEnd + 1) : []

  const toolsByMember = members.map(() => [] as ToolPoint[])
  for (const p of tools) {
    if (p.t > t) break
    toolsByMember[p.member].push(p)
  }

  const memberStates: MemberState[] = members.map((member, index) => {
    const points = toolsByMember[index]
    const lastTool = points.length > 0 ? points[points.length - 1] : null

    // コンテキスト: 最後のツール呼び出しの値。圧縮のほうが新しければ圧縮後の量。どちらも無ければ範囲の始まりより前の値
    let ctx = member.contextBefore
    let ctxAt = Number.NEGATIVE_INFINITY
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].ctx !== null) {
        ctx = points[i].ctx
        ctxAt = points[i].t
        break
      }
    }
    let lastCompactAt: number | null = null
    for (let i = visible.length - 1; i >= 0; i--) {
      const e = visible[i]
      if (e.kind === "compact" && e.sid === member.id) {
        lastCompactAt = e.t
        if (e.t >= ctxAt) ctx = e.post
        break
      }
    }

    let lastInstruct: FlowEvent | null = null
    let outcome: FlowEvent | null = null
    let lastEventAt: number | null = lastTool ? lastTool.t : null
    if (!member.isLeader) {
      for (let i = visible.length - 1; i >= 0; i--) {
        const e = visible[i]
        if (e.kind === "instruct" && e.to === member.id) {
          lastInstruct = e
          break
        }
      }
      if (lastInstruct) {
        for (const e of visible) {
          if (e.kind === "report" && e.from === member.id && e.instructAt === lastInstruct.t) outcome = e
          if (e.kind === "end" && e.sid === member.id && e.instructAt === lastInstruct.t) outcome = e
        }
      }
      for (const e of visible) {
        const involved =
          (e.kind === "instruct" && e.to === member.id) ||
          (e.kind === "report" && e.from === member.id) ||
          (e.kind === "end" && e.sid === member.id)
        if (involved && (lastEventAt === null || e.t > lastEventAt)) lastEventAt = e.t
      }
    }

    let phase: CardPhase = "idle"
    let toolCount = 0
    if (member.isLeader) {
      if (lastTool && t - lastTool.t <= WORKING_WINDOW_MS) phase = "working"
    } else if (lastInstruct) {
      const until = outcome ? outcome.t : t
      for (const p of points) if (p.t >= lastInstruct.t && p.t <= until) toolCount += p.n
      if (outcome) phase = outcome.kind === "report" ? "reported" : "noreport"
      else if (lastTool && lastTool.t >= lastInstruct.t && t - lastTool.t <= WORKING_WINDOW_MS) phase = "working"
    } else if (lastTool && t - lastTool.t <= WORKING_WINDOW_MS) {
      // 親からの指示が無くても、直近にツールを呼んでいれば作業中(人の入力で動いている子・3層目の補助のセッション)。作業量は指示ごとの数なので0
      phase = "working"
    }

    let recent = 0
    for (let i = points.length - 1; i >= 0 && t - points[i].t < 60_000; i--) recent += points[i].n

    return {
      id: member.id,
      phase,
      tools: toolCount,
      ctx,
      lastInstruct: lastInstruct && lastInstruct.kind === "instruct" ? lastInstruct.summary : null,
      lastEventAt,
      callsPerMinute: recent,
      lastCompactAt,
    }
  })

  const leaderId = members.find((m) => m.isLeader)?.id ?? null
  const counts: ChartCounts = {
    instructs: visible.filter((e) => e.kind === "instruct").length,
    reports: visible.filter((e) => e.kind === "report").length,
    ends: visible.filter((e) => e.kind === "end").length,
    working: memberStates.filter((m, i) => !members[i].isLeader && m.phase === "working").length,
    leaderInstructs: leaderId === null ? 0 : visible.filter((e) => e.kind === "instruct" && e.from === leaderId).length,
    leaderReports: leaderId === null ? 0 : visible.filter((e) => e.kind === "report" && e.to === leaderId).length,
  }
  return { t, members: memberStates, counts }
}

// ---------------------------------------------------------------------------
// 見た目の規則

/** 増えた分の強調。1,000トークン以上増えたときだけ「+28K」の形で返す */
export function formatCtxDelta(delta: number): string | null {
  return delta >= CTX_FLASH_MIN_TOKENS ? `+${formatTokens(delta)}` : null
}

/** 作業量(ツール呼び出し回数)の、1周目の中での割合(0〜1)。100回以上は1のまま(粒の大きさ・カードの光り方に使う) */
export function workRatio(tools: number): number {
  return Math.max(0, Math.min(1, tools / FLOW_WORK_LAP))
}

/** 報告の粒の半径。作業量0〜100回以上を、最小〜最大の線形 */
export function particleRadius(tools: number): number {
  return PARTICLE_MIN_RADIUS + (PARTICLE_MAX_RADIUS - PARTICLE_MIN_RADIUS) * workRatio(tools)
}

/** 作業中の脈動の周期(秒)。直近1分のツール呼び出しが多いほど速い(0回=1.8秒、30回以上=0.6秒) */
export function pulseSeconds(callsPerMinute: number): number {
  const v = Math.max(0, Math.min(1, callsPerMinute / 30))
  return 1.8 - 1.2 * v
}

/** 動きを減らす設定のとき、粒の移動・脈動・強調の動きを止める */
export function shouldAnimate(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion
}

/**
 * 指揮役のカードの状態の文言。指揮役自身が作業中かと、配下(2層目・3層目)の作業中の数(概要の「作業中」と同じ数)を、
 * 「配下で」と付けて区別する。
 */
export function leaderPhaseText(selfWorking: boolean, subordinatesWorking: number): string {
  const subordinates = subordinatesWorking > 0 ? `配下で${subordinatesWorking}件が作業中` : null
  if (selfWorking) return subordinates ? `作業中・${subordinates}` : "作業中"
  return subordinates ?? "作業なし"
}

/** 「最後の出来事から」の経過の表示 */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分前`
  return `${Math.floor(min / 60)}時間前`
}

// ---------------------------------------------------------------------------
// ライブ: 新しい出来事だけを選ぶ

/** 前回までに見た時刻(cursor)より後の出来事。ライブで新しく粒を流すもの */
export function newEventsAfter(events: FlowEvent[], cursor: number): FlowEvent[] {
  return events.filter((e) => e.t > cursor)
}

/**
 * 出来事を見分けるキー(種別・時刻・関わるセッション)。指示は、受け手の記録の時刻(t)ではなく、送信記録の時刻(sentAt)で見分ける。
 * 送信側の記録だけで出した指示が、1〜2秒後に受け手の記録が書かれて確認済みになっても、同じ指示として扱うため。
 */
export function eventKey(e: FlowEvent): string {
  switch (e.kind) {
    case "instruct":
      return `i|${e.sentAt ?? e.t}|${e.from}|${e.to}`
    case "report":
      return `r|${e.t}|${e.from}`
    case "end":
      return `e|${e.t}|${e.sid}`
    case "compact":
      return `c|${e.t}|${e.sid}`
    case "cross":
      return `x|${e.t}|${e.source}|${e.to}`
  }
}

/** 見た出来事のキー → 受信の状態。指示以外は "-"。送信側のみで流した指示が、あとで確認済みになったことを見つけるために覚える */
export type SeenEvents = Map<string, FlowReceipt | "-">

/**
 * まだ見ていない出来事(fresh)と、見た指示が確認済みになったもの(upgraded)を返し、seen に覚える。更新の間に会話ログへ
 * 遅れて書かれた出来事も、取りこぼさず、同じ出来事を2回流さない。seen が空のとき(最初の表示)は、過去の出来事を流さないよう、
 * 呼び出し側が先に呼んで、返り値を捨てる。
 * upgraded は、すでに「受信未確認」の粒で流した指示の受信が、あとで確認できたもの。粒はもう流さず、
 * 表示中のラベル・粒の「受信未確認」の印だけを、確認済みに切り替える。
 */
export function selectUnseen(events: FlowEvent[], seen: SeenEvents): { fresh: FlowEvent[]; upgraded: FlowInstruct[] } {
  const fresh: FlowEvent[] = []
  const upgraded: FlowInstruct[] = []
  for (const e of events) {
    const key = eventKey(e)
    const before = seen.get(key)
    if (before === undefined) {
      seen.set(key, e.kind === "instruct" ? e.receipt : "-")
      fresh.push(e)
    } else if (e.kind === "instruct" && e.receipt === "confirmed" && before === "sender-only") {
      seen.set(key, "confirmed")
      upgraded.push(e)
    }
  }
  return { fresh, upgraded }
}

/** 前回までに見た時刻より後の、ツール呼び出しのまとまり */
export function newToolsAfter(tools: ToolPoint[], cursor: number): ToolPoint[] {
  return tools.filter((p) => p.t > cursor)
}

// ---------------------------------------------------------------------------
// 出来事の一覧の文言

export interface EventLine {
  t: number
  /** 種別の表示(指示・報告・終了・圧縮・他から) */
  label: string
  /** 色の種類。指示=down、報告=up、他グループ=cross、それ以外=neutral */
  tone: "down" | "up" | "cross" | "neutral"
  text: string
}

const SOURCE_LABEL = { "other-group": "他のグループ", external: "外部（CLI）" } as const

export function describeEvent(event: FlowEvent, titleOf: (id: string) => string): EventLine {
  switch (event.kind) {
    case "instruct":
      return {
        t: event.t,
        label: "指示",
        tone: "down",
        text: `→ ${titleOf(event.to)}「${event.summary || "（本文なし）"}」${event.receipt === "sender-only" ? "（受信を確認できていません）" : ""}`,
      }
    case "report": {
      const mins = Math.max(1, Math.round(event.durationMs / 60_000))
      return {
        t: event.t,
        label: "報告",
        tone: "up",
        text:
          event.instructAt === null
            ? `← ${titleOf(event.from)}（指示と組にならない報告）`
            : `← ${titleOf(event.from)}　ツール${event.tools}回・${mins}分`,
      }
    }
    case "end": {
      const mins = Math.max(1, Math.round(event.durationMs / 60_000))
      return { t: event.t, label: "終了", tone: "neutral", text: `${titleOf(event.sid)}　報告なし（ツール${event.tools}回・${mins}分）` }
    }
    case "compact":
      return { t: event.t, label: "圧縮", tone: "neutral", text: `${titleOf(event.sid)}　${formatTokens(event.pre)} → ${formatTokens(event.post)}` }
    case "cross":
      return {
        t: event.t,
        label: "他から",
        tone: "cross",
        text: `${SOURCE_LABEL[event.source]}から → ${titleOf(event.to)}「${event.summary || "（本文なし）"}」`,
      }
  }
}

/** 時刻 t までの出来事を、新しい順に最大 limit 件 */
export function eventLines(timeline: FlowTimeline, t: number, titleOf: (id: string) => string, limit = 50): EventLine[] {
  const end = lastIndexAtOrBefore(timeline.events, t)
  const lines: EventLine[] = []
  for (let i = end; i >= 0 && lines.length < limit; i--) lines.push(describeEvent(timeline.events[i], titleOf))
  return lines
}
