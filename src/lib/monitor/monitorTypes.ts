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

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  doing: "作業中",
  waiting: "待ち（上限）",
  todo: "これから",
  later: "後で",
}
