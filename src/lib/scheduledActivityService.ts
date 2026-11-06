import { promises as fs } from "fs"
import path from "path"
import { getDesktopSessionService, type ScheduledRunSource } from "./desktopSessionService"
import { SCHEDULED_TASK_FORM } from "./desktopSessions"
import type { DesktopSessionSummary } from "./desktopSessionTypes"
import { DAY_MS, UNKNOWN_AGENT_TYPE, chooseDefault, familyLabel } from "./scheduledActivity"
import type { FamilyLabel, RunTokens, ScheduledActivityResponse, ScheduledRun, StopReason } from "./scheduledActivityTypes"
import { buildMarks, markOfStatus } from "./statusMark"
import { UsageLedger, type UsageRow } from "./usageLedger"
import { costOf, type PriceBook } from "./usagePricing"
import { getUsageService } from "./usageService"

/**
 * 予定タスクのタブ(⑯)のサービス。Desktop のメタデータ(予定タスクの名前・会話記録の ID)と会話記録の使用量から、回ごとの数を作る。
 * - 予定タスクの回の会話記録(とそのサブエージェントの記録)だけを、ファイルが残っている間(最大30日)読む(AG-6・問2)。
 *   ［利用上限］の台帳(15日)とは別の台帳で、ほかのセッションの記録は開かない
 * - サブエージェントの種類は `*.meta.json` の agentType だけを読む。description(任せた作業の説明)は読み取っても保持しない(AG-5・AG-7)
 * - 読むだけ。外部と通信しない。LLM を呼ばない
 */

/** 予定タスクの回の会話記録を読む期間(日)。A11(30日分で1秒以内)を測って決めた値。守れないときは15に戻す(要件メモの問2) */
export const SCHEDULED_HORIZON_DAYS = 30

/** サブエージェントの種類の名前の形。形に合わない値は「種類不明」 */
const AGENT_TYPE_FORM = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,63}$/

export interface ScheduledActivityOptions {
  /** 会話ログのルート。null なら会話記録は無いものとして扱う */
  projectsRoot: string | null
  prices: PriceBook
  /** 予定タスクの回(Desktop のセッション一覧から) */
  runs: () => Promise<{ sessions: DesktopSessionSummary[]; runs: ScheduledRunSource[] }>
  /** 予定タスクの定義のフォルダ。省略時は会話ログのルートの隣の `scheduled-tasks` */
  definitionsRoot?: string | null
  horizonDays?: number
  now?: () => number
}

function stopReasonOf(s: DesktopSessionSummary): StopReason | null {
  if (!s.isArchived) return null
  if (s.messaging?.stopped) return "送信上限"
  if (s.status === "blocked") return "要対応"
  if ((s.messaging?.undelivered ?? 0) > 0) return "届かない送信"
  return null
}

const tokensOf = (r: UsageRow) => r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h

export class ScheduledActivityService {
  private readonly opts: ScheduledActivityOptions
  private readonly ledger: UsageLedger
  private keys = new Set<string>()
  private readonly agentTypes = new Map<string, { mtimeMs: number; type: string }>()

  constructor(options: ScheduledActivityOptions) {
    this.opts = options
    this.ledger = new UsageLedger({
      projectsRoot: options.projectsRoot,
      horizonMs: this.horizonDays * DAY_MS,
      now: options.now,
      include: (f) => this.keys.has(f.sessionKey),
    })
  }

  private get horizonDays(): number {
    return this.opts.horizonDays ?? SCHEDULED_HORIZON_DAYS
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  private definitionsRoot(): string | null {
    if (this.opts.definitionsRoot !== undefined) return this.opts.definitionsRoot
    return this.opts.projectsRoot ? path.join(path.dirname(this.opts.projectsRoot), "scheduled-tasks") : null
  }

  /** 予定タスクの定義の名前(フォルダ名だけ。中のファイルは読まない) */
  private async definitions(): Promise<string[]> {
    const root = this.definitionsRoot()
    if (!root) return []
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() && SCHEDULED_TASK_FORM.test(e.name)).map((e) => e.name)
    } catch {
      return []
    }
  }

  /** サブエージェントの種類。`<agent>.meta.json` の agentType だけを取り出す(更新時刻が同じなら読み直さない) */
  private async agentTypeOf(transcriptPath: string): Promise<string> {
    const metaPath = transcriptPath.replace(/\.jsonl$/, ".meta.json")
    let stat
    try {
      stat = await fs.stat(metaPath)
    } catch {
      this.agentTypes.delete(metaPath)
      return UNKNOWN_AGENT_TYPE
    }
    const hit = this.agentTypes.get(metaPath)
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.type
    let type = UNKNOWN_AGENT_TYPE
    try {
      const raw = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Record<string, unknown>
      const value = raw && typeof raw === "object" ? raw.agentType : null
      if (typeof value === "string" && AGENT_TYPE_FORM.test(value)) type = value
    } catch {
      // 壊れた・書き込み途中のファイルは「種類不明」(内容を含むエラー文は残さない)
    }
    this.agentTypes.set(metaPath, { mtimeMs: stat.mtimeMs, type })
    return type
  }

  async get(): Promise<ScheduledActivityResponse> {
    const now = this.now()
    const horizonStart = now - this.horizonDays * DAY_MS
    const [{ sessions, runs: sources }, definitions] = await Promise.all([this.opts.runs(), this.definitions()])
    this.keys = new Set(sources.flatMap((s) => s.cliSessionIds))
    await this.ledger.refresh()

    const rowsBy = new Map<string, UsageRow[]>()
    for (const row of this.ledger.rows()) {
      const list = rowsBy.get(row.sessionKey)
      if (list) list.push(row)
      else rowsBy.set(row.sessionKey, [row])
    }
    const subagentFiles = new Map<string, string[]>()
    for (const f of this.ledger.files()) {
      if (!f.subagent) continue
      const list = subagentFiles.get(f.sessionKey)
      if (list) list.push(f.filePath)
      else subagentFiles.set(f.sessionKey, [f.filePath])
    }

    const marks = buildMarks(sessions, now)
    const built: ScheduledRun[] = []
    for (const src of sources) {
      const s = src.summary
      const rows = src.cliSessionIds.flatMap((id) => rowsBy.get(id) ?? [])
      let cost = 0
      let mainCost = 0
      const mainByFamily = new Map<FamilyLabel, number>()
      const subFamilies = new Set<FamilyLabel>()
      const tokenMap = new Map<string, RunTokens>()
      for (const r of rows) {
        const c = costOf(r, this.opts.prices.resolve(r.model).price)
        const family = familyLabel(r.model)
        cost += c
        if (r.subagent) subFamilies.add(family)
        else {
          mainCost += c
          mainByFamily.set(family, (mainByFamily.get(family) ?? 0) + c)
        }
        const key = `${r.subagent ? "s" : "m"}:${family}`
        const t = tokenMap.get(key) ?? { family, subagent: r.subagent, tokens: 0 }
        t.tokens += tokensOf(r)
        tokenMap.set(key, t)
      }
      const files = src.cliSessionIds.flatMap((id) => subagentFiles.get(id) ?? [])
      const subagentTypes: Record<string, number> = {}
      for (const type of await Promise.all(files.map((f) => this.agentTypeOf(f)))) {
        subagentTypes[type] = (subagentTypes[type] ?? 0) + 1
      }
      let mainFamilies = [...mainByFamily.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
      if (mainFamilies.length === 0 && s.model) mainFamilies = [familyLabel(s.model)]
      // 作成時刻が無いときだけ、最初の応答の時刻を探す(行が多くても引数の上限に当たらないよう、ループで)
      let firstAt: number | null = null
      if (s.createdAt === null) for (const r of rows) if (firstAt === null || r.at < firstAt) firstAt = r.at
      built.push({
        desktopId: s.id,
        taskId: src.taskId,
        startedAt: s.createdAt ?? firstAt ?? s.lastActivityAt ?? 0,
        mark: marks.get(s.id) ?? markOfStatus(s),
        stopReason: stopReasonOf(s),
        archived: s.isArchived,
        running: s.status === "running",
        hasUsage: rows.length > 0,
        cost,
        mainCost,
        mainFamilies,
        subagentCount: files.length,
        subagentFamilies: [...subFamilies],
        subagentTypes,
        tokens: [...tokenMap.values()].sort((a, b) => Number(a.subagent) - Number(b.subagent) || b.tokens - a.tokens),
      })
    }

    // 読む期間の中の回と、その前の7日の回(比べで「記録の外」と数えるため)と、各予定タスクの最後の回(一覧の「最後の回」に使う)
    built.sort((a, b) => b.startedAt - a.startedAt)
    const keepFrom = horizonStart - 7 * DAY_MS
    const latestSeen = new Set<string>()
    const runs = built.filter((r) => {
      const latest = !latestSeen.has(r.taskId)
      latestSeen.add(r.taskId)
      return latest || r.startedAt >= keepFrom
    })

    return {
      generatedAt: now,
      horizonDays: this.horizonDays,
      horizonStart,
      runs,
      definitions: definitions.sort(),
      // 既定の選択は、読む期間の中の回だけで決める(期間の外の回は使用量が読めていない)
      defaultSelection: chooseDefault(runs.filter((r) => r.startedAt >= horizonStart), now),
    }
  }
}

// ---------------------------------------------------------------------------
// アプリ全体で共有するインスタンス

interface SharedService {
  service: Promise<ScheduledActivityService>
  cls: unknown
}

const globalForService = globalThis as unknown as { __ccdScheduledActivityService?: SharedService }

export function getScheduledActivityService(): Promise<ScheduledActivityService> {
  const existing = globalForService.__ccdScheduledActivityService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === ScheduledActivityService)) {
    return existing.service
  }
  const service = getUsageService().then(
    (usage) =>
      new ScheduledActivityService({
        projectsRoot: usage.projectsRoot,
        prices: usage.prices,
        runs: async () => (await getDesktopSessionService()).scheduledRuns(),
      })
  )
  globalForService.__ccdScheduledActivityService = { service, cls: ScheduledActivityService }
  return service
}
