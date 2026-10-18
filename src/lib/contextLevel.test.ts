import { describe, expect, it } from "vitest"
import { CTX_CRITICAL_RATIO, CTX_WARNING_RATIO, ctxLevel, ctxRatio } from "./contextLevel"

describe("コンテキストの段階", () => {
  it("79.9%は通常、80%は黄、89.9%は黄、90%は赤", () => {
    expect(ctxLevel(0.799)).toBe("ok")
    expect(ctxLevel(0.8)).toBe("warning")
    expect(ctxLevel(0.899)).toBe("warning")
    expect(ctxLevel(0.9)).toBe("critical")
    expect(ctxLevel(1)).toBe("critical")
    expect(ctxLevel(0)).toBe("ok")
    expect([CTX_WARNING_RATIO, CTX_CRITICAL_RATIO]).toEqual([0.8, 0.9])
  })

  it("使用率は上限を超えない。上限が不明なら null", () => {
    expect(ctxRatio(500, 1000)).toBe(0.5)
    expect(ctxRatio(2000, 1000)).toBe(1)
    expect(ctxRatio(null, 1000)).toBeNull()
    expect(ctxRatio(500, null)).toBeNull()
    expect(ctxRatio(500, 0)).toBeNull()
  })
})
