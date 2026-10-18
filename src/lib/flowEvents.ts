import {
  FLOW_TOOL_BUCKET_MS,
  type FlowCompact,
  type FlowCross,
  type FlowEnd,
  type FlowEvent,
  type FlowInstruct,
  type FlowReport,
} from "./flowTypes"

/**
 * 組織図アニメーション(⑤)の「出来事」を、各セッションの会話ログから取り出した信号(signals)から組み立てる。
 * ファイルを読まない純粋な関数だけを置く(読み取りは flowReader.ts)。⑦の「返事の来ない指示」でも、そのまま使えるようにしてある。
 *
 * 会話の本文は持たない。信号が持つ文字列は、指示と他グループ連絡の先頭20文字だけ。
 */

/** peer行の送り手の種類。local: Desktopのセッション / external: CLIなどの外部 / other: 手戻しなど(描かない) */
export type PeerSource = "local" | "external" | "other"

/** 他のセッションから届いた入力(会話ログの peer 行) */
export interface PeerSignal {
  t: number
  /** local のときだけ、送り手のDesktopセッションID */
  fromId: string | null
  source: PeerSource
  /** 本文の先頭20文字 */
  summary: string
}

/** 他のセッションへ送った記録(SendMessage 等のツール呼び出し) */
export interface SendSignal {
  t: number
  /** 宛先の候補(セッションID・名前)。どれかがセッションのIDまたはタイトルに一致すれば、そのセッション宛て */
  targets: string[]
  /** 本文の先頭20文字 */
  summary: string
}

export interface ToolSignal {
  t: number
  /** 呼び出した応答の時点のコンテキスト(トークン)。使用量が無ければ null */
  ctx: number | null
}

export interface CompactSignal {
  t: number
  pre: number
  post: number
}

/** 1つのセッションの、メインスレッドの信号。すべて時刻の昇順 */
export interface SessionSignals {
  peers: PeerSignal[]
  sends: SendSignal[]
  tools: ToolSignal[]
  compacts: CompactSignal[]
  /** ターンの終わり(assistantの stop_reason が tool_use 以外)の時刻 */
  turnEnds: number[]
}

export function emptySignals(): SessionSignals {
  return { peers: [], sends: [], tools: [], compacts: [], turnEnds: [] }
}

export interface FlowSessionInput {
  id: string
  title: string
  signals: SessionSignals
}

/** 送信記録と、受け手の peer 行を同じ指示とみなす時刻の差(実データでは、遅れの中央値は約5秒) */
export const SEND_MATCH_WINDOW_MS = 60_000

export interface ToolBucket {
  t: number
  sid: string
  /** まとまりの最後のコンテキスト。不明は null */
  ctx: number | null
  n: number
}

/** 3層目のセッション。親は2層目の子(`members` のどれか) */
export interface SubSessionInput {
  /** 親(2層目のセッション)のID */
  parentId: string
  session: FlowSessionInput
}

export interface AssembleInput {
  /** 指揮役。見つからなければ null(そのとき、指示・報告・終了・他グループの出来事は作らない) */
  leader: FlowSessionInput | null
  /** 子(2層目。指揮役を除く) */
  members: FlowSessionInput[]
  /** 3層目。親(2層目の子)との間の指示・報告を、2層目と同じ規則で組み立てる */
  subs?: SubSessionInput[]
  /** この時刻以降の出来事だけを返す。組の判定には、これより前の信号も使う */
  since: number
}

export interface AssembleResult {
  /** 時刻の昇順 */
  events: FlowEvent[]
  /** 指揮役・子のツール呼び出しのまとまり。時刻の昇順 */
  tools: ToolBucket[]
  /** since より前の、最後のコンテキスト(トークン)。セッションID → 値 */
  contextBefore: Map<string, number | null>
}

// ---------------------------------------------------------------------------
// 指揮役の判定

export interface LeaderCandidate {
  id: string
  title: string
  createdAt: number | null
}

/**
 * グループ内で、タイトルが接頭辞で始まるセッションを指揮役にする。一致が複数なら、作成日時が最も早いもの
 * (作成日時が分からないものは後ろ。同じなら ID の順)。接頭辞が空なら、指揮役はいない。
 */
export function pickLeader<T extends LeaderCandidate>(sessions: T[], prefix: string): T | null {
  if (!prefix) return null
  const matches = sessions.filter((s) => s.title.startsWith(prefix))
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => {
    const ta = a.createdAt ?? Number.POSITIVE_INFINITY
    const tb = b.createdAt ?? Number.POSITIVE_INFINITY
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]
}

// ---------------------------------------------------------------------------
// 出来事の組み立て

function countIn(times: Array<{ t: number }>, from: number, to: number): number {
  let n = 0
  for (const x of times) if (x.t >= from && x.t <= to) n++
  return n
}

interface Instruction {
  t: number
  summary: string
  receipt: "confirmed" | "sender-only"
  /** 対応する送信記録の時刻(送信側のみは t と同じ。受信確認ありで対応する送信記録が無ければ null) */
  sentAt: number | null
}

/**
 * 親が子へ送った記録と、子の側の peer 行（受信）を対応づける。
 * 送信と受信の順番を保ったまま（交差させず）、次の順に最良の対応を選ぶ。
 *   1. 対応する組の数が最も多い
 *   2. 同数なら、組の時刻の差（受信 − 送信）の合計が最も小さい
 * 組にできるのは、送信が受信より前（同時刻を含む）で、差が SEND_MATCH_WINDOW_MS 以内のものだけ。
 * 受信が確認できない送信が混ざったときは、近い送信に受信が対応し（送信の抜けに強い）、
 * 受信がまとめて遅れて届いたときは、順番どおりに対応する（送信から見て最も近い受信を取る向きだと、順番が逆になる）。
 * matched: peer 行の添字 → 対応した送信記録の時刻 / unmatched: 子の側に対応する peer 行が無い送信記録（入力の順）
 */
export function pairSends(sends: SendSignal[], confirmed: PeerSignal[]): { matched: Map<number, number>; unmatched: SendSignal[] } {
  const matched = new Map<number, number>()
  const used = new Set<number>()

  // 送信・受信を時刻の順に並べ、隣り合う出来事の間が窓より空いたところで区切る。窓を超えて離れた送信と受信は組にならないので、
  // 区切りをまたぐ組は無く、区切りごとに別々に解いてよい（組み合わせの表が大きくなるのを避ける）。同時刻は送信を先にする
  const events = [
    ...sends.map((s, i) => ({ t: s.t, isSend: true, i })),
    ...confirmed.map((p, i) => ({ t: p.t, isSend: false, i })),
  ].sort((a, b) => a.t - b.t || (a.isSend === b.isSend ? a.i - b.i : a.isSend ? -1 : 1))

  let sendIdx: number[] = []
  let receiptIdx: number[] = []
  const solveSegment = () => {
    for (const [si, ri] of pairSegment(sends, sendIdx, confirmed, receiptIdx)) {
      used.add(si)
      matched.set(ri, sends[si].t)
    }
    sendIdx = []
    receiptIdx = []
  }
  let prevT = Number.NEGATIVE_INFINITY
  for (const e of events) {
    if (e.t - prevT > SEND_MATCH_WINDOW_MS) solveSegment()
    if (e.isSend) sendIdx.push(e.i)
    else receiptIdx.push(e.i)
    prevT = e.t
  }
  solveSegment()

  return { matched, unmatched: sends.filter((_, j) => !used.has(j)) }
}

/**
 * 時刻の昇順に並んだ送信・受信（それぞれの添字の列）の間で、順番を保つ最良の対応を求める（pairSends の説明の順）。
 * 返す値は [送信の添字, 受信の添字] の列。
 */
function pairSegment(sends: SendSignal[], sendIdx: number[], confirmed: PeerSignal[], receiptIdx: number[]): [number, number][] {
  const n = sendIdx.length
  const m = receiptIdx.length
  if (n === 0 || m === 0) return []

  // count[i][j]・cost[i][j]: 先頭 i 件の送信と先頭 j 件の受信での、最良の対応の組数と、差の合計
  // from: その最良に至った手 (1: 送信 i を使わない / 2: 受信 j を使わない / 3: 送信 i と受信 j を組にする)
  const width = m + 1
  const count = new Int32Array((n + 1) * width)
  const cost = new Float64Array((n + 1) * width)
  const from = new Uint8Array((n + 1) * width)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const here = i * width + j
      let bestCount = count[here - width]
      let bestCost = cost[here - width]
      let bestFrom = 1
      if (count[here - 1] > bestCount || (count[here - 1] === bestCount && cost[here - 1] < bestCost)) {
        bestCount = count[here - 1]
        bestCost = cost[here - 1]
        bestFrom = 2
      }
      const gap = confirmed[receiptIdx[j - 1]].t - sends[sendIdx[i - 1]].t
      if (gap >= 0 && gap <= SEND_MATCH_WINDOW_MS) {
        const pairCount = count[here - width - 1] + 1
        const pairCost = cost[here - width - 1] + gap
        if (pairCount > bestCount || (pairCount === bestCount && pairCost < bestCost)) {
          bestCount = pairCount
          bestCost = pairCost
          bestFrom = 3
        }
      }
      count[here] = bestCount
      cost[here] = bestCost
      from[here] = bestFrom
    }
  }

  const pairs: [number, number][] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const move = from[i * width + j]
    if (move === 3) {
      pairs.push([sendIdx[i - 1], receiptIdx[j - 1]])
      i--
      j--
    } else if (move === 1) {
      i--
    } else {
      j--
    }
  }
  return pairs
}

/** 親(指揮役、または3層目の親の子)から子への指示の一覧(受信を確認できたものと、送信側の記録だけのもの)を、時刻の昇順で返す */
function instructionsFor(parent: FlowSessionInput, member: FlowSessionInput): Instruction[] {
  const confirmed = member.signals.peers.filter((p) => p.source === "local" && p.fromId === parent.id)
  const sends = parent.signals.sends.filter((s) => s.targets.some((x) => x === member.id || x === member.title))
  const { matched, unmatched } = pairSends(sends, confirmed)
  const list: Instruction[] = confirmed.map((p, i) => ({
    t: p.t,
    summary: p.summary,
    receipt: "confirmed" as const,
    sentAt: matched.get(i) ?? null,
  }))
  for (const s of unmatched) list.push({ t: s.t, summary: s.summary, receipt: "sender-only", sentAt: s.t })
  return list.sort((a, b) => a.t - b.t)
}

/** ツール呼び出しを、同じセッションの5秒ごとにまとめる */
function bucketTools(session: FlowSessionInput, since: number): ToolBucket[] {
  const buckets: ToolBucket[] = []
  let key = Number.NaN
  for (const tool of session.signals.tools) {
    if (tool.t < since) continue
    const k = Math.floor(tool.t / FLOW_TOOL_BUCKET_MS)
    const last = buckets[buckets.length - 1]
    if (last && k === key) {
      last.t = tool.t
      last.n++
      if (tool.ctx !== null) last.ctx = tool.ctx
    } else {
      buckets.push({ t: tool.t, sid: session.id, ctx: tool.ctx, n: 1 })
      key = k
    }
  }
  return buckets
}

/** 表示範囲の始まりより前の、最後のコンテキスト。圧縮のあとにツール呼び出しが無ければ、圧縮後の量 */
function lastContextBefore(session: FlowSessionInput, since: number): number | null {
  let ctx: number | null = null
  let at = Number.NEGATIVE_INFINITY
  for (const tool of session.signals.tools) {
    if (tool.t >= since) break
    if (tool.ctx !== null) {
      ctx = tool.ctx
      at = tool.t
    }
  }
  for (const c of session.signals.compacts) {
    if (c.t >= since) break
    if (c.t >= at) {
      ctx = c.post
      at = c.t
    }
  }
  return ctx
}

/**
 * 親と子の間の、指示・報告・「報告なしで終了」の出来事。指揮役と2層目の間も、2層目と3層目の間も、同じ規則で作る。
 * 報告は、親の側の peer 行(送り手が子)から作る。
 */
function edgeEvents(parent: FlowSessionInput, member: FlowSessionInput): FlowEvent[] {
  const events: FlowEvent[] = []
  const instructions = instructionsFor(parent, member)
  const reports = parent.signals.peers.filter((p) => p.source === "local" && p.fromId === member.id)
  const usedReports = new Set<number>()

  instructions.forEach((ins, i) => {
    const windowEnd = i + 1 < instructions.length ? instructions[i + 1].t : Number.POSITIVE_INFINITY
    const instruct: FlowInstruct = {
      kind: "instruct",
      t: ins.t,
      from: parent.id,
      to: member.id,
      summary: ins.summary,
      receipt: ins.receipt,
      sentAt: ins.sentAt,
    }
    events.push(instruct)

    const reportIndex = reports.findIndex((r, ri) => !usedReports.has(ri) && r.t >= ins.t && r.t < windowEnd)
    if (reportIndex >= 0) {
      usedReports.add(reportIndex)
      const r = reports[reportIndex]
      const report: FlowReport = {
        kind: "report",
        t: r.t,
        from: member.id,
        to: parent.id,
        instructAt: ins.t,
        tools: countIn(member.signals.tools, ins.t, r.t),
        durationMs: r.t - ins.t,
      }
      events.push(report)
      return
    }
    // 報告が付かない指示: 子のターンが終わっていれば「報告なしで終了」。終わっていなければ未了で、何も出さない
    const endAt = member.signals.turnEnds.find((t) => t >= ins.t && t < windowEnd)
    if (endAt !== undefined) {
      const end: FlowEnd = {
        kind: "end",
        t: endAt,
        sid: member.id,
        instructAt: ins.t,
        tools: countIn(member.signals.tools, ins.t, endAt),
        durationMs: endAt - ins.t,
      }
      events.push(end)
    }
  })

  // 組にならなかった報告(同じ窓の2通目以降・最初の指示より前)も、線は描く。作業量は0
  reports.forEach((r, ri) => {
    if (usedReports.has(ri)) return
    events.push({
      kind: "report",
      t: r.t,
      from: member.id,
      to: parent.id,
      instructAt: null,
      tools: 0,
      durationMs: 0,
    } satisfies FlowReport)
  })
  return events
}

export function assembleFlow(input: AssembleInput): AssembleResult {
  const { leader, members, since } = input
  const subs = leader ? (input.subs ?? []) : []
  const events: FlowEvent[] = []
  const all = [...(leader ? [leader] : []), ...members, ...subs.map((s) => s.session)]

  if (leader) {
    // 木の中のセッション(2層目・3層目)。ここに無い local の送り手だけが「他のグループ」
    const treeIds = new Set([...members.map((m) => m.id), ...subs.map((s) => s.session.id)])

    for (const member of members) events.push(...edgeEvents(leader, member))
    const memberById = new Map(members.map((m) => [m.id, m] as const))
    for (const sub of subs) {
      const parent = memberById.get(sub.parentId)
      if (parent) events.push(...edgeEvents(parent, sub.session))
    }

    // 他のグループ・外部(CLI)からの、指揮役への連絡。木の中のセッション(子どうし・3層目から指揮役)・手戻しの形式は描かない
    for (const p of leader.signals.peers) {
      if (p.source === "external") {
        events.push({ kind: "cross", t: p.t, to: leader.id, source: "external", summary: p.summary } satisfies FlowCross)
      } else if (p.source === "local" && p.fromId && p.fromId !== leader.id && !treeIds.has(p.fromId)) {
        events.push({ kind: "cross", t: p.t, to: leader.id, source: "other-group", summary: p.summary } satisfies FlowCross)
      }
    }
  }

  for (const session of all) {
    for (const c of session.signals.compacts) {
      events.push({ kind: "compact", t: c.t, sid: session.id, pre: c.pre, post: c.post } satisfies FlowCompact)
    }
  }

  const tools = all.flatMap((s) => bucketTools(s, since)).sort((a, b) => a.t - b.t)
  const contextBefore = new Map(all.map((s) => [s.id, lastContextBefore(s, since)] as const))

  return {
    events: events.filter((e) => e.t >= since).sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
    tools,
    contextBefore,
  }
}

/** 同じ時刻の出来事は、指示→(作業)→報告・終了の順に並べる */
const KIND_ORDER: Record<FlowEvent["kind"], number> = { cross: 0, instruct: 1, compact: 2, end: 3, report: 4 }
