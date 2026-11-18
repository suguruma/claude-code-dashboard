import { describe, expect, it } from "vitest"
import type { EnvMapData, RouteVisit } from "./envMapTypes"
import { BAND_GAP, BOX_H, BAND_PAD, EMPTY_BAND_H, GUTTER_PX, LABEL_GUTTER, circled, fitView, fitZoom, layoutNow, layoutRoute, pickInstruction, playbackInterval, stepInstruction } from "./envMapLayout"

const layers = ["entry", "safety", "routing", "skills", "tools", "knowledge", "output"].map((id) => ({ id, label: id }))
const node = (id: string, layer: string, degree = 1) => ({ id, layer, label: id, kind: "", strength: "none" as const, place: "", desc: "", degree })

function data(n: number): EnvMapData {
  const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`, layers[i % 7].id, i % 3 === 0 ? 0 : 1))
  return { schema: 1, generatedAt: 0, stale: false, layers, nodes, edges: [] }
}

describe("［今］の並べ方", () => {
  it("帯は7本、上から下。つながり無しは帯ごとに1つにまとめる", () => {
    const l = layoutNow(data(94), 977 - 32)
    expect(l.bands.map((b) => b.layer)).toEqual(layers.map((x) => x.id))
    for (let i = 1; i < l.bands.length; i++) expect(l.bands[i].y).toBeGreaterThan(l.bands[i - 1].y)
    const isolatedTotal = [...l.isolated.values()].reduce((a, b) => a + b.length, 0)
    expect(isolatedTotal).toBe(32)
    expect(l.boxes.length).toBe(94 - 32 + l.isolated.size)
    expect(l.bands.reduce((a, b) => a + b.count, 0)).toBe(94)
    // 箱は幅の中に入る
    for (const b of l.boxes) expect(b.x + b.w / 2).toBeLessThanOrEqual(977 - 32)
  })

  it("[A22] 箱200 でも全体を表示の倍率で全部入る(最小倍率を箱の数から決める)", () => {
    const l = layoutNow(data(200), 977)
    const z = fitZoom(l, 977, 555)
    expect(z).toBeGreaterThan(0)
    expect(l.height * z).toBeLessThanOrEqual(555)
    expect(l.width * z).toBeLessThanOrEqual(977)
    // 帯の名前の幅を左に取っても、箱は枠の中に入る
    const v = fitView(l, 977, 555)
    expect(v.pan.x + LABEL_GUTTER * v.zoom).toBe(GUTTER_PX)
    expect(v.pan.x + l.width * v.zoom).toBeLessThanOrEqual(977)
    expect(v.pan.y + l.height * v.zoom).toBeLessThanOrEqual(555)
  })
})

describe("ルートの詰めた表示", () => {
  it("通った箱だけ。7帯で 1.0倍のまま 1024 のルートの高さ 375px に入る", () => {
    const d = data(94)
    const visits: RouteVisit[] = ["n0", "n1", "n2", "n3", "n4", "n5", "n6"].map((box, i) => ({ box, order: i + 1, calls: 1, visits: 1 }))
    const l = layoutRoute(d, visits, 721 - 32)
    expect(l.boxes).toHaveLength(7)
    expect(l.height).toBe(7 * (BOX_H + BAND_PAD) + 6 * BAND_GAP)
    expect(l.height).toBeLessThanOrEqual(375 - 32)
    expect(fitZoom(l, 721, 375)).toBe(1)
  })
  it("[低4・低10] 印(見張り・ほか)は帯の右端に寄せ、帯の数に数えない", () => {
    const d = data(14)
    const visits: RouteVisit[] = [
      { box: "n0", order: 1, calls: 0, visits: 1 },
      { box: "n1", order: 0, calls: 5, visits: 0 },
    ]
    const l = layoutRoute(d, visits, 689, new Set(["n1"]))
    const mark = l.boxes.find((b) => b.id === "n1")!
    expect(mark.x + mark.w / 2).toBeCloseTo(689)
    expect(l.bands.find((b) => b.layer === "safety")?.count).toBe(0)
  })
  it("通っていない帯は細い", () => {
    const l = layoutRoute(data(14), [{ box: "n0", order: 1, calls: 0, visits: 1 }], 721)
    expect(l.bands.filter((b) => b.h === EMPTY_BAND_H)).toHaveLength(6)
  })
})

describe("[A26] 指示の選び方(番号0〈最初の入力の前〉があっても)", () => {
  it("既定は最後の指示、前後は配列の位置で", () => {
    expect(pickInstruction([0, 1], null)).toBe(1)
    expect(pickInstruction([0], null)).toBe(0)
    expect(pickInstruction([], null)).toBeNull()
    expect(pickInstruction([1, 2, 3], 2)).toBe(2)
    expect(pickInstruction([1, 2, 3], 9)).toBe(3)
    expect(stepInstruction([0, 1, 2], 1, -1)).toBe(0)
    expect(stepInstruction([0, 1, 2], 2, 1)).toBeNull()
    expect(stepInstruction([0, 1, 2], 0, -1)).toBeNull()
  })
})

describe("[A20] 再生の間隔と番号", () => {
  it("全体15秒以内・1歩300ms 以上", () => {
    for (const n of [1, 5, 12, 13, 50, 100]) {
      const i = playbackInterval(n)
      expect(i).toBeGreaterThanOrEqual(300)
      if (n * 300 <= 15000) expect(i * n).toBeLessThanOrEqual(15000)
    }
    expect(playbackInterval(12)).toBe(1200)
  })
  it("丸囲みの番号", () => {
    expect(circled(1)).toBe("①")
    expect(circled(12)).toBe("⑫")
    expect(circled(21)).toBe("(21)")
  })
})
