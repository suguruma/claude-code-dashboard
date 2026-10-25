import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  emptyText,
  gapSummary,
  homeAlertText,
  initialTime,
  timeToPinOnMetricSwitch,
  memText,
  pageAlertText,
  sparkLabel,
  splitTop,
  stepTime,
  thresholdLine,
  valueText,
  yMax,
} from "./loadView"
import type { AlertBand, LoadPoint, MonitorLoadResponse, PcAlertItem, SnapshotSession } from "./monitorTypes"
import { createPcAlertNotifyTracker, PC_ALERT_TARGET } from "./pcAlertNotifications"

// 値はどれも合成
const T0 = new Date(2026, 9, 26, 14, 30).getTime()
const MIN = 60_000
const pts: LoadPoint[] = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * MIN, cpu: 10 + i, memMb: 20000 + i, procs: 100 }))
const band = (start: number, end: number, max: number | null, threshold: number | null, peakAt = end): AlertBand => ({ start, end, max, peakAt, threshold })
const item = (key: "cpu" | "mem", b: AlertBand, active: boolean, count = 1): PcAlertItem => ({ key, band: b, active, count })
const sess = (n: number, cpu: number, memMb: number): SnapshotSession => ({ id: `local_s${n}`, title: `担当${n}`, group: null, cpu, memMb, procs: 1, sparkCpu: [], sparkMem: [] })

describe("[WC-4] 時刻の選び方と表(A4・A25・A27)", () => {
  it("←→ は前後の記録、Shift+←→ は10分、Home／End は最初と最後", () => {
    const cur = T0 + 10 * MIN
    expect(stepTime(pts, cur, "ArrowLeft", false)).toBe(T0 + 9 * MIN)
    expect(stepTime(pts, cur, "ArrowRight", false)).toBe(T0 + 11 * MIN)
    expect(stepTime(pts, cur, "ArrowRight", true)).toBe(T0 + 20 * MIN)
    expect(stepTime(pts, cur, "ArrowLeft", true)).toBe(T0)
    expect(stepTime(pts, cur, "Home", false)).toBe(T0)
    expect(stepTime(pts, cur, "End", false)).toBe(T0 + 29 * MIN)
    expect(stepTime(pts, T0, "ArrowLeft", false)).toBe(T0)
    expect(stepTime(pts, cur, "a", false)).toBeNull()
  })

  it("最初の時刻は、図に出しているほうの最後の警告のピーク。無ければもう片方、それも無ければ最後の記録", () => {
    const alerts = { cpu: [band(T0, T0 + 5 * MIN, 90, 85, T0 + 3 * MIN)], mem: [band(T0 + 10 * MIN, T0 + 12 * MIN, 91, 90, T0 + 11 * MIN)] }
    expect(initialTime(pts, alerts, "cpu")).toBe(T0 + 3 * MIN)
    expect(initialTime(pts, alerts, "mem")).toBe(T0 + 11 * MIN)
    expect(initialTime(pts, { cpu: [], mem: alerts.mem }, "cpu")).toBe(T0 + 11 * MIN)
    expect(initialTime(pts, { cpu: [], mem: [] }, "cpu")).toBe(T0 + 29 * MIN)
  })

  it("[WC-11] ［CPU］［メモリ］を切り替えても選んだ時刻は動かない。まだ選んでいないときは、今の最初の時刻を選んだことにする(⑭ のゲート2 の L4)", () => {
    const alerts = { cpu: [band(T0, T0 + 5 * MIN, 90, 85, T0 + 3 * MIN)], mem: [band(T0 + 10 * MIN, T0 + 12 * MIN, 91, 90, T0 + 11 * MIN)] }
    const first = initialTime(pts, alerts, "cpu")
    expect(timeToPinOnMetricSwitch(first, null)).toBe(T0 + 3 * MIN)
    expect(timeToPinOnMetricSwitch(first, T0 + 20 * MIN)).toBeNull()
    expect(timeToPinOnMetricSwitch(null, null)).toBeNull()
  })

  it("表は上位8件と「ほか n」の合計。並びは選んだほう(CPU・メモリ)の多い順", () => {
    const list = Array.from({ length: 11 }, (_, i) => sess(i, 11 - i, 100 * (i + 1)))
    const byCpu = splitTop(list, "cpu")
    expect(byCpu.top.map((s) => s.id).slice(0, 2)).toEqual(["local_s0", "local_s1"])
    expect(byCpu.top).toHaveLength(8)
    expect(byCpu.rest).toEqual({ count: 3, cpu: 3 + 2 + 1, memMb: 900 + 1000 + 1100 })
    expect(splitTop(list, "mem").top[0].id).toBe("local_s10")
  })

  it("図の読み上げの文と、小さな線の読み上げの名前", () => {
    expect(valueText(pts[3], "cpu")).toBe("14:33・CPU 13%")
    expect(valueText(null, "cpu")).toBe("記録なし")
    expect(sparkLabel([1, null, 38.2], "cpu")).toBe("直近30分：最大 38%")
    expect(sparkLabel([null], "cpu")).toBe("直近30分：記録なし")
  })
})

describe("[WC-5] 途切れの文(A5)", () => {
  it("図の下に「記録なし n回・最長 n分」", () => {
    expect(gapSummary([{ start: 0, end: 4 * MIN }, { start: 10 * MIN, end: 36 * MIN }])).toBe("記録なし 2回・最長 26分")
    expect(gapSummary([])).toBeNull()
  })
})

describe("[WC-11] メモリの見せ方(A17・A19)", () => {
  it("「32GB 中 21.4GB（67%）」。総量が分からないときは GB だけ", () => {
    expect(memText(21914, 32768)).toBe("32GB 中 21.4GB（67%）")
    expect(memText(21914, null)).toBe("21.4GB")
  })

  it("縦軸の上端は、CPU は 100、メモリは総量(GB)。総量が分からないときは記録の最大に合わせる", () => {
    expect(yMax(pts, "cpu", null)).toBe(100)
    expect(yMax(pts, "mem", 32768)).toBe(32)
    expect(yMax(pts, "mem", null)).toBe(Math.ceil((20029 / 1024) * 1.1))
  })
})

describe("[WC-12] しきい値の線と警告の文(A13・A18・A30)", () => {
  it("しきい値は受け取った数字のまま。メモリの線は総量×しきい値の GB、総量が分からなければ引かない", () => {
    expect(thresholdLine(90, "cpu", null)).toBe(90)
    expect(thresholdLine(90, "mem", 32768)).toBeCloseTo(28.8)
    expect(thresholdLine(90, "mem", null)).toBeNull()
    expect(thresholdLine(null, "cpu", null)).toBeNull()
  })

  it("画面とライブラリに、しきい値の数(85・90)を持たない", () => {
    const dir = path.resolve(__dirname)
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    const comps = path.resolve(__dirname, "../../components/resources")
    const all = [...files.map((f) => path.join(dir, f)), ...readdirSync(comps).map((f) => path.join(comps, f))]
    for (const f of all) {
      const code = readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
      expect(code, f).not.toMatch(/(?<![\d.])(85|90)(?![\d])/)
    }
  })

  it("ページの上の帯の文：しきい値と時間帯と最大。複数回なら「ほか n回」。読めないしきい値は「警告」", () => {
    expect(pageAlertText(item("cpu", band(T0, T0 + 6 * MIN, 88, 85), true, 3))).toBe("PC の CPU が 85% を超えました　14:30〜14:36（最大 88%）　ほか 2回")
    expect(pageAlertText(item("mem", band(T0, T0, null, null), false))).toBe("PC の メモリ の警告　14:30")
  })

  it("[WC-6] ホームの帯：直近10分は「！」つき、過ぎたら灰色の1行。CPU とメモリは1本。無ければ出さない(帯の高さが変わらない)", () => {
    const cpu = item("cpu", band(T0, T0 + 6 * MIN, 88, 85), true)
    const mem = item("mem", band(T0 + 2 * MIN, T0 + 4 * MIN, 91.5, 90), false)
    expect(homeAlertText([cpu, mem])).toEqual({ active: true, text: "！ PC の CPU 88%（警告）14:30〜14:36" })
    expect(homeAlertText([{ ...cpu, active: false }, mem])).toEqual({
      active: false,
      text: "今日 PC の負荷が警告を超えました：CPU 14:30〜14:36（最大 88%）・メモリ 14:32〜14:34（最大 92%）",
    })
    expect(homeAlertText([])).toBeNull()
  })

  it("[WC-6] 通知：新しく始まった直近10分の帯だけ1回。最初の取得は基準を取るだけ。押すと［負荷］を開く印", () => {
    const tr = createPcAlertNotifyTracker()
    const summary = (items: PcAlertItem[]) => ({ configured: true, generatedAt: T0, items, today: true })
    const first = item("cpu", band(T0, T0 + MIN, 88, 85), true)
    expect(tr.update(summary([first]))).toEqual([])
    expect(tr.update(summary([{ ...first, band: { ...first.band, end: T0 + 3 * MIN } }]))).toEqual([])
    const next = item("cpu", band(T0 + 30 * MIN, T0 + 30 * MIN, 93, 85), true)
    const out = tr.update(summary([next]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sessionId: PC_ALERT_TARGET, title: "PC の警告: CPU が 85% 以上" })
    expect(tr.update(summary([next]))).toEqual([])
    expect(tr.update(summary([item("mem", band(T0 + 40 * MIN, T0 + 40 * MIN, 91, 90), false)]))).toEqual([])
  })
})

describe("[WC-14] 空の状態の文(A32)", () => {
  const base: MonitorLoadResponse = {
    configured: true,
    status: "ok",
    generatedAt: T0,
    date: "2026-10-26",
    days: ["2026-10-26", "2026-10-24"],
    isToday: true,
    rangeHours: 6,
    from: T0,
    to: T0 + 60 * MIN,
    points: pts,
    memTotalMb: null,
    memTotalSource: null,
    thresholds: { cpu: null, mem: null },
    alerts: { cpu: [], mem: [] },
    gaps: [],
    dayHasAlert: false,
    lastRecordAt: T0,
    skipped: 0,
  }

  it("記録があるときは文を出さない(図を出す)", () => {
    expect(emptyText(base)).toBeNull()
  })

  it("今日のファイルが無い・選んだ日が無い・範囲に記録が無い・設定が無い・拒否", () => {
    const last = new Date(2026, 9, 25, 23, 59).getTime()
    expect(emptyText({ ...base, status: "missing", points: [], lastRecordAt: last })).toBe(
      "今日の記録はまだありません（最後の記録：10/25 23:59）。PC を起動し直した後は、記録の仕組みが動くまで空きます。日付を選ぶと前の日を見られます"
    )
    expect(emptyText({ ...base, status: "missing", isToday: false, date: "2026-10-22", points: [] })).toBe("10/22 の記録はありません。記録があるのは 10/24 からです")
    expect(emptyText({ ...base, points: [] })).toBe("この時間帯には記録がありません（PC が止まっていたか、記録の仕組みが動いていませんでした）")
    expect(emptyText({ ...base, status: "unset" })).toContain("config/monitor.json")
    expect(emptyText({ ...base, status: "refused" })).toContain("読みません")
  })
})
