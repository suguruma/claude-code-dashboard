/**
 * ホームの段階的な表示(⑫)の決まり。画面に依らない関数だけを置く(テストで確かめる)。
 * - 欄の状態は「答え・失敗・待った時間」だけで決める。画面の側で要求を時間で打ち切らない(ST-8)。
 * - 「読めませんでした」は、サーバーが 500 などを返したとき・通信が切れたとき(= SWR の error)だけ。
 */

/** 上のバーの印を出すまでの待ち(ms)。速い PC では印が一度も出ない(ST-9) */
export const MARKS_DELAY_MS = 1_500
/** 件数が、利用上限の公式値を待つ最長の時間(ms)。そろえば一緒に出し、越えたら件数だけ先に出す(ST-7) */
export const OFFICIAL_WAIT_MS = 1_500
/** 「時間がかかっています（30秒以上）」を出すまでの時間(ms)。要求は切らない(ST-8) */
export const SLOW_NOTICE_MS = 30_000
/** 上のバーの秒を出し始めるまでの時間(ms)(中7) */
export const ELAPSED_SHOW_MS = 3_000

export type SectionPhase = "loading" | "slow" | "ready" | "failed"

/** 欄の状態。答えがあれば ready(失敗が後から来ても、前の答えを出し続ける) */
export function sectionPhase(input: { hasData: boolean; failed: boolean; startedAt: number; now: number }): SectionPhase {
  if (input.hasData) return "ready"
  if (input.failed) return "failed"
  return input.now - input.startedAt >= SLOW_NOTICE_MS ? "slow" : "loading"
}

/**
 * 件数のカードに数字を出してよいか。一覧の答えが来てから、公式値を最長 OFFICIAL_WAIT_MS だけ待つ。
 * 公式値が来た・失敗した・待ちを越えた、のどれかで出す(公式値が失敗しても件数は出す)
 */
export function countsVisible(input: { listReadyAt: number | null; usagePhase: SectionPhase; now: number }): boolean {
  if (input.listReadyAt === null) return false
  if (input.usagePhase === "ready" || input.usagePhase === "failed") return true
  return input.now - input.listReadyAt >= OFFICIAL_WAIT_MS
}

export type StageId = "counts" | "usage" | "org"

export const STAGE_LABEL: Record<StageId, string> = {
  counts: "次にやる判断",
  usage: "利用上限",
  org: "組織図",
}

/** 印を押したときに移る欄の id */
export const STAGE_TARGET_ID: Record<StageId, string> = {
  counts: "home-decisions",
  usage: "home-usage-strip",
  org: "home-org",
}

export interface StageMark {
  id: StageId
  phase: SectionPhase
}

export interface MarksView {
  /** 印を出すか */
  visible: boolean
  /** 済んだ数(「読み込み中 2/3」) */
  done: number
  total: number
  /** 秒の表示(3秒たってから。そろったら出さない) */
  elapsedSeconds: number | null
}

/**
 * 上のバーの印(ST-9)。1.5秒以上待ったときだけ出し、そろったら消す。失敗の印は、押して閉じるか直るまで残す。
 * firstLoadDone(初めての読み込みが済んだ)の後は、再取得のあいだも出さない。
 */
export function marksView(input: {
  marks: StageMark[]
  startedAt: number
  now: number
  firstLoadDone: boolean
  failureDismissed: boolean
}): MarksView {
  const total = input.marks.length
  const done = input.marks.filter((m) => m.phase === "ready").length
  const failed = input.marks.some((m) => m.phase === "failed")
  const elapsed = input.now - input.startedAt
  const waiting = done + input.marks.filter((m) => m.phase === "failed").length < total
  if (failed && !input.failureDismissed) {
    return { visible: true, done, total, elapsedSeconds: waiting && elapsed >= ELAPSED_SHOW_MS ? Math.floor(elapsed / 1000) : null }
  }
  if (input.firstLoadDone || !waiting || elapsed < MARKS_DELAY_MS) return { visible: false, done, total, elapsedSeconds: null }
  return { visible: true, done, total, elapsedSeconds: elapsed >= ELAPSED_SHOW_MS ? Math.floor(elapsed / 1000) : null }
}

/** 印の記号(色だけに頼らない) */
export function markSymbol(phase: SectionPhase): string {
  if (phase === "ready") return "✓"
  if (phase === "failed") return "！"
  return "…"
}

/** 組織図の枠の高さの初めての値(px)。読み込み後の実測(合成データで約1640px。⑬ で4つの集計をやめる前に測った)に近い値 */
export const ORG_FRAME_DEFAULT_HEIGHT = 1_400
/** 覚えておく高さの範囲(px)。壊れた値で枠が極端にならないように */
export const ORG_FRAME_MIN_HEIGHT = 320
export const ORG_FRAME_MAX_HEIGHT = 4_000

/**
 * 覚えておいた組織図の高さ(グループ・範囲ごと)を、枠の高さに直す。
 * グループがまだ分からない・そのグループの高さが無いときは、同じ範囲で最後に覚えた高さを使う(一覧の答えが来る前の枠)
 */
export function orgFrameHeight(saved: Record<string, number> | null | undefined, groupId: string | null, rangeHours: number): number {
  const exact = groupId ? saved?.[`${groupId}|${rangeHours}`] : undefined
  const latest = Object.entries(saved ?? {})
    .filter(([key]) => key.endsWith(`|${rangeHours}`))
    .at(-1)?.[1]
  const value = typeof exact === "number" ? exact : latest
  if (typeof value !== "number" || !Number.isFinite(value)) return ORG_FRAME_DEFAULT_HEIGHT
  return Math.min(ORG_FRAME_MAX_HEIGHT, Math.max(ORG_FRAME_MIN_HEIGHT, Math.round(value)))
}

/** 覚えておく高さを足した、新しい表(数だけ。グループ・範囲は最大20組) */
export function rememberOrgHeight(
  saved: Record<string, number> | null | undefined,
  groupId: string,
  rangeHours: number,
  height: number
): Record<string, number> {
  const key = `${groupId}|${rangeHours}`
  const rounded = Math.min(ORG_FRAME_MAX_HEIGHT, Math.max(ORG_FRAME_MIN_HEIGHT, Math.round(height)))
  const entries = Object.entries(saved ?? {}).filter(([k, v]) => k !== key && typeof v === "number")
  return Object.fromEntries([...entries.slice(-19), [key, rounded]])
}

/** 失敗の理由(利用者向けの短い文)。サーバーが答えた失敗と、つながらなかった失敗を分ける */
export function failureReason(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === "number") return "サーバーがエラーを返しました"
  return "サーバーにつながりませんでした"
}
