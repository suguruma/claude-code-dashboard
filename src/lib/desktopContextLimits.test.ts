import { describe, expect, it } from "vitest"
import { DEFAULT_CONTEXT_LIMIT, EXTENDED_CONTEXT_LIMIT, resolveContextLimit } from "./desktopContextLimits"

describe("resolveContextLimit", () => {
  it("既知のモデル群は仮置きの表から、未知のモデルは既定値を使う", () => {
    expect(resolveContextLimit("claude-sonnet-5-5", 1000)).toBe(EXTENDED_CONTEXT_LIMIT)
    expect(resolveContextLimit("claude-haiku-5-5", 1000)).toBe(DEFAULT_CONTEXT_LIMIT)
    expect(resolveContextLimit("claude-opus-4-7", 1000)).toBe(DEFAULT_CONTEXT_LIMIT)
    expect(resolveContextLimit(null, 1000)).toBe(DEFAULT_CONTEXT_LIMIT)
  })

  it("claude-opus-4-8 は1M(実測で60万トークンを超える使用量があり、200Kとは扱えない)", () => {
    expect(resolveContextLimit("claude-opus-4-8", 607_659)).toBe(EXTENDED_CONTEXT_LIMIT)
    expect(resolveContextLimit("claude-opus-4-8", 1000)).toBe(EXTENDED_CONTEXT_LIMIT)
  })

  it("[1m] 接尾辞があれば1M", () => {
    expect(resolveContextLimit("claude-opus-4-8[1m]", 1000)).toBe(EXTENDED_CONTEXT_LIMIT)
  })

  it("設定による上書きは、より長い前方一致を優先する", () => {
    expect(resolveContextLimit("claude-sonnet-5-5", 1000, { "claude-sonnet": 300_000, "claude-sonnet-5": 400_000 })).toBe(400_000)
  })

  it("実測の使用量が上限を超えていたら1Mに引き上げる", () => {
    expect(resolveContextLimit("claude-opus-4-7", 250_000)).toBe(EXTENDED_CONTEXT_LIMIT)
    expect(resolveContextLimit("claude-unknown-model", 250_000)).toBe(EXTENDED_CONTEXT_LIMIT)
  })
})
