import { promises as fs } from "fs"
import path from "path"
import { readJsonlFrom } from "./jsonlReader"

/**
 * 会話記録(~/.claude/projects)から、応答ごとの使用量の台帳を作る。利用上限の推定の元になる。
 *
 * 集計のルール:
 * - 本体(`<dir>/<セッション>.jsonl`)に加えて、サブエージェント(`<dir>/<セッション>/subagents/*.jsonl`)も読む
 * - `message.id` で重複を除く。1つの応答が思考・本文・ツール呼び出しごとに別の行で書かれ、どの行にも同じusageが付くため、
 *   除かないと約2倍(週の消費では約2.6倍)に数えてしまう。usageが違う重複は、出力が最大の行を採る
 * - 合成の応答(`<synthetic>`)・APIエラーの行は数えない
 * 読み取りだけを行い、会話の本文は保持しない(使用量・時刻・モデル名・識別子だけを残す)。
 */

export interface UsageRow {
  /** message.id */
  id: string
  /** 応答の時刻(ms)。応答が終わった時刻なので、実際の消費より数分遅れることがある */
  at: number
  model: string
  /** 会話ログのセッションID。サブエージェントは親のセッションID */
  sessionKey: string
  /** `~/.claude/projects/` 直下のフォルダ名 */
  dirName: string
  subagent: boolean
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export type ParsedUsage = Omit<UsageRow, "sessionKey" | "dirName" | "subagent">

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/** 解析対象になりうる行だけをJSONとして解釈する(巨大なツール出力などの解析コストを避ける) */
function mayBeUsageLine(line: string): boolean {
  return line.includes('"usage"') && (line.includes('"type":"assistant"') || line.includes('"type": "assistant"'))
}

export function parseUsageLine(line: string): ParsedUsage | null {
  if (!mayBeUsageLine(line)) return null
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(line) as Record<string, unknown>
  } catch {
    // 書き込み途中の行や壊れた行は読み飛ばす。エラー文にファイルの内容は含めない
    return null
  }
  if (!entry || typeof entry !== "object" || entry.type !== "assistant") return null
  if (entry.isApiErrorMessage === true) return null
  const message = entry.message as Record<string, unknown> | undefined
  if (!message || typeof message !== "object") return null
  const id = message.id
  const model = message.model
  const usage = message.usage as Record<string, unknown> | undefined
  if (typeof id !== "string" || !id || typeof model !== "string" || !usage || typeof usage !== "object") return null
  if (model === "<synthetic>") return null
  const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN
  if (!Number.isFinite(at)) return null

  const creationTotal = count(usage.cache_creation_input_tokens)
  const split = usage.cache_creation && typeof usage.cache_creation === "object" ? (usage.cache_creation as Record<string, unknown>) : null
  let cacheWrite5m = split ? count(split.ephemeral_5m_input_tokens) : 0
  const cacheWrite1h = split ? count(split.ephemeral_1h_input_tokens) : 0
  // 内訳に含まれない分(内訳が無い古い形式を含む)は、5分のキャッシュとして数える
  const rest = creationTotal - cacheWrite5m - cacheWrite1h
  if (rest > 0) cacheWrite5m += rest

  return {
    id,
    at,
    model,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite5m,
    cacheWrite1h,
  }
}

/** 同じ message.id の行が複数あるとき、どちらを採るか。出力が大きい方、同じなら先に見つけた方 */
export function preferRow<T extends { output: number }>(current: T, candidate: T): T {
  return candidate.output > current.output ? candidate : current
}

interface FileState {
  size: number
  offset: number
  rows: Map<string, UsageRow>
}

interface TranscriptFile {
  filePath: string
  dirName: string
  sessionKey: string
  subagent: boolean
}

export interface UsageLedgerOptions {
  projectsRoot: string
  /** この期間より古い応答は保持しない。既定は15日(週の枠+較正に使う直近7日分の枠) */
  horizonMs?: number
  now?: () => number
}

const DEFAULT_HORIZON_MS = 15 * 24 * 60 * 60 * 1000
const DISCOVERY_TTL_MS = 5_000

export async function listTranscriptFiles(projectsRoot: string): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = []
  let dirs
  try {
    dirs = await fs.readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return files
  }
  await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = path.join(projectsRoot, d.name)
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            files.push({
              filePath: path.join(dir, entry.name),
              dirName: d.name,
              sessionKey: entry.name.slice(0, -".jsonl".length),
              subagent: false,
            })
          } else if (entry.isDirectory()) {
            const subDir = path.join(dir, entry.name, "subagents")
            let subs: string[]
            try {
              subs = await fs.readdir(subDir)
            } catch {
              continue
            }
            for (const name of subs) {
              if (name.endsWith(".jsonl")) {
                files.push({ filePath: path.join(subDir, name), dirName: d.name, sessionKey: entry.name, subagent: true })
              }
            }
          }
        }
      })
  )
  return files
}

export class UsageLedger {
  private readonly opts: UsageLedgerOptions
  private readonly states = new Map<string, FileState>()
  private discovery: { at: number; files: TranscriptFile[] } | null = null
  private inflight: Promise<void> | null = null
  private cache: { version: number; builtAt: number; rows: UsageRow[] } | null = null
  private version = 0

  constructor(options: UsageLedgerOptions) {
    this.opts = options
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  private get horizonMs(): number {
    return this.opts.horizonMs ?? DEFAULT_HORIZON_MS
  }

  /** 追記された分だけを読み足す。同時に呼ばれても、読み取りは1回にまとめる */
  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async doRefresh(): Promise<void> {
    const now = this.now()
    if (!this.discovery || now - this.discovery.at >= DISCOVERY_TTL_MS) {
      this.discovery = { at: now, files: await listTranscriptFiles(this.opts.projectsRoot) }
    }
    const cutoff = now - this.horizonMs
    for (const file of this.discovery.files) {
      let stat
      try {
        stat = await fs.stat(file.filePath)
      } catch {
        this.states.delete(file.filePath)
        continue
      }
      // 更新が期間より古いファイルには、期間内の応答は無い(行は時刻順に追記される)
      if (stat.mtimeMs < cutoff && !this.states.has(file.filePath)) continue

      let state = this.states.get(file.filePath)
      // サイズが減っていたら、書き直されたとみなして最初から読み直す
      if (!state || stat.size < state.size) {
        state = { size: 0, offset: 0, rows: new Map() }
        this.states.set(file.filePath, state)
      }
      if (stat.size === state.offset) {
        state.size = stat.size
        continue
      }
      const target = state
      try {
        target.offset = await readJsonlFrom(file.filePath, target.offset, stat.size, (line) => {
          const parsed = parseUsageLine(line)
          if (!parsed) return
          const row: UsageRow = { ...parsed, sessionKey: file.sessionKey, dirName: file.dirName, subagent: file.subagent }
          const existing = target.rows.get(row.id)
          target.rows.set(row.id, existing ? preferRow(existing, row) : row)
        })
        target.size = stat.size
        this.version++
      } catch {
        // 読み取りに失敗した。次の取得で再試行する(内容を含むエラー文は残さない)
      }
    }
  }

  /** 重複を除いた応答の一覧(時刻順)。期間より古いものは含めない。refresh() の後に呼ぶ */
  rows(): UsageRow[] {
    const now = this.now()
    if (this.cache && this.cache.version === this.version && now - this.cache.builtAt < 1_000) return this.cache.rows
    const cutoff = now - this.horizonMs
    const merged = new Map<string, UsageRow>()
    for (const state of this.states.values()) {
      for (const row of state.rows.values()) {
        if (row.at < cutoff) continue
        const existing = merged.get(row.id)
        merged.set(row.id, existing ? preferRow(existing, row) : row)
      }
    }
    const rows = [...merged.values()].sort((a, b) => a.at - b.at)
    this.cache = { version: this.version, builtAt: now, rows }
    return rows
  }
}
