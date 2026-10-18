/**
 * Claude Desktop セッション一覧のAPI/画面で共有する型。
 * サーバー専用モジュール(fs等)をimportしない。クライアントコンポーネントからも参照するため。
 *
 * ここに載せる項目が「APIが返してよい項目」の許可リストになる(検討書 S3)。
 * Desktopのメタデータの値(ツール一覧・システムプロンプトの写し・MCP設定・権限の更新履歴など)は
 * 型に存在しないため、どの経路でも返せない。
 */

/**
 * 表示する状態。
 * - running: 実行中(会話ログの更新状況からの推定)
 * - interrupted: 中断の可能性(ツール実行待ちのまま更新が止まっている)
 * - blocked: 要対応 / review_ready: 確認待ち / completed: 完了(Desktopがターン後に付ける分類)
 * - waiting: 入力待ち(ターンは終わっているが、ターン後の要約が無い)
 * - error: Desktopがエラーを記録している
 * - unknown: 判断材料が無い
 */
export type DesktopSessionStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "review_ready"
  | "completed"
  | "waiting"
  | "error"
  | "unknown"

/** 指示の発信元。人が書いたものか、他のセッション・通知・定期実行・システムかを区別する */
export type InstructionOrigin = "human" | "peer" | "notification" | "scheduled" | "system"

export type TaskStatus = "pending" | "in_progress" | "completed"

export interface DesktopSessionTask {
  /** ステップ名。取り込み時に80文字へ切り詰める */
  content: string
  status: TaskStatus
}

export interface DesktopSessionContext {
  /** 直近の応答時点のコンテキスト使用量(入力+キャッシュ読み+キャッシュ作成) */
  tokens: number
  /** 使用量の上限。記録が無いためモデルごとの仮置き値 */
  limit: number
  /** tokens / limit。1を超えない */
  ratio: number
}

export interface DesktopSessionPhase {
  completed: number
  total: number
  /** 実行中(in_progress)のステップ名。承認済みの表示項目。60文字に切り詰める */
  currentStep: string | null
}

export interface DesktopSessionInstruction {
  /** 先頭60文字の抜粋(承認済みの表示項目)。通知由来は空文字 */
  excerpt: string
  origin: InstructionOrigin
  at: number | null
}

export interface DesktopSessionGroupRef {
  id: string
  name: string
}

export interface DesktopSessionSummary {
  /** Desktopのセッション識別子(`local_<uuid>`)。縮退表示では会話ログのセッションID */
  id: string
  title: string
  cwd: string | null
  /** 作業フォルダの末尾の名前(表示用) */
  folderName: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  isArchived: boolean
  /** 定期実行(ルーチン)から作られたセッション */
  isRoutine: boolean
  pinned: boolean
  group: DesktopSessionGroupRef | null
  status: DesktopSessionStatus
  /** 状態の判断根拠(短い説明)。実行中などの推定の根拠を画面に出すために使う */
  statusReason: string
  /** Desktopが「ユーザーの対応が必要」と記録している(要約文そのものは返さない) */
  needsAction: boolean
  createdAt: number | null
  lastActivityAt: number | null
  completedTurns: number | null
  /** 会話ログ(.jsonl)が見つかったか */
  transcript: "found" | "missing"
  /** 会話ログの解析状態。partial は末尾のみ解析した暫定値(圧縮回数・フェーズが不完全な場合がある) */
  digest: "full" | "partial" | "none"
  context: DesktopSessionContext | null
  phase: DesktopSessionPhase | null
  /** 圧縮の回数。会話ログを全体解析するまで null */
  compactionCount: number | null
  /** 人が書いた直近の指示。人の指示が無ければ、直近の他の発信元の指示 */
  latestInstruction: DesktopSessionInstruction | null
  /** 最新の入力の発信元。latestInstruction より新しい人以外の入力があるかの判定に使う */
  latestInputOrigin: InstructionOrigin | null
  /** 実行中に届いて、まだ処理されていない入力の数 */
  queuedInputs: number
}

export interface DesktopSessionGroup {
  id: string
  name: string
  order: number
  count: number
}

export interface DesktopSessionCounts {
  total: number
  running: number
  blocked: number
  reviewReady: number
  highContext: number
  archived: number
}

export type DesktopSessionSource = "desktop" | "transcript-only" | "none"

export interface DesktopSessionListResponse {
  generatedAt: number
  /** desktop: Desktopのメタデータから作成 / transcript-only: 会話ログだけの縮退表示 / none: データなし */
  source: DesktopSessionSource
  warnings: string[]
  counts: DesktopSessionCounts
  groups: DesktopSessionGroup[]
  sessions: DesktopSessionSummary[]
  /** コンテキスト上限の仮置きに関する注記(画面に常時表示する) */
  contextLimitNote: string
  highContextRatio: number
}

export interface DesktopSessionDetail extends DesktopSessionSummary {
  tasks: DesktopSessionTask[]
  /** `~/.claude/projects/` 配下のフォルダ名(セッション監視への導線用)。会話ログが無ければ null */
  projectDirName: string | null
  /** 会話ログのファイル名(拡張子なし)。セッション監視で同じセッションを開くために使う */
  transcriptId: string | null
  lastCompactionAt: number | null
}
