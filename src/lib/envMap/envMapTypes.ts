/**
 * ⑲ AI 環境の全体マップ(地図と、指示ごとのルートの重ね描き)の応答の型。
 * 画面と API の応答に入れてよいのは、地図の箱と線(04 が伏せた形)・道具の名前・箱の id・順番・時刻・回数だけ(EM-6)。
 * 人の入力・ファイルの中身・コマンドの全文・ツールの入力・突き合わせに使ったファイルのパスは入れない。
 */

/** 箱の強さ(map.json の strength)。画面では日本語の凡例に写す */
export type EnvMapStrength = "stop" | "judge" | "watch" | "read" | "none"

export interface EnvMapLayer {
  id: string
  label: string
}

export interface EnvMapNode {
  id: string
  layer: string
  label: string
  /** 箱の種類の説明(04 が書いた日本語) */
  kind: string
  strength: EnvMapStrength
  /** 置き場(04 が伏せた形。念のため個人のフォルダの名前は `~` に伏せ直す) */
  place: string
  desc: string
  /** つながっている線の数(［今］に描く線だけで数える) */
  degree: number
}

export interface EnvMapEdge {
  src: string
  dst: string
  /** 線の説明(04 が書いた日本語) */
  label: string
  /** 食い違う決まりの線(赤で描く) */
  conflict: boolean
}

export interface EnvMapData {
  /** map.json の形の版(無い古い形は null) */
  schema: number | null
  /** 地図の作成の時刻(ミリ秒。map.json の generated_at は日本時間で時差の印が無い) */
  generatedAt: number | null
  /** 作成から7日を超えた(A27) */
  stale: boolean
  layers: EnvMapLayer[]
  /** ［今］に出す箱(理想の箱 ghost は除く) */
  nodes: EnvMapNode[]
  /** 両端の箱が残る線だけ */
  edges: EnvMapEdge[]
}

/** 地図が描けないときの理由(A3・A4)。画面には文をそのまま出す */
export interface EnvMapProblem {
  kind: "no-config" | "missing" | "broken" | "newer-schema" | "bad-shape" | "unreadable"
  message: string
}

export interface EnvMapSessionItem {
  /** Desktop のセッション識別子 */
  id: string
  title: string
  /** 最後に動いた時刻(ミリ秒) */
  lastActivityAt: number | null
  archived: boolean
  running: boolean
}

export interface EnvMapResponse {
  generatedAt: number
  map: EnvMapData | null
  problem: EnvMapProblem | null
  /** 直近30日に動いたセッション(新しい順) */
  sessions: EnvMapSessionItem[]
  /** 既定で選ぶセッション(直近に動いた物。無ければ null) */
  defaultSession: string | null
}

/** ルートの1歩(続く同じ箱をまとめた物)。box は地図の箱の id */
export interface RouteStep {
  box: string
  /** まとめた道具の回数(入口・グループの歩は0) */
  calls: number
}

/** 初めて通った順の箱(①〜)。visits は、その箱を歩として通った回数(戻ると増える) */
export interface RouteVisit {
  box: string
  order: number
  calls: number
  visits: number
}

export interface RouteCount {
  /** 箱の id か、地図に無い道具の名前 */
  key: string
  /** key が箱の id か */
  isBox: boolean
  count: number
}

/** 空の状態(A25) */
export type RouteEmpty = "no-tools" | "no-box" | null

export interface RouteInstruction {
  /** 何番目の指示か(1から) */
  index: number
  startAt: number | null
  endAt: number | null
  /** 数える道具の回数(規則11 の道具を除く) */
  calls: number
  /** 多かった道具(箱か道具の名前。2つまで) */
  top: RouteCount[]
  /** 時刻の順の歩(入口・グループを含む) */
  steps: RouteStep[]
  /** 初めて通った順(入口・グループを含む) */
  visits: RouteVisit[]
  /** 地図に無い道具の名前と回数(規則9) */
  others: RouteCount[]
  /** 見張りのフックを通った回数(規則7。段1 は歩にせず印) */
  guard: number
  /** 呼んだ役の数(サブエージェントの中の道具は数えない。A5d) */
  agents: number
  empty: RouteEmpty
  /** 動いている途中の指示 */
  running: boolean
}

export interface RouteResponse {
  sessionId: string
  /** 入口の箱(entry:desktop か task:<id>) */
  entry: string
  /** グループの箱。分からなければ null(「グループ不明」) */
  group: string | null
  instructions: RouteInstruction[]
  /** 読んだ会話記録の大きさ(バイト) */
  bytes: number
  /** 読み取りに失敗したときの文 */
  problem: string | null
}
