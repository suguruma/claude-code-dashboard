import { promises as fs } from "fs"
import type { UsageWindowKey } from "./usageTypes"

/**
 * 公式値の記録(`~/.claude-dashboard/usage-snapshots.jsonl`、1行1件)を読む。ダッシュボードは読み取るだけで、書かない。
 * 形式: {ts, source:"get_usage", recordedBy, plan, windows:[{key, model?, label, percentUsed, resetsAt}], extraUsage}
 *
 * 取り込むのは許可リストの項目だけ。`recordedBy`(記録したセッション名)・`source`は読み捨てる(APIにも画面にも出さない)。
 * 認証情報のファイルは読まない。
 */

export interface SnapshotWindow {
  key: UsageWindowKey
  /** weekly_model のモデル名(Fable 等)。それ以外は null */
  modelName: string | null
  label: string
  percentUsed: number
  /** 次のリセット時刻(ms) */
  resetsAt: number
}

export interface UsageSnapshot {
  /** 記録した時刻(ms) */
  ts: number
  plan: string | null
  windows: SnapshotWindow[]
  extraUsage: { enabled: boolean; spent: number | null } | null
}

const KEYS: UsageWindowKey[] = ["five_hour", "weekly_all", "weekly_model"]
/** 末尾からこのバイト数だけ読む。記録は追記され続けるため、古い分は読まない */
const MAX_READ_BYTES = 1024 * 1024

export { defaultSnapshotsPath } from "./dataLocations"

function asTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** label「Weekly · Fable」の「·」の後ろ(モデル名)を取り出す */
function modelNameFromLabel(label: string): string | null {
  const idx = label.lastIndexOf("·")
  const name = (idx >= 0 ? label.slice(idx + 1) : "").trim()
  return name || null
}

function parseWindow(raw: unknown): SnapshotWindow | null {
  if (!raw || typeof raw !== "object") return null
  const w = raw as Record<string, unknown>
  const key = KEYS.find((k) => k === w.key)
  const resetsAt = asTime(w.resetsAt)
  const percent = w.percentUsed
  if (!key || resetsAt === null || typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) return null
  const label = typeof w.label === "string" ? w.label.slice(0, 80) : ""
  let modelName: string | null = null
  if (key === "weekly_model") {
    modelName = (typeof w.model === "string" && w.model.trim() ? w.model.trim().slice(0, 40) : null) ?? modelNameFromLabel(label)
    // モデル名が分からない weekly_model は、どのモデルの枠か決められないので使わない
    if (!modelName) return null
  }
  return { key, modelName, label, percentUsed: percent, resetsAt }
}

export function parseSnapshotLine(line: string): UsageSnapshot | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const ts = asTime(raw.ts)
  if (ts === null || !Array.isArray(raw.windows)) return null
  const windows = raw.windows.map(parseWindow).filter((w): w is SnapshotWindow => w !== null)
  if (windows.length === 0) return null

  let extraUsage: UsageSnapshot["extraUsage"] = null
  if (raw.extraUsage && typeof raw.extraUsage === "object") {
    const e = raw.extraUsage as Record<string, unknown>
    if (typeof e.enabled === "boolean") {
      const spent = typeof e.spent === "number" && Number.isFinite(e.spent) && e.spent >= 0 ? e.spent : null
      extraUsage = { enabled: e.enabled, spent }
    }
  }
  return { ts, plan: typeof raw.plan === "string" ? raw.plan.slice(0, 40) : null, windows, extraUsage }
}

export interface SnapshotReadResult {
  found: boolean
  /** 記録の時刻順(古い順) */
  snapshots: UsageSnapshot[]
}

export async function readSnapshots(filePath: string): Promise<SnapshotReadResult> {
  let handle
  try {
    handle = await fs.open(filePath, "r")
  } catch {
    return { found: false, snapshots: [] }
  }
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - MAX_READ_BYTES)
    const length = size - start
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, start)
    let text = buffer.toString("utf-8")
    if (start > 0) {
      // 先頭は行の途中から始まるため、最初の改行まで捨てる
      const firstNewline = text.indexOf("\n")
      text = firstNewline < 0 ? "" : text.slice(firstNewline + 1)
    }
    const snapshots: UsageSnapshot[] = []
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      const snapshot = parseSnapshotLine(line)
      if (snapshot) snapshots.push(snapshot)
    }
    snapshots.sort((a, b) => a.ts - b.ts)
    return { found: true, snapshots }
  } catch {
    return { found: false, snapshots: [] }
  } finally {
    await handle.close()
  }
}
