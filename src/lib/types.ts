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
 * `rule-optimizer`スキルが生成する`rule_refactor_proposal.json`の1件の提案。
 * categoryで対象ルールを照合する（Rule.idは位置依存の一時的な識別子のため使用しない）。
 * - modify: sourceCategoriesは1件のみでtargetCategoryと同じ値（既存ルールの内容修正）
 * - merge: sourceCategoriesが複数件（統合対象の見出し名一覧）、targetCategoryは統合後の見出し名
 * - remove: sourceCategories/targetCategoryは削除対象の見出し名、contentはnull
 */
export interface RuleProposal {
  type: "modify" | "merge" | "remove"
  targetCategory: string
  sourceCategories: string[]
  content: string | null
  reason: string
}

export interface RuleRefactorProposalFile {
  version: 1
  generatedAt: string
  proposals: RuleProposal[]
}

export type RuleRefactorItemStatus = "ready" | "stale"

/** 提案1件と現在のCLAUDE.mdを突き合わせたdiffプレビュー用の1項目 */
export interface RuleRefactorDiffItem {
  index: number
  type: RuleProposal["type"]
  targetCategory: string
  sourceCategories: string[]
  reason: string
  status: RuleRefactorItemStatus
  before: string | null
  after: string | null
  /** status: "stale"の場合のみ、適用できない理由 */
  staleReason?: string
}

export interface RuleRefactorDiffResult {
  /** 提案ファイルが存在しない場合はnull */
  generatedAt: string | null
  items: RuleRefactorDiffItem[]
}

export interface RuleRefactorApplyResult {
  backups: string[]
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
  category?: string
  /** ディレクトリ名（呼び出しコマンド）とは別の、一覧で見出しとして表示する人間向けの名前 */
  title?: string
  /**
   * このスキルのプロンプト設計が想定しているモデル（自由記述。例:"Opus 5"）。
   * Claude Code側でSKILL.mdのfrontmatterキー`model`が予約語として解釈される可能性を避けるため、
   * ダッシュボード専用メタデータとして`target-model`という別名を使う。
   */
  targetModel?: string
  body: string
  /** references/scripts/evals サブディレクトリの有無（表示専用、frontmatterには保存しない） */
  hasReferences?: boolean
  hasScripts?: boolean
  hasEvals?: boolean
  /** SKILL.mdの作成日時。frontmatterの`created`に一度だけ保存し、以後の編集では変更しない */
  createdAt?: string
  /** SKILL.mdの最終更新日時。frontmatterの`updated`に保存し、更新のたびに現在時刻へ差し替える */
  updatedAt?: string
}

export interface TradeOff {
  option_a: string
  option_b: string
}

/**
 * 進行役がアサインした専門エージェント1件。指示プロンプトによって「AI社長」
 * 「PM」「戦略家」等、進行役や役割の呼び方は変わりうるため、role/reason_for_assignment
 * 自体に固有名詞を持たせず、chain_of_command側で進行役の肩書きを表現する。
 *
 * persona/memory_context/tools/current_stateは、AIエージェントが保持する4種の情報
 * （役割・制約／記憶・文脈／ツール・実行権限／現在のステータス・中間思考）に対応する
 * 任意項目。いずれも既存ログとの後方互換のためoptional。
 */
export interface AssignedAgent {
  role: string
  reason_for_assignment: string
  /** 役割・制約（Role & Persona）：このエージェントの行動規範・振る舞いの定義 */
  persona?: string
  /** 記憶・文脈（Memory & Context）：参照した長期記憶・短期文脈の要約（例: 参照したCLAUDE.mdのルールやmemory/*.md） */
  memory_context?: string
  /** ツール・実行権限（Tools & Capabilities）：このエージェントが実際に使用した/使用可能なツール */
  tools?: string[]
  /** 現在のステータス・中間思考（State & Intermediate Thought）：完了時点で到達した結論・最終的な状態 */
  current_state?: string
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
  /**
   * assigned_agentsの上位にいる指揮系統の肩書きを、末端から遠い順に並べたもの
   * （例: ["オーナー", "AI社長（メインディレクター）"]）。指示プロンプトによって
   * 「AI社長」のような役職が存在しない体制（例: 戦略家/設計者/生成者/破壊者/仕上げ屋の
   * 5役が対等に並ぶチーム編成）もあるため固定文言にせず、無指定なら指揮系統の表示自体を
   * 省略しassigned_agentsだけをフラットなチームとして表示する。
   */
  chain_of_command?: string[]
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
  /** 実際の~/.claude（グローバル設定）と一致するかどうか。表示専用の計算値でファイルには保存しない */
  isGlobalConfig?: boolean
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
  category?: string
  title?: string
  targetModel?: string
  createdAt?: string
  updatedAt?: string
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
  /** スキルのカテゴリ変更（未分類は null）。kind: "rule" では使用しない */
  categoryBefore?: string | null
  categoryAfter?: string | null
  /** スキルの表示名変更（未設定は null）。kind: "rule" では使用しない */
  titleBefore?: string | null
  titleAfter?: string | null
  /** スキルの対象モデル変更（未設定は null）。kind: "rule" では使用しない */
  targetModelBefore?: string | null
  targetModelAfter?: string | null
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

/**
 * 1セッション（1つの`.jsonl`）の集計サマリー。
 * セッション一覧の表示だけでなく、同一プロジェクト内の他セッションと突き合わせて
 * 「いつもと比べて異常か」を判定する診断（sessionDiagnostics.ts）の入力も兼ねるため、
 * 診断の8軸が必要とする値はすべてここに含める。
 */
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
  mcpToolCallCount: number
  skillCallCount: number
  totalToolOutputChars: number
  /** ツール実行結果ではない、人間が実際に送った指示の件数（自律度の分母） */
  userMessageCount: number
  /** ユーザーが途中で停止させたツール呼び出しの回数 */
  interruptedToolCallCount: number
  /** フック（pre-commit・フォーマッタ等）が失敗した回数 */
  hookErrorCount: number
  /** Agentツールによるサブエージェント呼び出しの回数 */
  subagentCallCount: number
  /**
   * 先頭のユーザー発話の抜粋（何のセッションだったかを判別するための表示名用）。
   * プライバシー方針上、本文全体や2件目以降の発話は保持・表示しない（この抜粋のみ）。
   */
  firstUserMessageExcerpt: string | null
  /** 発火したスキル名（重複なし、呼び出し回数の情報は持たない） */
  skillNames: string[]
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

/** ツール呼び出し1件（対応するtool_resultが来た時点でisError・outputChars等が確定する） */
export interface ToolCallEvent {
  turnIndex: number
  timestamp: string
  name: string
  isError: boolean
  isSidechain: boolean
  outputChars: number
  /** name が `mcp__<server>__<tool>` 形式の場合のサーバー識別子（組み込みツールならnull） */
  mcpServer: string | null
  /** Skillツール呼び出しの場合の呼び出し先スキル名 */
  skillName: string | null
  /** Agentツール呼び出しの場合のsubagent_type */
  subagentType: string | null
}

/** 自動コンパクション（コンテキスト圧縮）発生イベント */
export interface CompactionEvent {
  timestamp: string
  trigger: string
  preTokens: number
  durationMs: number
}

/**
 * 診断（sessionDiagnostics.ts）が実際に必要とする最小限のフィールドだけを持つ軽量版。
 * セッションを選んだ直後の初期表示ではこちらを取得する（詳細データを開くまでSessionMetrics全体は取得しない）。
 */
export interface SessionDiagnosisMetrics {
  summary: SessionSummary
  mcpCallCountsByServer: Record<string, number>
}

/** セッション詳細の全メトリクス（「詳細データ」を開いたときだけ取得する） */
export interface SessionMetrics {
  summary: SessionSummary
  tokenPoints: TokenPoint[]
  compactions: CompactionEvent[]
  toolCallCountsByName: Record<string, number>
  toolErrorCountsByName: Record<string, number>
  /** ツール名ごとの出力合計文字数（本文は保持せず、文字数のみ集計） */
  toolOutputCharsByName: Record<string, number>
  /** MCPサーバー識別子ごとの呼び出し回数 */
  mcpCallCountsByServer: Record<string, number>
  /** 発火したスキル名ごとの呼び出し回数 */
  skillCallCounts: Record<string, number>
  /** サブエージェント種別(subagent_type)ごとの呼び出し回数 */
  subagentCallCounts: Record<string, number>
  effortCounts: Record<string, number>
  sidechainToolCallCount: number
  interruptedToolCallCount: number
  hookErrorCount: number
  userMessageCount: number
}

/**
 * `session-diagnostician`スキル（Claude Code側）が生成する意味診断1件。
 * sessionDiagnostics.tsのしきい値判定とは異なり、根拠(observation)は会話内容を読んだ自由記述になる。
 */
export interface SessionSemanticFinding {
  id: string
  title: string
  severity: "good" | "warning" | "critical" | "info"
  observation: string
  action: string | null
}

/** `session_diagnosis.json`の内容（対象プロジェクトのルートに生成される） */
export interface SessionSemanticDiagnosis {
  version: number
  generatedAt: string
  sessionId: string
  summary: string
  overall: "good" | "warning" | "critical" | "info"
  findings: SessionSemanticFinding[]
}
