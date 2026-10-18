import { createReadStream, promises as fs, type Dirent } from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { FileIOError } from "./fileIO"
import {
  CompactionEvent,
  SessionMetrics,
  SessionProjectSummary,
  SessionSummary,
  ToolCallEvent,
  TokenPoint,
} from "./types"
import { NotFoundError } from "./errors"

/**
 * Claude Codeのセッション実行ログ(`.jsonl`)が格納される場所。ダッシュボードで登録した
 * プロジェクト（config/projects.json）とは無関係に、実行しているマシンの実際の
 * `~/.claude/projects/`を直接見る（このマシンで実行されたセッションは登録状況に関わらず
 * ここに存在するため、専用のルートとして扱う）。
 */
export function getClaudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects")
}

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface RawContentBlock {
  type?: string
  id?: string
  name?: string
  tool_use_id?: string
  is_error?: boolean
  input?: unknown
  content?: unknown
  text?: string
}

/** 表示名に使う先頭発話の抜粋の上限文字数。本文全体は保持・表示しない */
const EXCERPT_MAX_CHARS = 60

/** ユーザー発話から表示用の短い抜粋を作る（改行等を1スペースに畳み、長ければ末尾を省略） */
function buildExcerpt(content: RawContentBlock[] | string | undefined): string | null {
  let text: string | null = null
  if (typeof content === "string") {
    text = content
  } else if (Array.isArray(content)) {
    const block = content.find((b) => b.type === "text" && typeof b.text === "string")
    text = block?.text ?? null
  }
  if (!text) return null
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (!collapsed) return null
  return collapsed.length > EXCERPT_MAX_CHARS ? `${collapsed.slice(0, EXCERPT_MAX_CHARS)}…` : collapsed
}

/** `mcp__<server>__<tool>` 形式のツール名からサーバー識別子を取り出す（組み込みツールはnull） */
function parseMcpServer(name: string): string | null {
  const prefix = "mcp__"
  if (!name.startsWith(prefix)) return null
  const rest = name.slice(prefix.length)
  const idx = rest.indexOf("__")
  if (idx === -1) return null
  return rest.slice(0, idx)
}

/** tool_resultのcontentから、本文自体は保持せず文字数だけを数える */
function contentLength(content: unknown): number {
  if (typeof content === "string") return content.length
  if (Array.isArray(content)) {
    return content.reduce((sum: number, part) => {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return sum + (part as { text: string }).text.length
      }
      return sum
    }, 0)
  }
  return 0
}

interface RawLine {
  type?: string
  subtype?: string
  timestamp?: string
  isSidechain?: boolean
  effort?: string
  cwd?: string
  version?: string
  hookErrors?: unknown[]
  compactMetadata?: { trigger?: string; preTokens?: number; durationMs?: number }
  toolUseResult?: { interrupted?: boolean }
  message?: {
    /** 応答のID。1つの応答が思考・本文・ツール呼び出しごとに別の行で書かれ、どの行にも同じIDとusageが付く */
    id?: string
    usage?: RawUsage
    content?: RawContentBlock[] | string
  }
}

/** `.jsonl`を1行ずつストリーム解析し、会話本文を保持せず集計値のみを組み立てる */
async function parseSessionFile(filePath: string): Promise<SessionMetrics> {
  const toolNameById = new Map<string, string>()
  const toolCallById = new Map<string, ToolCallEvent>()

  const tokenPoints: TokenPoint[] = []
  /** message.id → tokenPoints の位置。同じ応答の行を二重に数えないために使う */
  const tokenPointIndexById = new Map<string, number>()
  const toolCalls: ToolCallEvent[] = []
  const compactions: CompactionEvent[] = []
  const toolCallCountsByName: Record<string, number> = {}
  const toolErrorCountsByName: Record<string, number> = {}
  const toolOutputCharsByName: Record<string, number> = {}
  const mcpCallCountsByServer: Record<string, number> = {}
  const skillCallCounts: Record<string, number> = {}
  const subagentCallCounts: Record<string, number> = {}
  const effortCounts: Record<string, number> = {}

  let startedAt: string | null = null
  let endedAt: string | null = null
  let cwd: string | null = null
  let version: string | null = null
  let firstUserMessageExcerpt: string | null = null
  let sidechainToolCallCount = 0
  let interruptedToolCallCount = 0
  let hookErrorCount = 0
  let userMessageCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreationTokens = 0

  const rl = readline.createInterface({ input: createReadStream(filePath, "utf-8") })

  for await (const line of rl) {
    if (!line.trim()) continue
    let obj: RawLine
    try {
      obj = JSON.parse(line) as RawLine
    } catch {
      continue
    }

    if (obj.timestamp) {
      if (!startedAt) startedAt = obj.timestamp
      endedAt = obj.timestamp
    }
    if (!cwd && obj.cwd) cwd = obj.cwd
    if (!version && obj.version) version = obj.version

    if (obj.type === "assistant" && obj.message) {
      const usage = obj.message.usage
      if (usage) {
        const inputTokens = usage.input_tokens ?? 0
        const outputTokens = usage.output_tokens ?? 0
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0
        const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
        const messageId = typeof obj.message.id === "string" && obj.message.id ? obj.message.id : null
        const seenIndex = messageId !== null ? tokenPointIndexById.get(messageId) : undefined
        if (seenIndex !== undefined) {
          // 同じ応答の続きの行。usageが違うときは、出力が最大の行を採る(合計はその差分だけ直す)
          const seen = tokenPoints[seenIndex]
          if (outputTokens > seen.outputTokens) {
            totalInputTokens += inputTokens - seen.inputTokens
            totalOutputTokens += outputTokens - seen.outputTokens
            totalCacheReadTokens += cacheReadTokens - seen.cacheReadTokens
            totalCacheCreationTokens += cacheCreationTokens - seen.cacheCreationTokens
            tokenPoints[seenIndex] = { ...seen, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
          }
        } else {
          totalInputTokens += inputTokens
          totalOutputTokens += outputTokens
          totalCacheReadTokens += cacheReadTokens
          totalCacheCreationTokens += cacheCreationTokens
          const effort = obj.effort ?? null
          if (effort) effortCounts[effort] = (effortCounts[effort] ?? 0) + 1
          if (messageId !== null) tokenPointIndexById.set(messageId, tokenPoints.length)
          tokenPoints.push({
            turnIndex: tokenPoints.length,
            timestamp: obj.timestamp ?? "",
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            effort,
          })
        }
      }

      const content = Array.isArray(obj.message.content) ? obj.message.content : []
      for (const block of content) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolNameById.set(block.id, block.name)
          toolCallCountsByName[block.name] = (toolCallCountsByName[block.name] ?? 0) + 1
          if (obj.isSidechain) sidechainToolCallCount++

          const mcpServer = parseMcpServer(block.name)
          if (mcpServer) {
            mcpCallCountsByServer[mcpServer] = (mcpCallCountsByServer[mcpServer] ?? 0) + 1
          }

          const input =
            block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : null
          let skillName: string | null = null
          let subagentType: string | null = null
          if (block.name === "Skill" && input && typeof input.skill === "string") {
            skillName = input.skill
            skillCallCounts[skillName] = (skillCallCounts[skillName] ?? 0) + 1
          }
          if (block.name === "Agent" && input && typeof input.subagent_type === "string") {
            subagentType = input.subagent_type
            subagentCallCounts[subagentType] = (subagentCallCounts[subagentType] ?? 0) + 1
          }

          const event: ToolCallEvent = {
            turnIndex: tokenPoints.length > 0 ? tokenPoints.length - 1 : 0,
            timestamp: obj.timestamp ?? "",
            name: block.name,
            isError: false,
            isSidechain: obj.isSidechain ?? false,
            outputChars: 0,
            mcpServer,
            skillName,
            subagentType,
          }
          toolCalls.push(event)
          toolCallById.set(block.id, event)
        }
      }
    }

    if (obj.type === "user") {
      const content = Array.isArray(obj.message?.content) ? obj.message.content : []
      let hasToolResult = false
      for (const block of content) {
        if (block.type === "tool_result") {
          hasToolResult = true
          if (block.tool_use_id) {
            const name = toolNameById.get(block.tool_use_id)
            if (block.is_error && name) {
              toolErrorCountsByName[name] = (toolErrorCountsByName[name] ?? 0) + 1
            }
            const event = toolCallById.get(block.tool_use_id)
            if (event) {
              if (block.is_error) event.isError = true
              const chars = contentLength(block.content)
              event.outputChars = chars
              if (name) toolOutputCharsByName[name] = (toolOutputCharsByName[name] ?? 0) + chars
            }
          }
        }
      }
      if (!hasToolResult) {
        userMessageCount++
        if (userMessageCount === 1) firstUserMessageExcerpt = buildExcerpt(obj.message?.content)
      }
      if (obj.toolUseResult?.interrupted === true) interruptedToolCallCount++
    }

    if (obj.type === "system") {
      if (obj.subtype === "compact_boundary" && obj.compactMetadata) {
        compactions.push({
          timestamp: obj.timestamp ?? "",
          trigger: obj.compactMetadata.trigger ?? "unknown",
          preTokens: obj.compactMetadata.preTokens ?? 0,
          durationMs: obj.compactMetadata.durationMs ?? 0,
        })
      }
      if (Array.isArray(obj.hookErrors) && obj.hookErrors.length > 0) {
        hookErrorCount++
      }
    }
  }

  const toolErrorCount = Object.values(toolErrorCountsByName).reduce((a, b) => a + b, 0)
  const mcpToolCallCount = Object.values(mcpCallCountsByServer).reduce((a, b) => a + b, 0)
  const skillCallCount = Object.values(skillCallCounts).reduce((a, b) => a + b, 0)
  const totalToolOutputChars = Object.values(toolOutputCharsByName).reduce((a, b) => a + b, 0)
  const subagentCallCount = Object.values(subagentCallCounts).reduce((a, b) => a + b, 0)
  const stat = await fs.stat(filePath)

  const summary: SessionSummary = {
    sessionId: path.basename(filePath, ".jsonl"),
    startedAt,
    endedAt,
    turnCount: tokenPoints.length,
    toolCallCount: toolCalls.length,
    toolErrorCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    compactionCount: compactions.length,
    cwd,
    version,
    sizeBytes: stat.size,
    mcpToolCallCount,
    skillCallCount,
    totalToolOutputChars,
    userMessageCount,
    interruptedToolCallCount,
    hookErrorCount,
    subagentCallCount,
    firstUserMessageExcerpt,
    skillNames: Object.keys(skillCallCounts).sort(),
  }

  return {
    summary,
    tokenPoints,
    compactions,
    toolCallCountsByName,
    toolErrorCountsByName,
    toolOutputCharsByName,
    mcpCallCountsByServer,
    skillCallCounts,
    subagentCallCounts,
    effortCounts,
    sidechainToolCallCount,
    interruptedToolCallCount,
    hookErrorCount,
    userMessageCount,
  }
}

export async function listSessionProjects(): Promise<SessionProjectSummary[]> {
  const root = getClaudeProjectsRoot()
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw new FileIOError(`${root} の読み込みに失敗しました: ${String(err)}`)
  }

  const dirNames = dirents.filter((d) => d.isDirectory()).map((d) => d.name)

  const summaries = await Promise.all(
    dirNames.map(async (dirName): Promise<SessionProjectSummary | null> => {
      const dirPath = path.join(root, dirName)
      let files: string[]
      try {
        files = (await fs.readdir(dirPath)).filter((f) => f.endsWith(".jsonl"))
      } catch {
        return null
      }
      if (files.length === 0) return null

      const stats = await Promise.all(files.map((f) => fs.stat(path.join(dirPath, f))))
      const lastActivityMs = Math.max(...stats.map((s) => s.mtimeMs))

      return {
        dirName,
        sessionCount: files.length,
        lastActivityAt: new Date(lastActivityMs).toISOString(),
      }
    })
  )

  return summaries
    .filter((s): s is SessionProjectSummary => s !== null)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
}

export async function listSessions(dirName: string): Promise<SessionSummary[]> {
  const dirPath = path.join(getClaudeProjectsRoot(), dirName)
  let files: string[]
  try {
    files = (await fs.readdir(dirPath)).filter((f) => f.endsWith(".jsonl"))
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw new FileIOError(`${dirPath} の読み込みに失敗しました: ${String(err)}`)
  }

  const summaries = await Promise.all(
    files.map(async (file) => {
      const metrics = await parseSessionFile(path.join(dirPath, file))
      return metrics.summary
    })
  )

  return summaries.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
}

export async function getSessionMetrics(dirName: string, sessionId: string): Promise<SessionMetrics> {
  const filePath = path.join(getClaudeProjectsRoot(), dirName, `${sessionId}.jsonl`)
  try {
    await fs.access(filePath)
  } catch {
    throw new NotFoundError("セッションが見つかりません")
  }
  return parseSessionFile(filePath)
}
