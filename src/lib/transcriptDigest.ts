import { promises as fs } from "fs"
import type {
  DesktopSessionMessaging,
  DesktopSessionTask,
  InstructionOrigin,
  TaskStatus,
} from "./desktopSessionTypes"
import { WRAP_UP_ACTIONS, approvalActionsOfLabel, kindFromWords, type WrapUpDigest } from "./needsActionKind"
import { isPeerMessage, peerBodyOf } from "./peerMessage"
import { cutAfterMask } from "./secretMask"
import { SEND_LIMIT, classifySendResult, isSendTool } from "./sessionMessaging"

/**
 * 会話ログ(`.jsonl`)から、セッション一覧に必要な少数の値だけを取り出す「要約(digest)」。
 *
 * - 会話本文は保持しない。保持するのは先頭60文字の抜粋、ステップ名(80文字まで)、数値、フラグのみ。
 *   例外は次にやる判断(⑬)に使う文だけ：最後のターンの wrap_up の ask とボタンの名前、結果を待っている質問の先頭の問いと
 *   選択肢の名前、プランの1行目、ツールの呼び出しの先頭40字(秘密らしい文字列は伏せる)。どれも上限で切る。
 * - 追記型のログなので、前回の読み取り位置(offset)から後ろだけを読み足せる。サイズが減っていたら呼び出し側が作り直す。
 * - 初回は末尾だけを読む「暫定の要約」で素早く返し、全体の読み込み(圧縮の回数・フェーズの正確な値)は呼び出し側が後から行う。
 */

export const INSTRUCTION_EXCERPT_CHARS = 60
/** 次にやる判断(⑬)の問いの文の上限。実データの ask は最大60字なので、ふつうは切らない */
export const QUESTION_MAX_CHARS = 1000
/** 答えの候補(ボタン・選択肢の名前)の1つの上限と、持つ数の上限 */
export const OPTION_MAX_CHARS = 60
const MAX_OPTIONS = 8
const MAX_SKILL_CALLS = 100
/** 許可を待つツールの呼び出しの先頭(⑬ D1。秘密らしい文字列を伏せてから切る) */
export const TOOL_PREVIEW_CHARS = 40
const STEP_MAX_CHARS = 80
const MAX_TASKS = 200
const MAX_PENDING = 64
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
  /** assistantのみ。この行で呼び出したツールの名前 */
  toolNames: string[]
  /** userのみ。この行が結果を返しているツールの名前(ツール結果の行でなければ null) */
  resultOf: string | null
}

/** 結果を待っているユーザーへの質問(AskUserQuestion)。先頭の問いの全文と、その選択肢の名前だけを持つ */
export interface PendingAsk {
  toolUseId: string | null
  question: string
  /** 1回の呼び出しの問いの数(先頭の1問を出し、残りは「ほか n問」) */
  count: number
  options: string[]
}

/** 結果を待っているツールの呼び出し(許可待ちの推定に使う)。ツール名と、秘密を伏せた入力の先頭40字だけ */
export interface PendingTool {
  toolUseId: string | null
  name: string
  preview: string
}

/** ターンの終わりを宣言するツール。呼ぶとタスクリストの残りは完了になる */
export const WRAP_UP_TOOL = "mcp__ccd_turn__wrap_up"
/** ユーザーの回答を待つツール。呼び出したまま止まっているのは、中断ではなく回答待ち */
export const ASK_USER_TOOLS = ["AskUserQuestion", "ExitPlanMode"]

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
  /**
   * context の値を記録した応答(メインスレッドの最後の、使用量のある assistant 行)の時刻。
   * プロンプトキャッシュはこの時刻から数えて切れるので、再開時にコンテキストを書き直すか(整理ページ)の判断に使う。
   * サブエージェントの行・API エラーの代替応答は含めない
   */
  lastAssistantAt: number | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  cwd: string | null
  title: string | null
  compactionCount: number
  lastCompactionAt: number | null
  tasks: DigestTask[] | null
  legacyNextId: number
  /** 結果が来るまで、TaskCreate のIDを仮の番号で持っているタスク(tool_use_id → タスク) */
  pendingCreates: Map<string, DigestTask>
  /** 直近のツール呼び出し(tool_use_id → ツール名)。ツール結果がどのツールのものかを知るために持つ */
  recentTools: Map<string, string>
  queued: number
  /** 人が書いた直近の指示 */
  latestHuman: DigestInstruction | null
  /** 発信元を問わない直近の入力 */
  latestInput: DigestInstruction | null
  /** 人が最後に入力してから、他のセッションへ送った回数(送信ツールの呼び出し。届かなかった分を含む)。人の入力で0に戻る */
  sendsSinceHuman: number
  /** うち、届かなかった送信の数(上限による分を含む)。人の入力で0に戻る */
  undeliveredSinceHuman: number
  /** 送信上限に達した旨の結果を受け取っていて、その後に人の入力が無い */
  sendLimitStopped: boolean
  /** 人の入力をこの要約の中で読んだか。false の間は、送信回数が実際より少ない可能性がある */
  humanSeen: boolean
  /**
   * 最後のターンの wrap_up の呼び出し(⑩ 要対応の種類の手がかり)。新しい入力(ターンの始まり)で null に戻る。
   * 保持する文は ask(全文。上限あり)とボタンの名前(label)だけ(⑬)。recap・ボタンの message は取り込まない
   */
  lastWrapUp: WrapUpDigest | null
  /** 結果を待っている AskUserQuestion(⑬)。結果が来るか、新しい入力で null に戻る */
  pendingAsk: PendingAsk | null
  /** 結果を待っている ExitPlanMode のプランの1行目(⑬)。結果が来るか、新しい入力で null に戻る */
  pendingPlan: { toolUseId: string | null; line: string } | null
  /** 結果を待っている、最後のツールの呼び出し(⑬)。結果が来るか、新しい入力で null に戻る */
  pendingTool: PendingTool | null
  /** スキルの呼び出し(関係性マップ ⑬ RM-6)。スキルの名前と時刻だけ。新しい順に最大100件 */
  skillCalls: Array<{ name: string; at: number | null }>
}

export function createDigest(): TranscriptDigest {
  return {
    complete: false,
    offset: 0,
    lastEventAt: null,
    lastRow: null,
    lastAssistantUuid: null,
    context: null,
    lastAssistantAt: null,
    model: null,
    effort: null,
    permissionMode: null,
    cwd: null,
    title: null,
    compactionCount: 0,
    lastCompactionAt: null,
    tasks: null,
    legacyNextId: 1,
    pendingCreates: new Map(),
    recentTools: new Map(),
    queued: 0,
    latestHuman: null,
    latestInput: null,
    sendsSinceHuman: 0,
    undeliveredSinceHuman: 0,
    sendLimitStopped: false,
    humanSeen: false,
    lastWrapUp: null,
    pendingAsk: null,
    pendingPlan: null,
    pendingTool: null,
    skillCalls: [],
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
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
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
  attachment?: { type?: string; content?: unknown; origin?: { kind?: unknown }; commandMode?: unknown; prompt?: unknown }
  compactMetadata?: { postTokens?: unknown }
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

/** 作業中に届いた入力の本文(文字列、または最初のtextブロック。画像だけなら空) */
function queuedPromptText(prompt: unknown): string {
  if (typeof prompt === "string") return prompt
  if (!Array.isArray(prompt)) return ""
  const block = (prompt as RawBlock[]).find((b) => b && b.type === "text" && typeof b.text === "string")
  return block?.text ?? ""
}

/**
 * attachment(`queued_command`)の発信元。セッションが作業中のときに届いた入力(人の入力・他セッションからのメッセージ・通知)は、
 * user の行ではなく、この attachment の行として記録される(同じ内容の user の行は後から書かれない)。
 * 発信元は `attachment.origin.kind` に入る。
 * - origin が無い行(確認できたのは通知の古い形式だけ)は、通知・システムの差し込み・他セッションからのメッセージの形なら人の入力にせず、
 *   それ以外の `commandMode: "prompt"` は、user の行の古い形式と同じく人の入力として扱う(数え直し漏れで10/10が戻らないほうを避ける)。
 */
export function queuedOriginOf(attachment: RawEntry["attachment"]): InstructionOrigin | null {
  if (!attachment || attachment.type !== "queued_command") return null
  const kind = attachment.origin?.kind
  if (kind === "human") return "human"
  if (kind === "peer") return "peer"
  if (kind === "task-notification") return "notification"
  if (typeof kind === "string") return "system"
  if (attachment.commandMode === "task-notification") return "notification"
  const text = queuedPromptText(attachment.prompt).trimStart()
  if (text.startsWith("<task-notification")) return "notification"
  if (isPeerMessage(text)) return "peer"
  if (SYSTEM_WRAPPER.test(text) || text.startsWith(CONTINUATION_MARK)) return "system"
  return attachment.commandMode === undefined || attachment.commandMode === "prompt" ? "human" : "system"
}

/** userの行から、ツール結果ではない発言の本文を取り出す。ツール結果の行は toolResults に結果のブロックを返す */
function userText(content: RawBlock[] | string | undefined): {
  text: string | null
  toolResults: RawBlock[]
} {
  if (typeof content === "string") return { text: content, toolResults: [] }
  if (!Array.isArray(content)) return { text: null, toolResults: [] }
  const toolResults = content.filter((b) => b.type === "tool_result")
  if (toolResults.length > 0) return { text: null, toolResults }
  const block = content.find((b) => b.type === "text" && typeof b.text === "string")
  return { text: block?.text ?? null, toolResults: [] }
}

/** ツール結果の本文(文字列、または text ブロックの配列)を1つの文字列にする */
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((b) => (b && typeof b === "object" && typeof (b as RawBlock).text === "string" ? (b as RawBlock).text : ""))
    .join("\n")
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

function applyLegacyTaskTool(
  d: TranscriptDigest,
  name: string,
  input: Record<string, unknown>,
  toolUseId: string | undefined
): void {
  if (name === "TaskCreate") {
    const subject = typeof input.subject === "string" ? input.subject : ""
    // 前の計画がすべて完了していたら、新しい計画の始まりとみなして一覧を作り直す。
    // タスクのIDは新しい一覧で1に戻るため、仮の番号も1から数え直す
    if (!d.tasks || d.tasks.every((t) => t.status === "completed")) {
      d.tasks = []
      d.legacyNextId = 1
    }
    // IDはツール結果の「Task #N created」で確定する。結果が来るまでは仮の番号を使う
    const task: DigestTask = { id: String(d.legacyNextId), content: makeExcerpt(subject, STEP_MAX_CHARS), status: "pending" }
    if (d.tasks.length < MAX_TASKS) d.tasks.push(task)
    d.legacyNextId++
    if (toolUseId) {
      d.pendingCreates.set(toolUseId, task)
      if (d.pendingCreates.size > MAX_PENDING) d.pendingCreates.delete(d.pendingCreates.keys().next().value as string)
    }
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

/** 他のセッションへの送信ツールの結果から、届かなかったこと・送信上限での停止を記録する */
function applySendResult(d: TranscriptDigest, block: RawBlock): void {
  const kind = classifySendResult(resultText(block.content))
  if (kind === "ok") return
  d.undeliveredSinceHuman++
  if (kind === "limit") d.sendLimitStopped = true
}

/** 人の入力が来たら、送信上限の数え直しと停止の解除 */
function resetSendLimit(d: TranscriptDigest): void {
  d.sendsSinceHuman = 0
  d.undeliveredSinceHuman = 0
  d.sendLimitStopped = false
  d.humanSeen = true
}

/** wrap_up はターンの終わりの宣言。完了していないステップはすべて完了として扱う */
function completeAllTasks(d: TranscriptDigest): void {
  if (!d.tasks) return
  for (const t of d.tasks) t.status = "completed"
}

/** TaskCreate の結果(`Task #N created successfully`)から、タスクのIDを確定する */
function resolveCreatedTaskId(d: TranscriptDigest, block: RawBlock): void {
  if (!block.tool_use_id) return
  const task = d.pendingCreates.get(block.tool_use_id)
  if (!task) return
  d.pendingCreates.delete(block.tool_use_id)
  const match = /Task #(\d+)/.exec(resultText(block.content))
  if (!match) return
  task.id = match[1]
  d.legacyNextId = Number(match[1]) + 1
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

/** 要約から、画面に出す送信回数の情報を作る */
export function messagingOf(d: TranscriptDigest): DesktopSessionMessaging {
  return {
    // 上限に達した旨の結果を受け取っていれば、末尾だけの要約で数え漏れがあっても、回数は上限に達している
    sent: d.sendLimitStopped ? SEND_LIMIT : Math.min(d.sendsSinceHuman, SEND_LIMIT),
    limit: SEND_LIMIT,
    stopped: d.sendLimitStopped,
    undelivered: d.undeliveredSinceHuman,
    exact: d.complete || d.humanSeen || d.sendLimitStopped,
  }
}

/**
 * 作業中に届いた入力。人の入力なら、user の行と同じく送信回数を数え直し、停止を解除する(上限で止まったあとに人が一言入力しても、
 * それが user の行にならず 10/10 のまま戻らなかった)。他セッション・通知・システムの入力では数え直さない。
 * 画像だけの入力は、本文が無いので最新の指示は更新しないが、人の入力なので数え直す。
 */
function applyQueuedCommand(d: TranscriptDigest, attachment: NonNullable<RawEntry["attachment"]>, at: number | null): void {
  if (queuedOriginOf(attachment) !== "human") return
  resetSendLimit(d)
  const text = queuedPromptText(attachment.prompt)
  if (SYSTEM_WRAPPER.test(text) || text.startsWith(CONTINUATION_MARK) || !text.trim()) return
  const instruction: DigestInstruction = { excerpt: makeExcerpt(text, INSTRUCTION_EXCERPT_CHARS), origin: "human", at }
  d.latestInput = instruction
  d.latestHuman = instruction
  startTurn(d)
}

/** 新しい入力でターンが始まる。前のターンの wrap_up と、結果を待っていた呼び出しは、もう当てはまらない */
function startTurn(d: TranscriptDigest): void {
  d.lastWrapUp = null
  d.pendingAsk = null
  d.pendingPlan = null
  d.pendingTool = null
}

/** ツールの結果が来たら、その呼び出しを「結果待ち」から外す */
function clearPending(d: TranscriptDigest, toolUseId: string): void {
  if (d.pendingAsk?.toolUseId === toolUseId) d.pendingAsk = null
  if (d.pendingPlan?.toolUseId === toolUseId) d.pendingPlan = null
  if (d.pendingTool?.toolUseId === toolUseId) d.pendingTool = null
}

/**
 * wrap_up の入力から、要対応の種類と次にやる判断(⑬)に使う値だけを取り出す。
 * 承認のボタンは、ボタンの名前(label)の文から決める(⑬ D6。実際のボタンに action のキーは無い)。古い形の action のキーも読む
 */
export function wrapUpDigestOf(input: Record<string, unknown>): WrapUpDigest {
  const ask = typeof input.ask === "string" && input.ask.trim() ? input.ask : null
  const allowed: readonly string[] = WRAP_UP_ACTIONS
  const buttons = Array.isArray(input.actions)
    ? input.actions.filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    : []
  const actions = new Set<string>()
  const labels: string[] = []
  for (const b of buttons) {
    if (typeof b.action === "string" && allowed.includes(b.action)) actions.add(b.action)
    if (typeof b.label === "string" && b.label.trim()) {
      for (const a of approvalActionsOfLabel(b.label)) actions.add(a)
      if (labels.length < MAX_OPTIONS) labels.push(cutAfterMask(b.label, OPTION_MAX_CHARS))
    }
  }
  return {
    askExcerpt: ask === null ? null : cutAfterMask(ask, INSTRUCTION_EXCERPT_CHARS),
    ask: ask === null ? null : cutAfterMask(ask, QUESTION_MAX_CHARS),
    askWordKind: kindFromWords(ask),
    actions: [...actions],
    labels,
    blocked: typeof input.blocked === "boolean" ? input.blocked : null,
  }
}

/** AskUserQuestion の入力から、先頭の問いの全文と選択肢の名前を取り出す。古い形(question だけ)も読む */
export function pendingAskOf(input: Record<string, unknown>, toolUseId: string | null): PendingAsk | null {
  const questions = Array.isArray(input.questions)
    ? input.questions.filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
    : []
  const first = questions[0]
  const text = typeof first?.question === "string" ? first.question : typeof input.question === "string" ? input.question : ""
  if (!text.trim()) return null
  const options = Array.isArray(first?.options)
    ? first.options
        .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>).label : typeof o === "string" ? o : undefined))
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .slice(0, MAX_OPTIONS)
        .map((l) => cutAfterMask(l, OPTION_MAX_CHARS))
    : []
  return { toolUseId, question: cutAfterMask(text, QUESTION_MAX_CHARS), count: Math.max(1, questions.length), options }
}

/** ツールの入力の先頭(許可待ちの推定で出す)。コマンド・ファイル・URL の順に探し、秘密らしい文字列を伏せてから40字で切る */
export function toolPreviewOf(input: Record<string, unknown> | null): string {
  if (!input) return ""
  for (const key of ["command", "file_path", "path", "url", "pattern", "query"]) {
    const v = input[key]
    if (typeof v === "string" && v.trim()) return cutAfterMask(v, TOOL_PREVIEW_CHARS)
  }
  const first = Object.values(input).find((v): v is string => typeof v === "string" && v.trim().length > 0)
  return first ? cutAfterMask(first, TOOL_PREVIEW_CHARS) : ""
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
      const { text, toolResults } = userText(entry.message?.content)
      const interrupted = text !== null && text.startsWith(INTERRUPT_MARK)
      let resultOf: string | null = null
      for (const result of toolResults) {
        if (result.tool_use_id) {
          const toolName = d.recentTools.get(result.tool_use_id)
          resultOf = toolName ?? resultOf
          if (toolName && isSendTool(toolName)) applySendResult(d, result)
          clearPending(d, result.tool_use_id)
        }
        resolveCreatedTaskId(d, result)
      }
      d.lastRow = { role: "user", stopReason: null, interrupted, at, toolNames: [], resultOf }
      if (toolResults.length > 0 || entry.isCompactSummary || text === null || interrupted) return
      const origin = originOf(entry)
      // 他セッションからの入力(peer)は、システムが差し込む形式のため isMeta が付く。peer だけは指示として扱う
      if (entry.isMeta && origin !== "peer") return
      if (origin === "human" && (SYSTEM_WRAPPER.test(text) || text.startsWith(CONTINUATION_MARK))) return
      // 他セッションからの入力は、前置きの一文・包みのタグ・末尾の署名を除いた本文を、抜粋にする(組織図の指示の要約と同じ関数)
      const body = origin === "peer" ? peerBodyOf(text) : text
      const instruction: DigestInstruction = {
        excerpt: origin === "notification" ? "" : makeExcerpt(body, INSTRUCTION_EXCERPT_CHARS),
        origin,
        at,
      }
      d.latestInput = instruction
      // 新しい入力でターンが始まる。前のターンの wrap_up と、結果待ちの呼び出しは、もう当てはまらない
      startTurn(d)
      if (origin === "human") {
        d.latestHuman = instruction
        resetSendLimit(d)
      }
      return
    }
    case "assistant": {
      if (entry.isSidechain) return
      const message = entry.message
      const stopReason = message?.stop_reason ?? null
      const toolNames: string[] = []
      d.lastRow = { role: "assistant", stopReason, interrupted: false, at, toolNames, resultOf: null }
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
        if (tokens > 0) {
          d.context = { tokens, model: typeof message?.model === "string" ? message.model : d.model }
          if (at !== null) d.lastAssistantAt = at
        }
      }
      if (Array.isArray(message?.content)) {
        for (const block of message.content) {
          if (block.type !== "tool_use" || typeof block.name !== "string") continue
          toolNames.push(block.name)
          // 1回の応答が複数の行に分かれて書かれても、同じ呼び出しを2回数えない
          if (isSendTool(block.name) && !(typeof block.id === "string" && d.recentTools.has(block.id))) {
            d.sendsSinceHuman++
          }
          if (typeof block.id === "string") {
            d.recentTools.set(block.id, block.name)
            if (d.recentTools.size > MAX_PENDING) d.recentTools.delete(d.recentTools.keys().next().value as string)
          }
          if (block.name === WRAP_UP_TOOL) completeAllTasks(d)
          const input =
            block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : null
          if (block.name === "Skill") {
            const skill = typeof input?.skill === "string" ? input.skill : typeof input?.command === "string" ? input.command : ""
            if (skill.trim()) {
              d.skillCalls.push({ name: makeExcerpt(skill, OPTION_MAX_CHARS), at })
              if (d.skillCalls.length > MAX_SKILL_CALLS) d.skillCalls.shift()
            }
          }
          if (block.name === WRAP_UP_TOOL) d.lastWrapUp = wrapUpDigestOf(input ?? {})
          else {
            // 次にやる判断(⑬)：結果を待っている呼び出し。質問とプランは問いの文に、ほかは許可待ちの推定に使う
            const toolUseId = typeof block.id === "string" ? block.id : null
            d.pendingTool = { toolUseId, name: block.name, preview: toolPreviewOf(input) }
            if (block.name === "AskUserQuestion") d.pendingAsk = pendingAskOf(input ?? {}, toolUseId)
            if (block.name === "ExitPlanMode") {
              const plan = typeof input?.plan === "string" ? input.plan : ""
              const line = plan.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0)
              d.pendingPlan = line ? { toolUseId, line: cutAfterMask(line, QUESTION_MAX_CHARS) } : null
            }
          }
          if (!input) continue
          if (block.name === "mcp__ccd_turn__update_plan") applyPlanInput(d, input)
          else if (block.name === "TaskCreate" || block.name === "TaskUpdate") {
            applyLegacyTaskTool(d, block.name, input, block.id)
          }
        }
      }
      return
    }
    case "system": {
      if (entry.subtype === "compact_boundary") {
        d.compactionCount++
        d.lastCompactionAt = at
        // 圧縮の直後は、次の応答が来るまで使用量が分からない。圧縮後の量を仮の値にする
        const postTokens = entry.compactMetadata?.postTokens
        if (typeof postTokens === "number" && postTokens > 0) d.context = { tokens: postTokens, model: d.model }
      }
      return
    }
    case "attachment": {
      if (entry.attachment?.type === "task_reminder") applyTaskReminder(d, entry.attachment.content)
      else if (entry.attachment?.type === "queued_command" && !entry.isSidechain) applyQueuedCommand(d, entry.attachment, at)
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
  // 作業中に届いた入力(人・他セッション・通知)は attachment の行になる。type の指定が無いので、attachment の種類で拾う
  '"queued_command"',
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
