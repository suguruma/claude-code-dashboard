import type { DesktopSessionSummary } from "./desktopSessionTypes"
import type { FlowEvent } from "./flowTypes"
import {
  CACHE_TTL_MS,
  type CacheState,
  type CleanupCandidate,
  type CleanupReason,
  type DecisionItem,
  type DecisionReason,
  type HousekeepingThresholds,
  type PercentRange,
  type ResumeCost,
  type UnansweredInstruction,
} from "./housekeepingTypes"
import { CACHE_WRITE_1H_RATIO, type PriceResolution } from "./usagePricing"
import type { UsageCalibration, UsagePrice } from "./usageTypes"

/**
 * セッションの整理(⑦)の判定。ファイルにも他のサービスにも触れない純粋な関数だけを置く(組み立ては housekeepingService.ts)。
 * 会話の本文は扱わない。受け取るのは、セッション一覧の要約と、組織図の出来事(指示の先頭20文字までを含む)だけ。
 */

// ---------------------------------------------------------------------------
// A. コンテキスト整理の候補

/** 最後の応答からの経過で決まるキャッシュの状態。ちょうど TTL(60分)は「切れた」とみなす */
export function cacheStateOf(lastAssistantAt: number | null, now: number): CacheState {
  if (lastAssistantAt === null) return "unknown"
  return now - lastAssistantAt >= CACHE_TTL_MS ? "expired" : "valid"
}

/** キャッシュが切れたセッションを再開したとき、コンテキスト全体を1時間キャッシュに書き直す金額(ドル) */
export function resumeCostUsd(contextTokens: number, price: UsagePrice): number {
  return (contextTokens * price.input * CACHE_WRITE_1H_RATIO) / 1_000_000
}

/**
 * 金額を、上限の枠に対する割合の幅にする。較正が「1%あたりの金額」の範囲(low〜high)なので、割合は 金額÷high 〜 金額÷low。
 * high が無い(公式値が0%だけ)ときは下限が決まらず、最大(金額÷low)だけを返す。較正が無い・使えないときは null。
 */
export function percentRange(usd: number, calibration: UsageCalibration | null): PercentRange | null {
  if (!calibration || !(calibration.costPerPercentLow > 0)) return null
  const high = calibration.costPerPercentHigh
  return {
    min: high !== null && high > 0 ? usd / high : null,
    max: usd / calibration.costPerPercentLow,
  }
}

export interface CleanupInput {
  sessions: DesktopSessionSummary[]
  now: number
  /** コンテキスト使用率がこの値以上を「大きい」とする */
  highContextRatio: number
  thresholds: HousekeepingThresholds
  priceOf: (model: string) => PriceResolution
  /** 5時間の枠・週(全モデル)の枠の較正。無ければ null(割合は出さない) */
  fiveHour: UsageCalibration | null
  weekly: UsageCalibration | null
}

/**
 * コンテキスト整理の候補。アーカイブ済み・実行中のセッションは対象外。
 * - 大きい(large): コンテキスト使用率が highContextRatio 以上
 * - 長く止まっている(idle): 最後の応答から idleMs 以上たち、コンテキストが minIdleTokens 以上
 * 並びは、再開コストの大きい順(キャッシュが有効なものは後ろ。同じなら、コンテキストの大きい順)。
 */
export function selectCleanupCandidates(input: CleanupInput): CleanupCandidate[] {
  const { now, highContextRatio, thresholds } = input
  const candidates: CleanupCandidate[] = []
  for (const s of input.sessions) {
    if (s.isArchived || s.status === "running" || !s.context) continue
    const { tokens, ratio } = s.context
    const idleMs = s.lastAssistantAt === null ? null : Math.max(0, now - s.lastAssistantAt)

    const reasons: CleanupReason[] = []
    if (ratio >= highContextRatio) reasons.push("large")
    if (idleMs !== null && idleMs >= thresholds.idleMs && tokens >= thresholds.minIdleTokens) reasons.push("idle")
    if (reasons.length === 0) continue

    const cache = cacheStateOf(s.lastAssistantAt, now)
    let resumeCost: ResumeCost | null = null
    if (cache !== "valid") {
      const { price, via } = input.priceOf(s.model ?? "")
      const usd = resumeCostUsd(tokens, price)
      resumeCost = {
        usd,
        fiveHour: percentRange(usd, input.fiveHour),
        weekly: percentRange(usd, input.weekly),
        priceUnregistered: via === "none",
      }
    }
    candidates.push({
      id: s.id,
      title: s.title,
      groupName: s.group?.name ?? null,
      model: s.model,
      contextTokens: tokens,
      contextRatio: ratio,
      lastAssistantAt: s.lastAssistantAt,
      idleMs,
      reasons,
      cache,
      resumeCost,
      suggestClear: cache === "expired",
    })
  }
  return candidates.sort((a, b) => {
    const cost = (b.resumeCost?.usd ?? -1) - (a.resumeCost?.usd ?? -1)
    if (cost !== 0) return cost
    if (b.contextTokens !== a.contextTokens) return b.contextTokens - a.contextTokens
    return a.id < b.id ? -1 : 1
  })
}

// ---------------------------------------------------------------------------
// B. 返事の無い指示

export interface UnansweredLookup {
  group: { id: string; name: string }
  titleOf: (sessionId: string) => string
  isWorking: (sessionId: string) => boolean
}

/**
 * 組織図の出来事(assembleFlow の結果)から、返事の来ていない指示を取り出す。報告が付いた指示は出さない。
 * - 受信を確認できた指示(confirmed): 子のターンが報告なしで終わっていれば ended-without-report(時間に関係なく)、
 *   終わっていなくて、thresholdMs 以上たっていれば awaiting-report
 * - 送り手の送信記録だけの指示(sender-only): thresholdMs 以上たっていれば possibly-undelivered
 *   (受け手の会話ログに記録が無い。子が別の用でターンを終えていても、指示が届いたとは言えないので、この種類にする)
 * 並びは、古い指示から。
 */
export function findUnanswered(
  events: FlowEvent[],
  now: number,
  thresholdMs: number,
  lookup: UnansweredLookup
): UnansweredInstruction[] {
  const answered = new Set<string>()
  const ended = new Set<string>()
  const key = (from: string, to: string, t: number) => `${from}\u0000${to}\u0000${t}`
  for (const e of events) {
    // 報告は 子→親、終了は 子の ID。どちらも、組になった指示の時刻(instructAt)で指示を引く
    if (e.kind === "report" && e.instructAt !== null) answered.add(key(e.to, e.from, e.instructAt))
    else if (e.kind === "end") ended.add(`${e.sid}\u0000${e.instructAt}`)
  }

  const out: UnansweredInstruction[] = []
  for (const e of events) {
    if (e.kind !== "instruct" || answered.has(key(e.from, e.to, e.t))) continue
    const ageMs = Math.max(0, now - e.t)
    let kind: UnansweredInstruction["kind"] | null = null
    if (e.receipt === "sender-only") {
      if (ageMs >= thresholdMs) kind = "possibly-undelivered"
    } else if (ended.has(`${e.to}\u0000${e.t}`)) {
      kind = "ended-without-report"
    } else if (ageMs >= thresholdMs) {
      kind = "awaiting-report"
    }
    if (!kind) continue
    out.push({
      kind,
      groupId: lookup.group.id,
      groupName: lookup.group.name,
      fromId: e.from,
      fromTitle: lookup.titleOf(e.from),
      toId: e.to,
      toTitle: lookup.titleOf(e.to),
      summary: e.summary,
      sentAt: e.t,
      ageMs,
      working: lookup.isWorking(e.to),
    })
  }
  return out.sort((a, b) => a.sentAt - b.sentAt)
}

// ---------------------------------------------------------------------------
// C. オーナーの判断待ち

/** 並びの優先度(小さいほど先) */
const DECISION_RANK: Record<DecisionReason, number> = { "needs-action": 0, "send-limit": 1, error: 2, undelivered: 3 }

/**
 * オーナーの判断・対応を待っているセッション。アーカイブされていないすべてのセッション(グループ外を含む)から集める。
 * 1セッション1行で、理由が複数あれば reasons に優先度の順に並べる。
 * - needs-action: 状態が要対応(blocked)
 * - send-limit: 他のセッションへの送信が上限で止まっている
 * - error: 状態がエラー
 * - undelivered: 届かなかった送信がある(送信上限で止まっているものは、send-limit にまとめる)
 * 並びは、最も優先度の高い理由の順。同じなら、最後の活動が古い順(不明は最後)。
 */
export function collectDecisions(sessions: DesktopSessionSummary[]): DecisionItem[] {
  const items: DecisionItem[] = []
  for (const s of sessions) {
    if (s.isArchived) continue
    const reasons: DecisionReason[] = []
    if (s.status === "blocked") reasons.push("needs-action")
    if (s.messaging?.stopped) reasons.push("send-limit")
    if (s.status === "error") reasons.push("error")
    const undelivered = s.messaging?.undelivered ?? 0
    if (undelivered > 0 && !s.messaging?.stopped) reasons.push("undelivered")
    if (reasons.length === 0) continue
    items.push({
      id: s.id,
      title: s.title,
      groupName: s.group?.name ?? null,
      reasons,
      excerpt: reasons.includes("needs-action") ? s.needsActionExcerpt : null,
      undeliveredCount: reasons.includes("undelivered") ? undelivered : 0,
      lastActivityAt: s.lastActivityAt,
    })
  }
  return items.sort((a, b) => {
    const rank = DECISION_RANK[a.reasons[0]] - DECISION_RANK[b.reasons[0]]
    if (rank !== 0) return rank
    const ta = a.lastActivityAt ?? Number.POSITIVE_INFINITY
    const tb = b.lastActivityAt ?? Number.POSITIVE_INFINITY
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}
