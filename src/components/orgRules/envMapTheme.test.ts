import { describe, expect, it } from "vitest"
import { CONFLICT_EDGE, NORMAL_EDGE, STRENGTH_TEXT, strengthBorder } from "./envMapTheme"

describe("[A18・中2・低1] 形で見分ける", () => {
  it("食い違う決まりの線は破線で、通常の線の倍以上の太さ", () => {
    expect(CONFLICT_EDGE.style).toBe("dashed")
    expect(NORMAL_EDGE.style).toBe("solid")
    expect(CONFLICT_EDGE.width / NORMAL_EDGE.width).toBeGreaterThanOrEqual(2)
    // 短い線では破線が形に出ないので、矢印の形も替える
    expect(CONFLICT_EDGE.arrow).toBe("tee")
    // 隣り合う箱の間でも破線の模様が出る長さ(8+4 の2回分以上)になるよう曲げる
    expect(CONFLICT_EDGE.bend).toBeGreaterThanOrEqual(24)
  })
  it("5つの強さの枠は、太さ・線の種類・色のどれかで互いに違う", () => {
    const all = (["stop", "judge", "watch", "read", "none"] as const).map((s) => JSON.stringify(strengthBorder(s)))
    expect(new Set(all).size).toBe(5)
    expect(strengthBorder("none").muted).toBe(true)
    expect(strengthBorder("read").muted).toBe(false)
  })
  it("記録だけの枠は点線で、食い違いの線(破線)と線の種類が違う", () => {
    expect(strengthBorder("watch").style).toBe("dotted")
    expect(strengthBorder("watch").style).not.toBe(CONFLICT_EDGE.style)
  })
  it("凡例の言葉に英語が無い", () => {
    for (const t of Object.values(STRENGTH_TEXT)) expect(t).not.toMatch(/[A-Za-z]/)
  })
})
