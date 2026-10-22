/**
 * 利用上限の可視化(⑥)のAPI/画面で共有する型。サーバー専用モジュール(fs等)をimportしない。
 *
 * ここに載せる項目が「APIが返してよい項目」の許可リストになる。
 * 公式値の記録(usage-snapshots.jsonl)の `recordedBy`(記録したセッション名)は型に存在しないため、返せない。
 */

/** 上限の窓。five_hour=5時間 / weekly_all=週(全モデル) / weekly_model=週(モデル別。modelNameで区別) */
export type UsageWindowKey = "five_hour" | "weekly_all" | "weekly_model"

/** 100万トークンあたりのドル。キャッシュ作成は入力単価の1.25倍(5分)・2倍(1時間)で計算する */
export interface UsagePrice {
  input: number
  output: number
  cacheRead: number
}

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  /** キャッシュ作成(5分+1時間) */
  cacheWrite: number
}

/** 枠の中で最新の公式値 */
export interface UsageOfficialValue {
  percentUsed: number
  /** 記録した時刻(ms) */
  recordedAt: number
  resetsAt: number
}

/** 推定値。公式値の記録の間を、会話記録のトークン量から埋めた値 */
export type UsageEstimate =
  | { kind: "estimate"; percent: number; low: number; high: number }
  /**
   * 推定しない。no-official: この枠の公式値が無い(トークン量と金額だけを出し、%は出さない) /
   * no-calibration: 係数を決められない(較正できる公式値が無い)
   */
  | { kind: "none"; reason: "no-official" | "no-calibration" }

export interface UsagePace {
  /** 1時間あたりに増える%(推定)。5時間は30分の指数平滑(半減期20分)、週は直近24時間の平均 */
  ratePerHour: number
  basis: "ewma30" | "mean24h"
  /** 参考: 直近60分の平均(5時間の枠のみ) */
  mean60PerHour: number | null
  /** 100%に達する時刻(ms)。ペースが0なら null */
  etaAt: number | null
  /** 100%に達するのが、リセットより前か */
  beforeReset: boolean
  /**
   * リセットより前に達する予測でも、その差が小さい(5時間の枠で15分以内・週の枠で2時間以内)。予測の誤差の範囲なので、
   * 赤い警告ではなく黄色で「リセットとほぼ同時」と表示する。すでに100%に達しているときは false
   */
  nearReset: boolean
}

export interface UsageCalibration {
  /** 1%あたりの金額(ドル)の範囲。上限が無い(公式値が0%だけ)ときは high が null */
  costPerPercentLow: number
  costPerPercentHigh: number | null
  /** 係数の決め方。intersect: 複数の公式値の範囲を重ねた / single: 1点の公式値から */
  mode: "intersect" | "single"
  /** 係数の決定に使った公式値の数 */
  samples: number
}

export interface UsageWindowView {
  /** 窓の識別子(`<key>` または `weekly_model:<モデル名>`) */
  id: string
  key: UsageWindowKey
  /** 画面に出す名前(例: 5時間 / 週(全モデル) / 週(Fable)) */
  label: string
  /** weekly_model のモデル名。それ以外は null */
  modelName: string | null
  /** 現在の枠の始まりと終わり(リセット)の時刻(ms)。活動が無く分からないときは null */
  windowStart: number | null
  resetsAt: number | null
  /** 現在の枠の中で最新の公式値。枠が切り替わっていて、まだ記録が無いときは null */
  official: UsageOfficialValue | null
  /** 枠が切り替わる前の、最後の公式値(official が null のときの参考) */
  previousOfficial: UsageOfficialValue | null
  estimate: UsageEstimate
  /** ゲージ・通知に使う%。推定があれば推定、無ければ公式値、どちらも無ければ null */
  displayPercent: number | null
  /** 現在の枠の中で使った量(会話記録から。重複除去済み) */
  tokens: UsageTokens
  /** 同じ量をAPI価格で換算したドル */
  costUsd: number
  calibration: UsageCalibration | null
  pace: UsagePace | null
}

/** 上限ガードの状態。最新の公式値だけで決める(表示のみ。ガードの判断自体は運用ルール側) */
export interface UsageGuard {
  level: "none" | "warn" | "high"
  /** 根拠になった窓の名前と公式値の%。level が none のときは null */
  windowLabel: string | null
  percent: number | null
}

export interface UsageContribution {
  /** 会話ログのセッションID(サブエージェントは親のセッションID)。Desktopのセッションと対応づけられないときの識別にも使う */
  sessionKey: string
  /** Desktopのセッション識別子(`local_<uuid>`)。対応づけられなければ null */
  desktopId: string | null
  title: string
  groupId: string | null
  groupName: string | null
  costUsd: number
  tokens: UsageTokens
}

export interface UsageContributionSet {
  /** 集計した期間の始まり(ms) */
  since: number
  items: UsageContribution[]
}

/** 推定が過去の公式値からどれだけ外れたか(直近7日の記録から、その時点の推定を再現して比べた絶対誤差。単位は%ポイント) */
export interface UsageAccuracy {
  samples: number
  medianAbsError: number | null
  p90AbsError: number | null
}

export interface UsageResponse {
  generatedAt: number
  /** 公式値の記録ファイル。found=false のときは公式値を表示できない */
  snapshots: {
    found: boolean
    count: number
    /** 最新の記録の時刻(ms) */
    lastRecordedAt: number | null
    plan: string | null
  }
  /** 追加利用(プランの上限を超えた分を有料で使えるか)。記録に無ければ null */
  extraUsage: { enabled: boolean; spent: number | null } | null
  windows: UsageWindowView[]
  guard: UsageGuard
  /** 直近5時間(窓の始まりから)と今週のセッション別の消費。金額換算(=上限への寄与)で集計する */
  contributions: { fiveHour: UsageContributionSet; week: UsageContributionSet }
  accuracy: UsageAccuracy
  /** 価格表に無いモデル名(opusの価格で仮に計算している) */
  unregisteredModels: string[]
  /** 画面に常時出す注記(推定の前提・時刻の誤差) */
  note: string
  /**
   * "official" は、公式値の記録だけを読んだ軽い答え(推定・ペース・セッション別の消費はまだ空)。
   * ホームが推定より先に公式値を出すために使う(⑫ ST-7)。省略は、推定を含むふつうの答え
   */
  phase?: "official"
}
