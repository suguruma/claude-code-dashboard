/**
 * セッションの整理(⑦)のAPI/画面で共有する型と定数。サーバー専用モジュール(fs等)をimportしない。
 *
 * ここに載せる項目が「APIが返してよい項目」の許可リストになる。含めてよいのは、セッションID・タイトル・グループ名・モデル・
 * 時刻・数値・状態・指示の先頭20文字・要対応の先頭60文字・要対応の種類と手がかりの名前（⑩）だけ。会話の本文・報告の本文・指示の20文字より後ろは、型に存在しないため返せない。
 */

import type { DesktopNeedsActionInfo } from "./desktopSessionTypes"

/** プロンプトキャッシュ(1時間)の有効な時間。最後の応答からこれだけ空くと、再開時にコンテキスト全体を書き直す */
export const CACHE_TTL_MS = 60 * 60 * 1000

/** 整理ページの判定のしきい値。既定は下の定数で、`config/desktop-sessions.json` の `housekeeping` で上書きできる */
export interface HousekeepingThresholds {
  /** 最後の応答からこれだけ空いたセッションを「長く止まっている」とする(ms) */
  idleMs: number
  /** 「長く止まっている」の対象にする、コンテキストの最小量(トークン)。小さいセッションは書き直しても安い */
  minIdleTokens: number
  /** 指示から報告がないまま、これだけ過ぎたら「返事の無い指示」とする(ms) */
  unansweredMs: number
}

export const DEFAULT_HOUSEKEEPING_THRESHOLDS: HousekeepingThresholds = {
  idleMs: 60 * 60 * 1000,
  minIdleTokens: 50_000,
  unansweredMs: 30 * 60 * 1000,
}

/** 返事の無い指示を探す範囲。組織図の最大の表示範囲と同じ24時間 */
export const UNANSWERED_RANGE_MS = 24 * 60 * 60 * 1000

/** 画面の注記(金額は上限の相対的な目安で、請求額ではない) */
export const HOUSEKEEPING_NOTE =
  "再開コストは、キャッシュが切れたセッションを再開した最初の応答で、コンテキスト全体を書き直す分の目安です。利用上限をどれだけ使うかの相対的な大きさで、請求額ではありません。"

// ---------------------------------------------------------------------------
// A. コンテキスト整理の候補

/** large: コンテキスト使用率が高い / idle: 長く止まっている(キャッシュが切れている可能性が高い) */
export type CleanupReason = "large" | "idle"

/** valid: 最後の応答から1時間未満(再開は安い) / expired: 1時間以上(再開で書き直す) / unknown: 最後の応答の時刻が分からない */
export type CacheState = "valid" | "expired" | "unknown"

/** 利用上限に対する割合の幅(%)。min が null のときは、下限が決められない(「最大で約 max%」) */
export interface PercentRange {
  min: number | null
  max: number
}

export interface ResumeCost {
  /** 再開で書き直す分の金額(ドル。上限をどれだけ使うかの物差し) */
  usd: number
  /** 5時間の枠・週(全モデル)の枠に対する割合。その枠の較正が無いときは null */
  fiveHour: PercentRange | null
  weekly: PercentRange | null
  /** 価格表に無いモデルで、opus の価格に置き換えて計算した */
  priceUnregistered: boolean
}

export interface CleanupCandidate {
  id: string
  title: string
  groupName: string | null
  model: string | null
  contextTokens: number
  contextRatio: number
  /** 最後の応答の時刻。分からなければ null */
  lastAssistantAt: number | null
  /** 最後の応答からの経過(ms)。lastAssistantAt が null なら null */
  idleMs: number | null
  reasons: CleanupReason[]
  cache: CacheState
  /** キャッシュが有効(valid)なときは null */
  resumeCost: ResumeCost | null
  /** 使わないなら再開せず /clear か圧縮を勧める(キャッシュが切れているとき) */
  suggestClear: boolean
}

// ---------------------------------------------------------------------------
// B. 返事の無い指示

/**
 * ended-without-report: 子のターンが、報告せずに終わった(時間に関係なく出す)
 * awaiting-report: 受信を確認できていて、報告も終了もないまま、しきい値以上たった
 * possibly-undelivered: 送り手の送信記録しかなく(受信を確認できない)、しきい値以上たった
 */
export type UnansweredKind = "ended-without-report" | "awaiting-report" | "possibly-undelivered"

export interface UnansweredInstruction {
  kind: UnansweredKind
  groupId: string
  groupName: string
  fromId: string
  fromTitle: string
  toId: string
  toTitle: string
  /** 指示の本文の先頭20文字 */
  summary: string
  /** 指示を送った時刻(ms)。送り手の送信記録を対応づけられていればその時刻、なければ受け手の記録の時刻 */
  sentAt: number
  /** sentAt からの経過(ms) */
  ageMs: number
  /** 宛先のセッションが、いま実行中か */
  working: boolean
}

// ---------------------------------------------------------------------------
// C. オーナーの判断待ち

/** needs-action: 要対応 / send-limit: 送信上限で停止中 / error: エラー / undelivered: 届かなかった送信がある */
export type DecisionReason = "needs-action" | "send-limit" | "error" | "undelivered"

export interface DecisionItem {
  id: string
  title: string
  groupName: string | null
  /** 優先度の高い順 */
  reasons: DecisionReason[]
  /** 要対応の内容の先頭60文字(要対応のときだけ) */
  excerpt: string | null
  /** 要対応の種類と手がかり(⑩。要対応のときだけ) */
  needsAction: DesktopNeedsActionInfo | null
  /** 届かなかった送信の数(undelivered があるときだけ意味を持つ。無ければ 0) */
  undeliveredCount: number
  lastActivityAt: number | null
}

// ---------------------------------------------------------------------------

export interface HousekeepingResponse {
  generatedAt: number
  /** 3つの節の件数(概要に出す) */
  counts: { cleanup: number; unanswered: number; decisions: number }
  cleanup: {
    items: CleanupCandidate[]
    highContextRatio: number
    idleMinutes: number
    minIdleTokens: number
    /** 較正があるか(無ければ、再開コストはドルだけで、割合は出さない) */
    calibrated: { fiveHour: boolean; weekly: boolean }
  }
  unanswered: {
    items: UnansweredInstruction[]
    thresholdMinutes: number
    rangeHours: number
  }
  decisions: { items: DecisionItem[] }
  warnings: string[]
  note: string
}
