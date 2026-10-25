import type { AlertBand, AlertKey, LoadPoint, MonitorLoadResponse, PcAlertItem, SnapshotSession } from "./monitorTypes"

/**
 * ［負荷］の画面の計算と文(⑭ WC-3〜WC-6・WC-11〜WC-13)。画面とテストで同じものを使う(サーバー専用のモジュールを import しない)。
 * しきい値の数字はここにも持たない(alert の行の title から読んだ値を受け取る。A13)。
 */

export type Metric = "cpu" | "mem"

/** 上位の数(つながりの図の点と表で同じ。A4・A20・A27) */
export const TOP_N = 8

export function hhmm(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function gb(mb: number): string {
  return `${(mb / 1024).toFixed(1)}GB`
}

/** 「32GB 中 21.4GB（67%）」。総量が分からないときは GB だけ(WC-11) */
export function memText(memMb: number | null, totalMb: number | null): string {
  if (memMb === null) return "—"
  if (totalMb === null || totalMb <= 0) return gb(memMb)
  return `${Math.round(totalMb / 1024)}GB 中 ${gb(memMb)}（${Math.round((memMb / totalMb) * 100)}%）`
}

export function pct(v: number): string {
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`
}

/** 推移の図の縦の値(CPU は %、メモリは GB) */
export function valueOf(p: LoadPoint, metric: Metric): number | null {
  return metric === "cpu" ? p.cpu : p.memMb === null ? null : p.memMb / 1024
}

/** 縦軸の上端：CPU は 100%。メモリは総量(GB)、分からないときは記録の最大値に合わせる(WC-11・L4) */
export function yMax(points: ReadonlyArray<LoadPoint>, metric: Metric, memTotalMb: number | null): number {
  if (metric === "cpu") return 100
  if (memTotalMb) return memTotalMb / 1024
  const max = Math.max(0, ...points.map((p) => (p.memMb ?? 0) / 1024))
  return max > 0 ? Math.ceil(max * 1.1) : 1
}

/** しきい値の線の高さ：CPU は %、メモリは総量×しきい値÷100 の GB。総量が分からないメモリは線を引かない(WC-12) */
export function thresholdLine(threshold: number | null, metric: Metric, memTotalMb: number | null): number | null {
  if (threshold === null) return null
  if (metric === "cpu") return threshold
  return memTotalMb ? (memTotalMb / 1024) * (threshold / 100) : null
}

/** 選んだ時刻の読み上げの文：「14:33・CPU 88%」「14:33・メモリ 21.4GB」 */
export function valueText(p: LoadPoint | null, metric: Metric): string {
  if (!p) return "記録なし"
  return metric === "cpu" ? `${hhmm(p.t)}・CPU ${pct(p.cpu)}` : `${hhmm(p.t)}・メモリ ${p.memMb === null ? "—" : gb(p.memMb)}`
}

export function nearestPoint(points: ReadonlyArray<LoadPoint>, t: number): LoadPoint | null {
  let best: LoadPoint | null = null
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
  return best
}

/**
 * 時刻の選び方(A25)。←→ で前後の記録、Shift+←→ で10分、Home／End で最初と最後。返すのは記録の時刻
 */
export function stepTime(points: ReadonlyArray<LoadPoint>, current: number, key: string, shift: boolean): number | null {
  if (points.length === 0) return null
  if (key === "Home") return points[0].t
  if (key === "End") return points[points.length - 1].t
  const dir = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0
  if (dir === 0) return null
  if (shift) return nearestPoint(points, current + dir * 10 * 60_000)?.t ?? null
  const i = points.findIndex((p) => p.t >= current)
  const idx = i === -1 ? points.length - 1 : points[i].t === current ? i + dir : dir > 0 ? i : i - 1
  return points[Math.min(Math.max(idx, 0), points.length - 1)].t
}

/** 最初に選ぶ時刻：窓に警告があれば最後の警告のピーク、無ければ最後の記録(P3〜P5) */
export function initialTime(points: ReadonlyArray<LoadPoint>, alerts: Record<AlertKey, AlertBand[]>, metric: Metric): number | null {
  // 図に出しているほう(CPU・メモリ)の警告を先に見る
  const own = alerts[metric]
  const other = alerts[metric === "cpu" ? "mem" : "cpu"]
  const latest = own[own.length - 1] ?? other[other.length - 1]
  if (latest) return latest.peakAt
  return points[points.length - 1]?.t ?? null
}

/**
 * ［CPU］［メモリ］を切り替えるときに、選んだことにする時刻(⑭ のゲート2 の L4・WC-11)。まだ選んでいない(最初の時刻を出している)ときだけ、
 * 今の時刻を返す。最初の時刻は図に出しているほうの警告のピークなので、選んだことにしないと切り替えで動いてしまう。選んであれば null(そのまま)
 */
export function timeToPinOnMetricSwitch(selected: number | null, picked: number | null): number | null {
  return picked === null ? selected : null
}

/** 途切れの直前の記録(［途切れの直前を見る］。最後の途切れ) */
export function beforeGap(gaps: ReadonlyArray<{ start: number; end: number }>): number | null {
  return gaps.length ? gaps[gaps.length - 1].start : null
}

/** 図の下の「記録なし n回・最長 n分」(24時間の図では3分の途切れが 1px 以下になるため) */
export function gapSummary(gaps: ReadonlyArray<{ start: number; end: number }>): string | null {
  if (gaps.length === 0) return null
  const longest = Math.max(...gaps.map((g) => g.end - g.start))
  return `記録なし ${gaps.length}回・最長 ${Math.round(longest / 60_000)}分`
}

export const ALERT_LABEL: Record<AlertKey, string> = { cpu: "CPU", mem: "メモリ" }

/** 帯の時間帯：「14:30〜14:36」 */
export function bandRange(b: AlertBand): string {
  return b.start === b.end ? hhmm(b.start) : `${hhmm(b.start)}〜${hhmm(b.end)}`
}

/** リソースのページの上の警告の帯の文：「PC の CPU が 85% を超えました　14:30〜14:36（最大 88%）」。しきい値が読めないときは「警告」 */
export function pageAlertText(item: PcAlertItem): string {
  const what = ALERT_LABEL[item.key]
  const over = item.band.threshold === null ? `PC の ${what} の警告` : `PC の ${what} が ${item.band.threshold}% を超えました`
  const max = item.band.max === null ? "" : `（最大 ${pct(item.band.max)}）`
  const more = item.count > 1 ? `　ほか ${item.count - 1}回` : ""
  return `${over}　${bandRange(item.band)}${max}${more}`
}

/** ホームの PC の警告の帯の文(4-4)。直近10分は「！ PC の CPU 88%（警告）14:30〜14:36」、過ぎたら灰色の1行。CPU とメモリは1本にまとめる */
export function homeAlertText(items: ReadonlyArray<PcAlertItem>): { active: boolean; text: string } | null {
  if (items.length === 0) return null
  const active = items.some((i) => i.active)
  if (active) {
    const parts = items
      .filter((i) => i.active)
      .map((i) => `${ALERT_LABEL[i.key]} ${i.band.max === null ? "" : pct(i.band.max)}（警告）${bandRange(i.band)}`.replace("  ", " "))
    return { active, text: `！ PC の ${parts.join("・")}` }
  }
  const parts = items.map((i) => `${ALERT_LABEL[i.key]} ${bandRange(i.band)}${i.band.max === null ? "" : `（最大 ${pct(i.band.max)}）`}`)
  return { active, text: `今日 PC の負荷が警告を超えました：${parts.join("・")}` }
}

/** 表とつながりの図の並び：選んだほう(CPU・メモリ)の多い順(P2) */
export function sortSessions(sessions: ReadonlyArray<SnapshotSession>, metric: Metric): SnapshotSession[] {
  return [...sessions].sort((a, b) => (metric === "cpu" ? b.cpu - a.cpu : (b.memMb ?? 0) - (a.memMb ?? 0)))
}

/** 上位8件と「ほか n」(A4・A27) */
export function splitTop(sessions: ReadonlyArray<SnapshotSession>, metric: Metric): {
  top: SnapshotSession[]
  rest: { count: number; cpu: number; memMb: number }
} {
  const sorted = sortSessions(sessions, metric)
  const rest = sorted.slice(TOP_N)
  return {
    top: sorted.slice(0, TOP_N),
    rest: { count: rest.length, cpu: rest.reduce((n, s) => n + s.cpu, 0), memMb: rest.reduce((n, s) => n + (s.memMb ?? 0), 0) },
  }
}

/** 直近30分の小さな線の読み上げの名前：「直近30分：最大 38%」「直近30分：最大 1.2GB」 */
export function sparkLabel(values: ReadonlyArray<number | null>, metric: Metric): string {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return "直近30分：記録なし"
  const max = Math.max(...nums)
  return `直近30分：最大 ${metric === "cpu" ? pct(max) : gb(max)}`
}

/** 過去の日の警告の回数と最大(灰色の1行。L2) */
export function pastAlertText(data: MonitorLoadResponse): string {
  const parts = (["cpu", "mem"] as const)
    .filter((k) => data.alerts[k].length > 0)
    .map((k) => {
      const max = Math.max(...data.alerts[k].map((b) => b.max ?? 0))
      return `${k === "cpu" ? "CPU" : "メモリ"} ${data.alerts[k].length}回（最大 ${pct(max)}）`
    })
  return parts.length ? `この日の警告：${parts.join("・")}` : "この日は警告の行があります（今の範囲の外）"
}

/** 空の状態の文(4-3。WC-14) */
export function emptyText(data: MonitorLoadResponse): string | null {
  if (data.status === "unset") return "CPU の記録のフォルダが設定されていません（config/monitor.json の cpuDir）。"
  if (data.status === "refused") return "CPU の記録のフォルダは、認証情報などを含むおそれがあるため読みません。"
  if (data.status === "missing" && data.isToday) {
    const last = data.lastRecordAt === null ? "" : `（最後の記録：${new Date(data.lastRecordAt).getMonth() + 1}/${new Date(data.lastRecordAt).getDate()} ${hhmm(data.lastRecordAt)}）`
    return `今日の記録はまだありません${last}。PC を起動し直した後は、記録の仕組みが動くまで空きます。日付を選ぶと前の日を見られます`
  }
  if (data.status === "missing") {
    const first = data.days[data.days.length - 1]
    return `${data.date.slice(5).replace("-", "/")} の記録はありません。${first ? `記録があるのは ${first.slice(5).replace("-", "/")} からです` : ""}`
  }
  if (data.status === "unreadable") return "CPU の記録のファイルを読めませんでした。"
  if (data.points.length === 0) return "この時間帯には記録がありません（PC が止まっていたか、記録の仕組みが動いていませんでした）"
  return null
}
