/**
 * Claude Desktop セッション一覧のAPI/画面で共有する型。
 * サーバー専用モジュール(fs等)をimportしない。クライアントコンポーネントからも参照するため。
 *
 * ここに載せる項目が「APIが返してよい項目」の許可リストになる(検討書 S3)。
 * Desktopのメタデータの値(ツール一覧・システムプロンプトの写し・MCP設定・権限の更新履歴など)は
 * 型に存在しないため、どの経路でも返せない。
 */

import type { NeedsActionKind, NeedsActionSource } from "./needsActionKind"

/**
 * 表示する状態。
 * - running: 実行中(会話ログの更新状況からの推定)
 * - interrupted: 中断の可能性(ツール実行待ちのまま更新が止まっている)
 * - blocked: 要対応 / review_ready: 確認待ち / completed: 完了(Desktopがターン後に付ける分類)
 * - standby: 待機(Desktopは要対応にしたが、手がかりから「次の連絡や条件を待っているだけ」と分かったもの。⑩。要対応には数えない)
 * - waiting: 入力待ち(ターンは終わっているが、ターン後の要約が無い)
 * - error: Desktopがエラーを記録している
 * - unknown: 判断材料が無い
 */
export type DesktopSessionStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "standby"
  | "review_ready"
  | "completed"
  | "waiting"
  | "error"
  | "unknown"

/** 要対応の種類(⑩)。状態が blocked のときだけ付く */
export interface DesktopNeedsActionInfo {
  kind: NeedsActionKind
  source: NeedsActionSource
  /** 言葉からの推定(画面に「推定」と出す) */
  estimated: boolean
  /** wrap_up の承認のボタン(commit・create_pr・merge)の名前。手がかりの表示に使う */
  buttons: string[]
}

/** 待機の手がかり(⑩)。状態が standby のときだけ付く。言葉から決めた待機は推定 */
export interface DesktopStandbyInfo {
  source: NeedsActionSource
  estimated: boolean
}

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

/**
 * 他のセッションへ送ったメッセージの数。Desktopは「そのセッションで人が最後に入力してから10回まで」しか送れない
 * (他のセッションからの入力では数え直されない)。数えるのは送信ツールの呼び出しで、届かなかった送信も含む。
 */
export interface DesktopSessionMessaging {
  /** 人が最後に入力してからの送信回数。上限(limit)を超えて試した分は limit にそろえる */
  sent: number
  limit: number
  /** 送信上限に達して送れなくなっている。人がこのセッションに入力すると解除される */
  stopped: boolean
  /** うち、届かなかった(宛先が見つからない・上限など)送信の数 */
  undelivered: number
  /**
   * sent が確定した値か。会話ログの末尾だけを読んだ暫定の要約で、人の最後の入力まで読めていないときは false
   * (実際の回数はこれ以上の可能性がある)。stopped は検出できた時点で確定
   */
  exact: boolean
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
  /** Desktopが「ユーザーの対応が必要」と記録している */
  needsAction: boolean
  /**
   * 要対応の内容の先頭60文字(承認済みの表示項目)。Desktopが「要対応」と分類したセッションだけに付く。
   * 要約に要対応の文が無ければ、最後のターンの wrap_up の質問(ask)の先頭60文字(⑩ ゲート1の条件4)。
   * 状態の説明(status_detail)・ターンのまとめ(turnWrapUp)・wrap_up の recap とボタンの文は返さない。
   */
  needsActionExcerpt: string | null
  /** 要対応の種類と、決めた手がかり(⑩)。状態が blocked のときだけ付く */
  needsActionInfo: DesktopNeedsActionInfo | null
  /** 待機の手がかり(⑩)。状態が standby のときだけ付く */
  standbyInfo: DesktopStandbyInfo | null
  createdAt: number | null
  lastActivityAt: number | null
  completedTurns: number | null
  /** 会話ログ(.jsonl)が見つかったか */
  transcript: "found" | "missing"
  /** 会話ログの解析状態。partial は末尾のみ解析した暫定値(圧縮回数・フェーズが不完全な場合がある) */
  digest: "full" | "partial" | "none"
  context: DesktopSessionContext | null
  /**
   * context の値を記録した応答の時刻(メインスレッドの最後の assistant の応答)。プロンプトキャッシュはここから数えて切れるので、
   * 整理ページの「再開すると書き直すか」の判断に使う。会話ログが無い・応答がまだ無ければ null
   */
  lastAssistantAt: number | null
  phase: DesktopSessionPhase | null
  /** 圧縮の回数。会話ログを全体解析するまで null */
  compactionCount: number | null
  /** 人が書いた直近の指示。人の指示が無ければ、直近の他の発信元の指示 */
  latestInstruction: DesktopSessionInstruction | null
  /** 最新の入力の発信元。latestInstruction より新しい人以外の入力があるかの判定に使う */
  latestInputOrigin: InstructionOrigin | null
  /** 実行中に届いて、まだ処理されていない入力の数 */
  queuedInputs: number
  /** 他のセッションへの送信回数と、送信上限での停止。会話ログが無いセッションは null */
  messaging: DesktopSessionMessaging | null
  /**
   * claude.exe が `--resume=<セッションID>` でこのセッションを開いているか。「実行中」とは別の情報
   * (待機中のセッションでもプロセスは残る)。running: プロセスあり / none: 無し / unknown: 取得できていない
   * (Windows以外・取得に失敗・初回の取得前)。
   */
  cliProcess: "running" | "none" | "unknown"
  /** このセッションを作った(spawnした)セッションのID。組織図の3層目(親子)の根拠。分からなければ null */
  spawnedFromId: string | null
  /**
   * サイドチャット(Desktop の分岐の操作で作られた脇の会話)か。組織図ではカードにせず、親のカードに数だけ出す。
   * 一覧では「サイドチャット（親：…）」の印を付ける
   */
  isSideChat: boolean
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

/**
 * データの場所の出どころ(⑧-2)。explicit-config: 設定ファイル / explicit-env: 環境変数 / auto: 自動で決めた /
 * disabled: 自動の探索を止めていて(`CCD_DESKTOP_AUTODETECT=0`)、明示も無い(場所は null)
 */
export type DataLocationOrigin = "explicit-config" | "explicit-env" | "auto" | "disabled"

export interface DataLocation {
  path: string | null
  origin: DataLocationOrigin
}

export interface DesktopSessionListResponse {
  generatedAt: number
  /** desktop: Desktopのメタデータから作成 / transcript-only: 会話ログだけの縮退表示 / none: データなし */
  source: DesktopSessionSource
  /** Desktop のデータフォルダの場所と出どころ(⑧-2。画面のお知らせに出す。場所は開いたときだけ表示する) */
  dataLocation: DataLocation
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
