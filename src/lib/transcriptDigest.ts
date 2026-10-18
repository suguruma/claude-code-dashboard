import { promises as fs } from "fs"
import type {
  DesktopSessionTask,
  InstructionOrigin,
  TaskStatus,
} from "./desktopSessionTypes"

/**
 * 会話ログ(`.jsonl`)から、セッション一覧に必要な少数の値だけを取り出す「要約(digest)」。
 *
 * - 会話本文は保持しない。保持するのは先頭60文字の抜粋、ステップ名(80文字まで)、数値、フラグのみ。
 * - 追記型のログなので、前回の読み取り位置(offset)から後ろだけを読み足せる。サイズが減っていたら呼び出し側が作り直す。
 * - 初回は末尾だけを読む「暫定の要約」で素早く返し、全体の読み込み(圧縮の回数・フェーズの正確な値)は呼び出し側が後から行う。
 */

export const INSTRUCTION_EXCERPT_CHARS = 60
const STEP_MAX_CHARS = 80
const MAX_TASKS = 200
/** 暫定の要約のために読む末尾のバイト数 */
export const TAIL_BYTES = 512 * 1024
const CHUNK_BYTES = 1024 * 1024
/** 改行の無い異常に長い行を抱え込み続けないための上限 */
const MAX_CARRY_BYTES = 32 * 1024 * 1024

export interface DigestInstruction {
  excerpt: string
  origin: InstructionOrigin
  at: number | null
}

export interface DigestTask extends DesktopSessionTask {
  /** 以前のCLIのタスク(TaskCreate/TaskUpdate)のID。タスクリスト更新ツールのステップには無い */
  id?: string
}

export interface DigestLastRow {
  role: "user" | "assistant"
  /** assistantのみ。tool_use のときはツールの結果待ち */
  stopReason: string | null
  /** ユーザーによる中断(`[Request interrupted by user`)の行 */
  interrupted: boolean
  at: number | null
}

export interface TranscriptDigest {
  /** ファイルの先頭から読んだ要約なら true。末尾だけの暫定なら false */
  complete: boolean
  /** ここまで読み終えたバイト位置(改行で終わる行の末尾) */
  offset: number
  lastEventAt: number | null
  lastRow: DigestLastRow | null
  /** メインスレッドの最後の assistant 行の uuid(ターン後の要約との突き合わせに使う) */
  lastAssistantUuid: string | null
  context: { tokens: number; model: string | null } | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  cwd: string | null
  title: string | null
  compactionCount: number
  lastCompactionAt: number | null
  tasks: DigestTask[] | null
  legacyNextId: number
  queued: number
  /** 人が書いた直近の指示 */
  latestHuman: DigestInstruction | null
  /** 発信元を問わない直近の入力 */
  latestInput: DigestInstruction | null
}

export function createDigest(): TranscriptDigest {
  return {
    complete: false,
    offset: 0,
    lastEventAt: null,
    lastRow: null,
    lastAssistantUuid: null,
    context: null,
    model: null,
    effort: null,
    permissionMode: null,
    cwd: null,
    title: null,
    compactionCount: 0,
    lastCompactionAt: null,
    tasks: null,
    legacyNextId: 1,
    queued: 0,
    latestHuman: null,
    latestInput: null,
  }
}

// ---------------------------------------------------------------------------
// 抜粋の作成

export function makeExcerpt(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed
}

interface RawBlock {
  type?: string
  text?: string
  name?: string
  input?: unknown
}

interface RawEntry {
  type?: string
  subtype?: string
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  /** 圧縮後に差し込まれる「この会話は以前の会話の続き」の要約。人の指示ではない */
  isCompactSummary?: boolean
  isApiErrorMessage?: boolean
  effort?: string
  cwd?: string
  permissionMode?: string
  turnOrigin?: unknown
  origin?: { kind?: unknown }
  operation?: string
  customTitle?: string
  aiTitle?: string
  attachment?: { type?: string; content?: unknown }
  message?: {
    model?: string
    stop_reason?: string | null
    usage?: {
      input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    content?: RawBlock[] | string
  }
}

function toMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? null : ms
}

/** システムが差し込む疑似ユーザー行(コマンド出力・リマインダー等)かどうか */
const SYSTEM_WRAPPER = /^<(local-command|command-name|command-message|command-args|system-reminder|bash-|user-prompt-submit)/
const INTERRUPT_MARK = "[Request interrupted by user"
/** isCompactSummary が付かない形式でも、圧縮後の要約を指示として拾わない */
const CONTINUATION_MARK = "This session is being continued from a previous conversation"

function originOf(entry: RawEntry): InstructionOrigin {
  const kind = entry.origin?.kind
  if (kind === "human") return "human"
  if (kind === "peer") return "peer"
  if (kind === "task-notification") return "notification"
  if (typeof kind === "string") return "system"
  switch (entry.turnOrigin) {
    case "peer":
      return "peer"
    case "task_notification":
      return "notification"
    case "scheduled":
      return "scheduled"
    case "system":
      return "system"
    default:
      // 発信元の記録が無い古い形式の行、または人の入力(sdk含む)
      return "human"
  }
}

/** userの行から、ツール結果ではない発言の本文を取り出す。ツール結果の行は toolResult:true */
function userText(content: RawBlock[] | string | undefined): { text: string | null; toolResult: boolean } {
  if (typeof content === "string") return { text: content, toolResult: false }
  if (!Array.isArray(content)) return { text: null, toolResult: false }
  if (content.some((b) => b.type === "tool_result")) return { text: null, toolResult: true }
  const block = content.find((b) => b.type === "text" && typeof b.text === "string")
  return { text: block?.text ?? null, toolResult: false }
}

// ---------------------------------------------------------------------------
// タスクリスト

function normalizeStatus(value: unknown): TaskStatus {
  if (value === "completed" || value === "done") return "completed"
  if (value === "in_progress") return "in_progress"
  return "pending"
}

function applyPlanInput(d: TranscriptDigest, input: Record<string, unknown>): void {
  if (Array.isArray(input.items)) {
    d.tasks = input.items
      .slice(0, MAX_TASKS)
      .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
      .map((i) => ({
        content: makeExcerpt(typeof i.content === "string" ? i.content : "", STEP_MAX_CHARS),
        status: normalizeStatus(i.status),
      }))
    return
  }
  const tasks = d.tasks
  if (!tasks) return
  if (input.advance === true) {
    const current = tasks.findIndex((t) => t.status === "in_progress")
    if (current >= 0) tasks[current].status = "completed"
    const next = tasks.findIndex((t) => t.status === "pending")
    if (next >= 0) tasks[next].status = "in_progress"
    return
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      if (typeof n === "number" && tasks[n - 1]) tasks[n - 1].status = "completed"
    }
  }
  if (typeof input.start === "number" && tasks[input.start - 1]) {
    tasks[input.start - 1].status = "in_progress"
  }
}

function applyLegacyTaskTool(d: TranscriptDigest, name: string, input: Record<string, unknown>): void {
  if (name === "TaskCreate") {
    const subject = typeof input.subject === "string" ? input.subject : ""
    // 前の計画がすべて完了していたら、新しい計画の始まりとみなして一覧を作り直す
    if (!d.tasks || d.tasks.every((t) => t.status === "completed")) d.tasks = []
    if (d.tasks.length < MAX_TASKS) {
      d.tasks.push({
        id: String(d.legacyNextId),
        content: makeExcerpt(subject, STEP_MAX_CHARS),
        status: "pending",
      })
    }
    d.legacyNextId++
    return
  }
  if (name === "TaskUpdate" && d.tasks) {
    const id = String(input.taskId ?? input.task_id ?? "")
    const idx = d.tasks.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (input.status === "deleted") {
      d.tasks.splice(idx, 1)
      return
    }
    if (typeof input.status === "string") d.tasks[idx].status = normalizeStatus(input.status)
    if (typeof input.subject === "string") d.tasks[idx].content = makeExcerpt(input.subject, STEP_MAX_CHARS)
  }
}

function applyTaskReminder(d: TranscriptDigest, content: unknown): void {
  if (!Array.isArray(content) || content.length === 0) return
  d.tasks = content
    .slice(0, MAX_TASKS)
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => c.status !== "deleted")
    .map((c) => ({
      id: c.id === undefined ? undefined : String(c.id),
      content: makeExcerpt(typeof c.subject === "string" ? c.subject : "", STEP_MAX_CHARS),
      status: normalizeStatus(c.status),
    }))
}

// ---------------------------------------------------------------------------
// 1行の取り込み

export function applyEntry(d: TranscriptDigest, entry: RawEntry): void {
  const at = toMs(entry.timestamp)
  if (at !== null && (d.lastEventAt === null || at > d.lastEventAt)) d.lastEventAt = at
  if (!d.cwd && typeof entry.cwd === "string") d.cwd = entry.cwd

  switch (entry.type) {
    case "user": {
      if (entry.isSidechain) return
      if (typeof entry.permissionMode === "string") d.permissionMode = entry.permissionMode
      const { text, toolResult } = userText(entry.message?.content)
      const interrupted = text !== null && text.startsWith(INTERRUPT_MARK)
      d.lastRow = { role: "user", stopReason: null, interrupted, at }
      if (toolResult || entry.isMeta || entry.isCompactSummary || text === null || interrupted) return
      const origin = originOf(entry)
      if (origin === "human" && (SYSTEM_WRAPPER.test(text) || text.startsWith(CONTINUATION_MARK))) return
      const body = origin === "peer" ? text.replace(/^<[^>]*>\s*/, "") : text
      const instruction: DigestInstruction = {
        excerpt: origin === "notification" ? "" : makeExcerpt(body, INSTRUCTION_EXCERPT_CHARS),
        origin,
        at,
      }
      d.latestInput = instruction
      if (origin === "human") d.latestHuman = instruction
      return
    }
    case "assistant": {
      if (entry.isSidechain) return
      const message = entry.message
      const stopReason = message?.stop_reason ?? null
      d.lastRow = { role: "assistant", stopReason, interrupted: false, at }
      if (typeof entry.uuid === "string") d.lastAssistantUuid = entry.uuid
      if (typeof entry.effort === "string") d.effort = entry.effort
      const synthetic = entry.isApiErrorMessage === true || message?.model === "<synthetic>"
      if (!synthetic && typeof message?.model === "string") d.model = message.model
      const usage = message?.usage
      if (!synthetic && usage) {
        const tokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
        if (tokens > 0) d.context = { tokens, model: typeof message?.model === "string" ? message.model : d.model }
      }
      if (Array.isArray(message?.content)) {
        for (const block of message.content) {
          if (block.type !== "tool_use" || typeof block.name !== "string") continue
          const input =
            block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : null
          if (!input) continue
          if (block.name === "mcp__ccd_turn__update_plan") applyPlanInput(d, input)
          else if (block.name === "TaskCreate" || block.name === "TaskUpdate") applyLegacyTaskTool(d, block.name, input)
        }
      }
      return
    }
    case "system": {
      if (entry.subtype === "compact_boundary") {
        d.compactionCount++
        d.lastCompactionAt = at
      }
      return
    }
    case "attachment": {
      if (entry.attachment?.type === "task_reminder") applyTaskReminder(d, entry.attachment.content)
      return
    }
    case "queue-operation": {
      if (entry.operation === "enqueue") d.queued++
      else if (entry.operation === "dequeue" || entry.operation === "remove") d.queued = Math.max(0, d.queued - 1)
      return
    }
    case "custom-title": {
      if (typeof entry.customTitle === "string" && entry.customTitle.trim()) {
        d.title = makeExcerpt(entry.customTitle, 80)
      }
      return
    }
    case "ai-title": {
      // 手動で付けた名前(custom-title)を優先する。custom-titleの方が後に書かれることが多いが、順序に依存しない
      if (!d.title && typeof entry.aiTitle === "string" && entry.aiTitle.trim()) {
        d.title = makeExcerpt(entry.aiTitle, 80)
      }
      return
    }
  }
}

/**
 * 解析対象になりうる行だけをJSONとして解釈する。巨大なツール出力など不要な行の解析コストを避ける。
 * Desktop/CLIはキーの後に空白を入れない形式で書くが、空白ありの形式でも読めるよう両方を見る。
 */
const RELEVANT_TYPES = ["assistant", "user", "system", "queue-operation", "custom-title", "ai-title"]
const RELEVANT_MARKERS = [
  ...RELEVANT_TYPES.flatMap((t) => [`"type":"${t}"`, `"type": "${t}"`]),
  '"task_reminder"',
]

export function applyLine(d: TranscriptDigest, line: string): void {
  if (!RELEVANT_MARKERS.some((m) => line.includes(m))) return
  let entry: RawEntry
  try {
    entry = JSON.parse(line) as RawEntry
  } catch {
    // 書き込み途中の行や壊れた行は読み飛ばす。エラー文にファイルの内容は含めない
    return
  }
  if (entry && typeof entry === "object") applyEntry(d, entry)
}

// ---------------------------------------------------------------------------
// ファイル読み取り

/** 暫定の要約: 末尾 tailBytes だけを読む。読み取り位置は進めず、complete は false のまま */
export async function readTailDigest(
  filePath: string,
  size: number,
  tailBytes: number = TAIL_BYTES
): Promise<TranscriptDigest> {
  const digest = createDigest()
  digest.offset = size
  if (size === 0) return digest

  const start = Math.max(0, size - tailBytes)
  const length = size - start
  const buffer = Buffer.alloc(length)
  const handle = await fs.open(filePath, "r")
  try {
    await handle.read(buffer, 0, length, start)
  } finally {
    await handle.close()
  }

  let text = buffer.toString("utf-8")
  if (start > 0) {
    // 先頭は行の途中から始まるため、最初の改行まで捨てる
    const firstNewline = text.indexOf("\n")
    text = firstNewline < 0 ? "" : text.slice(firstNewline + 1)
  }
  for (const line of text.split("\n")) {
    if (line) applyLine(digest, line)
  }
  return digest
}

/**
 * digest.offset から endSize までを読み足して要約に反映する(全体読み込み・差分読み込み共通)。
 * 改行で終わっていない最後の行は書き込み途中とみなし、次回に回す(offsetを進めない)。
 * 同じ digest に対して同時に呼ばないこと(呼び出し側で直列化する)。
 */
export async function advanceDigest(
  filePath: string,
  digest: TranscriptDigest,
  endSize: number,
  chunkBytes: number = CHUNK_BYTES
): Promise<void> {
  // 先頭から読んだ要約(または既に完全な要約)への読み足しのときだけ、完全な要約になる
  const coversWholeFile = digest.complete || digest.offset === 0
  const handle = await fs.open(filePath, "r")
  try {
    let position = digest.offset
    let carry: Buffer = Buffer.alloc(0)
    while (position < endSize) {
      const length = Math.min(chunkBytes, endSize - position)
      const chunk = Buffer.alloc(length)
      const { bytesRead } = await handle.read(chunk, 0, length, position)
      if (bytesRead === 0) break
      position += bytesRead

      const data = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
      const lastNewline = data.lastIndexOf(0x0a)
      if (lastNewline < 0) {
        carry = data.length > MAX_CARRY_BYTES ? Buffer.alloc(0) : Buffer.from(data)
        if (data.length > MAX_CARRY_BYTES) digest.offset = position
        continue
      }
      const complete = data.subarray(0, lastNewline).toString("utf-8")
      for (const line of complete.split("\n")) {
        if (line) applyLine(digest, line)
      }
      carry = Buffer.from(data.subarray(lastNewline + 1))
      digest.offset = position - carry.length
    }
    if (coversWholeFile) digest.complete = true
  } finally {
    await handle.close()
  }
}
