/**
 * 見張り(⑭ リソースのページ)の API の応答の型。画面とサーバーで共有する(サーバー専用のモジュールを import しない)。
 * 応答に、設定したパスとファイルの生の行は入れない(WC-10。画面に要る項目だけ)。
 */

/** ファイルを読めたか。unset: 設定に場所が無い / missing: ファイルが無い / refused: 拒否リストに当たる場所 / unreadable: 大きすぎる・読めない */
export type MonitorFileStatus = "ok" | "unset" | "missing" | "refused" | "unreadable"

export type PlanState = "doing" | "todo" | "later" | "waiting"

export interface PlanItem {
  sessionId: string
  /** Desktop のセッションの今の題名。結べないときはファイルの題名か ID の先頭(WC-7) */
  title: string
  task: string
  state: PlanState
  /** 順(1 が先)。書かれていなければ null */
  order: number | null
  /** 大きさ(小・中・大)と再開のしやすさ(易・難)。ファイルの値のまま */
  size: string
  resume: string
  updatedAt: number | null
}

export interface PlanGroup {
  name: string
  counts: Record<PlanState, number>
  items: PlanItem[]
}

export interface WaitingItem {
  sessionId: string
  title: string
  group: string
  /** 回復の見込みの時刻。空・読めないときは null */
  resetsAt: number | null
  /** 回復の後の次の一歩(秘密とパスは伏せる) */
  next: string
}

export interface MonitorPlanResponse {
  /** config/monitor.json があるか。無いときは画面に設定の案内を出す(WC-8) */
  configured: boolean
  generatedAt: number
  waiting: {
    status: MonitorFileStatus
    items: WaitingItem[]
    /** 今日、再開した・起こした件数(畳んで出す) */
    resumedToday: number
    sentToday: number
    /** 列の足りない行など、飛ばした行の数 */
    skipped: number
  }
  plan: {
    status: MonitorFileStatus
    groups: PlanGroup[]
    doneCount: number
    skipped: number
  }
}

/** 警告の種類。cpu は alert の行の key=high、mem は key=mem */
export type AlertKey = "cpu" | "mem"

export interface AlertBand {
  start: number
  /** 最後の alert の行の時刻 */
  end: number
  /** alert の行の値(cpu_pct の列)の最大 */
  max: number | null
  /** 最大の alert の行の時刻(［ピークを見る］で選ぶ時刻) */
  peakAt: number
  /** title から読んだしきい値。読めないときは null */
  threshold: number | null
}

/** 推移の図の1点(total の行。約1分ごと) */
export interface LoadPoint {
  t: number
  cpu: number
  memMb: number | null
  procs: number | null
}

export interface MonitorLoadResponse {
  configured: boolean
  /** CPU の記録のフォルダと、見ている日のファイルを読めたか */
  status: MonitorFileStatus
  generatedAt: number
  /** 見ている日(YYYY-MM-DD)と、ファイルのある日(新しい順) */
  date: string
  days: string[]
  isToday: boolean
  rangeHours: number
  from: number
  to: number
  points: LoadPoint[]
  /** メモリの総量(MB)と出どころ。log: 記録の total の行(8列のファイル) / host: Dashboard の PC / null: 分からない(samePc=false) */
  memTotalMb: number | null
  memTotalSource: "log" | "host" | null
  /** 窓の中の alert の行から読んだしきい値(無ければ null。線を引かない) */
  thresholds: Record<AlertKey, number | null>
  alerts: Record<AlertKey, AlertBand[]>
  gaps: Array<{ start: number; end: number }>
  /** その日に alert の行があったか(図の下の「この日は警告の行がありません」) */
  dayHasAlert: boolean
  /** 見ている日の最後の記録(今日の記録が無いときの文に使う) */
  lastRecordAt: number | null
  skipped: number
}

export interface SnapshotSession {
  id: string
  title: string
  group: string | null
  cpu: number
  memMb: number | null
  procs: number | null
  /** 直近30分の値(1分ごと。記録の無い分は null) */
  sparkCpu: Array<number | null>
  sparkMem: Array<number | null>
}

export interface MonitorSnapshotResponse {
  configured: boolean
  /** 選んだ時刻の前後1分にあった記録の時刻。無ければ null */
  t: number | null
  /** 前後1分に無いときの、いちばん近い記録の時刻 */
  nearest: number | null
  total: { cpu: number; memMb: number | null; procs: number | null } | null
  memTotalMb: number | null
  sessions: SnapshotSession[]
  /** セッションの外のプログラム(proc の行。CPU 1% 以上の上位3つ) */
  others: Array<{ name: string; cpu: number; memMb: number | null }>
}

/** ホームの帯・サイドバーの「！」・通知に使う警告の要約(WC-6・WC-12。帯に要る項目だけ) */
export interface PcAlertItem {
  key: AlertKey
  band: AlertBand
  /** 最後の alert の行が直近10分か(赤い帯)。過ぎてから24時間は false(灰色の1行) */
  active: boolean
  /** 直近24時間の帯の数(「ほか n回」) */
  count: number
}

export interface MonitorAlertSummary {
  configured: boolean
  generatedAt: number
  /** 直近24時間で最後の帯(CPU・メモリそれぞれ) */
  items: PcAlertItem[]
  /** 今日、alert の行があったか(サイドバーの「リソース」の「！」) */
  today: boolean
}

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  doing: "作業中",
  waiting: "待ち（上限）",
  todo: "これから",
  later: "後で",
}
