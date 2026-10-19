/**
 * 組織図アニメーション(⑤)のAPI/画面で共有する型。サーバー専用モジュール(fs等)をimportしない。
 *
 * ここに載せる項目が「APIが返してよい項目」の許可リストになる。含めてよいのは、セッションID・タイトル・モデル・
 * 時刻・数値・種別・指示と他グループ連絡の先頭20文字だけ。報告の本文・指示の20文字より後ろ・システムプロンプトの写し・
 * 認証情報は、型に存在しないため、どの経路でも返せない。
 */

/** 指示・他グループの連絡の要約に出す文字数(オーナーが承認した「要約20文字」) */
export const FLOW_SUMMARY_CHARS = 20
/** 表示範囲の既定と上限 */
export const FLOW_DEFAULT_RANGE_MS = 4 * 60 * 60 * 1000
export const FLOW_MAX_RANGE_MS = 24 * 60 * 60 * 1000
/** ツール呼び出しをまとめる間隔(同じセッションの5秒ごと) */
export const FLOW_TOOL_BUCKET_MS = 5_000
/** 作業量のバーの1周のツール呼び出し回数。100回で満杯になり、超えた分は次の周の色で重ねて伸びる。報告の粒も、この回数で最大 */
export const FLOW_WORK_LAP = 100

/**
 * 受信を確認できたか。confirmed: 受け手の会話ログに対応する行がある / sender-only: 送り手の送信記録だけがある
 * (届いていない、または受け手側の記録がまだ無い)
 */
export type FlowReceipt = "confirmed" | "sender-only"

/** 指揮役から子への指示 */
export interface FlowInstruct {
  kind: "instruct"
  t: number
  from: string
  to: string
  /** 本文の先頭20文字(超えたら「…」) */
  summary: string
  receipt: FlowReceipt
  /**
   * 送り手の送信記録の時刻。送信側のみの指示は、t と同じ。受信を確認できた指示は、対応する送信記録があればその時刻(無ければ null)。
   * 受信を確認する前(送信側のみ)と、確認できたあとで、t(受け手の記録の時刻)は変わるが、同じ指示だと見分けるために使う。
   */
  sentAt: number | null
}

/** 子から指揮役への報告。本文は持たない */
export interface FlowReport {
  kind: "report"
  t: number
  from: string
  to: string
  /** 組になった指示の時刻。組にならなかった報告(同じ窓の2通目以降など)は null */
  instructAt: number | null
  /** 指示から報告までの、子のメインスレッドのツール呼び出し回数。組にならなければ 0 */
  tools: number
  durationMs: number
}

/** 子のターンが、報告せずに終わった */
export interface FlowEnd {
  kind: "end"
  t: number
  sid: string
  instructAt: number
  tools: number
  durationMs: number
}

export interface FlowCompact {
  kind: "compact"
  t: number
  sid: string
  pre: number
  post: number
}

/** 他のグループ・外部(CLI)から、指揮役への連絡 */
export interface FlowCross {
  kind: "cross"
  t: number
  /** 受け手(指揮役)のセッションID */
  to: string
  source: "other-group" | "external"
  summary: string
}

export type FlowEvent = FlowInstruct | FlowReport | FlowEnd | FlowCompact | FlowCross

/**
 * ツール呼び出しのまとまり(同じセッションの5秒ごと)。応答の大きさを抑えるため、数値の組で返す。
 * [since からの経過ms, members の添字, その時点のコンテキスト(トークン。不明は -1), まとめた呼び出し回数]
 */
export type FlowToolSample = [number, number, number, number]

export interface FlowMember {
  id: string
  title: string
  model: string | null
  /** 指揮役か */
  isLeader: boolean
  /**
   * 木での親のセッションID。指揮役は null。2層目は指揮役、3層目は2層目のセッション(4層目以降は、2層目の祖先)。
   * 指揮役がいないグループでは、全員 null(木を描かない)。
   */
  parentId: string | null
  /** コンテキストの上限(一覧と同じ、モデルごとの仮置き値)。不明は null */
  contextLimit: number | null
  /** 表示範囲の始まりより前の、最後のコンテキスト(トークン)。分からなければ null */
  contextBefore: number | null
  /** このセッションから作られたサイドチャットの数(アーカイブされていないもの)。サイドチャットはカードにしない */
  sideChats: number
}

export interface FlowGroupRef {
  id: string
  name: string
}

export interface FlowResponse {
  generatedAt: number
  /** 出来事を返す範囲の始まり(ms) */
  since: number
  group: FlowGroupRef
  /** 指揮役のセッションID。見つからなければ null(そのときは線・粒を出さない) */
  leaderId: string | null
  /** 指揮役を見つけるタイトルの接頭辞 */
  prefix: string
  /**
   * 指揮役を先頭に、木に出るセッション(作成日時の古い順)。グループ内のアーカイブされていないセッションと、
   * 2層目の子が作った、グループに入っていないセッション(3層目)。
   */
  members: FlowMember[]
  /** 出来事。時刻の昇順 */
  events: FlowEvent[]
  /** ツール呼び出しのまとまり。時刻の昇順 */
  tools: FlowToolSample[]
}
