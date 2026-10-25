import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildFlow, frameWait, lineWidth, MAX_FPS, MAX_PARTICLES, particleCount, shouldAnimate } from "./connectionFlow"
import type { MonitorSnapshotResponse, SnapshotSession } from "./monitorTypes"

// 値はどれも合成
const sess = (n: number, cpu: number, memMb: number): SnapshotSession => ({ id: `local_s${n}`, title: `担当${n}`, group: null, cpu, memMb, procs: 1, sparkCpu: [], sparkMem: [] })
const snap = (total: number, sessions: SnapshotSession[], others = [{ name: "claude", cpu: 3, memMb: 800 }]): MonitorSnapshotResponse => ({
  configured: true,
  t: 1,
  nearest: 1,
  total: { cpu: total, memMb: 16384, procs: 200 },
  memTotalMb: 32768,
  sessions,
  others,
})

describe("[WC-13] つながりの図(A20・A21・A23・A29)", () => {
  it("25 セッションでも点は最大10(上位8件・ほか・セッションの外)。線の太さと粒の数は割合の順", () => {
    const list = Array.from({ length: 25 }, (_, i) => sess(i, 25 - i, 300))
    const flow = buildFlow(snap(90, list), "cpu")!
    expect(flow.nodes).toHaveLength(10)
    expect(flow.nodes.map((n) => n.kind)).toEqual([...Array(8).fill("session"), "others", "outside"])
    const sessions = flow.nodes.slice(0, 8)
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i - 1].width).toBeGreaterThanOrEqual(sessions[i].width)
      expect(sessions[i - 1].particles).toBeGreaterThanOrEqual(sessions[i].particles)
    }
    expect(flow.nodes.reduce((n, x) => n + x.particles, 0)).toBeLessThanOrEqual(MAX_PARTICLES)
  })

  it("点の合計＋説明できない分＝PC 全体(±0.1)", () => {
    const flow = buildFlow(snap(40, [sess(1, 12.34, 500), sess(2, 7.5, 400)]), "cpu")!
    const sum = flow.nodes.reduce((n, x) => n + x.share, 0) + flow.unexplained
    expect(Math.abs(sum - 40)).toBeLessThanOrEqual(0.1)
  })

  it("太さと粒は PC 全体に対する割合(PC が 5% のときは 90% のときより粒が少ない)。0.5% 未満は粒0", () => {
    expect(lineWidth(90)).toBe(12)
    expect(lineWidth(1)).toBe(1)
    expect(lineWidth(20)).toBe(6)
    expect(particleCount(0.4)).toBe(0)
    expect(particleCount(0.6)).toBe(1)
    expect(particleCount(13)).toBe(3)
    expect(particleCount(80)).toBe(6)
    const quiet = buildFlow(snap(5, [sess(1, 3, 100), sess(2, 1, 100)], []), "cpu")!
    const busy = buildFlow(snap(90, [sess(1, 60, 100), sess(2, 25, 100)], []), "cpu")!
    const count = (f: typeof quiet) => f.nodes.reduce((n, x) => n + x.particles, 0)
    expect(count(quiet)).toBeLessThan(count(busy))
    expect([quiet.speed, busy.speed]).toEqual(["quiet", "normal"])
  })

  it("［メモリ］では右の点がメモリになり、太さもメモリの割合(総量に対する %)", () => {
    const flow = buildFlow(snap(10, [sess(1, 1, 8192), sess(2, 9, 1024)]), "mem")!
    expect(flow.total).toBe(50)
    expect(flow.nodes[0]).toMatchObject({ key: "local_s1", share: 25 })
    expect(flow.nodes[1].share).toBeCloseTo(3.125)
  })

  it("動きを減らす設定・止める・隠れている・画面の外のときは動かさない。粒は30回／秒まで", () => {
    const base = { reducedMotion: false, paused: false, hidden: false, onScreen: true }
    expect(shouldAnimate(base)).toBe(true)
    expect(shouldAnimate({ ...base, reducedMotion: true })).toBe(false)
    expect(shouldAnimate({ ...base, paused: true })).toBe(false)
    expect(shouldAnimate({ ...base, hidden: true })).toBe(false)
    expect(shouldAnimate({ ...base, onScreen: false })).toBe(false)
    expect(MAX_FPS).toBe(30)
    // 動かさないときはタイマーを始めない(effect の最初で返す)
    const code = readFileSync(path.resolve(__dirname, "../../components/resources/ConnectionFlow.tsx"), "utf-8")
    expect(code).toMatch(/if \(!animate\) return\s+const lap/)
  })

  // ⑭ のゲート2 の L3：requestAnimationFrame を使わず、タイマーで 1/30 秒ごとに描く。タイマーが遅れても30回／秒を超えない
  it.each([0, 1, 4])("粒はタイマーが %dms 遅れても、1秒に30回まで(描くのにかかった時間は次の待ちから引く)", (lateMs) => {
    let t = 0
    let draws = 0
    while (t < 999.99) {
      draws += 1
      const drawn = t
      t = drawn + 0.5 + frameWait(drawn + 0.5, drawn) + lateMs
    }
    expect(draws).toBeLessThanOrEqual(30)
    expect(draws).toBeGreaterThanOrEqual(lateMs === 0 ? 30 : 26)
    expect(frameWait(100, 0)).toBe(0)
    const code = readFileSync(path.resolve(__dirname, "../../components/resources/ConnectionFlow.tsx"), "utf-8")
    expect(code).not.toMatch(/requestAnimationFrame\(/)
  })
})
