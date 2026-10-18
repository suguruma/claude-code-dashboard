import { mapLimit } from "./desktopSessions"
import { getDesktopSessionService, type DesktopSessionService, type GroupSource } from "./desktopSessionService"
import { assembleFlow, emptySignals, pickLeader, type FlowSessionInput } from "./flowEvents"
import { FlowSignalReader } from "./flowReader"
import { placeOrgTree } from "./flowTree"
import {
  FLOW_DEFAULT_RANGE_MS,
  FLOW_MAX_RANGE_MS,
  type FlowMember,
  type FlowResponse,
  type FlowToolSample,
} from "./flowTypes"

/** 「直近24時間」を選んだ画面が、通信の時間ぶんだけ24時間を超えて送っても、24時間として扱う余裕 */
export const FLOW_SINCE_TOLERANCE_MS = 60_000

/**
 * `since`(出来事を返す範囲の始まり)を検証する。数値でない・未来・24時間より前なら、既定(4時間前)にする。
 * 24時間を少し(1分以内)超えるだけなら、画面の「直近24時間」の通信遅れとして、24時間前に丸める。
 * エラーにはしない(画面の操作で、範囲が壊れても表示を止めないため)。
 */
export function normalizeSince(since: number | null | undefined, now: number): number {
  if (typeof since !== "number" || !Number.isFinite(since) || since > now) return now - FLOW_DEFAULT_RANGE_MS
  const age = now - since
  if (age > FLOW_MAX_RANGE_MS + FLOW_SINCE_TOLERANCE_MS) return now - FLOW_DEFAULT_RANGE_MS
  return age > FLOW_MAX_RANGE_MS ? now - FLOW_MAX_RANGE_MS : since
}

/** グループIDは一覧のキーとして引くだけで、パスには使わない。念のため形式も絞る */
const SAFE_GROUP_ID = /^[A-Za-z0-9_-]{1,100}$/

/** APIのクエリ。group が形式に合わなければ null。since は数値にできなければ null(あとで既定に直す) */
export function parseFlowParams(params: URLSearchParams): { group: string | null; since: number | null } {
  const group = params.get("group")
  const rawSince = params.get("since")
  return {
    group: group && SAFE_GROUP_ID.test(group) ? group : null,
    since: rawSince !== null && rawSince.trim() !== "" ? Number(rawSince) : null,
  }
}

export interface FlowServiceOptions {
  now?: () => number
  reader?: FlowSignalReader
}

/**
 * グループの組織図アニメーション用に、出来事の列を組み立てる。
 * セッションの一覧・グループ・会話ログの所在は DesktopSessionService のキャッシュを使い、
 * 会話ログの読み取りは FlowSignalReader が差分だけ行う。読み取り専用。
 *
 * 木は、指揮役(1層目)・グループ内の子(2層目)・2層目の子が作ったセッション(3層目。グループの外でもよい)。
 * 親子の根拠は spawnedFrom.sessionId だけ(flowTree.ts)。指揮役がいないグループは、カードだけを並べて木を作らない。
 */
export class FlowService {
  private readonly now: () => number
  readonly reader: FlowSignalReader

  constructor(
    private readonly sessions: DesktopSessionService,
    options: FlowServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.reader = options.reader ?? new FlowSignalReader()
  }

  /** グループが無ければ null */
  async build(groupId: string, sinceInput?: number | null): Promise<FlowResponse | null> {
    const now = this.now()
    const since = normalizeSince(sinceInput, now)
    const { group, sources, outsiders } = await this.sessions.groupSources(groupId)
    if (!group) return null

    const prefix = this.sessions.orchestratorPrefix()
    const leaderSource = pickLeader(
      sources.map((s) => ({ source: s, id: s.summary.id, title: s.summary.title, createdAt: s.summary.createdAt })),
      prefix
    )?.source
    // 指揮役を先頭に、木に出るセッションを作成日時の古い順に並べる。parentOf は、木での親(指揮役がいなければ空)
    const leaderId = leaderSource?.summary.id ?? null
    const parentOf = new Map<string, string>()
    let ordered: GroupSource[] = sources
    if (leaderSource && leaderId) {
      const candidates = [...sources.filter((s) => s !== leaderSource), ...outsiders]
      const byId = new Map(candidates.map((s) => [s.summary.id, s] as const))
      const placements = placeOrgTree({
        leaderId,
        sessions: candidates.map((s) => ({
          id: s.summary.id,
          createdAt: s.summary.createdAt,
          parentId: s.summary.spawnedFromId,
          inGroup: s.summary.group?.id === groupId,
        })),
      })
      ordered = [leaderSource, ...placements.flatMap((p) => byId.get(p.id) ?? [])]
      for (const p of placements) parentOf.set(p.id, p.parentId)
    }

    // 組の判定には範囲より前の信号も使うので、読む期間は常に上限(24時間)にそろえる
    const horizon = now - FLOW_MAX_RANGE_MS
    const inputs: FlowSessionInput[] = new Array(ordered.length)
    await mapLimit(ordered.map((source, index) => ({ source, index })), 6, async ({ source, index }) => {
      const signals = source.filePath ? await this.reader.read(source.filePath, horizon) : emptySignals()
      inputs[index] = { id: source.summary.id, title: source.summary.title, signals }
    })

    const leader = leaderSource ? inputs[0] : null
    const rest = leaderSource ? inputs.slice(1) : inputs
    // 親が指揮役(または木に親がいない)なら2層目、そうでなければ、その親(2層目)の3層目
    const members = rest.filter((s) => (parentOf.get(s.id) ?? leaderId) === leaderId)
    const subs = rest.flatMap((s) => {
      const parentId = parentOf.get(s.id)
      return parentId && parentId !== leaderId ? [{ parentId, session: s }] : []
    })
    const assembled = assembleFlow({ leader, members, subs, since })

    const indexOf = new Map(inputs.map((s, i) => [s.id, i] as const))
    const tools: FlowToolSample[] = assembled.tools.map((b) => [b.t - since, indexOf.get(b.sid) ?? 0, b.ctx ?? -1, b.n])
    const maxCtx = new Map<string, number>()
    for (const b of assembled.tools) if (b.ctx !== null) maxCtx.set(b.sid, Math.max(maxCtx.get(b.sid) ?? 0, b.ctx))

    const flowMembers: FlowMember[] = ordered.map((source, i) => {
      const id = source.summary.id
      const before = assembled.contextBefore.get(id) ?? null
      const seen = Math.max(maxCtx.get(id) ?? 0, before ?? 0, source.summary.context?.tokens ?? 0)
      return {
        id,
        title: source.summary.title,
        model: source.summary.model,
        isLeader: leaderSource !== undefined && i === 0,
        parentId: parentOf.get(id) ?? null,
        contextLimit: this.sessions.contextLimitOf(source.summary.model, seen),
        contextBefore: before,
      }
    })

    return {
      generatedAt: now,
      since,
      group,
      leaderId,
      prefix,
      members: flowMembers,
      events: assembled.events,
      tools,
    }
  }
}

interface SharedFlow {
  service: Promise<FlowService>
  cls: unknown
}

const globalForFlow = globalThis as unknown as { __ccdFlowService?: SharedFlow }

/** サーバー内で1つだけ作る(差分読みのキャッシュを、APIの呼び出しをまたいで保つため) */
export function getFlowService(): Promise<FlowService> {
  const existing = globalForFlow.__ccdFlowService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === FlowService)) return existing.service
  const service = getDesktopSessionService().then((sessions) => new FlowService(sessions))
  globalForFlow.__ccdFlowService = { service, cls: FlowService }
  return service
}
