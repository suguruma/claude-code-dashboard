import { TOP_N, type Metric } from "./loadView"
import type { MonitorSnapshotResponse } from "./monitorTypes"

/**
 * つながりの図「どこに CPU を使っているか」(⑭ WC-13)の計算。画面とテストで同じものを使う。
 * 尺度は PC 全体に対する割合(絶対)：PC が静かなときは図も静か(P10)。
 * - 線の太さ＝割合×0.3px(最小1px・最大12px)
 * - 粒の数＝割合÷6 の切り上げ(0.5% 以上は最低1粒・1本に最大6粒・図全体で最大40粒)
 * - 点は最大10＝上位8件・ほか・セッションの外(A20)
 * - 点の合計＋説明できない分＝PC 全体(A29)
 */

export const MAX_PARTICLES = 40
export const MAX_PER_LINE = 6
/** 粒を描く回数の上限(回／秒)。数(線の太さ)は記録の間隔(約1分)で変わるだけ */
export const MAX_FPS = 30

export type FlowNodeKind = "session" | "others" | "outside"

export interface FlowNode {
  key: string
  kind: FlowNodeKind
  label: string
  /** PC 全体に対する割合(%) */
  share: number
  width: number
  particles: number
}

export interface FlowModel {
  nodes: FlowNode[]
  /** PC 全体(%)。CPU は total の cpu_pct、メモリは総量に対する使っている量 */
  total: number
  /** PC 全体から、点の合計を引いた差(システムなど。セッションの外は上位3つだけなので届かない) */
  unexplained: number
  /** 速さの2段階。PC 全体が 20% 未満のときは静か */
  speed: "normal" | "quiet"
}

export function lineWidth(share: number): number {
  return Math.min(12, Math.max(1, share * 0.3))
}

export function particleCount(share: number): number {
  if (share < 0.5) return 0
  return Math.min(MAX_PER_LINE, Math.max(1, Math.ceil(share / 6)))
}

/** 図全体の粒を40までに抑える(多い線から1つずつ減らす。1粒の線は残す) */
function capParticles(nodes: FlowNode[]): void {
  let sum = nodes.reduce((n, x) => n + x.particles, 0)
  while (sum > MAX_PARTICLES) {
    const most = nodes.reduce((a, b) => (b.particles > a.particles ? b : a))
    if (most.particles <= 1) break
    most.particles--
    sum--
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10

export function buildFlow(snap: MonitorSnapshotResponse, metric: Metric): FlowModel | null {
  if (!snap.total) return null
  // メモリの割合の分母：総量が分かれば総量、分からなければ PC 全体の使っている量
  const memBase = snap.memTotalMb ?? snap.total.memMb ?? null
  const shareOf = (cpu: number, memMb: number | null) => (metric === "cpu" ? cpu : memBase && memMb !== null ? (memMb / memBase) * 100 : 0)
  const total = metric === "cpu" ? snap.total.cpu : memBase && snap.total.memMb !== null ? (snap.total.memMb / memBase) * 100 : 0

  const sorted = [...snap.sessions].sort((a, b) => shareOf(b.cpu, b.memMb) - shareOf(a.cpu, a.memMb))
  const node = (key: string, kind: FlowNodeKind, label: string, share: number): FlowNode => ({
    key,
    kind,
    label,
    share,
    width: lineWidth(share),
    particles: particleCount(share),
  })
  const nodes: FlowNode[] = sorted.slice(0, TOP_N).map((s) => node(s.id, "session", s.title, shareOf(s.cpu, s.memMb)))
  const rest = sorted.slice(TOP_N)
  if (rest.length > 0) nodes.push(node("others", "others", `ほか ${rest.length} セッション`, rest.reduce((n, s) => n + shareOf(s.cpu, s.memMb), 0)))
  if (snap.others.length > 0) nodes.push(node("outside", "outside", "セッションの外", snap.others.reduce((n, o) => n + shareOf(o.cpu, o.memMb), 0)))
  capParticles(nodes)
  const used = nodes.reduce((n, x) => n + x.share, 0)
  return { nodes, total: round1(total), unexplained: round1(Math.max(0, total - used)), speed: total >= 20 ? "normal" : "quiet" }
}

/**
 * 粒を動かすか(A21)。動きを減らす設定・止めるボタン・窓やタブが隠れている・図が画面の外のときは動かさない
 * (別の切り替え〈利用上限・作業と待ち〉を見ているときは、図そのものを描かない)
 */
export function shouldAnimate(o: { reducedMotion: boolean; paused: boolean; hidden: boolean; onScreen: boolean }): boolean {
  return !o.reducedMotion && !o.paused && !o.hidden && o.onScreen
}

/** 粒の1周の時間(ms)。ふつうは 2.4秒、静かは 4.8秒 */
export function lapMs(speed: FlowModel["speed"]): number {
  return speed === "normal" ? 2400 : 4800
}
