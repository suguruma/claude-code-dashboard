import { promises as fs } from "fs"
import path from "path"
import { getAppDataRoot } from "./fileIO"
import { getClaudeProjectsRoot } from "./sessionMonitor"
import { getDesktopSessionService } from "./desktopSessionService"
import { FIVE_HOUR_MS, USAGE_NOTE, WEEK_MS, buildContributions, buildUsage, type SessionIdentity } from "./usageEstimate"
import { UsageLedger } from "./usageLedger"
import { PriceBook, parsePriceOverrides } from "./usagePricing"
import { defaultSnapshotsPath, readSnapshots, type SnapshotReadResult } from "./usageSnapshots"
import type { UsagePrice, UsageResponse } from "./usageTypes"

/**
 * 利用上限の可視化(⑥)のサービス。公式値の記録(読み取りのみ)と会話記録の台帳から、画面に出す値を組み立てる。
 * 読み取り専用・外部との通信なし・LLMを呼ばない。認証情報のファイルは読まない。
 */

export interface UsageServiceOptions {
  /** 会話ログのルート。省略時は `~/.claude/projects` */
  projectsRoot?: string
  /** 公式値の記録。省略時は `~/.claude-dashboard/usage-snapshots.jsonl` */
  snapshotsPath?: string
  /** 価格表の上書き(モデルIDまたは系統名 → 単価) */
  prices?: Record<string, UsagePrice>
  now?: () => number
  /** 会話ログのセッションID → Desktopのセッション(名前・グループ)。省略時は対応づけない */
  identities?: () => Promise<Map<string, SessionIdentity>>
}

export class UsageService {
  private readonly opts: UsageServiceOptions
  private readonly ledger: UsageLedger
  private readonly prices: PriceBook
  private snapshotCache: { mtimeMs: number; size: number; result: SnapshotReadResult } | null = null

  constructor(options: UsageServiceOptions = {}) {
    this.opts = options
    this.prices = new PriceBook(options.prices ?? {})
    this.ledger = new UsageLedger({
      projectsRoot: options.projectsRoot ?? getClaudeProjectsRoot(),
      now: options.now,
    })
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  private async snapshots(): Promise<SnapshotReadResult> {
    const file = this.opts.snapshotsPath ?? defaultSnapshotsPath()
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      this.snapshotCache = null
      return { found: false, snapshots: [] }
    }
    if (this.snapshotCache && this.snapshotCache.mtimeMs === stat.mtimeMs && this.snapshotCache.size === stat.size) {
      return this.snapshotCache.result
    }
    const result = await readSnapshots(file)
    // 読めなかったときは、更新時刻を覚えず、次の取得で読み直す
    if (result.found) this.snapshotCache = { mtimeMs: stat.mtimeMs, size: stat.size, result }
    return result
  }

  async get(): Promise<UsageResponse> {
    const now = this.now()
    const [snapshotResult] = await Promise.all([this.snapshots(), this.ledger.refresh()])
    const rows = this.ledger.rows()
    const identities = (await this.opts.identities?.().catch(() => null)) ?? new Map<string, SessionIdentity>()
    const { snapshots } = snapshotResult

    const built = buildUsage({ now, snapshots, rows, prices: this.prices })
    const identityOf = (sessionKey: string) => identities.get(sessionKey) ?? null
    const fiveHourSince = built.fiveHourStart !== null && built.fiveHourStart <= now ? built.fiveHourStart : now - FIVE_HOUR_MS
    const weekSince = built.weekStart !== null && built.weekStart <= now ? built.weekStart : now - WEEK_MS

    const latest = snapshots[snapshots.length - 1] ?? null
    return {
      generatedAt: now,
      snapshots: {
        found: snapshotResult.found,
        count: snapshots.length,
        lastRecordedAt: latest?.ts ?? null,
        plan: latest?.plan ?? null,
      },
      extraUsage: latest?.extraUsage ?? null,
      windows: built.windows,
      guard: built.guard,
      contributions: {
        fiveHour: buildContributions(rows, fiveHourSince, now, this.prices, identityOf),
        week: buildContributions(rows, weekSince, now, this.prices, identityOf),
      },
      accuracy: built.accuracy,
      unregisteredModels: built.unregisteredModels,
      note: USAGE_NOTE,
    }
  }
}

// ---------------------------------------------------------------------------
// アプリ全体で共有するインスタンス

interface UsageConfigFile {
  prices?: unknown
  snapshotsPath?: unknown
  projectsRoot?: unknown
}

async function loadConfigFile(): Promise<UsageServiceOptions> {
  let raw: UsageConfigFile
  try {
    raw = JSON.parse(await fs.readFile(path.join(getAppDataRoot(), "config", "usage.json"), "utf-8"))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== "object") return {}
  const options: UsageServiceOptions = {}
  if (typeof raw.snapshotsPath === "string" && raw.snapshotsPath) options.snapshotsPath = raw.snapshotsPath
  if (typeof raw.projectsRoot === "string" && raw.projectsRoot) options.projectsRoot = raw.projectsRoot
  if (raw.prices) options.prices = parsePriceOverrides(raw.prices)
  return options
}

interface SharedService {
  service: Promise<UsageService>
  /** 作成時のクラス。開発中のホットリロードで古いクラスのインスタンスが残らないよう、現在のクラスと比べる */
  cls: unknown
}

const globalForService = globalThis as unknown as { __ccdUsageService?: SharedService }

export function getUsageService(): Promise<UsageService> {
  const existing = globalForService.__ccdUsageService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === UsageService)) {
    return existing.service
  }
  const service = loadConfigFile().then((fileOptions) => {
    const projectsRoot = process.env.CLAUDE_DESKTOP_PROJECTS_ROOT?.trim()
    return new UsageService({
      ...fileOptions,
      ...(projectsRoot ? { projectsRoot } : {}),
      identities: async () => (await getDesktopSessionService()).sessionIdentities(),
    })
  })
  globalForService.__ccdUsageService = { service, cls: UsageService }
  return service
}
