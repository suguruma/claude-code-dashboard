import { getDesktopSessionService, type DesktopSessionService } from "./desktopSessionService"
import { mapLimit } from "./desktopSessions"
import { getFlowService, type FlowService } from "./flowService"
import { collectDecisions, countUnreadableTranscripts, findUnanswered, selectCleanupCandidates } from "./housekeeping"
import {
  HOUSEKEEPING_NOTE,
  UNANSWERED_RANGE_MS,
  type HousekeepingResponse,
  type UnansweredInstruction,
} from "./housekeepingTypes"
import { PriceBook, type PriceResolution } from "./usagePricing"
import { getUsageService } from "./usageService"
import type { UsageCalibration, UsageResponse } from "./usageTypes"

/** 再開コストの金額と割合を出すために使う、利用上限のサービスの部分(テストでは差し替える) */
export interface HousekeepingUsageSource {
  get(): Promise<UsageResponse>
  priceOf(model: string): PriceResolution
}

export interface HousekeepingServiceOptions {
  now?: () => number
  /** 利用上限のサービス。省略時、または取得に失敗したときは、既定の価格表で金額だけを出し、割合は出さない */
  usage?: () => Promise<HousekeepingUsageSource | null>
}

const GROUP_READ_CONCURRENCY = 3

/**
 * セッションの整理(⑦)のページ用に、3つの一覧(コンテキスト整理の候補・返事の無い指示・判断待ち)を組み立てる。
 * セッション一覧・組織図の出来事・利用上限は、それぞれのサービスのキャッシュを使うので、呼び出しのたびに読み直すのは変わったファイルだけ。
 * 読み取り専用・外部との通信なし・LLMを呼ばない。
 */
export class HousekeepingService {
  private readonly now: () => number
  private readonly fallbackPrices = new PriceBook()

  constructor(
    private readonly sessions: DesktopSessionService,
    private readonly flow: FlowService,
    private readonly options: HousekeepingServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now
  }

  async get(): Promise<HousekeepingResponse> {
    const now = this.now()
    const warnings: string[] = []
    const list = await this.sessions.list()
    const thresholds = this.sessions.housekeepingThresholds()
    if (list.source === "none") {
      warnings.push("Claude Desktopのセッション情報も会話ログも見つかりませんでした。")
    } else if (list.source === "transcript-only") {
      warnings.push("Desktopのセッション情報を読めないため、会話ログだけで判定しています。要対応・エラー・グループは判断できません。")
    }
    // 会話ログが無い・読めないセッションは、コンテキストも会話ログ由来の要対応も分からず、一覧から黙って外れてしまうので、件数を知らせる
    const unreadable = countUnreadableTranscripts(list.sessions)
    if (unreadable > 0) warnings.push(`${unreadable}件のセッションは会話ログを読めないため判定できません。`)

    let usageSource: HousekeepingUsageSource | null = null
    let usage: UsageResponse | null = null
    try {
      usageSource = (await this.options.usage?.()) ?? null
      usage = usageSource ? await usageSource.get() : null
    } catch {
      warnings.push("利用上限の記録を読めなかったため、再開コストの割合は表示できません（金額だけを表示します）。")
    }
    const calibrationOf = (key: "five_hour" | "weekly_all"): UsageCalibration | null =>
      usage?.windows.find((w) => w.key === key && w.modelName === null)?.calibration ?? null
    const fiveHour = calibrationOf("five_hour")
    const weekly = calibrationOf("weekly_all")

    const cleanup = selectCleanupCandidates({
      sessions: list.sessions,
      now,
      highContextRatio: list.highContextRatio,
      thresholds,
      priceOf: (model) => usageSource?.priceOf(model) ?? this.fallbackPrices.resolve(model),
      fiveHour,
      weekly,
    })

    const unanswered = await this.collectUnanswered(list.groups, list.sessions, now, thresholds.unansweredMs, warnings)
    const decisions = collectDecisions(list.sessions)

    return {
      generatedAt: now,
      counts: { cleanup: cleanup.length, unanswered: unanswered.length, decisions: decisions.length },
      cleanup: {
        items: cleanup,
        highContextRatio: list.highContextRatio,
        idleMinutes: Math.round(thresholds.idleMs / 60_000),
        minIdleTokens: thresholds.minIdleTokens,
        calibrated: { fiveHour: fiveHour !== null, weekly: weekly !== null },
      },
      unanswered: {
        items: unanswered,
        thresholdMinutes: Math.round(thresholds.unansweredMs / 60_000),
        rangeHours: Math.round(UNANSWERED_RANGE_MS / 3_600_000),
      },
      decisions: { items: decisions },
      warnings,
      note: HOUSEKEEPING_NOTE,
    }
  }

  /** 全グループの組織図の出来事から、返事の来ていない指示を集める。指揮役のいないグループは出来事が無いので対象外 */
  private async collectUnanswered(
    groups: { id: string; name: string; count: number }[],
    sessions: { id: string; title: string; status: string }[],
    now: number,
    thresholdMs: number,
    warnings: string[]
  ): Promise<UnansweredInstruction[]> {
    const byId = new Map(sessions.map((s) => [s.id, s] as const))
    const since = now - UNANSWERED_RANGE_MS
    const found: UnansweredInstruction[] = []
    let failed = 0
    await mapLimit(
      groups.filter((g) => g.count > 0),
      GROUP_READ_CONCURRENCY,
      async (group) => {
        try {
          const flow = await this.flow.build(group.id, since)
          if (!flow) return
          found.push(
            ...findUnanswered(flow.events, now, thresholdMs, {
              group: { id: group.id, name: group.name },
              titleOf: (id) => byId.get(id)?.title ?? "（不明なセッション）",
              isWorking: (id) => byId.get(id)?.status === "running",
            })
          )
        } catch {
          failed++
        }
      }
    )
    if (failed > 0) warnings.push(`${failed}件のグループの組織図を読めなかったため、返事の無い指示を確認できていません。`)
    return found.sort((a, b) => a.sentAt - b.sentAt || (a.toId < b.toId ? -1 : 1))
  }
}

interface SharedHousekeeping {
  service: Promise<HousekeepingService>
  cls: unknown
}

const globalForHousekeeping = globalThis as unknown as { __ccdHousekeepingService?: SharedHousekeeping }

/** サーバー内で1つだけ作る */
export function getHousekeepingService(): Promise<HousekeepingService> {
  const existing = globalForHousekeeping.__ccdHousekeepingService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === HousekeepingService)) return existing.service
  const service = Promise.all([getDesktopSessionService(), getFlowService()]).then(
    ([sessions, flow]) => new HousekeepingService(sessions, flow, { usage: () => getUsageService() })
  )
  globalForHousekeeping.__ccdHousekeepingService = { service, cls: HousekeepingService }
  return service
}
