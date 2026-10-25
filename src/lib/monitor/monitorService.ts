import { promises as fs } from "fs"
import path from "path"
import { getDesktopSessionService } from "@/lib/desktopSessionService"
import { getAppDataRoot } from "@/lib/fileIO"
import { getPreviewBlockReason } from "@/lib/sensitivePaths"
import type { MonitorFileStatus, MonitorPlanResponse } from "./monitorTypes"
import { summarizePlan, summarizeQueue } from "./workPlan"

/**
 * 見張り(⑭ リソースのページ)のデータを組み立てる。読み取り専用・外部との通信なし・LLM を呼ばない。
 * 3つのファイル(作業計画・待ち行列・CPU の記録)と記録の仕組みは ■ファイル管理のもので、書かない・動かさない・止めない(WC-9)。
 * ファイルは fs.readFile / fs.open の "r" だけで開く。応答に、設定したパスとファイルの生の行は入れない(WC-10)。
 */

/** 作業計画・待ち行列の読む上限(今は十数KB。追記で増えても、これを超えたら読まずに unreadable) */
const MAX_PLAN_BYTES = 8 * 1024 * 1024

export interface MonitorConfig {
  workPlanFile?: string
  resumeQueueFile?: string
  /** CPU の記録のフォルダ(cpu_YYYYMMDD.tsv が並ぶ所) */
  cpuDir?: string
  /** 記録の PC と Dashboard の PC が同じか(既定 true)。総量の列が無い日のメモリの割合だけに使う(WC-11) */
  samePc?: boolean
}

/** 設定ファイル(`config/monitor.json`)を読む。無い・壊れているときは null(画面は設定の案内を出す。WC-8) */
export async function loadMonitorConfig(): Promise<MonitorConfig | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path.join(getAppDataRoot(), "config", "monitor.json"), "utf-8"))
  } catch {
    return null
  }
  return parseMonitorConfig(raw)
}

export function parseMonitorConfig(raw: unknown): MonitorConfig {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  return {
    workPlanFile: str(r.workPlanFile),
    resumeQueueFile: str(r.resumeQueueFile),
    cpuDir: str(r.cpuDir),
    samePc: typeof r.samePc === "boolean" ? r.samePc : undefined,
  }
}

/** 設定した1つのファイルを読む。拒否リストに当たる場所は開かない。エラーの文にファイルの中身を入れない */
export async function readMonitorFile(filePath: string | undefined, maxBytes = MAX_PLAN_BYTES): Promise<{ status: MonitorFileStatus; text: string }> {
  if (!filePath) return { status: "unset", text: "" }
  if (getPreviewBlockReason(filePath)) return { status: "refused", text: "" }
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > maxBytes) return { status: "unreadable", text: "" }
    return { status: "ok", text: await fs.readFile(filePath, "utf-8") }
  } catch (e) {
    return { status: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable", text: "" }
  }
}

export interface MonitorServiceOptions {
  config?: () => Promise<MonitorConfig | null>
  /** Desktop のセッション ID → 今の題名(WC-7) */
  titles?: () => Promise<Map<string, string>>
  now?: () => number
}

async function desktopTitles(): Promise<Map<string, string>> {
  try {
    const service = await getDesktopSessionService()
    const list = await service.list()
    return new Map(list.sessions.map((s) => [s.id, s.title]))
  } catch {
    return new Map()
  }
}

export class MonitorService {
  constructor(private readonly options: MonitorServiceOptions = {}) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** ［作業と待ち］(WC-1・WC-2) */
  async plan(): Promise<MonitorPlanResponse> {
    const config = await (this.options.config ?? loadMonitorConfig)()
    const now = this.now()
    const empty: MonitorPlanResponse = {
      configured: config !== null,
      generatedAt: now,
      waiting: { status: "unset", items: [], resumedToday: 0, sentToday: 0, skipped: 0 },
      plan: { status: "unset", groups: [], doneCount: 0, skipped: 0 },
    }
    if (!config) return empty
    const [titles, queueFile, planFile] = await Promise.all([
      (this.options.titles ?? desktopTitles)(),
      readMonitorFile(config.resumeQueueFile),
      readMonitorFile(config.workPlanFile),
    ])
    const queue = queueFile.status === "ok" ? summarizeQueue(queueFile.text, titles, now) : null
    const plan = planFile.status === "ok" ? summarizePlan(planFile.text, titles, queue?.waitingIds ?? new Set()) : null
    return {
      ...empty,
      waiting: queue
        ? { status: "ok", items: queue.items, resumedToday: queue.resumedToday, sentToday: queue.sentToday, skipped: queue.skipped }
        : { ...empty.waiting, status: queueFile.status },
      plan: plan ? { status: "ok", ...plan } : { ...empty.plan, status: planFile.status },
    }
  }
}

let shared: MonitorService | null = null

export function getMonitorService(): MonitorService {
  if (!shared) shared = new MonitorService()
  return shared
}
