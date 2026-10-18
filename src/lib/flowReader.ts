import { promises as fs } from "fs"
import { readJsonlFrom } from "./jsonlReader"
import { emptySignals, type PeerSource, type SessionSignals } from "./flowEvents"
import { FLOW_SUMMARY_CHARS } from "./flowTypes"
import { isSendTool } from "./sessionMessaging"
import { makeExcerpt } from "./transcriptDigest"

/**
 * 会話ログ(`.jsonl`)から、組織図アニメーション用の「信号」(他のセッションから届いた入力・送信の記録・ツール呼び出し・
 * 圧縮・ターンの終わり)を取り出す。メインスレッド(isSidechain でない行)だけを読む。
 *
 * - 会話本文は保持しない。保持する文字列は、指示と他グループ連絡の先頭20文字だけ。
 * - 追記型のログなので、前回の読み取り位置から後ろだけを読み足す。サイズが減っていたら最初から読み直す。
 * - 古い信号は、保持する期間(horizon)より前のものを捨てる。
 */

/** 同じ tool_use が複数の行に現れても、1回と数えるために覚えておくID数 */
const SEEN_TOOL_IDS = 512

interface RawBlock {
  type?: string
  id?: string
  name?: string
  text?: string
  input?: unknown
}

interface RawEntry {
  type?: string
  subtype?: string
  timestamp?: string
  isSidechain?: boolean
  origin?: { kind?: unknown; from?: unknown }
  /** 作業中に届いた入力は、user の行ではなく queued_command の attachment として記録される */
  attachment?: { type?: string; origin?: { kind?: unknown; from?: unknown }; prompt?: unknown }
  compactMetadata?: { preTokens?: unknown; postTokens?: unknown }
  message?: {
    model?: string
    stop_reason?: string | null
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    content?: RawBlock[] | string
  }
}

function toMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? null : ms
}

/** peer行の送り手の種類。`local_…` はDesktopのセッション、`uds:…` はCLIなどの外部、それ以外(手戻しなど)は描かない */
export function classifyPeer(from: unknown): { source: PeerSource; fromId: string | null } {
  if (typeof from !== "string") return { source: "other", fromId: null }
  if (/^local_[A-Za-z0-9_-]+$/.test(from)) return { source: "local", fromId: from }
  if (from.startsWith("uds:")) return { source: "external", fromId: null }
  return { source: "other", fromId: null }
}

/** userの行の本文(文字列、または最初のtextブロック) */
function bodyText(content: RawBlock[] | string | undefined): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? ""
}

/** 先頭と末尾のタグ(`<cross-session-message …>` など)を除いた本文の、先頭20文字 */
function summaryOf(text: string): string {
  return makeExcerpt(text.replace(/^<[^>]*>\s*/, "").replace(/\s*<\/[^>]*>\s*$/, ""), FLOW_SUMMARY_CHARS)
}

/** 送信ツールの入力から、宛先の候補(ID・名前)を取り出す */
function sendTargets(input: Record<string, unknown>): string[] {
  const targets: string[] = []
  for (const key of ["to", "recipient", "session_id", "sessionId", "name"]) {
    const value = input[key]
    if (typeof value === "string" && value) targets.push(value)
  }
  return targets
}

function sendBody(input: Record<string, unknown>): string {
  for (const key of ["message", "content"]) {
    const value = input[key]
    if (typeof value === "string" && value) return value
  }
  return ""
}

const MARKERS = ['"assistant"', '"peer"', "compact_boundary"]

export interface SignalEntry {
  offset: number
  signals: SessionSignals
  seenToolIds: string[]
}

export function createSignalEntry(): SignalEntry {
  return { offset: 0, signals: emptySignals(), seenToolIds: [] }
}

/** 1行を取り込む。対象外の行・壊れた行は何もしない */
export function applySignalLine(entry: SignalEntry, line: string, horizon: number): void {
  if (!MARKERS.some((m) => line.includes(m))) return
  let row: RawEntry
  try {
    row = JSON.parse(line) as RawEntry
  } catch {
    // 書き込み途中の行や壊れた行は読み飛ばす。エラー文にファイルの内容は含めない
    return
  }
  if (!row || typeof row !== "object" || row.isSidechain) return
  const t = toMs(row.timestamp)
  if (t === null) return
  const s = entry.signals

  if (row.type === "user") {
    if (row.origin?.kind !== "peer") return
    if (t < horizon) return
    const { source, fromId } = classifyPeer(row.origin.from)
    s.peers.push({ t, fromId, source, summary: summaryOf(bodyText(row.message?.content)) })
    return
  }

  if (row.type === "attachment") {
    // 受け手が作業中のときに届いた他セッションのメッセージ。同じ内容の user の行は書かれないので、二重にはならない
    const att = row.attachment
    if (att?.type !== "queued_command" || att.origin?.kind !== "peer" || t < horizon) return
    const { source, fromId } = classifyPeer(att.origin.from)
    s.peers.push({ t, fromId, source, summary: summaryOf(bodyText(att.prompt as RawBlock[] | string | undefined)) })
    return
  }

  if (row.type === "system") {
    if (row.subtype !== "compact_boundary" || t < horizon) return
    const pre = row.compactMetadata?.preTokens
    const post = row.compactMetadata?.postTokens
    if (typeof pre === "number" && typeof post === "number") s.compacts.push({ t, pre, post })
    return
  }

  if (row.type !== "assistant") return
  const message = row.message
  const synthetic = message?.model === "<synthetic>"
  const usage = message?.usage
  let ctx: number | null = null
  if (!synthetic && usage) {
    const tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    if (tokens > 0) ctx = tokens
  }
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      if (block.type !== "tool_use" || typeof block.name !== "string") continue
      if (typeof block.id === "string") {
        // 1つの応答が複数の行に分かれて書かれても、同じ呼び出しを2回数えない
        if (entry.seenToolIds.includes(block.id)) continue
        entry.seenToolIds.push(block.id)
        if (entry.seenToolIds.length > SEEN_TOOL_IDS) entry.seenToolIds.shift()
      }
      if (t < horizon) continue
      s.tools.push({ t, ctx })
      if (isSendTool(block.name) && block.input && typeof block.input === "object") {
        const input = block.input as Record<string, unknown>
        s.sends.push({ t, targets: sendTargets(input), summary: summaryOf(sendBody(input)) })
      }
    }
  }
  const stop = message?.stop_reason
  if (typeof stop === "string" && stop !== "tool_use" && !synthetic && t >= horizon) s.turnEnds.push(t)
}

function trim(signals: SessionSignals, horizon: number): void {
  const keep = <T extends { t: number }>(list: T[]) => {
    let i = 0
    while (i < list.length && list[i].t < horizon) i++
    return i === 0 ? list : list.slice(i)
  }
  signals.peers = keep(signals.peers)
  signals.sends = keep(signals.sends)
  signals.tools = keep(signals.tools)
  signals.compacts = keep(signals.compacts)
  let i = 0
  while (i < signals.turnEnds.length && signals.turnEnds[i] < horizon) i++
  if (i > 0) signals.turnEnds = signals.turnEnds.slice(i)
}

/**
 * 会話ログのファイルごとに、信号をキャッシュして差分だけ読み足す。
 * 同じファイルに対する同時の呼び出しは直列にする(同じ位置を2回読まないため)。
 */
export class FlowSignalReader {
  private readonly entries = new Map<string, SignalEntry>()
  private readonly chains = new Map<string, Promise<unknown>>()
  /** 読み取ったバイト数の合計(差分読みの確認用) */
  bytesRead = 0

  async read(filePath: string, horizon: number): Promise<SessionSignals> {
    const previous = this.chains.get(filePath) ?? Promise.resolve()
    const next = previous.then(
      () => this.readOnce(filePath, horizon),
      () => this.readOnce(filePath, horizon)
    )
    this.chains.set(filePath, next)
    return next
  }

  private async readOnce(filePath: string, horizon: number): Promise<SessionSignals> {
    let size: number
    let mtimeMs: number
    try {
      const stat = await fs.stat(filePath)
      size = stat.size
      mtimeMs = stat.mtimeMs
    } catch {
      this.entries.delete(filePath)
      return emptySignals()
    }
    let entry = this.entries.get(filePath)
    if (entry && size < entry.offset) entry = undefined // 小さくなっていたら、作り直したファイルとみなす
    if (!entry) {
      entry = createSignalEntry()
      this.entries.set(filePath, entry)
      // 保持する期間より前に最後に更新されたファイルは、読まなくても信号が無い
      if (mtimeMs < horizon) {
        entry.offset = size
        return entry.signals
      }
    }
    if (size > entry.offset) {
      const target = entry
      const start = target.offset
      target.offset = await readJsonlFrom(filePath, start, size, (line) => applySignalLine(target, line, horizon))
      this.bytesRead += target.offset - start
    }
    trim(entry.signals, horizon)
    return entry.signals
  }
}
