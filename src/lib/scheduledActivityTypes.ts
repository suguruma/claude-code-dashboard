import type { StatusMark } from "./statusMark"

/**
 * 予定タスクのタブ(⑯)の応答の型。返すのは許可リストの項目だけ：
 * 予定タスクの名前(定義のフォルダ名)・Desktop のセッション ID・時刻・状態の印・使用量の数・モデルの系統・サブエージェントの種類の名前。
 * 会話の本文・パス・題名・サブエージェントの description(任せた作業の説明)は入れない(AG-7)。
 */

/** モデルの系統の表示名。系統の分からないモデルは「その他」 */
export type FamilyLabel = "Opus" | "Sonnet" | "Haiku" | "Fable" | "その他"

/** アーカイブ済みの回で、止まった理由(要件メモの決めたこと・A1) */
export type StopReason = "送信上限" | "要対応" | "届かない送信"

export interface RunTokens {
  family: FamilyLabel
  subagent: boolean
  /** 入力・出力・キャッシュの書き込み・読み出しの合計 */
  tokens: number
}

export interface ScheduledRun {
  /** Desktop のセッション ID(行を押して詳細を開くため) */
  desktopId: string
  taskId: string
  /** 回の始まりの時刻(ms)。メタデータの作成時刻、無ければ最初の応答、無ければ最後の活動 */
  startedAt: number
  /** 一覧と同じ状態の印(⑮ buildMarks) */
  mark: StatusMark
  /** アーカイブ済みの回で止まった理由。無ければ null */
  stopReason: StopReason | null
  archived: boolean
  /** 作業中(平均に入れない) */
  running: boolean
  /** 使用量が読めたか(読めない回は「記録なし」で、平均に入れない) */
  hasUsage: boolean
  /** 1回あたりの消費(価格表による推定のドル。画面では前の7日を100とした値にする) */
  cost: number
  /** そのうち本体の分 */
  mainCost: number
  /** 本体で使ったモデルの系統(多い順) */
  mainFamilies: FamilyLabel[]
  /** サブエージェントの本数(会話記録のファイルの数) */
  subagentCount: number
  /** サブエージェントで使ったモデルの系統 */
  subagentFamilies: FamilyLabel[]
  /** サブエージェントの種類ごとの本数。種類の記録が無い物は「種類不明」 */
  subagentTypes: Record<string, number>
  /** モデル別のトークン(本体とサブエージェントを分ける) */
  tokens: RunTokens[]
}

/** 既定で選ぶ予定タスク(要件メモ 4-2「既定で選ぶ予定タスク」) */
export interface DefaultSelection {
  taskId: string
  /** new-family: 新しいモデルの系統が最初に出た回で選んだ / weight: 直近14日の重さの合計で選んだ */
  reason: "new-family" | "weight"
  /** 初めの境目の日(YYYY-MM-DD。日本時間)。weight のときは null(今日の7日前を使う) */
  boundaryDay: string | null
}

export interface ScheduledActivityResponse {
  generatedAt: number
  /** 予定タスクの回の会話記録を読む期間(日)。30(問2)、守れないときは15 */
  horizonDays: number
  /** 読む期間の始まり(ms)。これより前に始まった回は、記録の一部が読めていないことがある */
  horizonStart: number
  /** 回(新しい順)。読む期間の中の回と、各予定タスクの最後の回 */
  runs: ScheduledRun[]
  /** 予定タスクの定義の名前(フォルダ名。回が無い物も含む) */
  definitions: string[]
  defaultSelection: DefaultSelection | null
}
