/**
 * Claude Desktop のセッション一覧のテスト用に、合成(架空)のデータを作る補助関数。
 * 実際のセッション名・ID・パスは使わない(検討書 S7)。IDはすべて連番から作った架空の値。
 *
 * 秘密情報の流出テスト用に、返してはいけない項目(システムプロンプトの写し・MCP設定・トークン等)へ
 * SENTINEL を入れる。APIの応答に SENTINEL が現れたらテストが失敗する。
 */
import { promises as fs } from "fs"
import path from "path"

export const SENTINEL = "SENTINEL-DO-NOT-LEAK-7f3a9c"

/** blocked のセッションの needs_action の先頭(画面に出る部分) */
export const NEEDS_ACTION_HEAD = "対応が必要: 本番環境への反映を承認してください"

export const FAKE_ACCOUNT = "00000000-0000-4000-8000-0000000000a1"
export const FAKE_ORG = "00000000-0000-4000-8000-0000000000b1"

/** 架空のセッションID(`local_<uuid>`)。n から決定的に作る */
export function fakeSessionId(n: number): string {
  return `local_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

/** 架空の会話ログID */
export function fakeCliId(n: number): string {
  return `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`
}

export function fakeUuid(n: number): string {
  return `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`
}

export interface MetaOptions {
  n: number
  title?: string
  cwd?: string
  model?: string
  effort?: string
  permissionMode?: string
  isArchived?: boolean
  category?: "blocked" | "review_ready" | "completed" | null
  /** ターン後の要約が対応する assistant の uuid */
  summaryFor?: string
  lastAssistantUuid?: string
  lastActivityAt?: number
  createdAt?: number
  completedTurns?: number
  error?: string
  errorAt?: number
  scheduledTaskId?: string
  noCliSessionId?: boolean
}

/** Desktop の local_*.json に近い形のメタデータ。返してはいけない項目には SENTINEL を入れる */
export function makeMeta(o: MetaOptions): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    sessionId: fakeSessionId(o.n),
    cwd: o.cwd ?? `C:\\sample\\project-${o.n}`,
    originCwd: o.cwd ?? `C:\\sample\\project-${o.n}`,
    createdAt: o.createdAt ?? 1_700_000_000_000,
    lastActivityAt: o.lastActivityAt ?? 1_700_000_100_000,
    model: o.model ?? "claude-sonnet-5-5",
    effort: o.effort ?? "medium",
    isArchived: o.isArchived ?? false,
    title: o.title ?? `サンプルセッション${o.n}`,
    permissionMode: o.permissionMode ?? "acceptEdits",
    completedTurns: o.completedTurns ?? 3,
    // ---- 返してはいけない項目(S3) ----
    enabledMcpTools: [`mcp__fake__tool_${SENTINEL}`],
    remoteMcpServersConfig: { fake: { url: `https://example.invalid/${SENTINEL}` } },
    promptAppendSnapshot: `system prompt ${SENTINEL}`,
    toolSurfaceSnapshot: { tools: [SENTINEL] },
    sessionPermissionUpdates: [{ rule: SENTINEL }],
    alwaysAllowedReasons: [SENTINEL],
  }
  if (!o.noCliSessionId) meta.cliSessionId = fakeCliId(o.n)
  if (o.category !== undefined && o.category !== null) {
    meta.postTurnSummary = {
      status_category: o.category,
      status_detail: `detail ${SENTINEL}`,
      // 先頭60文字だけが表示される。60文字を超えた末尾に SENTINEL を置き、切り詰められることを確かめる
      needs_action: o.category === "blocked" ? `${NEEDS_ACTION_HEAD}${"あ".repeat(80)}${SENTINEL}` : "",
      summarizes_uuid: o.summaryFor ?? fakeUuid(o.n),
    }
    meta.postTurnSummaryFor = o.summaryFor ?? fakeUuid(o.n)
    meta.turnWrapUp = { description: `wrap ${SENTINEL}` }
  }
  if (o.lastAssistantUuid) meta.lastAssistantUuid = o.lastAssistantUuid
  if (o.error) meta.error = o.error
  if (o.errorAt !== undefined) meta.errorAt = o.errorAt
  if (o.scheduledTaskId) meta.scheduledTaskId = o.scheduledTaskId
  return meta
}

// ---------------------------------------------------------------------------
// 会話ログの行

export interface RowOptions {
  ts?: string
  uuid?: string
  sidechain?: boolean
}

const BASE_TS = Date.parse("2026-01-01T00:00:00.000Z")
export const tsAt = (offsetSec: number): string => new Date(BASE_TS + offsetSec * 1000).toISOString()

export function humanRow(text: string, o: RowOptions & { origin?: Record<string, unknown>; turnOrigin?: string } = {}) {
  return {
    type: "user",
    uuid: o.uuid,
    timestamp: o.ts ?? tsAt(0),
    isSidechain: o.sidechain ?? false,
    origin: o.origin ?? { kind: "human" },
    ...(o.turnOrigin ? { turnOrigin: o.turnOrigin } : {}),
    permissionMode: "acceptEdits",
    cwd: "C:\\sample\\project-1",
    message: { role: "user", content: text },
  }
}

/** 作業中に届いた入力の行(user の行ではなく queued_command の attachment)。origin を省くと、発信元の記録が無い形式 */
export function queuedCommandRow(
  prompt: string | Array<Record<string, unknown>>,
  o: RowOptions & { origin?: Record<string, unknown> | null; commandMode?: string } = {}
) {
  return {
    type: "attachment",
    timestamp: o.ts ?? tsAt(0),
    isSidechain: o.sidechain ?? false,
    attachment: {
      type: "queued_command",
      prompt,
      commandMode: o.commandMode ?? "prompt",
      ...(o.origin === null ? {} : { origin: o.origin ?? { kind: "human" } }),
    },
  }
}

export function toolResultRow(o: RowOptions & { toolUseId?: string; text?: string; asBlocks?: boolean } = {}) {
  const text = o.text ?? "ok"
  return {
    type: "user",
    timestamp: o.ts ?? tsAt(0),
    isSidechain: o.sidechain ?? false,
    message: {
      role: "user",
      // 実際のログは、結果が text ブロックの配列になっているものと、文字列のものがある
      content: [
        { type: "tool_result", tool_use_id: o.toolUseId ?? "toolu_fake", content: o.asBlocks ? [{ type: "text", text }] : text },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 他のセッションへの送信(送信回数・送信上限のテスト用)。文言は架空で、判定に使う語(Not delivered / 10 times 等)だけを含む

export const SYNTHETIC_SEND_OK = "Delivered to synthetic-target"
export const SYNTHETIC_SEND_LIMIT = "Not delivered: synthetic notice. The limit of 10 times has been reached"
export const SYNTHETIC_SEND_UNREACHABLE = "No agent named synthetic-target is reachable"

/** 他のセッションへ送るツールの呼び出し。n は呼び出しの通し番号(結果の行と対応づける) */
export function sendRow(n: number, o: RowOptions & { tool?: string } = {}) {
  return assistantRow({
    ...o,
    stop: "tool_use",
    tools: [{ name: o.tool ?? "SendMessage", id: `toolu_send_${n}`, input: { to: "synthetic-target", message: "synthetic" } }],
  })
}

/** n 番目の送信の結果の行 */
export function sendResultRow(n: number, text: string = SYNTHETIC_SEND_OK, o: RowOptions & { asBlocks?: boolean } = {}) {
  return toolResultRow({ ...o, toolUseId: `toolu_send_${n}`, text })
}

export interface AssistantOptions extends RowOptions {
  stop?: "tool_use" | "end_turn" | "stop_sequence"
  input?: number
  cacheRead?: number
  cacheCreation?: number
  model?: string
  effort?: string
  tools?: Array<{ name: string; input: Record<string, unknown>; id?: string }>
  text?: string
  apiError?: boolean
}

export function assistantRow(o: AssistantOptions = {}) {
  const content: Array<Record<string, unknown>> = []
  if (o.text) content.push({ type: "text", text: o.text })
  for (const tool of o.tools ?? []) content.push({ type: "tool_use", id: tool.id ?? "toolu_fake", name: tool.name, input: tool.input })
  return {
    type: "assistant",
    uuid: o.uuid,
    timestamp: o.ts ?? tsAt(0),
    isSidechain: o.sidechain ?? false,
    effort: o.effort,
    ...(o.apiError ? { isApiErrorMessage: true } : {}),
    message: {
      model: o.model ?? "claude-sonnet-5-5",
      role: "assistant",
      stop_reason: o.stop ?? "end_turn",
      usage: {
        input_tokens: o.input ?? 10,
        output_tokens: 20,
        cache_read_input_tokens: o.cacheRead ?? 0,
        cache_creation_input_tokens: o.cacheCreation ?? 0,
      },
      content,
    },
  }
}

export const compactRow = (ts = tsAt(0)) => ({
  type: "system",
  subtype: "compact_boundary",
  timestamp: ts,
  compactMetadata: { trigger: "auto", preTokens: 1000, postTokens: 100 },
})

export const queueRow = (operation: "enqueue" | "dequeue" | "remove") => ({
  type: "queue-operation",
  operation,
  timestamp: tsAt(0),
  content: "x",
})

export const planRow = (input: Record<string, unknown>, o: RowOptions = {}) =>
  assistantRow({ ...o, stop: "tool_use", tools: [{ name: "mcp__ccd_turn__update_plan", input }] })

export function toJsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// ディレクトリ

export interface DesktopFixture {
  dataDir: string
  projectsRoot: string
  sessionsDir: string
}

/** `<root>/data`(Desktopのデータフォルダ)と `<root>/projects`(会話ログのルート)の骨組みを作る */
export async function makeDesktopFixture(root: string): Promise<DesktopFixture> {
  const dataDir = path.join(root, "data")
  const sessionsDir = path.join(dataDir, "claude-code-sessions", FAKE_ACCOUNT, FAKE_ORG)
  const projectsRoot = path.join(root, "projects")
  await fs.mkdir(sessionsDir, { recursive: true })
  await fs.mkdir(projectsRoot, { recursive: true })
  return { dataDir, projectsRoot, sessionsDir }
}

export async function writeMeta(fx: DesktopFixture, meta: Record<string, unknown>): Promise<string> {
  const file = path.join(fx.sessionsDir, `${meta.sessionId as string}.json`)
  await fs.writeFile(file, JSON.stringify(meta), "utf-8")
  return file
}

export async function writeTranscript(
  fx: DesktopFixture,
  cliId: string,
  rows: unknown[],
  projectDir = "-sample-project-1"
): Promise<string> {
  const dir = path.join(fx.projectsRoot, projectDir)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${cliId}.jsonl`)
  await fs.writeFile(file, toJsonl(rows), "utf-8")
  return file
}

/** claude_desktop_config.json(グループとピン留め + 返してはいけないMCP設定)と、読んではいけない config.json */
export async function writeDesktopConfigs(
  fx: DesktopFixture,
  opts: {
    groups?: Array<{ id: string; name: string; order: number }>
    assignments?: Record<string, string>
    starred?: string[]
  } = {}
): Promise<void> {
  const scope = `${FAKE_ACCOUNT}/${FAKE_ORG}`
  const sections = [
    { id: "pinned", kind: "pinned", name: "ピン留め", order: 0 },
    ...(opts.groups ?? []).map((g) => ({ id: g.id, kind: "manual", name: g.name, order: g.order, members: [] })),
    { id: "sessions", kind: "sessions", name: "セッション", order: 99 },
  ]
  const config = {
    mcpServers: { fake: { command: "fake", env: { FAKE_API_KEY: SENTINEL } } },
    preferences: {
      epitaxyPrefs: {
        "dframe-code-sections": { [scope]: { sections } },
        "dframe-group-scopes": {
          [scope]: {
            groups: (opts.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
            assignments: opts.assignments ?? {},
          },
        },
        "starred-local-code-sessions": opts.starred ?? [],
        "dframe-local-slice": { pinnedOrder: [] },
        "unrelated-pref": { secret: SENTINEL },
      },
    },
  }
  await fs.writeFile(path.join(fx.dataDir, "claude_desktop_config.json"), JSON.stringify(config), "utf-8")
  // OAuthトークンを含む config.json は、読んではいけない(S1)
  await fs.writeFile(
    path.join(fx.dataDir, "config.json"),
    JSON.stringify({ oauth: { accessToken: SENTINEL, refreshToken: SENTINEL } }),
    "utf-8"
  )
}

/** ファイルの更新時刻を now からの相対秒で設定する */
export async function touch(file: string, nowMs: number, agoSec: number): Promise<void> {
  const t = new Date(nowMs - agoSec * 1000)
  await fs.utimes(file, t, t)
}
