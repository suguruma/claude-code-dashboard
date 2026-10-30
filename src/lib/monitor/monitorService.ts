import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { getDesktopSessionService } from "@/lib/desktopSessionService"
import { getAppDataRoot } from "@/lib/fileIO"
import { getPreviewBlockReason } from "@/lib/sensitivePaths"
import { alertBands, CpuFileState, findGaps, readCpuFile, toPoints, type MinuteRecord, type SessionSample } from "./cpuLog"
import type {
  AlertKey,
  MonitorAlertSummary,
  MonitorFileStatus,
  MonitorLoadResponse,
  MonitorPlanResponse,
  MonitorSnapshotResponse,
  PcAlertItem,
} from "./monitorTypes"
import { sessionLabel, summarizePlan, summarizeQueue } from "./workPlan"

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

export interface SessionInfo {
  title: string
  group: string | null
}

export interface MonitorServiceOptions {
  config?: () => Promise<MonitorConfig | null>
  /** Desktop のセッション ID → 今の題名とグループの名前(WC-7) */
  sessions?: () => Promise<Map<string, SessionInfo>>
  now?: () => number
  /** Dashboard の PC のメモリの総量(MB)。テストで差し替える(既定は os.totalmem()) */
  hostMemMb?: number
}

async function desktopSessions(): Promise<Map<string, SessionInfo>> {
  try {
    const service = await getDesktopSessionService()
    const list = await service.list()
    return new Map(list.sessions.map((s) => [s.id, { title: s.title, group: s.group?.name ?? null }]))
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
    const [sessions, queueFile, planFile] = await Promise.all([
      (this.options.sessions ?? desktopSessions)(),
      readMonitorFile(config.resumeQueueFile),
      readMonitorFile(config.workPlanFile),
    ])
    const titles = new Map([...sessions].map(([id, info]) => [id, info.title]))
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

  private readonly files = new Map<string, CpuFileState>()

  /** CPU の記録のフォルダにある日(YYYYMMDD。新しい順) */
  private async listDays(cpuDir: string): Promise<string[]> {
    try {
      const names = await fs.readdir(cpuDir)
      return names
        .map((n) => /^cpu_(\d{8})\.tsv$/.exec(n)?.[1])
        .filter((d): d is string => !!d)
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  /** ファイルごとの、読み足しの列の最後(同じファイルの読み足しを1本ずつにする) */
  private readonly reading = new Map<string, Promise<unknown>>()

  /**
   * その日のファイルを読み足して、記録を返す。読み足しの状態(どこまで読んだか)を要求のあいだで共有するので、
   * 同じファイルの読み足しは前の読み足しが終わってから始める(⑭ のゲート2 の L1。同時に来た要求が同じ追記を二重に読まないように)
   */
  private dayRecords(cpuDir: string, day: string): Promise<{ status: MonitorFileStatus; records: MinuteRecord[]; skipped: number }> {
    const filePath = path.join(cpuDir, `cpu_${day}.tsv`)
    const run = (this.reading.get(filePath) ?? Promise.resolve()).then(async () => {
      const { status, state } = await readCpuFile(filePath, this.files.get(filePath))
      this.files.set(filePath, state)
      return { status, records: status === "ok" ? state.records() : [], skipped: state.skipped }
    })
    const tail = run.catch(() => undefined)
    this.reading.set(filePath, tail)
    void tail.then(() => {
      if (this.reading.get(filePath) === tail) this.reading.delete(filePath)
    })
    return run
  }

  private hostMem(): number {
    return this.options.hostMemMb ?? os.totalmem() / (1024 * 1024)
  }

  /** メモリの総量：記録の total の行の mem_total_mb(8列のファイル)があればそれ。無ければ samePc のときだけ Dashboard の PC の総量(WC-11) */
  private memTotal(records: ReadonlyArray<MinuteRecord>, config: MonitorConfig): { memTotalMb: number | null; memTotalSource: "log" | "host" | null } {
    for (let i = records.length - 1; i >= 0; i--) {
      const v = records[i].memTotalMb
      if (v !== null && v > 0) return { memTotalMb: v, memTotalSource: "log" }
    }
    return config.samePc === false ? { memTotalMb: null, memTotalSource: null } : { memTotalMb: this.hostMem(), memTotalSource: "host" }
  }

  /** ［負荷］の推移の図(WC-3〜WC-5・WC-11・WC-12)。date は YYYY-MM-DD、rangeHours は 1・2・6・24、center は過去の日で窓の中心にする時刻 */
  async load(params: { date?: string | null; rangeHours?: number | null; center?: number | null } = {}): Promise<MonitorLoadResponse> {
    const config = await (this.options.config ?? loadMonitorConfig)()
    const now = this.now()
    const today = dayKey(now)
    const empty: MonitorLoadResponse = {
      configured: config !== null,
      status: "unset",
      generatedAt: now,
      date: dayLabel(today),
      days: [],
      isToday: true,
      rangeHours: 6,
      from: now - 6 * HOUR,
      to: now,
      points: [],
      memTotalMb: null,
      memTotalSource: null,
      thresholds: { cpu: null, mem: null },
      alerts: { cpu: [], mem: [] },
      gaps: [],
      dayHasAlert: false,
      lastRecordAt: null,
      skipped: 0,
    }
    if (!config?.cpuDir) return empty
    if (getPreviewBlockReason(config.cpuDir)) return { ...empty, status: "refused" }
    const days = await this.listDays(config.cpuDir)
    const wanted = params.date?.replace(/-/g, "") ?? today
    const day = wanted === today || days.includes(wanted) ? wanted : today
    const isToday = day === today
    const rangeHours = RANGES.includes(params.rangeHours ?? 0) ? params.rangeHours! : isToday ? 6 : 24
    const dayStart = startOfDay(day)
    const dayEnd = dayStart + 24 * HOUR

    const current = await this.dayRecords(config.cpuDir, day)
    let records = current.records
    let skipped = current.skipped
    let from: number
    let to: number
    if (isToday) {
      to = now
      from = now - rangeHours * HOUR
      // 窓が0時をまたぐときは前の日のファイルも読む(24時間の図は2つのファイルをまたいで1本の線。A33)
      const prev = dayKey(dayStart - HOUR)
      if (from < dayStart && days.includes(prev)) {
        const before = await this.dayRecords(config.cpuDir, prev)
        records = [...before.records, ...records]
        skipped += before.skipped
      }
    } else if (rangeHours === 24) {
      from = dayStart
      to = dayEnd
    } else {
      // 過去の日の短い範囲は、選んだ時刻を中心に窓を動かす(その日の中に収める)
      const half = (rangeHours * HOUR) / 2
      const center = Math.min(Math.max(params.center ?? dayStart + 12 * HOUR, dayStart + half), dayEnd - half)
      from = center - half
      to = center + half
    }

    const inWindow = records.filter((r) => r.t >= from && r.t <= to)
    const points = toPoints(inWindow)
    const lastOfDay = current.records[current.records.length - 1]?.t ?? null
    let lastRecordAt = lastOfDay
    if (lastRecordAt === null && days.length > 0) {
      // 今日のファイルが無いときは、いちばん新しい日の最後の記録(「最後の記録：10/23 23:59」)
      const latest = days.find((d) => d !== day)
      if (latest) {
        const recs = (await this.dayRecords(config.cpuDir, latest)).records
        lastRecordAt = recs[recs.length - 1]?.t ?? null
      }
    }
    const thresholdIn = (key: AlertKey) => {
      let v: number | null = null
      for (const r of records) for (const a of r.alerts) if (a.key === key && a.threshold !== null) v = a.threshold
      return v
    }
    return {
      ...empty,
      status: current.status,
      date: dayLabel(day),
      days: days.map(dayLabel),
      isToday,
      rangeHours,
      from,
      to,
      points,
      ...this.memTotal(inWindow.length ? inWindow : records, config),
      thresholds: { cpu: thresholdIn("cpu"), mem: thresholdIn("mem") },
      alerts: { cpu: alertBands(inWindow, "cpu"), mem: alertBands(inWindow, "mem") },
      gaps: findGaps(points, isToday ? now : null),
      dayHasAlert: current.records.some((r) => r.alerts.length > 0),
      lastRecordAt,
      skipped,
    }
  }

  /** 選んだ時刻に動いていたもの(WC-4・WC-13。前後1分の記録。セッションは CPU の多い順) */
  async snapshot(at: number): Promise<MonitorSnapshotResponse> {
    const config = await (this.options.config ?? loadMonitorConfig)()
    const empty: MonitorSnapshotResponse = { configured: config !== null, t: null, nearest: null, total: null, memTotalMb: null, sessions: [], others: [] }
    if (!config?.cpuDir || getPreviewBlockReason(config.cpuDir)) return empty
    const day = dayKey(at)
    const days = [dayKey(startOfDay(day) - HOUR), day]
    let records: MinuteRecord[] = []
    for (const d of days) records = [...records, ...(await this.dayRecords(config.cpuDir, d)).records]
    const totals = records.filter((r) => r.cpu !== null)
    let best: MinuteRecord | null = null
    for (const r of totals) if (!best || Math.abs(r.t - at) < Math.abs(best.t - at)) best = r
    if (!best) return empty
    if (Math.abs(best.t - at) > 60_000) return { ...empty, nearest: best.t }

    const info = await (this.options.sessions ?? desktopSessions)()
    const recent = totals.filter((r) => r.t > best!.t - 30 * 60_000 && r.t <= best!.t)
    const spark = (id: string, pick: (s: SessionSample) => number | null) =>
      sparkSlots(best!.t).map((slot) => {
        const r = recent.find((x) => Math.abs(x.t - slot) < 30_000)
        const s = r?.sessions.find((x) => x.id === id)
        return s ? pick(s) : null
      })
    const sessions = [...best.sessions]
      .sort((a, b) => b.cpu - a.cpu)
      .map((s) => ({
        id: s.id,
        title: sessionLabel(s.id, new Map([...info].map(([id, v]) => [id, v.title])), s.title),
        group: info.get(s.id)?.group ?? null,
        cpu: s.cpu,
        memMb: s.memMb,
        procs: s.procs,
        sparkCpu: spark(s.id, (x) => x.cpu),
        sparkMem: spark(s.id, (x) => x.memMb),
      }))
    return {
      configured: true,
      t: best.t,
      nearest: best.t,
      total: { cpu: best.cpu!, memMb: best.memMb, procs: best.procs },
      memTotalMb: this.memTotal(records, config).memTotalMb,
      sessions,
      others: [...best.others].sort((a, b) => b.cpu - a.cpu),
    }
  }

  /** ホームの帯・サイドバーの「！」・通知の警告の要約(WC-6・WC-12。直近24時間) */
  async alerts(): Promise<MonitorAlertSummary> {
    const config = await (this.options.config ?? loadMonitorConfig)()
    const now = this.now()
    const empty: MonitorAlertSummary = { configured: config !== null, generatedAt: now, items: [], today: false }
    if (!config?.cpuDir || getPreviewBlockReason(config.cpuDir)) return empty
    const today = dayKey(now)
    let records: MinuteRecord[] = []
    for (const d of [dayKey(startOfDay(today) - HOUR), today]) records = [...records, ...(await this.dayRecords(config.cpuDir, d)).records]
    const recent = records.filter((r) => r.t >= now - 24 * HOUR && r.t <= now)
    const items: PcAlertItem[] = []
    for (const key of ["cpu", "mem"] as const) {
      const bands = alertBands(recent, key)
      const band = bands[bands.length - 1]
      if (band) items.push({ key, band, active: now - band.end <= ALERT_ACTIVE_MS, count: bands.length })
    }
    const dayStart = startOfDay(today)
    return { ...empty, items, today: recent.some((r) => r.t >= dayStart && r.alerts.length > 0) }
  }
}

const HOUR = 60 * 60_000
const RANGES = [1, 2, 6, 24]
/** ホームの帯を赤で出す間(最後の alert の行から10分。WC-6) */
export const ALERT_ACTIVE_MS = 10 * 60_000

/** epoch ms → YYYYMMDD(この PC の日付) */
export function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

function dayLabel(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`
}

function startOfDay(day: string): number {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))).getTime()
}

/** 直近30分の小さな線の30の時刻(1分ごと。最後が選んだ記録) */
function sparkSlots(t: number): number[] {
  return Array.from({ length: 30 }, (_, i) => t - (29 - i) * 60_000)
}

let shared: MonitorService | null = null

export function getMonitorService(): MonitorService {
  if (!shared) shared = new MonitorService()
  return shared
}
