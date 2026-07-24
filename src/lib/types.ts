export type RuleCategory = string

/**
 * CLAUDE.md の `## 見出し` セクションから直接パースされるルール。
 * id は読み込みのたびに再構築される一時的な識別子（見出し+出現順）で、永続IDではない。
 * created_at/updated_at は Markdown 本文からは追跡できないため保持しない。
 */
export interface Rule {
  id: string
  category: RuleCategory
  content: string
  enabled: boolean
}

/**
 * `.claude/skills/<dirName>/SKILL.md` から読み込むスキル定義。
 * dirName はディレクトリ名（API操作時の識別子）、name/description/argumentSchema は
 * YAML frontmatter 由来、body はfrontmatter以降のMarkdown本文。
 */
export interface SkillMeta {
  dirName: string
  name: string
  description: string
  argumentSchema?: unknown
  body: string
}

export interface TradeOff {
  option_a: string
  option_b: string
}

/**
 * AI社長が追加した専門エージェント1件。role/reason_for_assignmentは
 * 「オーナー→AI社長→専門エージェント」の最大2階層ガードレールの一部として
 * アサイン理由の明記を前提とする。既存ログとの後方互換のためoptional。
 */
export interface AssignedAgent {
  role: string
  reason_for_assignment: string
}

/** 試行錯誤・リトライの1ステップ。ツール実行エラーや自律修正の過程を記録する */
export interface TrialStep {
  step: number
  action: string
  result: "success" | "error" | "retry"
  note: string
}

export interface AgentsDiscussion {
  consensus_rate: number
  conflict_point: string
  trade_offs: TradeOff[]
  assigned_agents?: AssignedAgent[]
  trial_process?: TrialStep[]
}

export interface UserIntervention {
  step: number
  user_input: string
  cause_analysis: string
}

export interface SuggestedNewRule {
  category: string
  content: string
}

export type ExecutionLogStatus = "completed" | "in_progress" | "failed"

export interface ExecutionLogEntry {
  task_id: string
  task_name: string
  executed_at: string
  status?: ExecutionLogStatus
  one_shot_score: number
  summary: string
  agents_discussion: AgentsDiscussion
  user_interventions: UserIntervention[]
  next_golden_prompt: string
  suggested_new_rules: SuggestedNewRule[]
}

export interface ExecutionLogFile {
  logs: ExecutionLogEntry[]
}

export interface ProjectConfig {
  id: string
  name: string
  path: string
}

export interface ProjectsFile {
  projects: ProjectConfig[]
  selectedProjectId: string | null
}

export interface ApiError {
  error: string
}

/**
 * `.claude/projects/<encoded-path>/memory/*.md` から読み込むAIメモリ。
 * dirName はエンコードされたプロジェクトパス。完全な逆変換ができない場合があるため、
 * 元のファイルシステムパスへの変換は行わずエンコード名をそのまま識別子として扱う。
 */
export interface MemoryProject {
  dirName: string
  entryCount: number
}

export interface MemoryEntry {
  fileName: string
  name: string
  description: string
  type: string
  body: string
}

/** `.claude/tasks/<sessionId>/*.json` から読み込むタスク実行履歴（TaskCreate/TaskUpdateの実データ） */
export interface TaskRecord {
  id: string
  subject: string
  description: string
  activeForm?: string
  status: "pending" | "in_progress" | "completed" | "deleted" | string
  blocks: string[]
  blockedBy: string[]
}

export interface TaskSession {
  sessionId: string
  tasks: TaskRecord[]
}

/** `.claude/settings.json` の読み取り専用ビュー（未知のフィールドも raw として保持） */
export interface SettingsView {
  raw: Record<string, unknown>
}

/** `.claude/backups/*.backup.*` の一覧 */
export interface BackupEntry {
  fileName: string
  timestampMs: number | null
  sizeBytes: number
}

/** `.claude/plugins/blocklist.json` */
export interface BlockedPlugin {
  plugin: string
  added_at: string
  reason: string
  text: string
}

/**
 * 他PCへの移行用エクスポートバンドル。ルール(CLAUDE.md)とスキル(SKILL.md)のみを対象とし、
 * settings.jsonの環境変数など個人環境依存の設定は意図的に含めない。
 */
export interface ExportedRule {
  category: string
  content: string
  enabled: boolean
}

export interface ExportedSkill {
  dirName: string
  name: string
  description: string
  argumentSchema?: unknown
  body: string
}

export interface ExportBundle {
  version: 1
  exportedAt: string
  sourceProjectName: string
  rules: ExportedRule[]
  skills: ExportedSkill[]
}

/** インポート差分プレビューの1項目 */
export type ImportItemStatus = "new" | "changed" | "unchanged" | "invalid"

export interface ImportDiffItem {
  kind: "rule" | "skill"
  key: string
  status: ImportItemStatus
  before: string | null
  after: string
}

export interface ImportDiffResult {
  items: ImportDiffItem[]
}

export interface ImportApplyResult {
  backups: string[]
}

/**
 * `~/.claude/projects/<dirName>/` 配下に `*.jsonl`（Claude Codeのセッション実行ログ）を
 * 持つプロジェクトディレクトリ。dirNameは元パスの独自エンコードで、メモリ機能と同様
 * 完全な逆変換はできないためそのまま識別子として扱う。
 */
export interface SessionProjectSummary {
  dirName: string
  sessionCount: number
  lastActivityAt: string | null
}

/** 1セッション（1つの`.jsonl`）の集計サマリー */
export interface SessionSummary {
  sessionId: string
  startedAt: string | null
  endedAt: string | null
  turnCount: number
  toolCallCount: number
  toolErrorCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  compactionCount: number
  cwd: string | null
  version: string | null
  sizeBytes: number
}

/** ターン（assistantメッセージ1件）ごとのトークン消費ポイント */
export interface TokenPoint {
  turnIndex: number
  timestamp: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  effort: string | null
}

/** ツール呼び出し1件（対応するtool_resultが来た時点でisError等が確定する） */
export interface ToolCallEvent {
  turnIndex: number
  timestamp: string
  name: string
  isError: boolean
  isSidechain: boolean
}

/** 自動コンパクション（コンテキスト圧縮）発生イベント */
export interface CompactionEvent {
  timestamp: string
  trigger: string
  preTokens: number
  durationMs: number
}

/** セッション詳細の全メトリクス */
export interface SessionMetrics {
  summary: SessionSummary
  tokenPoints: TokenPoint[]
  toolCalls: ToolCallEvent[]
  compactions: CompactionEvent[]
  toolCallCountsByName: Record<string, number>
  toolErrorCountsByName: Record<string, number>
  effortCounts: Record<string, number>
  sidechainToolCallCount: number
  interruptedToolCallCount: number
  hookErrorCount: number
  userMessageCount: number
}
