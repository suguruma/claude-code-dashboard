import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { alertBands, CpuFileState, findGaps, readCpuFile, thresholdOf, toPoints } from "./cpuLog"
import { dayKey, MonitorService } from "./monitorService"

// 値はどれも合成(本物の題名・ID ではない)
const HEAD7 = "time\tkind\tkey\ttitle\tcpu_pct\tmem_mb\tprocs"
const HEAD8 = `${HEAD7}\tmem_total_mb`
const pad = (n: number) => String(n).padStart(2, "0")
const stamp = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const T0 = new Date(2026, 9, 26, 14, 30, 5).getTime()
const MIN = 60_000

function parse(text: string) {
  const s = new CpuFileState()
  s.feed(text, true)
  return s
}

describe("[WC-3] CPU の記録を読む(A3・A13・A14・A33・A34)", () => {
  it("続いた alert の行(間が3分以内)を1つの帯にまとめ、開始・終了・最大は alert の行の値。total が高くても alert の行が無ければ帯は出ない", () => {
    const lines = [HEAD7]
    for (let i = 0; i < 10; i++) {
      const t = T0 + i * MIN
      lines.push([stamp(t), "total", "all", "", i < 6 ? "88.0" : "95.0", "20000", "180"].join("\t"))
      if (i < 6 && i !== 3) lines.push([stamp(t), "alert", "high", "CPU 85% 以上", String(86 + i), "", ""].join("\t"))
    }
    const bands = alertBands(parse(lines.join("\n")).records(), "cpu")
    expect(bands).toEqual([{ start: T0, end: T0 + 5 * MIN, max: 91, peakAt: T0 + 5 * MIN, threshold: 85 }])
  })

  it("しきい値は title の数字(90 なら 90)。読めない title の行は警告には数え、しきい値は null", () => {
    expect(thresholdOf("CPU 90% 以上")).toBe(90)
    expect(thresholdOf("メモリ 92.5% 以上")).toBe(92.5)
    const text = [HEAD7, [stamp(T0), "total", "all", "", "91", "1", "1"].join("\t"), [stamp(T0), "alert", "high", "高い", "91", "", ""].join("\t")].join("\n")
    expect(alertBands(parse(text).records(), "cpu")).toEqual([{ start: T0, end: T0, max: 91, peakAt: T0, threshold: null }])
  })

  it("桁区切りのコンマ(「20,751」)を数として読み、数にならない行は飛ばして数える", () => {
    const s = parse([HEAD7, [stamp(T0), "total", "all", "", "4.6", "20,751", "180"].join("\t"), [stamp(T0 + MIN), "total", "all", "", "x", "1", "1"].join("\t"), "壊れた行"].join("\n"))
    expect(toPoints(s.records())).toEqual([{ t: T0, cpu: 4.6, memMb: 20751, procs: 180 }])
    expect(s.skipped).toBe(2)
  })

  it("見出しが7列でも8列でも読み、8列のファイルは total の行の mem_total_mb を持つ。見出しより長い・短い行も見出しの列だけを読む", () => {
    const seven = parse([HEAD7, [stamp(T0), "total", "all", "", "5", "20000", "180", "32768"].join("\t")].join("\n")).records()
    expect(seven[0].memTotalMb).toBeNull()
    const eight = parse([HEAD8, [stamp(T0), "total", "all", "", "5", "20000", "180", "32768"].join("\t"), [stamp(T0), "session", "local_x1", "01_画面", "1.5", "300", "2"].join("\t")].join("\n")).records()
    expect(eight[0]).toMatchObject({ memTotalMb: 32768, sessions: [{ id: "local_x1", cpu: 1.5, memMb: 300 }] })
  })

  it("alert の行が total の直後でも、同じ time の末尾でも、session の行の間でも同じ結果。high と mem が同じ分でも1回ずつ", () => {
    const total = [stamp(T0), "total", "all", "", "90.0", "30000", "180", "32768"].join("\t")
    const high = [stamp(T0), "alert", "high", "CPU 85% 以上", "90.0", "", "", ""].join("\t")
    const mem = [stamp(T0), "alert", "mem", "メモリ 90% 以上", "91.6", "", "", ""].join("\t")
    const sess = (n: number) => [stamp(T0), "session", `local_x${n}`, "", "1", "1", "1", ""].join("\t")
    const orders = [
      [total, high, mem, sess(1), sess(2)],
      [total, sess(1), sess(2), high, mem],
      [sess(1), mem, total, sess(2), high],
    ]
    const results = orders.map((o) => {
      const recs = parse([HEAD8, ...o].join("\n")).records()
      return [alertBands(recs, "cpu"), alertBands(recs, "mem"), recs.length]
    })
    expect(results[0]).toEqual([[{ start: T0, end: T0, max: 90, peakAt: T0, threshold: 85 }], [{ start: T0, end: T0, max: 91.6, peakAt: T0, threshold: 90 }], 1])
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it("3万行(1日分)を 300ms 以内に読む。2回目は追記分だけを読む(A9)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-cpu-"))
    try {
      const file = path.join(tmp, "cpu_20261026.tsv")
      const day = new Date(2026, 9, 26).getTime()
      const lines = [HEAD8]
      for (let m = 0; m < 1440; m++) {
        const t = day + m * MIN + 19_000
        lines.push([stamp(t), "total", "all", "", "5.0", "20000", "180", "32768"].join("\t"))
        for (let i = 0; i < 20; i++) lines.push([stamp(t), "session", `local_s${i}`, `担当${i}`, "0.20", "300", "1", ""].join("\t"))
      }
      await fs.writeFile(file, lines.join("\n") + "\n", "utf-8")
      expect(lines.length).toBeGreaterThan(30_000)
      const started = performance.now()
      const first = await readCpuFile(file, undefined)
      const recs = first.state.records()
      const took = performance.now() - started
      expect(recs).toHaveLength(1440)
      expect(took).toBeLessThan(300)
      await fs.appendFile(file, [stamp(day + 1440 * MIN), "total", "all", "", "6.0", "1", "1", "32768"].join("\t") + "\n", "utf-8")
      const before = first.state.offset
      const second = await readCpuFile(file, first.state)
      expect(second.state.records()).toHaveLength(1441)
      expect(second.state.offset - before).toBeLessThan(100)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("[WC-5] 記録の途切れ(A5)", () => {
  it("前の total の記録から3分を超えて空いた所が途切れ。今日は最後の記録から今までも途切れ", () => {
    const pts = [{ t: T0 }, { t: T0 + MIN }, { t: T0 + 5 * MIN }, { t: T0 + 6 * MIN }]
    expect(findGaps(pts, null)).toEqual([{ start: T0 + MIN, end: T0 + 5 * MIN }])
    expect(findGaps(pts, T0 + 20 * MIN)).toEqual([
      { start: T0 + MIN, end: T0 + 5 * MIN },
      { start: T0 + 6 * MIN, end: T0 + 20 * MIN },
    ])
  })
})

describe("[WC-4] [WC-11] [WC-12] 見張りのサービス(A4・A15・A16・A17・A18・A33)", () => {
  let tmp: string
  const now = new Date(2026, 9, 26, 15, 0, 0).getTime()
  const today = new Date(2026, 9, 26).getTime()
  const yesterday = today - 24 * 60 * MIN

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-cpu-"))
    // 昨日：7列(総量の列なし)。今日：8列。昨日の 23:58〜今日の 00:01 は続けて記録(日付をまたいで1本の線)
    const y = [HEAD7]
    for (let m = 1438; m < 1440; m++) y.push([stamp(yesterday + m * MIN), "total", "all", "", "10.0", "16000", "100"].join("\t"))
    const t = [HEAD8]
    for (let m = 0; m < 2; m++) t.push([stamp(today + m * MIN), "total", "all", "", "12.0", "16000", "100", "32768"].join("\t"))
    // 14:30〜14:35 の記録。セッション10・セッションの外2。14:32〜14:34 にメモリの警告
    for (let m = 0; m < 6; m++) {
      const at = today + (14 * 60 + 30 + m) * MIN
      t.push([stamp(at), "total", "all", "", "40.0", "30000", "200", "32768"].join("\t"))
      if (m >= 2 && m <= 4) t.push([stamp(at), "alert", "mem", "メモリ 90% 以上", "91.5", "", "", ""].join("\t"))
      for (let i = 0; i < 10; i++) t.push([stamp(at), "session", `local_s${i}`, `担当${i}`, String(10 - i + m / 10), String(100 * (i + 1)), "2", ""].join("\t"))
      if (m === 5) {
        t.push([stamp(at), "proc", "claude", "", "3.10", "800", "1", ""].join("\t"))
        t.push([stamp(at), "proc", "MsMpEng", "", "1.20", "200", "1", ""].join("\t"))
      }
    }
    await fs.writeFile(path.join(tmp, `cpu_${dayKey(yesterday)}.tsv`), y.join("\n") + "\n", "utf-8")
    await fs.writeFile(path.join(tmp, `cpu_${dayKey(today)}.tsv`), t.join("\n") + "\n", "utf-8")
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const svc = (samePc?: boolean) =>
    new MonitorService({
      config: async () => ({ cpuDir: tmp, samePc }),
      sessions: async () => new Map([["local_s0", { title: "01_画面（Desktop）", group: "試験グループ" }]]),
      now: () => now,
      hostMemMb: 16384,
    })

  it("選んだ時刻にいちばん近い記録(前後1分)のセッションを CPU の多い順に。題名は Desktop、無ければファイル。セッションの外は、その時刻の行だけ", async () => {
    const at = today + (14 * 60 + 35) * MIN + 20_000
    const snap = await svc().snapshot(at)
    expect(snap.t).toBe(today + (14 * 60 + 35) * MIN)
    expect(snap.sessions.map((s) => s.title).slice(0, 3)).toEqual(["01_画面（Desktop）", "担当1", "担当2"])
    expect(snap.sessions[0].group).toBe("試験グループ")
    expect(snap.others.map((o) => o.name)).toEqual(["claude", "MsMpEng"])
    expect((await svc().snapshot(today + (14 * 60 + 33) * MIN)).others).toEqual([])
  })

  it("直近30分の小さな線は30点で、記録の無い分は null", async () => {
    const snap = await svc().snapshot(today + (14 * 60 + 35) * MIN)
    expect(snap.sessions[0].sparkCpu).toHaveLength(30)
    expect(snap.sessions[0].sparkCpu.slice(-6).every((v) => v !== null)).toBe(true)
    expect(snap.sessions[0].sparkCpu[0]).toBeNull()
    expect(snap.sessions[0].sparkMem.slice(-1)).toEqual([100])
  })

  it("前後1分に記録が無いときは t=null と、いちばん近い記録の時刻", async () => {
    const snap = await svc().snapshot(today + 13 * 60 * MIN)
    expect(snap.t).toBeNull()
    expect(snap.nearest).toBe(today + (14 * 60 + 30) * MIN)
  })

  it("24時間の図は前の日(7列)と今日(8列)をまたいで1本の線。8列の日は記録の総量を使い samePc を見ない", async () => {
    const res = await svc(false).load({ rangeHours: 24 })
    expect(res.points.slice(0, 4).map((p) => p.cpu)).toEqual([10, 10, 12, 12])
    expect(res.gaps[0]).toEqual({ start: today + MIN, end: today + (14 * 60 + 30) * MIN })
    expect(res).toMatchObject({ memTotalMb: 32768, memTotalSource: "log" })
  })

  it("総量の列が無い日は Dashboard の PC の総量。samePc=false なら総量を返さない(GB だけ)", async () => {
    const past = (samePc?: boolean) => svc(samePc).load({ date: `${dayKey(yesterday).slice(0, 4)}-${dayKey(yesterday).slice(4, 6)}-${dayKey(yesterday).slice(6)}` })
    expect(await past()).toMatchObject({ isToday: false, rangeHours: 24, memTotalMb: 16384, memTotalSource: "host" })
    expect(await past(false)).toMatchObject({ memTotalMb: null, memTotalSource: null })
  })

  it("key=mem の行があるときだけメモリの警告。しきい値は title の数字、最大は使用率。CPU の警告には数えない", async () => {
    const res = await svc().load({ rangeHours: 6 })
    expect(res.alerts.mem).toEqual([{ start: today + (14 * 60 + 32) * MIN, end: today + (14 * 60 + 34) * MIN, max: 91.5, peakAt: today + (14 * 60 + 32) * MIN, threshold: 90 }])
    expect(res.alerts.cpu).toEqual([])
    expect(res.thresholds).toEqual({ cpu: null, mem: 90 })
    expect(res.dayHasAlert).toBe(true)
  })

  it("警告の要約：最後の alert の行が10分より前なら active=false(灰色の1行)。今日あったら today", async () => {
    const res = await svc().alerts()
    expect(res.items).toEqual([{ key: "mem", band: expect.objectContaining({ max: 91.5, threshold: 90 }), active: false, count: 1 }])
    expect(res.today).toBe(true)
    const soon = new MonitorService({ config: async () => ({ cpuDir: tmp }), now: () => today + (14 * 60 + 40) * MIN })
    expect((await soon.alerts()).items[0].active).toBe(true)
  })

  it("応答にフォルダのパス・ファイルの名前が無く、ファイルに書き込まない", async () => {
    const writes = [vi.spyOn(fs, "writeFile"), vi.spyOn(fs, "appendFile")]
    const json = JSON.stringify([await svc().load({ rangeHours: 24 }), await svc().snapshot(today + (14 * 60 + 35) * MIN), await svc().alerts()])
    for (const w of writes) expect(w).not.toHaveBeenCalled()
    expect(json).not.toContain(tmp.replace(/\\/g, "\\\\"))
    expect(json).not.toContain("cpu_2026")
  })
})
